'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const rules = require('./rules');

const DEFAULT_LOGO_PATH = path.resolve(__dirname, '..', 'assets', 'HKC_logo.png');
const LOGO_NAME = 'HKC_logo.png';
// Discord erlaubt höchstens 6000 Zeichen je Nachricht über alle Embeds
const MESSAGE_CHAR_LIMIT = 5800;
const DESCRIPTION_LIMIT = 3800;
const COLOR = 0xc62828;
const NOTE = 'Virtuelle Strafzahlung nach § 5 des Regelwerks, keine reale Geldforderung.';
const UNIT_LABEL = { kmh: 'km/h', mph: 'mph' };

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function dateText(iso) {
    return new Date(iso).toLocaleDateString('de-DE', {
        timeZone: rules.timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function paymentPurpose(invoice, config) {
    return `${config.purposePrefix} ${invoice.number}`;
}

function logoFiles(logoPath) {
    return fs.existsSync(logoPath)
        ? [new AttachmentBuilder(logoPath, { name: LOGO_NAME })]
        : [];
}

/** Zeigt eine Zeile in der Einheit des Spiels (ETS2 km/h, ATS mph). */
function describeLine(line, task) {
    const gameRules = rules.games[task?.game] ?? rules.games.ets2;

    let evidence = null;
    try {
        evidence = task?.evidence_json ? JSON.parse(task.evidence_json) : null;
    } catch {
        evidence = null;
    }

    let speed = null;
    if (evidence && Number.isFinite(evidence.maxSpeed) && evidence.unit === gameRules.unit) {
        speed = evidence.maxSpeed;
    } else if (Number.isFinite(line.max_velocity_kmh)) {
        speed = gameRules.unit === 'mph'
            ? Math.round(line.max_velocity_kmh / rules.kmhPerMph)
            : line.max_velocity_kmh;
    }

    return {
        unit: UNIT_LABEL[gameRules.unit],
        speed,
        excess: line.fine_eur / gameRules.finePerUnit,
        fineEur: line.fine_eur,
    };
}

const wrap = lines => '```text\n' + lines.join('\n') + '\n```';

function buildTable(invoice, getTask) {
    const head = ['Fahrt', 'Gefahren', 'Über Limit', 'Strafe'];
    const rows = invoice.lines.map(line => {
        const info = describeLine(line, getTask(line.task_id));
        return [
            line.visible_id ?? `#${line.task_id}`,
            info.speed === null ? '-' : `${info.speed} ${info.unit}`,
            `${info.excess} ${info.unit}`,
            euro.format(info.fineEur),
        ];
    });

    const widths = head.map((title, column) =>
        Math.max(title.length, ...rows.map(row => row[column].length))
    );
    const format = row => row
        .map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])))
        .join(' | ');

    return {
        header: [format(head), widths.map(width => '-'.repeat(width)).join('-|-')],
        rows: rows.map(format),
    };
}

/** Verteilt die Zeilen so, dass jede Nachricht unter ihrer Zeichengrenze bleibt. */
function chunkRows(header, rows, firstLimit, nextLimit) {
    const size = list => wrap([...header, ...list]).length;
    const chunks = [];
    let current = [];
    let limit = firstLimit;

    for (const row of rows) {
        if (size([row]) > limit) throw new Error('Eine Rechnungszeile ist für Discord zu lang.');

        if (current.length > 0 && size([...current, row]) > limit) {
            chunks.push(current);
            current = [row];
            limit = nextLimit;
        } else {
            current.push(row);
        }
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}

/**
 * Baut die Rechnung als Discord-Nachrichten (bei vielen Zeilen mehrere).
 * Wirft einen Fehler, wenn sie nicht gebaut werden kann: dann darf nichts gesendet werden.
 */
function buildInvoiceMessages({ invoice, getTask, config, dueAt, logoPath = DEFAULT_LOGO_PATH }) {
    if (!invoice?.lines?.length) throw new Error('Die Rechnung enthält keine Positionen.');
    if (!config?.iban) throw new Error('Die SpedV-Kontonummer fehlt.');

    const due = new Date(dueAt);
    if (!Number.isFinite(due.getTime())) throw new Error('Die Zahlungsfrist ist ungültig.');

    const title = `Monatsabrechnung ${invoice.billing_month}`;
    const continuation = `${title} – Fortsetzung`;
    const footer = `HKC | Rechnung ${invoice.number}`;
    const fields = [
        { name: 'Fahrer', value: String(invoice.spedv_name), inline: true },
        { name: 'Rechnungsnummer', value: invoice.number, inline: true },
        { name: 'Gesamtbetrag', value: euro.format(invoice.total_eur), inline: true },
        { name: 'Zahlungsfrist', value: dateText(dueAt), inline: true },
        { name: 'SpedV-Kontonummer', value: config.iban, inline: false },
        { name: 'Verwendungszweck', value: paymentPurpose(invoice, config), inline: false },
    ];

    const headerChars =
        title.length + footer.length + fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    const firstLimit = Math.min(DESCRIPTION_LIMIT, MESSAGE_CHAR_LIMIT - headerChars) - (NOTE.length + 2);
    const nextLimit = Math.min(DESCRIPTION_LIMIT, MESSAGE_CHAR_LIMIT - continuation.length - footer.length);

    const table = buildTable(invoice, getTask);
    const chunks = chunkRows(table.header, table.rows, firstLimit, nextLimit);

    return chunks.map((chunk, index) => {
        const table_ = wrap([...table.header, ...chunk]);
        const embed = new EmbedBuilder().setColor(COLOR).setFooter({ text: footer });

        if (index === 0) {
            embed.setTitle(title).setDescription(`${NOTE}\n\n${table_}`).addFields(fields);
        } else {
            embed.setTitle(continuation).setDescription(table_);
        }

        const files = index === 0 ? logoFiles(logoPath) : [];
        if (files.length > 0) embed.setThumbnail(`attachment://${LOGO_NAME}`);

        return { embeds: [embed], files };
    });
}

/** Zahlungserinnerung für eine Rechnung, deren Frist abgelaufen ist. */
function buildReminderMessage({ invoice, config, logoPath = DEFAULT_LOGO_PATH }) {
    if (!config?.iban) throw new Error('Die SpedV-Kontonummer fehlt.');
    if (!invoice?.due_at) throw new Error('Die Rechnung hat keine Zahlungsfrist.');

    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`Zahlungserinnerung ${invoice.number}`)
        .setDescription(
            `Die Zahlungsfrist deiner Monatsabrechnung ${invoice.billing_month} ist am ` +
            `**${dateText(invoice.due_at)}** abgelaufen. Falls du schon bezahlt hast, melde dich bitte kurz ` +
            `bei der Buchhaltung.\n\n${NOTE}`
        )
        .addFields(
            { name: 'Rechnungsnummer', value: invoice.number, inline: true },
            { name: 'Gesamtbetrag', value: euro.format(invoice.total_eur), inline: true },
            { name: 'Fällig seit', value: dateText(invoice.due_at), inline: true },
            { name: 'SpedV-Kontonummer', value: config.iban, inline: false },
            { name: 'Verwendungszweck', value: paymentPurpose(invoice, config), inline: false }
        )
        .setFooter({ text: `HKC | Rechnung ${invoice.number}` });

    const files = logoFiles(logoPath);
    if (files.length > 0) embed.setThumbnail(`attachment://${LOGO_NAME}`);

    return { embeds: [embed], files };
}

module.exports = { buildInvoiceMessages, buildReminderMessage, describeLine };