'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const rules = require('./rules');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'billing.sqlite');
const DECISION_KINDS = ['waive', 'dismiss', 'assess'];
const STORED_OUTCOMES = ['fine', 'clear', 'review'];

/** Fehler mit Text, der einer berechtigten Person direkt angezeigt werden darf. */
class StoreError extends Error { }

const MIGRATIONS = [
    // Version 1
    `
  CREATE TABLE tasks (
    task_id          TEXT PRIMARY KEY CHECK (task_id GLOB '[0-9]*'),
    visible_id       TEXT,
    spedv_user_id    TEXT,
    spedv_name       TEXT,
    task_state       INTEGER NOT NULL,
    completed_at     TEXT,
    billing_month    TEXT CHECK (billing_month IS NULL OR billing_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    outcome          TEXT NOT NULL CHECK (outcome IN ('fine', 'clear', 'review')),
    reason           TEXT,
    message          TEXT,
    max_velocity_kmh REAL,
    excess_kmh       INTEGER,
    fine_eur         INTEGER NOT NULL DEFAULT 0 CHECK (fine_eur >= 0),
    evidence_json    TEXT,
    evaluated_at     TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE INDEX idx_tasks_month_user ON tasks (billing_month, spedv_user_id);
  CREATE INDEX idx_tasks_outcome ON tasks (outcome);

  CREATE TABLE decisions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL REFERENCES tasks (task_id),
    kind          TEXT NOT NULL CHECK (kind IN ('waive', 'dismiss', 'assess')),
    speed_kmh     REAL,
    excess_kmh    INTEGER,
    fine_eur      INTEGER NOT NULL DEFAULT 0 CHECK (fine_eur >= 0),
    reason        TEXT NOT NULL,
    decided_by    TEXT NOT NULL,
    decided_at    TEXT NOT NULL,
    revoked_at    TEXT,
    revoked_by    TEXT,
    revoke_reason TEXT
  );

  -- Pro Auftrag höchstens eine aktive Entscheidung
  CREATE UNIQUE INDEX idx_decisions_active ON decisions (task_id) WHERE revoked_at IS NULL;

  CREATE TABLE audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    actor        TEXT NOT NULL,
    action       TEXT NOT NULL,
    subject      TEXT,
    details_json TEXT
  );

  -- Wirksames Ergebnis: eine aktive Entscheidung geht der automatischen Auswertung vor
  CREATE VIEW task_effective AS
  SELECT
    t.*,
    d.id         AS decision_id,
    d.kind       AS decision_kind,
    d.reason     AS decision_reason,
    d.decided_by AS decision_by,
    d.decided_at AS decision_at,
    CASE
      WHEN d.kind = 'assess'  THEN 'fine'
      WHEN d.kind = 'waive'   THEN 'waived'
      WHEN d.kind = 'dismiss' THEN 'dismissed'
      WHEN t.outcome = 'review' THEN 'open_review'
      ELSE t.outcome
    END AS effective_status,
    CASE
      WHEN d.kind = 'assess' THEN d.fine_eur
      WHEN d.kind IS NOT NULL THEN 0
      WHEN t.outcome = 'fine' THEN t.fine_eur
      ELSE 0
    END AS effective_fine_eur
  FROM tasks t
  LEFT JOIN decisions d ON d.task_id = t.task_id AND d.revoked_at IS NULL;
  `,
];

const plain = row => (row ? { ...row } : null);
const plainAll = rows => rows.map(row => ({ ...row }));

function requireText(value, label, min, max) {
    const text = String(value ?? '').trim();
    if (text.length < min || text.length > max) {
        throw new StoreError(`${label} fehlt oder hat eine ungültige Länge (${min} bis ${max} Zeichen).`);
    }
    return text;
}

function requireMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month ?? ''))) {
        throw new StoreError('Monat muss im Format YYYY-MM angegeben werden.');
    }
    return month;
}

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
    };
}

