'use strict';

const { EmbedBuilder } = require('discord.js');
const rules = require('./rules');

const COLORS = Object.freeze({ info: 0x3498db, ok: 0x2ecc71, warn: 0xf39c12, fail: 0xe74c3c });
const ICON = Object.freeze({ ok: '✅', warn: '⚠️', fail: '❌' });
const INVOICE_LABEL = Object.freeze({ draft: 'Entwurf', sent: 'versendet', paid: 'bezahlt' });
const DELIVERY_LABEL = Object.freeze({
    delivered: 'zugestellt',
    failed: 'nicht zustellbar',
    unknown: 'Zustellung unklar',
});
const STATUS_TEXT = Object.freeze({
    ok: 'Bestanden',
    warn: 'Bestanden mit Hinweisen',
    fail: 'Nicht bestanden',
});
const UNIT_LABEL = Object.freeze({ kmh: 'km/h', mph: 'mph' });

const MAX_STATEMENT_ROWS = 40;
const FIELD_LIMIT = 700;
const LINE_LIMIT = 110;
const DETAIL_LIMIT = 200;

const euro = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
});
const money = amount => euro.format(amount).replace(/\u00a0/g, ' ');

const clip = (text, max) => {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const stamp = date =>
    date.toLocaleString('de-DE', {
        timeZone: rules.timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

function table(head, rows, rightAligned = []) {
    const widths = head.map((title, column) =>
        Math.max(title.length, ...rows.map(row => row[column].length))
    );
    const format = row => row
        .map((cell, column) => (rightAligned.includes(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
        .join(' | ');

    return [
        '```text',
        format(head),
        widths.map(width => '-'.repeat(width)).join('-|-'),
        ...rows.map(format),
        '```',
    ].join('\n');
}

/** Ein Feld mit begrenzter Länge: lange Listen werden abgeschnitten und gezählt. */
function listField(name, lines) {
    if (lines.length === 0) return null;

    let value = '';
    let shown = 0;
    for (const line of lines) {
        const next = `${value ? `${value}\n` : ''}${clip(line, LINE_LIMIT)}`;
        if (next.length > FIELD_LIMIT) break;
        value = next;
        shown += 1;
    }
    if (shown < lines.length) value += `\n… und ${lines.length - shown} weitere`;

    return { name: `${name} (${lines.length})`, value, inline: false };
}

/** Laufende Abrechnung eines Monats: je Fahrer die aktuellen Zahlen. */
function buildStatementMessage({ statement, closed, now = new Date() }) {
    const drivers = [...statement.drivers].sort(
        (a, b) => b.fineEur - a.fineEur || a.spedvName.localeCompare(b.spedvName, 'de')
    );
    const shown = drivers.slice(0, MAX_STATEMENT_ROWS);

    const lines = [
        closed
            ? '**Monat abgeschlossen.**'
            : '**Der Monat läuft noch.** Die Zahlen ändern sich täglich.',
    ];

    if (drivers.length === 0) {
        lines.push('Bisher gibt es keine ausgewerteten Aufträge.');
    } else {
        lines.push(
            table(
                ['Fahrer', 'Strafen', 'Betrag', 'Prüf.', 'Rechnung'],
                shown.map(driver => [
                    clip(driver.spedvName, 16),
                    String(driver.fines),
                    money(driver.fineEur),
                    String(driver.openReviews),
                    driver.invoice ? (INVOICE_LABEL[driver.invoice.status] ?? driver.invoice.status) : '-',
                ]),
                [1, 2, 3]
            )
        );
        if (drivers.length > shown.length) lines.push(`… und ${drivers.length - shown.length} weitere Fahrer`);
    }

    const totals = statement.totals;
    lines.push(
        `Strafen gesamt: **${money(totals.fineEur)}** · Fahrer mit Strafe: **${totals.driversWithFines}** · ` +
        `Offene Prüffälle: **${totals.openReviews}**`
    );
    if (statement.globalReviews.length > 0) {
        lines.push(`❌ ${statement.globalReviews.length} Prüffall/Prüffälle ohne Monat blockieren alle Rechnungen.`);
    }

    const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`📒 ${closed ? 'Abrechnung' : 'Laufende Abrechnung'} ${statement.month}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `HKC Abrechnung | Stand ${stamp(now)}` });

    return { embeds: [embed] };
}

/** Meldung über Änderungen. Gibt null zurück, wenn es nichts zu melden gibt. */
function buildAlertMessage({ run = {}, reminders = [], now = new Date() }) {
    const fines = (run.newFines ?? []).map(f =>
        `${f.visibleId} ${f.spedvName ?? 'unbekannt'} · ${f.maxSpeed ?? f.maxVelocityKmh} ${UNIT_LABEL[f.unit] ?? 'km/h'} · ${money(f.fineEur)}`
    );
    const reviews = (run.newReviews ?? []).map(r =>
        `${r.visibleId} ${r.spedvName ?? 'unbekannt'} · ${r.message}`
    );
    const reopened = (run.reopened ?? []).map(r =>
        `${r.visibleId} ${r.spedvName ?? 'unbekannt'} · ${r.message}`
    );
    const stale = (run.staleInvoiced ?? []).map(r =>
        `${r.visibleId} ${r.spedvName ?? 'unbekannt'} · ${r.billingMonth} · ${r.message}`
    );
    const errors = (run.errors ?? []).map(e => `${e.taskId} · ${e.message}`);

    const drafts = [];
    for (const batch of run.drafts ?? []) {
        for (const driver of batch.drivers) {
            if (driver.created) drafts.push(`${driver.number} · neu · ${money(driver.totalEur)}`);
            else if (driver.updated) drafts.push(`${driver.number} · ergänzt · ${money(driver.totalEur)}`);
            else if (driver.reason === 'exists_late_fines' && driver.lateTaskIds?.length > 0) {
                drafts.push(`${driver.number} · Nachzügler ${driver.lateTaskIds.join(', ')}`);
            }
        }
    }

    const reminderLines = reminders.map(r => `${r.number} · ${DELIVERY_LABEL[r.delivery] ?? r.delivery}`);

    const fields = [
        listField('Neue Strafen', fines),
        listField('Neue Prüffälle', reviews),
        listField('Wieder geöffnet', reopened),
        listField('Rechnung prüfen (Status geändert)', stale),
        listField('Rechnungsentwürfe', drafts),
        listField('Zahlungserinnerungen', reminderLines),
        listField('Fehler', errors),
    ].filter(Boolean);

    if (fields.length === 0) return null;

    const embed = new EmbedBuilder()
        .setColor(stale.length > 0 || errors.length > 0 ? COLORS.warn : COLORS.info)
        .setTitle('🔔 Abrechnung: Änderungen')
        .addFields(fields)
        .setFooter({ text: `HKC Abrechnung | ${stamp(now)}` });

    return { embeds: [embed], allowedMentions: { parse: [] } };
}

/** Ergebnis der Generalprüfung eines Monats. */
function buildClosingMessage({ check, now = new Date() }) {
    const lines = [`**${STATUS_TEXT[check.status]}**`, ''];

    for (const item of check.items) {
        lines.push(`${ICON[item.status]} **${item.label}** – ${clip(item.detail, DETAIL_LIMIT)}`);
    }

    const ready = check.readyDrivers;
    const readySum = ready.reduce((sum, driver) => sum + driver.fineEur, 0);
    lines.push(
        '',
        ready.length > 0
            ? `Versandbereit: **${ready.length}** Fahrer, zusammen **${money(readySum)}**.`
            : 'Zurzeit ist kein Fahrer versandbereit.'
    );

    const embed = new EmbedBuilder()
        .setColor(COLORS[check.status] ?? COLORS.info)
        .setTitle(`🧾 Generalprüfung ${check.month}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `HKC Abrechnung | Stand ${stamp(now)}` });

    return { embeds: [embed] };
}

function buildFailureMessage(message) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.fail)
        .setTitle('Abrechnungslauf fehlgeschlagen')
        .setDescription(`${clip(message, 300)}\n\nDer nächste Versuch folgt automatisch.`);

    return { embeds: [embed], allowedMentions: { parse: [] } };
}

module.exports = {
    buildStatementMessage,
    buildAlertMessage,
    buildClosingMessage,
    buildFailureMessage,
};
