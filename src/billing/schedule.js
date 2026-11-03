'use strict';

const logger = require('../utils/logger');
const { berlinClock } = require('./time');
const { runDailyBilling, runReminders, fetchReportChannel } = require('./job');
const { buildAlertMessage, buildFailureMessage } = require('./report');
const { createSettingsState } = require('./publisher');
const { PING_KEYS, roleIds } = require('./permissions');
const { getBillingContext } = require('./context');

const RUN_HOUR = 6; // Berliner Zeit
const DAILY_TICK_MS = 5 * 60_000;
const REMINDER_TICK_MS = 10 * 60_000;
const FIRST_TICK_DELAY_MS = 60_000;

/** Fällig, sobald es in Berlin 06:00 ist und für den heutigen Tag noch kein Lauf erfolgreich war. */
function shouldRunDaily({ now, lastRunDate, runHour = RUN_HOUR }) {
    const clock = berlinClock(now);
    return clock.hour >= runHour && lastRunDate !== clock.date;
}

function createBillingRuntime({
    getGuild,
    store,
    spedvClient,
    config,
    speditionId,
    findLink,
    getState,
    getPingRoleIds = () => [],
    isEnabled = () => true,
    now = () => new Date(),
    runHour = RUN_HOUR,
}) {
    let dailyRunning = false;
    let reminderRunning = false;

    async function notifyFailure(guild, state, error, at) {
        const today = berlinClock(at).date;
        if (state.get('lastErrorDate') === today) return; // höchstens einmal pro Tag

        try {
            const channel = await fetchReportChannel(guild, config);
            await channel.send(buildFailureMessage(error.message));
            state.set('lastErrorDate', today);
        } catch (notifyError) {
            logger.error('Abrechnung: Fehlermeldung konnte nicht gesendet werden', notifyError);
        }
    }

    async function executeDaily(guild, state, at) {
        if (dailyRunning) return { skipped: 'läuft bereits' };

        dailyRunning = true;
        try {
            const result = await runDailyBilling({
                guild,
                store,
                spedvClient,
                config,
                speditionId,
                findLink,
                state,
                pingRoleIds: getPingRoleIds(guild),
                now: at,
            });

            // Nur ein erfolgreicher Lauf zählt als erledigt, sonst folgt ein neuer Versuch
            if (!result.skipped) state.set('lastRunDate', berlinClock(at).date);
            return result;
        } catch (error) {
            logger.error('Abrechnung: Tageslauf fehlgeschlagen', error);
            await notifyFailure(guild, state, error, at);
            return { error: error.message };
        } finally {
            dailyRunning = false;
        }
    }

    async function dailyTick() {
        const at = now();
        const guild = getGuild();
        if (!guild || !isEnabled(guild)) return { skipped: 'inaktiv' };

        const state = getState(guild);
        if (!shouldRunDaily({ now: at, lastRunDate: state.get('lastRunDate'), runHour })) {
            return { skipped: 'nicht fällig' };
        }

        return executeDaily(guild, state, at);
    }

    /** Tageslauf sofort, unabhängig von Uhrzeit und letztem Lauf (für /abrechnung lauf). */
    async function runNow() {
        const at = now();
        const guild = getGuild();
        if (!guild || !isEnabled(guild)) return { skipped: 'inaktiv' };

        return executeDaily(guild, getState(guild), at);
    }

    async function reminderTick() {
        const at = now();
        const guild = getGuild();
        if (!guild || !isEnabled(guild)) return { skipped: 'inaktiv' };
        if (reminderRunning) return { skipped: 'läuft bereits' };

        reminderRunning = true;
        try {
            const results = await runReminders({ guild, store, config, findLink, now: at });

            // Die Meldung an die Buchhaltung darf die Erinnerungen selbst nie verhindern
            if (results.length > 0) {
                try {
                    const channel = await fetchReportChannel(guild, config);
                    await channel.send(buildAlertMessage({ reminders: results, now: at }));
                } catch (error) {
                    logger.warn(`Abrechnung: Meldung über Erinnerungen nicht gesendet: ${error.message}`);
                }
            }

            return { reminders: results.length };
        } catch (error) {
            logger.error('Abrechnung: Erinnerungslauf fehlgeschlagen', error);
            return { error: error.message };
        } finally {
            reminderRunning = false;
        }
    }

    return { dailyTick, reminderTick, runNow };
}

/** Startet die Abrechnung im Bot. Nur mit BILLING_ENABLED=true und vollständiger Konfiguration. */
function startBillingSchedule(client) {
    const context = getBillingContext();

    if (!context.enabled) {
        const log = process.env.BILLING_ENABLED === 'true' ? logger.warn : logger.info;
        log(`Abrechnung: nicht gestartet (${context.reason})`);
        return null;
    }

    const runtime = createBillingRuntime({
        getGuild: () => client.guilds.cache.get(process.env.GUILD_ID) ?? null,
        store: context.store,
        spedvClient: context.spedvClient,
        config: context.config,
        speditionId: context.speditionId,
        findLink: id => require('../utils/spedvApi').getLinkRecordBySpedvUserId(id),
        getState: guild => createSettingsState(guild.id),
        getPingRoleIds: guild => roleIds(guild.id, PING_KEYS),
        isEnabled: guild => require('../utils/moduleManager').isModuleEnabled(guild.id, 'ets'),
    });
    context.runtime = runtime;

    const safe = (task, name) => () =>
        task().catch(error => logger.error(`Abrechnung: ${name} abgebrochen`, error));

    setTimeout(safe(runtime.dailyTick, 'Tageslauf'), FIRST_TICK_DELAY_MS);
    setInterval(safe(runtime.dailyTick, 'Tageslauf'), DAILY_TICK_MS);
    setInterval(safe(runtime.reminderTick, 'Erinnerungslauf'), REMINDER_TICK_MS);

    logger.info(`Abrechnung: Zeitplan aktiv (Lauf ab ${RUN_HOUR}:00 Berliner Zeit, Erinnerungen alle 10 Minuten)`);
    return runtime;
}

module.exports = { shouldRunDaily, createBillingRuntime, startBillingSchedule };