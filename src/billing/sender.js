'use strict';

const rules = require('./rules');
const logger = require('../utils/logger');
const { StoreError } = require('./db');
const { buildInvoiceMessages, buildReminderMessage } = require('./invoiceMessage');

const DAY_MS = 86_400_000;
const DM_CLOSED = 50007; // Discord: Nachricht an diesen Nutzer nicht möglich

// Erst bei Gebrauch laden: das Modul legt beim Laden Dateien an
const defaultFindLink = spedvUserId =>
    require('../utils/spedvApi').getLinkRecordBySpedvUserId(spedvUserId);

const discordCode = error => Number(error?.code ?? error?.rawError?.code);
const isDmClosed = error => discordCode(error) === DM_CLOSED;

async function resolveRecipient({ guild, invoice, findLink }) {
    const link = findLink(invoice.spedv_user_id);

    if (!link || link.verified !== true || !/^\d{17,20}$/.test(String(link.discordId ?? ''))) {
        throw new StoreError(
            'Der Fahrer ist nicht (verifiziert) mit Discord verknüpft. Eine Zustellung ist nicht möglich.'
        );
    }

    const member = await guild.members.fetch(link.discordId).catch(() => null);
    if (!member) {
        throw new StoreError('Der Fahrer ist nicht auf dem Discord-Server. Eine Zustellung ist nicht möglich.');
    }

    return { discordId: String(link.discordId), member };
}

/** Neutraler Hinweis im Fahrer-Chat, nur nach eindeutig fehlgeschlagener DM und nur einmal. */
async function postFallback({ guild, store, invoice, config, actor, discordId }) {
    const channelId = config.fallbackChannelId;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;

    if (!channel?.isTextBased?.()) {
        logger.warn(`Abrechnung: Fallback-Kanal nicht erreichbar (Rechnung ${invoice.number})`);
        return 'skipped';
    }

    try {
        store.recordFallbackAttempt({ number: invoice.number, channelId, actor });
    } catch (error) {
        if (error instanceof StoreError) return 'skipped'; // es gab schon einen Hinweis
        throw error;
    }

    const content =
        `<@${discordId}> – deine HKC-Monatsabrechnung für **${invoice.billing_month}** konnte dir nicht ` +
        'per Direktnachricht zugestellt werden. Bitte prüfe deinen Abrechnungsstatus mit ' +
        '**/abrechnung meine** oder wende dich an die Buchhaltung.';

    let message;
    try {
        message = await channel.send({ content, allowedMentions: { users: [discordId] } });
    } catch (error) {
        logger.error(`Abrechnung: Fallback für ${invoice.number} fehlgeschlagen`, error);
        try {
            store.recordFallbackResult({ number: invoice.number, status: 'unknown', actor });
        } catch (storeError) {
            logger.error(`Abrechnung: Fallback-Ergebnis für ${invoice.number} nicht gespeichert`, storeError);
        }
        return 'unknown';
    }

    try {
        store.recordFallbackResult({ number: invoice.number, status: 'sent', messageId: message.id, actor });
    } catch (storeError) {
        logger.error(`Abrechnung: Fallback für ${invoice.number} gesendet, Ergebnis nicht gespeichert`, storeError);
    }
    return 'sent';
}

/**
 * Sendet eine Rechnung per DM. Reihenfolge: Empfänger prüfen, Nachricht bauen,
 * Versandversuch speichern, senden, Ergebnis speichern.
 * Wirft StoreError mit anzeigbarem Text, wenn nicht gesendet werden darf.
 */
async function sendInvoice({
    guild,
    store,
    number,
    actor,
    config,
    now = new Date(),
    findLink = defaultFindLink,
    logoPath,
}) {
    const invoice = store.getInvoice(number);
    if (!invoice) throw new StoreError('Rechnung nicht gefunden.');
    if (!config?.iban) {
        throw new StoreError('Die SpedV-Kontonummer ist nicht konfiguriert (BILLING_SPEDV_IBAN).');
    }

    const at = now instanceof Date ? now : new Date(now);
    const { discordId, member } = await resolveRecipient({ guild, invoice, findLink });

    const dueAt = invoice.due_at ?? new Date(at.getTime() + rules.paymentDays * DAY_MS).toISOString();
    const messages = buildInvoiceMessages({
        invoice,
        getTask: store.getEffective,
        config,
        dueAt,
        logoPath,
    });

    // Ab hier läuft die Frist: wirft bei bezahlt, storniert oder bereits zugestellt
    const attempt = store.recordSendAttempt({ number, discordId, actor, now: at });

    let delivery = 'delivered';
    for (let index = 0; index < messages.length; index += 1) {
        try {
            await member.send(messages[index]);
        } catch (error) {
            logger.error(`Abrechnung: DM für ${number} fehlgeschlagen`, error);
            // Nur wenn schon die erste Nachricht abgelehnt wurde, ist die Lage eindeutig
            delivery = index === 0 && isDmClosed(error) ? 'failed' : 'unknown';
            break;
        }
    }

    let warning = null;
    try {
        store.recordDeliveryResult({ number, delivery, actor });
    } catch (error) {
        logger.error(`Abrechnung: Zustellstatus für ${number} nicht gespeichert`, error);
        warning = 'Der Zustellstatus konnte nicht gespeichert werden. Die Rechnung bleibt vorsorglich gesperrt.';
        return { number, delivery, fallback: null, dueAt: attempt.due_at, messages: messages.length, warning };
    }

    let fallback = null;
    if (delivery === 'failed') {
        fallback = await postFallback({ guild, store, invoice: attempt, config, actor, discordId });
    }

    return { number, delivery, fallback, dueAt: attempt.due_at, messages: messages.length, warning };
}

/**
 * Sendet die Zahlungserinnerung (genau eine pro Rechnung) und hält das Ergebnis fest.
 * Scheitert die DM, gibt es keine öffentliche Nachricht.
 */
async function sendReminder({
    guild,
    store,
    invoice,
    actor,
    config,
    now = new Date(),
    findLink = defaultFindLink,
    logoPath,
}) {
    const message = buildReminderMessage({ invoice, config, logoPath });

    let member = null;
    try {
        ({ member } = await resolveRecipient({ guild, invoice, findLink }));
    } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        logger.warn(`Abrechnung: Erinnerung für ${invoice.number} nicht zustellbar: ${error.message}`);
    }

    let delivery = 'failed';
    if (member) {
        try {
            await member.send(message);
            delivery = 'delivered';
        } catch (error) {
            logger.error(`Abrechnung: Erinnerung für ${invoice.number} fehlgeschlagen`, error);
            delivery = isDmClosed(error) ? 'failed' : 'unknown';
        }
    }

    const saved = store.recordReminder({ number: invoice.number, delivery, actor, now });
    return { number: invoice.number, delivery: saved.reminder_delivery };
}

module.exports = { sendInvoice, sendReminder, isDmClosed };