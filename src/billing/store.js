'use strict';

const rules = require('./rules');
const {
    openDatabase,
    StoreError,
    plain,
    plainAll,
    requireText,
    requireMonth,
} = require('./db');
const { createInvoiceApi } = require('./invoices');

const DECISION_KINDS = ['waive', 'dismiss', 'assess'];
const STORED_OUTCOMES = ['fine', 'clear', 'review'];

function validateResult(result) {
    if (!result || typeof result !== 'object') {
        throw new TypeError('Auswertungsergebnis fehlt.');
    }
    if (!/^\d+$/.test(String(result.taskId ?? ''))) {
        throw new TypeError('taskId fehlt oder ist ungültig.');
    }
    if (!STORED_OUTCOMES.includes(result.outcome)) {
        throw new TypeError(`Ergebnis "${result.outcome}" wird nicht gespeichert.`);
    }
    if (!Number.isInteger(Number(result.taskState))) {
        throw new TypeError('taskState fehlt oder ist ungültig.');
    }
    if (result.outcome === 'review' && !String(result.reason ?? '').trim()) {
        throw new TypeError('Prüffall ohne Grund.');
    }
    if (result.outcome === 'fine') {
        const fine = Number(result.evidence?.fineEur);
        if (!Number.isInteger(fine) || fine <= 0) {
            throw new TypeError('Strafe ohne gültigen Betrag.');
        }
    }
    if (
        result.billingMonth !== null &&
        result.billingMonth !== undefined &&
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.billingMonth)
    ) {
        throw new TypeError('Ungültiger Abrechnungsmonat.');
    }
    if (
        result.game !== undefined &&
        result.game !== null &&
        !Object.hasOwn(rules.games, result.game)
    ) {
        throw new TypeError(`Unbekanntes Spiel "${result.game}".`);
    }
}

function toValues(result) {
    return {
        taskId: String(result.taskId),
        visibleId: result.visibleId ?? null,
        spedvUserId: result.spedvUserId ?? null,
        spedvName: result.spedvName ?? null,
        taskState: Number(result.taskState),
        completedAt: result.completedAt ?? null,
        billingMonth: result.billingMonth ?? null,
        outcome: result.outcome,
        reason: result.reason ?? null,
        message: result.message ?? null,
        maxVelocityKmh: result.evidence?.maxVelocityKmh ?? null,
        excessKmh: result.evidence?.excessKmh ?? null,
        fineEur: result.outcome === 'fine' ? Number(result.evidence.fineEur) : 0,
        evidenceJson: result.evidence ? JSON.stringify(result.evidence) : null,
        // Ergebnisse ohne Spielangabe (ältere Aufrufer) gelten als ETS2, null = nicht erkennbar
        game: result.game === undefined ? 'ets2' : result.game,
    };
}

