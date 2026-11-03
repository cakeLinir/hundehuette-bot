'use strict';

const rules = require('./rules');
const { StoreError } = require('./db');
const {
    OUTCOMES,
    REASONS,
    evaluateTask,
    detectGame,
    isBillableState,
    stateName,
} = require('./evaluate');
const { berlinMonth, isMonthClosed, monthWindowMs } = require('./time');

const STORABLE = [OUTCOMES.FINE, OUTCOMES.CLEAR, OUTCOMES.REVIEW];
const MAX_REPORTED_OPEN_TASKS = 50;

let running = false;

function monthsBetween(first, last) {
    const months = [];
    let [year, month] = first.split('-').map(Number);

    for (; ;) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (key > last) break;
        months.push(key);
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }

    return months;
}

/** Vorläufiger Monat für einen Auftrag, dessen Details nicht ladbar waren. */
function provisionalMonth(listItem, currentMonth, billingStartMonth) {
    const start = new Date(listItem.startTime);
    const month = Number.isFinite(start.getTime()) ? berlinMonth(start) : currentMonth;
    return month < billingStartMonth ? billingStartMonth : month;
}

function summarizeBatch(batch) {
    return {
        month: batch.month,
        created: batch.created,
        updated: batch.updated,
        blocked: batch.blocked,
        lateFines: batch.lateFines,
        drivers: batch.results.map(result => ({
            spedvUserId: result.spedvUserId,
            created: Boolean(result.created),
            updated: Boolean(result.updated),
            reason: result.reason ?? null,
            number: result.invoice?.number ?? null,
            totalEur: result.invoice?.total_eur ?? null,
            blockers: result.blockers ?? [],
            lateTaskIds: result.lateTaskIds ?? [],
        })),
    };
}

