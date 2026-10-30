
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SPEED_LIMIT_KMH = 95;
const FINE_PER_KMH_EUR = 100;
const STORE_VERSION = 1;
const TIME_ZONE = 'Europe/Berlin';
const BILLING_START_DATE = '2026-11-01';
const BILLING_START_MONTH = '2026-11';

const LOCK_TIMEOUT_MS = 15000;
const LOCK_RETRY_INTERVAL_MS = 50;

const REVIEW_STATUSES = new Set([
    'pending_evidence',
    'review_cleaned_telemetry',
    'review_missing_telemetry',
    'review_incomplete_telemetry',
    'review_speed_conflict',
    'review_details_unavailable',
    'review_missing_completion_time',
    'review_unverified_driver_link',
]);

function isReviewStatus(status) {
    return REVIEW_STATUSES.has(status) ||
        (typeof status === 'string' && status.startsWith('review_'));
}

function validateBillingMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new TypeError('Monat muss im Format YYYY-MM angegeben werden.');
    }

    if (month < BILLING_START_MONTH) {
        throw new Error(
            `Abrechnung gesperrt: Der Abrechnungsbeginn ist der ${BILLING_START_DATE}.`
        );
    }
}

const defaultDataPath = path.join(
    __dirname,
    '..',
    '..',
    'data',
    'speedBilling.json'
);

const dataPath = process.env.HKC_BILLING_DATA_PATH
    ? path.resolve(process.env.HKC_BILLING_DATA_PATH)
    : defaultDataPath;

const lockPath = `${dataPath}.lock`;

function isObject(value) {
    return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value);
}

function sleepSync(milliseconds) {
    const sharedBuffer = new SharedArrayBuffer(4);
    const lock = new Int32Array(sharedBuffer);

    Atomics.wait(lock, 0, 0, milliseconds);
}

/**
 * Exklusive prozessübergreifende Sperre.
 *
 * Die Lock-Datei wird mit wx angelegt.
 * Existiert sie bereits, wird bis zum Timeout gewartet.
 *
 * Verwaiste Lock-Dateien werden NICHT automatisch entfernt.
 */

