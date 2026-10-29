'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SPEED_LIMIT_KMH = 95;
const FINE_PER_KMH_EUR = 100;
const STORE_VERSION = 1;
const TIME_ZONE = 'Europe/Berlin';

const defaultDataPath = path.join(__dirname, '..', '..', 'data', 'speedBilling.json');
const dataPath = process.env.HKC_BILLING_DATA_PATH
    ? path.resolve(process.env.HKC_BILLING_DATA_PATH)
    : defaultDataPath;

function writeFileAtomicSync(filePath, content) {
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, filePath);
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}

function ensureStore() {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    if (!fs.existsSync(dataPath)) {
        writeFileAtomicSync(dataPath, JSON.stringify({ version: STORE_VERSION, jobs: {}, invoices: {}, audit: [] }, null, 2));
    }
}

function readStore() {
    ensureStore();
    let data;
    try {
        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (error) {
        // Do not replace corrupt data: it may contain billing evidence.
        throw new Error(`Geschwindigkeitsabrechnung: Datenspeicher nicht lesbar (${error.message}).`);
    }
    if (!data || data.version !== STORE_VERSION || !isObject(data.jobs) || !isObject(data.invoices) || !Array.isArray(data.audit)) {
        throw new Error('Geschwindigkeitsabrechnung: ungültige Datenstruktur; Datei wurde nicht überschrieben.');
    }
    return data;
}

function writeStore(data) {
    writeFileAtomicSync(dataPath, JSON.stringify(data, null, 2));
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value, label) {
    const result = String(value ?? '').trim();
    if (!result) throw new TypeError(`${label} fehlt.`);
    return result;
}

function parseDate(value, label) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} ist kein gültiger Zeitstempel.`);
    return date;
}

function monthKeyInBerlin(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    return `${year}-${month}`;
}

function calculateFine(maxVelocityKmh) {
    if (maxVelocityKmh === null || maxVelocityKmh === undefined || maxVelocityKmh === '') {
        return { status: 'pending_evidence', excessKmh: null, fineEur: null };
    }
    const speed = Number(maxVelocityKmh);
    if (!Number.isFinite(speed) || speed < 0) {
        throw new TypeError('Höchstgeschwindigkeit muss eine endliche, nichtnegative Zahl sein.');
    }
    // Use whole km/h as agreed; do not round a floating-point telemetry value up.
    const provenMaxKmh = Math.floor(speed);
    const excessKmh = Math.max(0, provenMaxKmh - SPEED_LIMIT_KMH);
    return {
        status: excessKmh > 0 ? 'fine_assessed' : 'no_violation',
        provenMaxKmh,
        excessKmh,
        fineEur: excessKmh * FINE_PER_KMH_EUR,
    };
}

function addAudit(data, action, actorDiscordId, details = {}) {
    data.audit.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        action,
        actorDiscordId: actorDiscordId == null ? null : String(actorDiscordId),
        details,
    });
}

/**
 * Records one completed SpedV job. The caller must only invoke this after independently
 * verifying that the task is completed and the speed value is trustworthy.
 * A missing speed creates a reviewable pending-evidence record, never a fine.
 */
function recordCompletedJob(input, actorDiscordId = null) {
    const guildId = requireText(input?.guildId, 'guildId');
    const taskId = requireText(input?.taskId, 'taskId');
    const spedvUserId = requireText(input?.spedvUserId, 'SpedV-Fahrer-ID');
    const discordUserId = requireText(input?.discordUserId, 'Discord-Fahrer-ID');
    const completedAt = parseDate(input?.completedAt, 'Abschlusszeitpunkt');
    const key = `${guildId}:${taskId}`;
    const data = readStore();
    const existing = data.jobs[key];

    if (existing && existing.status !== 'pending_evidence') {
        return { created: false, updated: false, duplicate: true, job: existing };
    }

    const calculation = calculateFine(input?.maxVelocityKmh);
    const now = new Date().toISOString();
    const job = {
        key,
        guildId,
        taskId,
        spedvUserId,
        discordUserId,
        completedAt: completedAt.toISOString(),
        billingMonth: monthKeyInBerlin(completedAt),
        maxVelocityKmh: calculation.provenMaxKmh ?? null,
        excessKmh: calculation.excessKmh,
        fineEur: calculation.fineEur,
        status: calculation.status,
        evidenceSource: input?.evidenceSource ? String(input.evidenceSource) : null,
        evidenceCapturedAt: calculation.status === 'pending_evidence' ? null : now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        invoiceId: existing?.invoiceId ?? null,
    };
    data.jobs[key] = job;
    addAudit(data, existing ? 'job_evidence_updated' : 'completed_job_recorded', actorDiscordId, {
        guildId, taskId, status: job.status, fineEur: job.fineEur,
    });
    writeStore(data);
    return { created: !existing, updated: Boolean(existing), duplicate: false, job };
}

/** Builds a draft invoice for one driver and calendar month; does not send anything. */
function createMonthlyInvoice(input, actorDiscordId = null) {
    const guildId = requireText(input?.guildId, 'guildId');
    const discordUserId = requireText(input?.discordUserId, 'Discord-Fahrer-ID');
    const month = requireText(input?.month, 'Abrechnungsmonat');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new TypeError('Monat muss im Format YYYY-MM angegeben werden.');

    const data = readStore();
    const invoiceId = `${guildId}:${month}:${discordUserId}`;
    if (data.invoices[invoiceId]) {
        return { created: false, duplicate: true, invoice: data.invoices[invoiceId] };
    }

    const jobs = Object.values(data.jobs).filter(job =>
        job.guildId === guildId &&
        job.discordUserId === discordUserId &&
        job.billingMonth === month &&
        job.status === 'fine_assessed' &&
        !job.invoiceId
    );

    if (jobs.some(job => job.status === 'pending_evidence')) {
        throw new Error('Interner Statusfehler: Aufträge mit fehlendem Nachweis dürfen nicht fakturiert werden.');
    }

    const lines = jobs.map(job => ({
        taskId: job.taskId,
        completedAt: job.completedAt,
        maxVelocityKmh: job.maxVelocityKmh,
        excessKmh: job.excessKmh,
        amountEur: job.fineEur,
    }));
    const now = new Date().toISOString();
    const invoice = {
        id: invoiceId,
        guildId,
        discordUserId,
        month,
        status: 'draft',
        currency: 'EUR',
        lineItems: lines,
        totalEur: lines.reduce((sum, line) => sum + line.amountEur, 0),
        createdAt: now,
        updatedAt: now,
        sendAttemptAt: null,
        dueAt: null,
        paidAt: null,
        paidByDiscordId: null,
        warningSentAt: null,
    };
    data.invoices[invoiceId] = invoice;
    for (const job of jobs) job.invoiceId = invoiceId;
    addAudit(data, 'monthly_invoice_drafted', actorDiscordId, {
        invoiceId, lineCount: lines.length, totalEur: invoice.totalEur,
    });
    writeStore(data);
    return { created: true, duplicate: false, invoice };
}

/** Records the DM send attempt timestamp, regardless of whether delivery succeeded. */
function recordInvoiceSendAttempt(invoiceId, attemptedAt = new Date(), delivery = 'unknown', actorDiscordId = null) {
    const data = readStore();
    const invoice = data.invoices[requireText(invoiceId, 'Rechnungs-ID')];
    if (!invoice) throw new Error('Rechnung nicht gefunden.');
    if (invoice.status !== 'draft' && invoice.status !== 'sent') throw new Error('Versandversuch für diesen Rechnungsstatus nicht zulässig.');
    const sentAt = parseDate(attemptedAt, 'Versuchszeitpunkt');
    const firstAttempt = !invoice.sendAttemptAt;
    // The contractual 14-day period starts at the first attempt and must not be reset by retries.
    if (firstAttempt) {
        invoice.sendAttemptAt = sentAt.toISOString();
        invoice.dueAt = new Date(sentAt.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    }
    const normalizedDelivery = ['delivered', 'failed', 'unknown'].includes(delivery) ? delivery : 'unknown';
    invoice.delivery = firstAttempt || invoice.delivery === 'unknown' ? normalizedDelivery : invoice.delivery;
    invoice.status = 'sent';
    invoice.updatedAt = new Date().toISOString();
    addAudit(data, firstAttempt ? 'invoice_send_attempt_recorded' : 'invoice_send_retry_recorded', actorDiscordId, {
        invoiceId, delivery: normalizedDelivery, dueAt: invoice.dueAt, firstAttempt,
    });
    writeStore(data);
    return invoice;
}

function markInvoicePaid(invoiceId, actorDiscordId, authorizedRoleIds, allowedRoleIds) {
    const actorId = requireText(actorDiscordId, 'Discord-ID der ausführenden Person');
    const authorized = new Set((authorizedRoleIds || []).map(String));
    const allowed = new Set((allowedRoleIds || []).map(String));
    if (![...authorized].some(roleId => allowed.has(roleId))) throw new Error('Keine Berechtigung zur Zahlungsbestätigung.');

    const data = readStore();
    const invoice = data.invoices[requireText(invoiceId, 'Rechnungs-ID')];
    if (!invoice) throw new Error('Rechnung nicht gefunden.');
    if (invoice.status === 'paid') return { updated: false, duplicate: true, invoice };
    if (invoice.status !== 'sent') throw new Error('Nur versendete Rechnungen können als bezahlt markiert werden.');
    invoice.status = 'paid';
    invoice.paidAt = new Date().toISOString();
    invoice.paidByDiscordId = actorId;
    invoice.updatedAt = invoice.paidAt;
    addAudit(data, 'invoice_marked_paid', actorId, { invoiceId });
    writeStore(data);
    return { updated: true, duplicate: false, invoice };
}

function listJobs(filters = {}) {
    return Object.values(readStore().jobs).filter(job =>
        (!filters.guildId || job.guildId === String(filters.guildId)) &&
        (!filters.month || job.billingMonth === filters.month) &&
        (!filters.discordUserId || job.discordUserId === String(filters.discordUserId)) &&
        (!filters.status || job.status === filters.status)
    );
}

function listInvoices(filters = {}) {
    return Object.values(readStore().invoices).filter(invoice =>
        (!filters.guildId || invoice.guildId === String(filters.guildId)) &&
        (!filters.month || invoice.month === filters.month) &&
        (!filters.discordUserId || invoice.discordUserId === String(filters.discordUserId)) &&
        (!filters.status || invoice.status === filters.status)
    );
}

module.exports = {
    SPEED_LIMIT_KMH,
    FINE_PER_KMH_EUR,
    calculateFine,
    recordCompletedJob,
    createMonthlyInvoice,
    recordInvoiceSendAttempt,
    markInvoicePaid,
    listJobs,
    listInvoices,
};