async function execute({ client, store, speditionId, at, createDrafts, maxEvaluations, lookbackDays, actor }) {
    const startedAt = new Date();
    const billingStartMonth = rules.billingStartDate.slice(0, 7);
    const currentMonth = berlinMonth(at);
    const cutoffMs = monthWindowMs(billingStartMonth, lookbackDays).startMs;

    const listed = await client.fetchTasks();
    const byId = new Map(listed.map(task => [String(task.id), task]));
    const known = store.knownFinalTaskIds();

    const report = {
        startedAt: startedAt.toISOString(),
        finishedAt: null,
        durationMs: 0,
        listed: listed.length,
        skippedOld: 0,
        skippedKnown: 0,
        deferred: 0,
        evaluated: 0,
        stored: { inserted: 0, updated: 0, unchanged: 0 },
        outcomes: { fine: 0, clear: 0, review: 0 },
        ignored: {},
        newFines: [],
        newReviews: [],
        reopened: [],
        staleInvoiced: [],
        drafts: [],
        dueReminders: [],
        openTasks: [],
        openTaskCount: 0,
        errors: [],
    };

    // 1. Vorauswahl
    const candidates = [];
    for (const task of listed) {
        const startedMs = new Date(task.startTime).getTime();
        if (Number.isFinite(startedMs) && startedMs < cutoffMs) {
            report.skippedOld += 1;
            continue;
        }

        if (!isBillableState(task.state)) {
            if (rules.openStates.includes(Number(task.state))) {
                report.openTaskCount += 1;
                if (report.openTasks.length < MAX_REPORTED_OPEN_TASKS) {
                    report.openTasks.push({
                        taskId: String(task.id),
                        state: Number(task.state),
                        stateName: stateName(task.state),
                        startTime: task.startTime ?? null,
                    });
                }
            }
            continue;
        }

        if (known.has(String(task.id))) {
            report.skippedKnown += 1;
            continue;
        }

        candidates.push(task);
    }

    candidates.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const batch = candidates.slice(0, maxEvaluations);
    report.deferred = candidates.length - batch.length;

    // 2. Auswerten und speichern
    for (const listItem of batch) {
        const taskId = String(listItem.id);

        try {
            let details = null;
            try {
                details = await client.fetchTaskDetails(taskId);
            } catch {
                details = null; // wird als Prüffall "Details nicht ladbar" ausgewertet
            }

            // Spiel aus der Währung der Liste; die Auswertung prüft es gegen die Details
            const game = detectGame(listItem);

            const result = await evaluateTask(
                { listItem, details, loadDriveData: () => client.fetchDriveData(taskId) },
                { speditionId, game }
            );
            report.evaluated += 1;

            if (
                result.outcome === OUTCOMES.REVIEW &&
                result.reason === REASONS.DETAILS_UNAVAILABLE &&
                result.billingMonth === null
            ) {
                // Fahrer und Monat sind aus der Liste bekannt: blockiert nur diesen Fahrer
                result.billingMonth = provisionalMonth(listItem, currentMonth, billingStartMonth);
            }

            if (!STORABLE.includes(result.outcome)) {
                report.ignored[result.outcome] = (report.ignored[result.outcome] ?? 0) + 1;
                continue;
            }

            const saved = store.recordEvaluation(result, { actor });
            report.stored[saved.action] += 1;
            report.outcomes[result.outcome] += 1;

            if (saved.action === 'inserted' || saved.action === 'updated') {
                if (result.outcome === OUTCOMES.FINE) {
                    report.newFines.push({
                        taskId,
                        visibleId: result.visibleId,
                        spedvUserId: result.spedvUserId,
                        spedvName: result.spedvName,
                        billingMonth: result.billingMonth,
                        game: result.game,
                        unit: result.evidence.unit,
                        maxSpeed: result.evidence.maxSpeed,
                        maxVelocityKmh: result.evidence.maxVelocityKmh,
                        fineEur: result.evidence.fineEur,
                    });
                } else if (result.outcome === OUTCOMES.REVIEW) {
                    report.newReviews.push({
                        taskId,
                        visibleId: result.visibleId,
                        spedvUserId: result.spedvUserId,
                        spedvName: result.spedvName,
                        billingMonth: result.billingMonth,
                        game: result.game,
                        reason: result.reason,
                        message: result.message,
                    });
                }
            }
        } catch (error) {
            report.errors.push({ taskId, message: error.message });
        }
    }

    // 3. Statusprüfung: noch nicht abgerechnete Strafen müssen weiter abrechenbar sein
    const months = monthsBetween(billingStartMonth, currentMonth);

    for (const month of months) {
        for (const row of store.summarizeMonth(month)) {
            if (!row.fines) continue;

            for (const fine of store.listFines({ month, spedvUserId: row.spedv_user_id })) {
                const current = byId.get(fine.task_id);
                if (current && isBillableState(current.state)) continue;

                const message = current
                    ? `Der Status ist jetzt ${stateName(current.state)}.`
                    : 'Der Auftrag ist in SpedV nicht mehr vorhanden.';

                try {
                    const reopened = store.reopenTask({
                        taskId: fine.task_id,
                        reason: 'state_changed',
                        message,
                        actor,
                    });
                    if (reopened.action === 'reopened') {
                        report.reopened.push({
                            taskId: fine.task_id,
                            visibleId: fine.visible_id,
                            spedvName: fine.spedv_name,
                            message,
                        });
                    }
                } catch (error) {
                    if (!(error instanceof StoreError)) throw error;
                    // Steckt schon in einer Rechnung: muss ein Mensch entscheiden
                    report.staleInvoiced.push({
                        taskId: fine.task_id,
                        visibleId: fine.visible_id,
                        spedvName: fine.spedv_name,
                        billingMonth: month,
                        message,
                    });
                }
            }
        }
    }

    // 4. Entwürfe für abgeschlossene Monate
    if (createDrafts) {
        for (const month of months) {
            if (!isMonthClosed(month, at)) continue;
            const draftBatch = store.createDraftsForMonth({ month, actor, now: at });
            if (draftBatch.results.length > 0) report.drafts.push(summarizeBatch(draftBatch));
        }
    }

    // 5. Fällige Erinnerungen (der Versand folgt in der Discord-Schicht)
    report.dueReminders = store.listDueForReminder(at);

    const finishedAt = new Date();
    report.finishedAt = finishedAt.toISOString();
    report.durationMs = finishedAt - startedAt;

    return report;
}

/**
 * Ein kompletter Abrechnungslauf. Es läuft immer nur einer gleichzeitig.
 *
 * @param {object} options
 * @param {object} options.client       SpedV-Client (spedvClient.js)
 * @param {object} options.store        Speicher (store.js)
 * @param {string} options.speditionId  Unsere Speditions-ID
 * @param {Date}   [options.now]        Zeitpunkt (für Tests änderbar)
 * @param {boolean} [options.createDrafts] Entwürfe für abgeschlossene Monate erstellen
 * @param {number} [options.maxEvaluations] Obergrenze pro Lauf
 */
async function runBilling({
    client,
    store,
    speditionId,
    now = new Date(),
    createDrafts = true,
    maxEvaluations = 200,
    lookbackDays = rules.defaultLookbackDays,
    actor = 'system',
}) {
    if (running) return { skipped: 'Ein Abrechnungslauf ist bereits aktiv.' };

    const at = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(at.getTime())) throw new TypeError('Ungültiger Zeitpunkt.');

    running = true;
    try {
        return await execute({
            client, store, speditionId: String(speditionId), at,
            createDrafts, maxEvaluations, lookbackDays, actor,
        });
    } finally {
        running = false;
    }
}

module.exports = { runBilling };
