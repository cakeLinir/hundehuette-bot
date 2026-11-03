'use strict';

const crypto = require('node:crypto');
const logger = require('../utils/logger');
const rules = require('./rules');
const { runBilling } = require('./runner');
const { buildStatement, runClosingCheck } = require('./closing');
const { sendReminder } = require('./sender');
const { berlinMonth, isMonthClosed, monthsBetween } = require('./time');
const { buildStatementMessage, buildAlertMessage, buildClosingMessage } = require('./report');
const { upsertMessage } = require('./publisher');

const signatureOf = value =>
    crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');

async function fetchReportChannel(guild, config) {
    const channel = config.reportChannelId
        ? await guild.channels.fetch(config.reportChannelId).catch(() => null)
        : null;

    if (!channel?.isTextBased?.()) {
        throw new Error('Der Buchhaltungs-Channel ist nicht erreichbar.');
    }
    return channel;
}

function linkedIds(statement, findLink) {
    return statement.drivers
        .map(driver => driver.spedvUserId)
        .filter(Boolean)
        .filter(id => {
            try {
                return findLink(id)?.verified === true;
            } catch {
                return false;
            }
        });
}

function isIncomplete(statement) {
    return statement.totals.openReviews > 0 ||
        statement.drivers.some(driver =>
            driver.fineEur > 0 && (!driver.invoice || ['draft', 'sent'].includes(driver.invoice.status))
        );
}

/** Lässt Hinweise weg, die schon einmal gemeldet wurden (Nachzügler, geänderter Status). */
function newsFrom(run, state) {
    const staleInvoiced = run.staleInvoiced.filter(entry => !state.get(`stale:${entry.taskId}`));

    const drafts = run.drafts
        .map(batch => ({
            ...batch,
            drivers: batch.drivers
                .map(driver => (driver.reason === 'exists_late_fines'
                    ? { ...driver, lateTaskIds: driver.lateTaskIds.filter(id => !state.get(`late:${id}`)) }
                    : driver))
                .filter(driver =>
                    driver.created ||
                    driver.updated ||
                    (driver.reason === 'exists_late_fines' && driver.lateTaskIds.length > 0)
                ),
        }))
        .filter(batch => batch.drivers.length > 0);

    return { ...run, staleInvoiced, drafts };
}

function markSeen(news, state) {
    for (const entry of news.staleInvoiced) state.set(`stale:${entry.taskId}`, true);
    for (const batch of news.drafts) {
        for (const driver of batch.drivers) {
            for (const id of driver.lateTaskIds ?? []) state.set(`late:${id}`, true);
        }
    }
}

/**
 * Tageslauf: SpedV auswerten, Entwürfe erstellen und im Buchhaltungs-Channel berichten.
 * Versendet nichts an Fahrer.
 */
async function runDailyBilling({
    guild,
    store,
    spedvClient,
    config,
    speditionId,
    findLink,
    state,
    pingRoleIds = [],
    now = new Date(),
    actor = 'system',
}) {
    const channel = await fetchReportChannel(guild, config);

    const run = await runBilling({
        client: spedvClient, store, speditionId, now, createDrafts: true, actor,
    });
    if (run.skipped) return { skipped: run.skipped };

    // Für die Generalprüfung wird die aktuelle Auftragsliste noch einmal gebraucht
    let listed = null;
    try {
        listed = await spedvClient.fetchTasks();
    } catch (error) {
        logger.warn(`Abrechnung: Auftragsliste für die Generalprüfung nicht abrufbar: ${error.message}`);
    }

    const current = berlinMonth(now);
    const result = {
        statements: [],
        closings: [],
        alert: false,
        evaluated: run.evaluated,
        newFines: run.newFines.length,
        newReviews: run.newReviews.length,
    };

    for (const month of monthsBetween(rules.billingStartDate.slice(0, 7), current)) {
        const statement = buildStatement({ store, month });
        const closed = isMonthClosed(month, now);
        const incomplete = isIncomplete(statement);
        const hadStatement = Boolean(state.get(`statement:${month}`));

        if (month !== current && !hadStatement && !incomplete) continue;

        // Laufende Abrechnung: im laufenden Monat täglich, sonst nur bei Änderungen
        const signature = signatureOf({
            drivers: statement.drivers,
            totals: statement.totals,
            globalReviews: statement.globalReviews,
        });

        if (month === current || signature !== state.get(`signature:${month}`)) {
            await upsertMessage({
                channel,
                state,
                key: `statement:${month}`,
                payload: buildStatementMessage({ statement, closed, now }),
            });
            state.set(`signature:${month}`, signature);
            result.statements.push(month);
        }

        // Generalprüfung für abgeschlossene Monate, die noch nicht erledigt sind
        if (closed && listed && (incomplete || hadStatement || state.get(`closing:${month}`))) {
            const check = runClosingCheck({
                store,
                listedTasks: listed,
                linkedUserIds: linkedIds(statement, findLink),
                month,
                now,
            });

            const checkSignature = signatureOf({
                status: check.status,
                items: check.items.map(item => [item.id, item.status, item.detail]),
                ready: check.readyDrivers.map(driver => [driver.spedvUserId, driver.invoiceStatus]),
            });

            if (checkSignature !== state.get(`closing-signature:${month}`)) {
                const first = !state.get(`closing:${month}`);
                const ping = first && pingRoleIds.length > 0;

                await upsertMessage({
                    channel,
                    state,
                    key: `closing:${month}`,
                    payload: buildClosingMessage({ check, now }),
                    content: ping ? `${pingRoleIds.map(id => `<@&${id}>`).join(' ')} Generalprüfung ${month}` : null,
                    allowedMentions: ping ? { roles: pingRoleIds } : null,
                });
                state.set(`closing-signature:${month}`, checkSignature);
                result.closings.push({ month, status: check.status });
            }
        }
    }

    const news = newsFrom(run, state);
    const alert = buildAlertMessage({ run: news, now });
    if (alert) {
        await channel.send(alert);
        markSeen(news, state);
        result.alert = true;
    }

    return result;
}

/** Sendet fällige Zahlungserinnerungen. Fehler bei einer Rechnung stoppen die anderen nicht. */
async function runReminders({ guild, store, config, findLink, now = new Date(), actor = 'system' }) {
    const results = [];

    for (const invoice of store.listDueForReminder(now)) {
        try {
            results.push(await sendReminder({ guild, store, invoice, actor, config, now, findLink }));
        } catch (error) {
            // Die Erinnerung bleibt fällig und wird beim nächsten Takt erneut versucht
            logger.error(`Abrechnung: Erinnerung für ${invoice.number} fehlgeschlagen`, error);
        }
    }

    return results;
}

module.exports = { runDailyBilling, runReminders, fetchReportChannel };