function createTaskApi({ db, transaction, writeAudit }) {
    const st = {
        getTask: db.prepare('SELECT * FROM tasks WHERE task_id = ?'),
        insertTask: db.prepare(`
      INSERT INTO tasks (
        task_id, visible_id, spedv_user_id, spedv_name, task_state, completed_at,
        billing_month, outcome, reason, message, max_velocity_kmh, excess_kmh,
        fine_eur, evidence_json, game, evaluated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
        updateTask: db.prepare(`
      UPDATE tasks SET
        visible_id = ?, spedv_user_id = ?, spedv_name = ?, task_state = ?, completed_at = ?,
        billing_month = ?, outcome = ?, reason = ?, message = ?, max_velocity_kmh = ?,
        excess_kmh = ?, fine_eur = ?, evidence_json = ?, game = ?, updated_at = ?
      WHERE task_id = ?`),
        reopenTask: db.prepare(`
      UPDATE tasks SET outcome = 'review', reason = ?, message = ?, fine_eur = 0, updated_at = ?
      WHERE task_id = ?`),
        getEffective: db.prepare('SELECT * FROM task_effective WHERE task_id = ?'),
        getActiveDecision: db.prepare('SELECT * FROM decisions WHERE task_id = ? AND revoked_at IS NULL'),
        insertDecision: db.prepare(`
      INSERT INTO decisions (task_id, kind, speed_kmh, excess_kmh, fine_eur, reason, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
        revokeDecision: db.prepare(`
      UPDATE decisions SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?`),
        finalIds: db.prepare(`SELECT task_id FROM tasks WHERE outcome IN ('fine', 'clear')`),
        openReviews: db.prepare(`
      SELECT * FROM task_effective
      WHERE effective_status = 'open_review' AND (? IS NULL OR billing_month = ? OR billing_month IS NULL)
      ORDER BY billing_month, completed_at, task_id`),
        blockingReviews: db.prepare(`
      SELECT * FROM task_effective
      WHERE effective_status = 'open_review'
        AND (billing_month IS NULL OR (billing_month = ? AND spedv_user_id = ?))
      ORDER BY billing_month, completed_at, task_id`),
        summary: db.prepare(`
      SELECT
        spedv_user_id,
        MAX(spedv_name) AS spedv_name,
        COUNT(*) AS tasks,
        COALESCE(SUM(effective_status = 'fine'), 0) AS fines,
        COALESCE(SUM(effective_fine_eur), 0) AS fine_eur,
        COALESCE(SUM(effective_status = 'clear'), 0) AS clears,
        COALESCE(SUM(effective_status = 'waived'), 0) AS waived,
        COALESCE(SUM(effective_status = 'dismissed'), 0) AS dismissed,
        COALESCE(SUM(effective_status = 'open_review'), 0) AS open_reviews
      FROM task_effective
      WHERE billing_month = ?
      GROUP BY spedv_user_id
      ORDER BY spedv_name`),
        fines: db.prepare(`
      SELECT * FROM task_effective
      WHERE effective_status = 'fine' AND billing_month = ? AND spedv_user_id = ?
      ORDER BY completed_at, task_id`),
        audit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    };

    /**
     * Speichert das Ergebnis einer Auswertung.
     * Strafe/kein Verstoß sind endgültig, ein Prüffall wird bei neuer Auswertung aktualisiert.
     */
    function recordEvaluation(result, { actor = 'system' } = {}) {
        validateResult(result);
        const v = toValues(result);
        const now = new Date().toISOString();

        return transaction(() => {
            const existing = st.getTask.get(v.taskId);

            if (!existing) {
                st.insertTask.run(
                    v.taskId, v.visibleId, v.spedvUserId, v.spedvName, v.taskState, v.completedAt,
                    v.billingMonth, v.outcome, v.reason, v.message, v.maxVelocityKmh, v.excessKmh,
                    v.fineEur, v.evidenceJson, v.game, now, now
                );
                writeAudit(actor, 'task_recorded', v.taskId, {
                    outcome: v.outcome,
                    reason: v.reason,
                    game: v.game,
                    fineEur: v.fineEur,
                });
                return { action: 'inserted', outcome: v.outcome };
            }

            if (existing.outcome !== 'review') {
                return { action: 'unchanged', outcome: existing.outcome };
            }

            const sameReview =
                v.outcome === 'review' &&
                existing.reason === v.reason &&
                existing.message === v.message &&
                existing.task_state === v.taskState &&
                existing.billing_month === v.billingMonth &&
                existing.spedv_user_id === v.spedvUserId &&
                existing.game === v.game;

            if (sameReview) {
                return { action: 'unchanged', outcome: 'review' };
            }

            st.updateTask.run(
                v.visibleId, v.spedvUserId, v.spedvName, v.taskState, v.completedAt,
                v.billingMonth, v.outcome, v.reason, v.message, v.maxVelocityKmh,
                v.excessKmh, v.fineEur, v.evidenceJson, v.game, now, v.taskId
            );
            writeAudit(
                actor,
                v.outcome === 'review' ? 'review_updated' : 'review_resolved_by_evaluation',
                v.taskId,
                { outcome: v.outcome, reason: v.reason, game: v.game, fineEur: v.fineEur }
            );
            return { action: 'updated', outcome: v.outcome };
        });
    }

    /**
     * Macht aus einem endgültigen Ergebnis wieder einen Prüffall, zum Beispiel wenn sich
     * der SpedV-Status nach der Auswertung geändert hat. Nicht möglich, solange der
     * Auftrag in einer aktiven Rechnung steckt (die Datenbank verhindert es).
     */
    function reopenTask({ taskId, reason, message, actor }) {
        const id = String(taskId ?? '').trim();
        const why = requireText(reason, 'Der Grund', 1, 100);
        const text = requireText(message, 'Die Meldung', 3, 500);
        const who = requireText(actor, 'Die ausführende Person', 1, 64);

        return transaction(() => {
            const task = st.getTask.get(id);
            if (!task) throw new StoreError('Auftrag nicht gefunden.');
            if (task.outcome === 'review') return { action: 'unchanged' };

            st.reopenTask.run(why, text, new Date().toISOString(), id);
            writeAudit(who, 'task_reopened', id, {
                reason: why,
                previousOutcome: task.outcome,
                previousFineEur: task.fine_eur,
            });
            return { action: 'reopened' };
        });
    }

    function getEffective(taskId) {
        return plain(st.getEffective.get(String(taskId)));
    }

    /** IDs aller Aufträge mit endgültigem Ergebnis: sie müssen nicht erneut geladen werden. */
    function knownFinalTaskIds() {
        return new Set(st.finalIds.all().map(row => row.task_id));
    }

    function listOpenReviews({ month = null } = {}) {
        if (month !== null) requireMonth(month);
        return plainAll(st.openReviews.all(month, month));
    }

    /** Offene Prüffälle, die die Rechnung dieses Fahrers in diesem Monat blockieren. */
    function listBlockingReviews({ month, spedvUserId }) {
        requireMonth(month);
        return plainAll(st.blockingReviews.all(month, String(spedvUserId)));
    }

    function summarizeMonth(month) {
        requireMonth(month);
        return plainAll(st.summary.all(month));
    }

    function listFines({ month, spedvUserId }) {
        requireMonth(month);
        return plainAll(st.fines.all(month, String(spedvUserId)));
    }

    /**
     * Hält eine menschliche Entscheidung fest.
     * waive   = Ausnahme genehmigt (§ 5.3), kostet 0 €
     * dismiss = Prüffall geklärt, kein Verstoß
     * assess  = Prüffall geklärt, Strafe nach festgestellter Geschwindigkeit
     *
     * Bei "assess" ist die Geschwindigkeit in der Einheit des Spiels anzugeben:
     * km/h bei ETS2, mph bei ATS ("speed"; "speedKmh" bleibt als Kurzform für ETS2).
     */
    function decide({ taskId, kind, reason, actor, speed = null, speedKmh = null }) {
        const id = String(taskId ?? '').trim();
        if (!DECISION_KINDS.includes(kind)) {
            throw new StoreError('Unbekannte Entscheidungsart.');
        }
        const why = requireText(reason, 'Die Begründung', 3, 500);
        const who = requireText(actor, 'Die ausführende Person', 1, 64);

        if (speed !== null && speedKmh !== null) {
            throw new StoreError('Bitte nur eine Geschwindigkeitsangabe machen.');
        }

        const given = speed !== null ? speed : speedKmh;
        const value = Number(given);

        if (kind === 'assess' && (given === null || !Number.isFinite(value) || value < 0 || value > 400)) {
            throw new StoreError('Für die Festsetzung ist eine gültige Geschwindigkeit nötig.');
        }

        return transaction(() => {
            const task = st.getTask.get(id);
            if (!task) throw new StoreError('Auftrag nicht gefunden.');

            if (kind !== 'waive' && task.outcome !== 'review') {
                throw new StoreError('Diese Entscheidung ist nur für Prüffälle möglich.');
            }
            if (kind === 'waive' && task.outcome === 'clear') {
                throw new StoreError('Der Auftrag hat keinen Verstoß, eine Ausnahme ist nicht nötig.');
            }
            if (st.getActiveDecision.get(id)) {
                throw new StoreError('Für diesen Auftrag gibt es schon eine Entscheidung. Widerrufe sie zuerst.');
            }

            let speedForRow = null;
            let excessKmh = null;
            let fineEur = 0;
            let detail = null;

            if (kind === 'assess') {
                const gameRules = rules.games[task.game];
                if (!gameRules) {
                    throw new StoreError('Das Spiel des Auftrags ist nicht bekannt. Eine Festsetzung ist nicht möglich.');
                }

                const excessUnits = Math.max(0, Math.ceil(value) - gameRules.limit);
                fineEur = excessUnits * gameRules.finePerUnit;

                // Gespeichert wird die physikalische Geschwindigkeit in km/h
                speedForRow = gameRules.unit === 'mph'
                    ? Math.round(value * rules.kmhPerMph * 100) / 100
                    : value;
                excessKmh = gameRules.unit === 'kmh' ? excessUnits : null;
                detail = { speed: value, unit: gameRules.unit, excessUnits };
            }

            st.insertDecision.run(id, kind, speedForRow, excessKmh, fineEur, why, who, new Date().toISOString());
            writeAudit(who, `decision_${kind}`, id, { reason: why, fineEur, ...detail });

            return plain(st.getEffective.get(id));
        });
    }

    function revokeDecision({ taskId, reason, actor }) {
        const id = String(taskId ?? '').trim();
        const why = requireText(reason, 'Die Begründung', 3, 500);
        const who = requireText(actor, 'Die ausführende Person', 1, 64);

        return transaction(() => {
            const active = st.getActiveDecision.get(id);
            if (!active) throw new StoreError('Für diesen Auftrag gibt es keine aktive Entscheidung.');

            st.revokeDecision.run(new Date().toISOString(), who, why, active.id);
            writeAudit(who, 'decision_revoked', id, { kind: active.kind, reason: why });

            return plain(st.getEffective.get(id));
        });
    }

    function auditLog({ limit = 100 } = {}) {
        return plainAll(st.audit.all(Math.min(Math.max(Number(limit) || 100, 1), 1000)));
    }

    return {
        recordEvaluation,
        reopenTask,
        getEffective,
        knownFinalTaskIds,
        listOpenReviews,
        listBlockingReviews,
        summarizeMonth,
        listFines,
        decide,
        revokeDecision,
        auditLog,
    };
}

function openStore(options = {}) {
    const context = openDatabase(options);

    try {
        return {
            ...createTaskApi(context),
            ...createInvoiceApi(context),
            close: context.close,
        };
    } catch (error) {
        context.close();
        throw error;
    }
}

module.exports = { openStore, StoreError };