function migrate(db) {
    const current = db.prepare('PRAGMA user_version').get().user_version;

    if (current > MIGRATIONS.length) {
        throw new StoreError(
            `Die Datenbank hat Version ${current}, dieser Code kennt nur bis ${MIGRATIONS.length}.`
        );
    }

    for (let version = current; version < MIGRATIONS.length; version += 1) {
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec(MIGRATIONS[version]);
            db.exec(`PRAGMA user_version = ${version + 1}`);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
}

function prepareStatements(db) {
    return {
        getTask: db.prepare('SELECT * FROM tasks WHERE task_id = ?'),
        insertTask: db.prepare(`
      INSERT INTO tasks (
        task_id, visible_id, spedv_user_id, spedv_name, task_state, completed_at,
        billing_month, outcome, reason, message, max_velocity_kmh, excess_kmh,
        fine_eur, evidence_json, evaluated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
        updateTask: db.prepare(`
      UPDATE tasks SET
        visible_id = ?, spedv_user_id = ?, spedv_name = ?, task_state = ?, completed_at = ?,
        billing_month = ?, outcome = ?, reason = ?, message = ?, max_velocity_kmh = ?,
        excess_kmh = ?, fine_eur = ?, evidence_json = ?, updated_at = ?
      WHERE task_id = ?`),
        getEffective: db.prepare('SELECT * FROM task_effective WHERE task_id = ?'),
        getActiveDecision: db.prepare('SELECT * FROM decisions WHERE task_id = ? AND revoked_at IS NULL'),
        insertDecision: db.prepare(`
      INSERT INTO decisions (task_id, kind, speed_kmh, excess_kmh, fine_eur, reason, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
        revokeDecision: db.prepare(`
      UPDATE decisions SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?`),
        insertAudit: db.prepare(`
      INSERT INTO audit (at, actor, action, subject, details_json) VALUES (?, ?, ?, ?, ?)`),
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
}

function openStore(options = {}) {
    const file = options.file ?? process.env.HKC_BILLING_DB ?? DEFAULT_FILE;
    const inMemory = file === ':memory:';

    if (!inMemory) {
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }

    const db = new DatabaseSync(file);
    let st;

    try {
        db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        if (!inMemory) db.exec('PRAGMA journal_mode = WAL;');
        migrate(db);
        st = prepareStatements(db);
    } catch (error) {
        // Datei freigeben: sonst bleibt sie (vor allem unter Windows) gesperrt
        try {
            db.close();
        } catch {
            // Ursprünglichen Fehler beibehalten
        }
        throw error;
    }

    function transaction(fn) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            db.exec('COMMIT');
            return result;
        } catch (error) {
            try {
                db.exec('ROLLBACK');
            } catch {
                // Ursprünglichen Fehler beibehalten
            }
            throw error;
        }
    }

    function writeAudit(actor, action, subject, details) {
        st.insertAudit.run(
            new Date().toISOString(),
            String(actor),
            action,
            subject ?? null,
            details ? JSON.stringify(details) : null
        );
    }

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
                    v.fineEur, v.evidenceJson, now, now
                );
                writeAudit(actor, 'task_recorded', v.taskId, {
                    outcome: v.outcome,
                    reason: v.reason,
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
                existing.spedv_user_id === v.spedvUserId;

            if (sameReview) {
                return { action: 'unchanged', outcome: 'review' };
            }

            st.updateTask.run(
                v.visibleId, v.spedvUserId, v.spedvName, v.taskState, v.completedAt,
                v.billingMonth, v.outcome, v.reason, v.message, v.maxVelocityKmh,
                v.excessKmh, v.fineEur, v.evidenceJson, now, v.taskId
            );
            writeAudit(
                actor,
                v.outcome === 'review' ? 'review_updated' : 'review_resolved_by_evaluation',
                v.taskId,
                { outcome: v.outcome, reason: v.reason, fineEur: v.fineEur }
            );
            return { action: 'updated', outcome: v.outcome };
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
     */
    function decide({ taskId, kind, reason, actor, speedKmh = null }) {
        const id = String(taskId ?? '').trim();
        if (!DECISION_KINDS.includes(kind)) {
            throw new StoreError('Unbekannte Entscheidungsart.');
        }
        const why = requireText(reason, 'Die Begründung', 3, 500);
        const who = requireText(actor, 'Die ausführende Person', 1, 64);

        let excessKmh = null;
        let fineEur = 0;
        let speed = null;

        if (kind === 'assess') {
            speed = Number(speedKmh);
            if (speedKmh === null || !Number.isFinite(speed) || speed < 0 || speed > 400) {
                throw new StoreError('Für die Festsetzung ist eine gültige Geschwindigkeit nötig.');
            }
            excessKmh = Math.max(0, Math.ceil(speed) - rules.speedLimitKmh);
            fineEur = excessKmh * rules.fineEurPerKmh;
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

            st.insertDecision.run(id, kind, speed, excessKmh, fineEur, why, who, new Date().toISOString());
            writeAudit(who, `decision_${kind}`, id, { reason: why, speedKmh: speed, fineEur });

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

    function close() {
        db.close();
    }

    return {
        recordEvaluation,
        getEffective,
        knownFinalTaskIds,
        listOpenReviews,
        listBlockingReviews,
        summarizeMonth,
        listFines,
        decide,
        revokeDecision,
        auditLog,
        close,
    };
}

module.exports = { openStore, StoreError };