function withStoreLock(callback) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });

    const lockToken = crypto.randomUUID();
    const startedAt = Date.now();

    let lockFd = null;

    while (lockFd === null) {
        let createdLock = false;

        try {
            lockFd = fs.openSync(lockPath, 'wx');
            createdLock = true;

            fs.writeFileSync(
                lockFd,
                JSON.stringify({
                    token: lockToken,
                    pid: process.pid,
                    createdAt: new Date().toISOString(),
                }, null, 2),
                'utf8'
            );
        } catch (error) {
            if (lockFd !== null) {
                try {
                    fs.closeSync(lockFd);
                } catch {
                    // Ursprünglichen Fehler beibehalten.
                }

                lockFd = null;
            }

            if (createdLock) {
                try {
                    fs.unlinkSync(lockPath);
                } catch {
                    // Ursprünglichen Fehler beibehalten.
                }

                throw error;
            }

            if (error.code !== 'EEXIST') {
                throw error;
            }

            if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
                let owner = 'Besitzerinformationen nicht lesbar';

                try {
                    owner = fs.readFileSync(lockPath, 'utf8');
                } catch {
                    // Lock-Datei könnte gerade entfernt worden sein.
                }

                throw new Error(
                    `Billing-Store ist nach ${LOCK_TIMEOUT_MS} ms weiterhin gesperrt. ` +
                    `Lock-Datei: ${lockPath}. Inhalt: ${owner}`
                );
            }

            sleepSync(LOCK_RETRY_INTERVAL_MS);
        }
    }

    let callbackError = null;
    let callbackResult;

    try {
        callbackResult = callback();
    } catch (error) {
        callbackError = error;
    }

    let releaseError = null;

    try {
        // Identität des ursprünglich geöffneten Locks sichern.
        const ownedLockStat = fs.fstatSync(lockFd);

        fs.closeSync(lockFd);
        lockFd = null;

        let currentLockStat;

        try {
            currentLockStat = fs.statSync(lockPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        if (currentLockStat) {
            const sameFile =
                ownedLockStat.dev === currentLockStat.dev &&
                ownedLockStat.ino === currentLockStat.ino;

            if (!sameFile) {
                throw new Error(
                    'Lock-Freigabe abgebrochen: Die Lock-Datei gehört nicht mehr ' +
                    'zu dem ursprünglich geöffneten Dateiobjekt.'
                );
            }

            fs.unlinkSync(lockPath);
        }
    } catch (error) {
        releaseError = error;

        if (lockFd !== null) {
            try {
                fs.closeSync(lockFd);
            } catch {
                // Bereits vorhandenen Freigabefehler beibehalten.
            }

            lockFd = null;
        }
    }

    // Ein Fehler aus der eigentlichen Operation hat Vorrang.
    if (callbackError) {
        if (releaseError) {
            callbackError.releaseError = releaseError;
        }

        throw callbackError;
    }

    if (releaseError) {
        throw new Error(
            `Billing-Store: Lock konnte nicht sicher freigegeben werden: ` +
            releaseError.message,
            { cause: releaseError }
        );
    }

    return callbackResult;
}

function writeFileAtomicSync(filePath, content) {
    const tempPath =
        `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

    try {
        fs.writeFileSync(tempPath, content, {
            encoding: 'utf8',
            flag: 'wx',
        });

        fs.renameSync(tempPath, filePath);
    } finally {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
}

/**
 * Legt den Store bei Bedarf exklusiv an.
 * Parallele Initialisierungen überschreiben sich nicht.
 */
function ensureStore() {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });

    let fd;

    try {
        fd = fs.openSync(dataPath, 'wx');

        fs.writeFileSync(
            fd,
            JSON.stringify({
                version: STORE_VERSION,
                jobs: {},
                invoices: {},
                reviewCases: {},
                audit: [],
            }, null, 2),
            'utf8'
        );
    } catch (error) {
        if (error.code !== 'EEXIST') {
            if (fd !== undefined) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // Ursprünglichen Fehler beibehalten.
                }

                fd = undefined;

                try {
                    fs.unlinkSync(dataPath);
                } catch {
                    // Ursprünglichen Fehler beibehalten.
                }
            }

            throw error;
        }
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

function readStore() {
    ensureStore();

    let data;

    try {
        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (error) {
        throw new Error(
            `Geschwindigkeitsabrechnung: Datenspeicher nicht lesbar (${error.message}).`
        );
    }

    if (
        !data ||
        data.version !== STORE_VERSION ||
        !isObject(data.jobs) ||
        !isObject(data.invoices) ||
        !Array.isArray(data.audit)
    ) {
        throw new Error(
            'Geschwindigkeitsabrechnung: ungültige Datenstruktur; Datei wurde nicht überschrieben.'
        );
    }

    if (data.reviewCases === undefined) {
        data.reviewCases = {};
    }

    if (!isObject(data.reviewCases)) {
        throw new Error(
            'Geschwindigkeitsabrechnung: reviewCases ist keine gültige Datenstruktur.'
        );
    }

    return data;
}

function writeStore(data) {
    writeFileAtomicSync(
        dataPath,
        JSON.stringify(data, null, 2)
    );
}

function requireText(value, label) {
    const result = String(value ?? '').trim();

    if (!result) {
        throw new TypeError(`${label} fehlt.`);
    }

    return result;
}

function optionalText(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const result = String(value).trim();
    return result || null;
}

function parseDate(value, label) {
    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
        throw new TypeError(`${label} ist kein gültiger Zeitstempel.`);
    }

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
    if (
        maxVelocityKmh === null ||
        maxVelocityKmh === undefined ||
        maxVelocityKmh === ''
    ) {
        return {
            status: 'pending_evidence',
            excessKmh: null,
            fineEur: null,
        };
    }

    const speed = Number(maxVelocityKmh);

    if (!Number.isFinite(speed) || speed < 0) {
        throw new TypeError(
            'Höchstgeschwindigkeit muss eine endliche, nichtnegative Zahl sein.'
        );
    }

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
        actorDiscordId: actorDiscordId == null
            ? null
            : String(actorDiscordId),
        details,
    });
}

function recordReviewCase(input, actorDiscordId = null) {
    const guildId = requireText(input?.guildId, 'guildId');
    const taskId = requireText(input?.taskId, 'taskId');

    const billingMonth = optionalText(input?.billingMonth);
    const discordUserId = optionalText(input?.discordUserId);
    const spedvUserId = optionalText(input?.spedvUserId);
    const spedvName = optionalText(input?.spedvName);

    const status = requireText(
        input?.status || 'pending_evidence',
        'Nachweisstatus'
    );

    if (!isReviewStatus(status)) {
        throw new TypeError(
            'Ein Nachweisfall benötigt einen gültigen Review-Status.'
        );
    }

    if (billingMonth !== null) {
        validateBillingMonth(billingMonth);
    }

    const key = `${guildId}:${taskId}`;
    const data = readStore();
    const existing = data.reviewCases[key];

    if (existing?.status === 'resolved') {
        return {
            created: false,
            updated: false,
            duplicate: true,
            reviewCase: existing,
        };
    }

    const now = new Date().toISOString();

    const reviewCase = {
        key,
        guildId,
        taskId,
        billingMonth,
        discordUserId,
        spedvUserId,
        spedvName,
        status,
        reason: requireText(
            input?.reason || 'Manuelle Nachweisprüfung erforderlich.',
            'Nachweisgrund'
        ),
        globalBlock: billingMonth === null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        resolvedAt: null,
        resolvedByDiscordId: null,
        resolutionReason: null,
    };

    data.reviewCases[key] = reviewCase;

    addAudit(
        data,
        existing ? 'review_case_updated' : 'review_case_created',
        actorDiscordId,
        {
            guildId,
            taskId,
            billingMonth,
            discordUserId,
            status,
            globalBlock: reviewCase.globalBlock,
        }
    );

    writeStore(data);

    return {
        created: !existing,
        updated: Boolean(existing),
        duplicate: false,
        reviewCase,
    };
}

function resolveReviewCase(
    input,
    actorDiscordId,
    resolutionReason
) {
    const guildId = requireText(input?.guildId, 'guildId');
    const taskId = requireText(input?.taskId, 'taskId');

    const actorId = requireText(
        actorDiscordId,
        'Discord-ID der auflösenden Person'
    );

    const reason = requireText(
        resolutionReason,
        'Begründung der Auflösung'
    );

    const key = `${guildId}:${taskId}`;
    const data = readStore();
    const reviewCase = data.reviewCases[key];

    if (!reviewCase) {
        throw new Error(`Nachweisfall nicht gefunden: ${key}`);
    }

    if (reviewCase.status === 'resolved') {
        return {
            updated: false,
            duplicate: true,
            reviewCase,
        };
    }

    const now = new Date().toISOString();

    reviewCase.status = 'resolved';
    reviewCase.globalBlock = false;
    reviewCase.resolvedAt = now;
    reviewCase.resolvedByDiscordId = actorId;
    reviewCase.resolutionReason = reason;
    reviewCase.updatedAt = now;

    addAudit(data, 'review_case_resolved', actorId, {
        guildId,
        taskId,
        billingMonth: reviewCase.billingMonth,
        discordUserId: reviewCase.discordUserId,
        resolutionReason: reason,
    });

    writeStore(data);

    return {
        updated: true,
        duplicate: false,
        reviewCase,
    };
}

function listReviewCases(filters = {}) {
    return Object.values(readStore().reviewCases).filter(reviewCase =>
        (!filters.guildId ||
            reviewCase.guildId === String(filters.guildId)) &&
        (!filters.month ||
            reviewCase.billingMonth === String(filters.month)) &&
        (!filters.discordUserId ||
            reviewCase.discordUserId === String(filters.discordUserId)) &&
        (!filters.status ||
            reviewCase.status === String(filters.status)) &&
        (filters.includeResolved ||
            reviewCase.status !== 'resolved')
    );
}

function resolveMatchingReviewCase(data, guildId, taskId, actorDiscordId) {
    const key = `${guildId}:${taskId}`;
    const reviewCase = data.reviewCases[key];

    if (!reviewCase || reviewCase.status === 'resolved') {
        return false;
    }

    const now = new Date().toISOString();

    reviewCase.status = 'resolved';
    reviewCase.globalBlock = false;
    reviewCase.resolvedAt = now;
    reviewCase.resolvedByDiscordId = actorDiscordId == null
        ? null
        : String(actorDiscordId);

    reviewCase.resolutionReason =
        'Durch erfolgreichen erneuten Auftragsnachweis aufgelöst.';

    reviewCase.updatedAt = now;

    addAudit(data, 'review_case_resolved_by_job_evidence', actorDiscordId, {
        guildId,
        taskId,
        billingMonth: reviewCase.billingMonth,
    });

    return true;
}


function reconcileJobWithExistingInvoice(data, job, actorDiscordId = null) {
    if (job.status !== 'fine_assessed') {
        return { action: 'not_billable' };
    }

    const invoiceId =
        `${job.guildId}:${job.billingMonth}:${job.discordUserId}`;

    const invoice = data.invoices[invoiceId];

    if (!invoice) {
        return { action: 'no_invoice' };
    }

    const existingLine = invoice.lineItems.find(
        item => item.taskId === job.taskId
    );

    if (invoice.status === 'draft') {
        if (!existingLine) {
            invoice.lineItems.push({
                taskId: job.taskId,
                completedAt: job.completedAt,
                maxVelocityKmh: job.maxVelocityKmh,
                excessKmh: job.excessKmh,
                amountEur: job.fineEur,
            });

            invoice.totalEur = invoice.lineItems.reduce(
                (sum, line) => sum + line.amountEur,
                0
            );

            invoice.updatedAt = new Date().toISOString();

            addAudit(
                data,
                'invoice_draft_updated_with_late_job',
                actorDiscordId,
                {
                    invoiceId,
                    taskId: job.taskId,
                    totalEur: invoice.totalEur,
                }
            );
        }

        job.invoiceId = invoiceId;
        job.billingFollowUp = null;

        return { action: 'added_to_draft', invoiceId };
    }

    if (existingLine) {
        job.invoiceId = invoiceId;
        job.billingFollowUp = null;

        return { action: 'already_in_invoice', invoiceId };
    }

    const now = new Date().toISOString();

    job.billingFollowUp = {
        status: 'open',
        invoiceId,
        reason: `Nachträglicher Auftrag bei Rechnungsstatus "${invoice.status}".`,
        createdAt: now,
        resolvedAt: null,
        resolvedByDiscordId: null,
        resolutionReason: null,
    };

    addAudit(
        data,
        'late_job_requires_manual_billing_follow_up',
        actorDiscordId,
        {
            invoiceId,
            taskId: job.taskId,
            invoiceStatus: invoice.status,
            fineEur: job.fineEur,
        }
    );

    return { action: 'manual_follow_up', invoiceId };
}

function recordCompletedJob(input, actorDiscordId = null) {
    const guildId = requireText(input?.guildId, 'guildId');
    const taskId = requireText(input?.taskId, 'taskId');

    const spedvUserId = requireText(
        input?.spedvUserId,
        'SpedV-Fahrer-ID'
    );

    const discordUserId = requireText(
        input?.discordUserId,
        'Discord-Fahrer-ID'
    );

    const completedAt = parseDate(
        input?.completedAt,
        'Abschlusszeitpunkt'
    );

    const billingMonth = monthKeyInBerlin(completedAt);
    validateBillingMonth(billingMonth);

    const key = `${guildId}:${taskId}`;
    const data = readStore();
    const existing = data.jobs[key];

    if (existing?.invoiceId) {
        return {
            created: false,
            updated: false,
            duplicate: true,
            job: existing,
        };
    }

    if (
        existing &&
        existing.status !== 'pending_evidence' &&
        !isReviewStatus(existing.status)
    ) {
        return {
            created: false,
            updated: false,
            duplicate: true,
            job: existing,
        };
    }

    const requestedStatus = input?.status == null
        ? null
        : String(input.status);

    let calculation;

    if (requestedStatus && isReviewStatus(requestedStatus)) {
        calculation = {
            status: requestedStatus,
            provenMaxKmh: null,
            excessKmh: null,
            fineEur: null,
        };
    } else {
        calculation = calculateFine(input?.maxVelocityKmh);
    }

    const now = new Date().toISOString();

    const job = {
        key,
        guildId,
        taskId,
        spedvUserId,
        discordUserId,
        completedAt: completedAt.toISOString(),
        billingMonth,
        maxVelocityKmh: calculation.provenMaxKmh ?? null,
        excessKmh: calculation.excessKmh,
        fineEur: calculation.fineEur,
        status: calculation.status,
        reviewReason: isReviewStatus(calculation.status)
            ? String(
                input?.reviewReason ||
                'Manuelle Nachweisprüfung erforderlich.'
            )
            : null,
        evidenceSource: input?.evidenceSource
            ? String(input.evidenceSource)
            : null,
        evidenceCapturedAt: isReviewStatus(calculation.status)
            ? null
            : now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        invoiceId: null,
        billingFollowUp: null,
    };

    data.jobs[key] = job;
    const invoiceReconciliation =
        reconcileJobWithExistingInvoice(
            data,
            job,
            actorDiscordId
        );
    

    if (!isReviewStatus(job.status)) {
        resolveMatchingReviewCase(
            data,
            guildId,
            taskId,
            actorDiscordId
        );
    }

    addAudit(
        data,
        existing ? 'job_evidence_updated' : 'completed_job_recorded',
        actorDiscordId,
        {
            guildId,
            taskId,
            status: job.status,
            fineEur: job.fineEur,
            billingMonth,
        }
    );

    writeStore(data);

    return {
        created: !existing,
        updated: Boolean(existing),
        duplicate: false,
        job,
        invoiceReconciliation,
    };
}

function findBlockingReviewCases(data, guildId, month, discordUserId) {
    return Object.values(data.reviewCases).filter(reviewCase => {
        if (
            reviewCase.guildId !== guildId ||
            reviewCase.status === 'resolved'
        ) {
            return false;
        }

        if (
            reviewCase.globalBlock ||
            !reviewCase.billingMonth
        ) {
            return true;
        }

        if (reviewCase.billingMonth !== month) {
            return false;
        }

        if (!reviewCase.discordUserId) {
            return true;
        }

        return reviewCase.discordUserId === discordUserId;
    });
}

function createMonthlyInvoice(input, actorDiscordId = null) {
    const guildId = requireText(input?.guildId, 'guildId');

    const discordUserId = requireText(
        input?.discordUserId,
        'Discord-Fahrer-ID'
    );

    const month = requireText(
        input?.month,
        'Abrechnungsmonat'
    );

    validateBillingMonth(month);

    const data = readStore();
    const invoiceId = `${guildId}:${month}:${discordUserId}`;

    if (data.invoices[invoiceId]) {
        return {
            created: false,
            duplicate: true,
            invoice: data.invoices[invoiceId],
        };
    }

    const blockingReviewCases = findBlockingReviewCases(
        data,
        guildId,
        month,
        discordUserId
    );

    if (blockingReviewCases.length > 0) {
        const taskIds = blockingReviewCases
            .map(reviewCase => reviewCase.taskId)
            .join(', ');

        throw new Error(
            `Rechnung gesperrt: ${blockingReviewCases.length} offene Nachweisfall/Nachweisfälle müssen zuerst geklärt werden (Aufträge: ${taskIds}).`
        );
    }

    const driverJobs = Object.values(data.jobs).filter(job =>
        job.guildId === guildId &&
        job.discordUserId === discordUserId &&
        job.billingMonth === month
    );

    const pendingJobs = driverJobs.filter(job =>
        isReviewStatus(job.status)
    );

    if (pendingJobs.length > 0) {
        const taskIds = pendingJobs
            .map(job => job.taskId)
            .join(', ');

        throw new Error(
            `Rechnung gesperrt: ${pendingJobs.length} Auftrag/Aufträge benötigen noch eine manuelle Nachweisprüfung (${taskIds}).`
        );
    }

    const jobs = driverJobs.filter(job =>
        job.status === 'fine_assessed' &&
        !job.invoiceId
    );

    if (jobs.length === 0) {
        throw new Error(
            'Keine abrechenbaren Verstöße für diesen Fahrer und Monat vorhanden.'
        );
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
        totalEur: lines.reduce(
            (sum, line) => sum + line.amountEur,
            0
        ),
        createdAt: now,
        updatedAt: now,
        sendAttemptAt: null,
        dueAt: null,
        paidAt: null,
        paidByDiscordId: null,
        warningSentAt: null,
    };

    data.invoices[invoiceId] = invoice;

    for (const job of jobs) {
        job.invoiceId = invoiceId;
    }

    addAudit(data, 'monthly_invoice_drafted', actorDiscordId, {
        invoiceId,
        lineCount: lines.length,
        totalEur: invoice.totalEur,
    });

    writeStore(data);

    return {
        created: true,
        duplicate: false,
        invoice,
    };
}

function addBerlinCalendarDays(date, days) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });

    const parts = Object.fromEntries(
        formatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    );

    // Berliner Kalenderdatum ermitteln und 14 Kalendertage addieren.
    const targetCalendarDate = new Date(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day + days,
        parts.hour,
        parts.minute,
        parts.second
    ));

    const target = {
        year: targetCalendarDate.getUTCFullYear(),
        month: targetCalendarDate.getUTCMonth() + 1,
        day: targetCalendarDate.getUTCDate(),
        hour: targetCalendarDate.getUTCHours(),
        minute: targetCalendarDate.getUTCMinutes(),
        second: targetCalendarDate.getUTCSeconds(),
    };

    const targetWallTime = Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hour,
        target.minute,
        target.second
    );

    function getBerlinParts(timestamp) {
        const values = Object.fromEntries(
            formatter.formatToParts(new Date(timestamp))
                .filter(part => part.type !== 'literal')
                .map(part => [part.type, Number(part.value)])
        );

        return {
            year: values.year,
            month: values.month,
            day: values.day,
            hour: values.hour,
            minute: values.minute,
            second: values.second,
        };
    }

    function getWallTime(parts) {
        return Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second
        );
    }

    // Mögliche UTC-Offsets rund um den Zielzeitpunkt ermitteln.
    const offsets = new Set();

    for (let hours = -36; hours <= 36; hours += 6) {
        const probe = targetWallTime + hours * 60 * 60 * 1000;
        const localWallTime = getWallTime(getBerlinParts(probe));

        offsets.add(localWallTime - probe);
    }

    const candidates = [...offsets].map(offset => {
        const timestamp = targetWallTime - offset;
        const actualParts = getBerlinParts(timestamp);

        return {
            timestamp,
            wallTime: getWallTime(actualParts),
        };
    });

    // Doppelte Stunde: das erste Vorkommen verwenden.
    const exactMatches = candidates
        .filter(candidate => candidate.wallTime === targetWallTime)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (exactMatches.length > 0) {
        return new Date(exactMatches[0].timestamp);
    }

    // Sommerzeitlücke: um die Lücke nach vorne verschieben.
    const nextValidTimes = candidates
        .filter(candidate => candidate.wallTime > targetWallTime)
        .sort((a, b) => {
            if (a.wallTime !== b.wallTime) {
                return a.wallTime - b.wallTime;
            }

            return a.timestamp - b.timestamp;
        });

    if (nextValidTimes.length === 0) {
        throw new Error(
            'Der Berliner Fälligkeitstermin konnte nicht aufgelöst werden.'
        );
    }

    return new Date(nextValidTimes[0].timestamp);
}

function recordInvoiceSendAttempt(
    invoiceId,
    attemptedAt,
    delivery = 'unknown',
    actorDiscordId = null
) {
    const data = readStore();
    const id = requireText(invoiceId, 'Rechnungs-ID');
    const invoice = data.invoices[id];

    if (!invoice) {
        throw new Error(`Rechnung nicht gefunden: ${id}`);
    }

    if (invoice.status === 'paid') {
        throw new Error(
            'Eine bezahlte Rechnung kann nicht erneut versendet werden.'
        );
    }

    const attemptDate = parseDate(
        attemptedAt,
        'Versandzeitpunkt'
    );

    const normalizedDelivery = [
        'delivered',
        'failed',
        'pending',
        'unknown',
    ].includes(delivery)
        ? delivery
        : 'unknown';

    const firstAttempt = !invoice.sendAttemptAt;

    if (firstAttempt) {
        invoice.sendAttemptAt = attemptDate.toISOString();
        invoice.dueAt = addBerlinCalendarDays(
            attemptDate,
            14
        ).toISOString();
    }

    invoice.delivery = normalizedDelivery;
    invoice.lastSendAttemptAt = attemptDate.toISOString();
    invoice.status = 'sent';
    invoice.updatedAt = attemptDate.toISOString();

    addAudit(data, 'invoice_send_attempt', actorDiscordId, {
        invoiceId: id,
        attemptedAt: attemptDate.toISOString(),
        delivery: normalizedDelivery,
        firstAttempt,
    });

    writeStore(data);

    return invoice;
}

function recordInvoiceDeliveryResult(
    invoiceId,
    delivery,
    actorDiscordId = null
) {
    const allowed = ['delivered', 'failed', 'unknown'];

    if (!allowed.includes(delivery)) {
        throw new TypeError('Ungültiger Zustellstatus.');
    }

    const data = readStore();
    const invoice = data.invoices[
        requireText(invoiceId, 'Rechnungs-ID')
    ];

    if (!invoice) {
        throw new Error('Rechnung nicht gefunden.');
    }

    if (invoice.status !== 'sent' || !invoice.sendAttemptAt) {
        throw new Error(
            'Es wurde noch kein Versandversuch gespeichert.'
        );
    }

    invoice.delivery = delivery;
    invoice.updatedAt = new Date().toISOString();

    addAudit(data, 'invoice_delivery_result_recorded', actorDiscordId, {
        invoiceId,
        delivery,
    });

    writeStore(data);

    return invoice;
}

function markInvoicePaid(
    invoiceId,
    actorDiscordId,
    authorizedRoleIds,
    allowedRoleIds
) {
    const actorId = requireText(
        actorDiscordId,
        'Discord-ID der ausführenden Person'
    );

    const authorized = new Set(
        (authorizedRoleIds || []).map(String)
    );

    const allowed = new Set(
        (allowedRoleIds || []).map(String)
    );

    if (![...authorized].some(roleId => allowed.has(roleId))) {
        throw new Error(
            'Keine Berechtigung zur Zahlungsbestätigung.'
        );
    }

    const data = readStore();
    const invoice = data.invoices[
        requireText(invoiceId, 'Rechnungs-ID')
    ];

    if (!invoice) {
        throw new Error('Rechnung nicht gefunden.');
    }

    if (invoice.status === 'paid') {
        return {
            updated: false,
            duplicate: true,
            invoice,
        };
    }

    if (invoice.status !== 'sent') {
        throw new Error(
            'Nur versendete Rechnungen können als bezahlt markiert werden.'
        );
    }

    invoice.status = 'paid';
    invoice.paidAt = new Date().toISOString();
    invoice.paidByDiscordId = actorId;
    invoice.updatedAt = invoice.paidAt;

    addAudit(data, 'invoice_marked_paid', actorId, {
        invoiceId,
    });

    writeStore(data);

    return {
        updated: true,
        duplicate: false,
        invoice,
    };
}

function listJobs(filters = {}) {
    return Object.values(readStore().jobs).filter(job =>
        (!filters.guildId ||
            job.guildId === String(filters.guildId)) &&
        (!filters.month ||
            job.billingMonth === filters.month) &&
        (!filters.discordUserId ||
            job.discordUserId === String(filters.discordUserId)) &&
        (!filters.status ||
            job.status === filters.status)
    );
}

function listInvoices(filters = {}) {
    return Object.values(readStore().invoices).filter(invoice =>
        (!filters.guildId ||
            invoice.guildId === String(filters.guildId)) &&
        (!filters.month ||
            invoice.month === filters.month) &&
        (!filters.discordUserId ||
            invoice.discordUserId === String(filters.discordUserId)) &&
        (!filters.status ||
            invoice.status === filters.status)
    );
}

function listOverdueInvoices(asOf = new Date()) {
    const referenceDate = parseDate(
        asOf,
        'Prüfzeitpunkt'
    );

    return Object.values(readStore().invoices).filter(invoice => {
        if (
            invoice.status !== 'sent' ||
            !invoice.dueAt ||
            invoice.warningSentAt
        ) {
            return false;
        }

        const dueDate = new Date(invoice.dueAt);

        return Number.isFinite(dueDate.getTime()) &&
            dueDate.getTime() < referenceDate.getTime();
    });
}

function markInvoiceWarningSent(
    invoiceId,
    warningAt = new Date(),
    actorDiscordId = null
) {
    const data = readStore();
    const id = requireText(invoiceId, 'Rechnungs-ID');
    const invoice = data.invoices[id];

    if (!invoice) {
        throw new Error('Rechnung nicht gefunden.');
    }

    if (invoice.warningSentAt) {
        return {
            updated: false,
            duplicate: true,
            invoice,
        };
    }

    if (invoice.status !== 'sent' || !invoice.dueAt) {
        throw new Error(
            'Nur versendete, unbezahlte Rechnungen können gemahnt werden.'
        );
    }

    const warningDate = parseDate(
        warningAt,
        'Mahnzeitpunkt'
    );

    const dueDate = parseDate(
        invoice.dueAt,
        'Fälligkeit'
    );

    if (warningDate.getTime() <= dueDate.getTime()) {
        throw new Error(
            'Die Zahlungsfrist ist noch nicht abgelaufen.'
        );
    }

    invoice.warningSentAt = warningDate.toISOString();
    invoice.updatedAt = new Date().toISOString();

    addAudit(data, 'invoice_overdue_warning_sent', actorDiscordId, {
        invoiceId: id,
        dueAt: invoice.dueAt,
        warningSentAt: invoice.warningSentAt,
    });

    writeStore(data);

    return {
        updated: true,
        duplicate: false,
        invoice,
    };
}

/**
 * Führt einen vollständigen Speed-Billing-Import als einen Batch aus.
 *
 * Alle Operationen werden zunächst validiert und anschließend
 * auf einer In-Memory-Kopie verarbeitet.
 *
 * Es erfolgt höchstens ein Schreibvorgang für den gesamten Batch.
 */
function recordImportBatch(operations, actorDiscordId = null) {
    if (!Array.isArray(operations)) {
        throw new TypeError(
            'Import-Batch muss eine Operationsliste enthalten.'
        );
    }

    if (operations.length === 0) {
        throw new Error('Import-Batch enthält keine Operationen.');
    }

    const actorId = actorDiscordId == null
        ? null
        : String(actorDiscordId);

    const seenKeys = new Set();

    // Vollständige Vorvalidierung vor dem Lesen des Stores.
    for (const operation of operations) {
        if (!isObject(operation)) {
            throw new TypeError(
                'Import-Batch enthält eine ungültige Operation.'
            );
        }

        const guildId = requireText(operation.guildId, 'guildId');
        const taskId = requireText(operation.taskId, 'taskId');
        const key = `${guildId}:${taskId}`;

        if (seenKeys.has(key)) {
            throw new Error(
                `Import-Batch enthält Auftrag ${taskId} mehrfach.`
            );
        }

        seenKeys.add(key);

        if (operation.type === 'review') {
            if (!isReviewStatus(operation.status)) {
                throw new Error(
                    `Auftrag ${taskId}: ungültiger Review-Status.`
                );
            }

            if (
                operation.billingMonth !== null &&
                operation.billingMonth !== undefined
            ) {
                validateBillingMonth(operation.billingMonth);
            }

            requireText(
                operation.reason ||
                'Manuelle Nachweisprüfung erforderlich.',
                'Review-Grund'
            );
        } else if (operation.type === 'job') {
            const completedAt = parseDate(
                operation.completedAt,
                `Auftrag ${taskId}: Abschlusszeitpunkt`
            );

            const billingMonth = monthKeyInBerlin(completedAt);
            validateBillingMonth(billingMonth);

            requireText(operation.spedvUserId, 'SpedV-Fahrer-ID');
            requireText(operation.discordUserId, 'Discord-Fahrer-ID');

            const calculation = calculateFine(
                operation.maxVelocityKmh
            );

            if (
                calculation.status !== operation.expectedStatus ||
                calculation.fineEur !== operation.expectedFineEur ||
                calculation.excessKmh !== operation.expectedExcessKmh
            ) {
                throw new Error(
                    `Auftrag ${taskId}: Bewertung stimmt nicht mit dem Importplan überein.`
                );
            }

            if (
                operation.expectedStatus !== 'fine_assessed' &&
                operation.expectedStatus !== 'no_violation'
            ) {
                throw new Error(
                    `Auftrag ${taskId}: unzulässiger Bewertungsstatus.`
                );
            }
        } else {
            throw new Error(
                `Auftrag ${taskId}: unbekannter Operationstyp ${String(operation.type)}.`
            );
        }
    }

    const originalData = readStore();
    const data = JSON.parse(JSON.stringify(originalData));

    const results = [];

    let createdCount = 0;
    let updatedCount = 0;
    let duplicateCount = 0;
    let reviewCaseCount = 0;
    let jobCount = 0;

    for (const operation of operations) {
        const guildId = String(operation.guildId);
        const taskId = String(operation.taskId);
        const key = `${guildId}:${taskId}`;

        if (operation.type === 'review') {
            const existing = data.reviewCases[key];

            if (existing?.status === 'resolved') {
                duplicateCount += 1;

                results.push({
                    taskId,
                    type: 'review',
                    success: true,
                    created: false,
                    updated: false,
                    duplicate: true,
                    status: existing.status,
                });

                continue;
            }

            const billingMonth = optionalText(operation.billingMonth);
            const discordUserId = optionalText(operation.discordUserId);
            const spedvUserId = optionalText(operation.spedvUserId);
            const spedvName = optionalText(operation.spedvName);
            const status = operation.status;

            const reason = String(
                operation.reason ||
                'Manuelle Nachweisprüfung erforderlich.'
            );

            const isIdentical = Boolean(existing) &&
                existing.billingMonth === billingMonth &&
                existing.discordUserId === discordUserId &&
                existing.spedvUserId === spedvUserId &&
                existing.spedvName === spedvName &&
                existing.status === status &&
                existing.reason === reason;

            if (isIdentical) {
                duplicateCount += 1;

                results.push({
                    taskId,
                    type: 'review',
                    success: true,
                    created: false,
                    updated: false,
                    duplicate: true,
                    status: existing.status,
                });

                continue;
            }

            const now = new Date().toISOString();

            const reviewCase = {
                key,
                guildId,
                taskId,
                billingMonth,
                discordUserId,
                spedvUserId,
                spedvName,
                status,
                reason,
                globalBlock: billingMonth === null,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
                resolvedAt: null,
                resolvedByDiscordId: null,
                resolutionReason: null,
            };

            data.reviewCases[key] = reviewCase;

            addAudit(
                data,
                existing
                    ? 'review_case_updated'
                    : 'review_case_created',
                actorId,
                {
                    guildId,
                    taskId,
                    billingMonth,
                    discordUserId,
                    status,
                    globalBlock: reviewCase.globalBlock,
                    source: 'speed_billing_import',
                }
            );

            reviewCaseCount += 1;

            if (existing) {
                updatedCount += 1;
            } else {
                createdCount += 1;
            }

            results.push({
                taskId,
                type: 'review',
                success: true,
                created: !existing,
                updated: Boolean(existing),
                duplicate: false,
                status: reviewCase.status,
            });

            continue;
        }

        const existing = data.jobs[key];

        if (existing?.invoiceId) {
            duplicateCount += 1;

            results.push({
                taskId,
                type: 'job',
                success: true,
                created: false,
                updated: false,
                duplicate: true,
                status: existing.status,
            });

            continue;
        }

        if (
            existing &&
            existing.status !== 'pending_evidence' &&
            !isReviewStatus(existing.status)
        ) {
            duplicateCount += 1;

            results.push({
                taskId,
                type: 'job',
                success: true,
                created: false,
                updated: false,
                duplicate: true,
                status: existing.status,
            });

            continue;
        }

        const completedAt = parseDate(
            operation.completedAt,
            'Abschlusszeitpunkt'
        );

        const billingMonth = monthKeyInBerlin(completedAt);
        const calculation = calculateFine(operation.maxVelocityKmh);
        const now = new Date().toISOString();

        const job = {
            key,
            guildId,
            taskId,
            spedvUserId: requireText(
                operation.spedvUserId,
                'SpedV-Fahrer-ID'
            ),
            discordUserId: requireText(
                operation.discordUserId,
                'Discord-Fahrer-ID'
            ),
            completedAt: completedAt.toISOString(),
            billingMonth,
            maxVelocityKmh: calculation.provenMaxKmh,
            excessKmh: calculation.excessKmh,
            fineEur: calculation.fineEur,
            status: calculation.status,
            reviewReason: null,
            evidenceSource: operation.evidenceSource
                ? String(operation.evidenceSource)
                : null,
            evidenceCapturedAt: now,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            invoiceId: null,
            billingFollowUp: null,
        };

        data.jobs[key] = job;

        const invoiceReconciliation =
            reconcileJobWithExistingInvoice(
                data,
                job,
                actorId
            );

        resolveMatchingReviewCase(
            data,
            guildId,
            taskId,
            actorId
        );

        addAudit(
            data,
            existing
                ? 'job_evidence_updated'
                : 'completed_job_recorded',
            actorId,
            {
                guildId,
                taskId,
                status: job.status,
                fineEur: job.fineEur,
                billingMonth,
                source: 'speed_billing_import',
            }
        );

        jobCount += 1;

        if (existing) {
            updatedCount += 1;
        } else {
            createdCount += 1;
        }

        results.push({
            taskId,
            type: 'job',
            success: true,
            created: !existing,
            updated: Boolean(existing),
            duplicate: false,
            status: job.status,
            fineEur: job.fineEur,
            excessKmh: job.excessKmh,
            invoiceReconciliation,
        });
    }

    // Keine Dateiänderung, wenn ausschließlich Duplikate vorliegen.
    const writesPerformed =
        createdCount > 0 || updatedCount > 0;

    if (writesPerformed) {
        writeStore(data);
    }

    return {
        attemptedCount: operations.length,
        createdCount,
        updatedCount,
        duplicateCount,
        reviewCaseCount,
        jobCount,
        failedCount: 0,
        writesPerformed,
        discordActionsPerformed: false,
        results,
    };
}

module.exports = {
    SPEED_LIMIT_KMH,
    FINE_PER_KMH_EUR,
    BILLING_START_DATE,
    BILLING_START_MONTH,

    calculateFine,

    recordCompletedJob: (...args) =>
        withStoreLock(() => recordCompletedJob(...args)),

    recordReviewCase: (...args) =>
        withStoreLock(() => recordReviewCase(...args)),

    resolveReviewCase: (...args) =>
        withStoreLock(() => resolveReviewCase(...args)),

    createMonthlyInvoice: (...args) =>
        withStoreLock(() => createMonthlyInvoice(...args)),

    recordInvoiceSendAttempt: (...args) =>
        withStoreLock(() => recordInvoiceSendAttempt(...args)),

    recordInvoiceDeliveryResult: (...args) =>
        withStoreLock(() => recordInvoiceDeliveryResult(...args)),

    markInvoicePaid: (...args) =>
        withStoreLock(() => markInvoicePaid(...args)),

    markInvoiceWarningSent: (...args) =>
        withStoreLock(() => markInvoiceWarningSent(...args)),

    recordImportBatch: (...args) =>
        withStoreLock(() => recordImportBatch(...args)),

    listJobs,
    listInvoices,
    listReviewCases,
    listOverdueInvoices,
};
