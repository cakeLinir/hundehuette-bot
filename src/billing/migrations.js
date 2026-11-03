'use strict';

/**
 * Schema-Versionen. Eine veröffentlichte Version wird nie geändert,
 * Änderungen kommen immer als neuer Eintrag am Ende.
 */
module.exports = [
    // Version 1: Aufträge, Entscheidungen, Protokoll
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

  -- Wirksames Ergebnis: eine aktive Entscheidung geht der automatischen Auswertung vor.
  -- Eine festgesetzte Strafe von 0 EUR zählt als "geklärt, kein Verstoß".
  CREATE VIEW task_effective AS
  SELECT
    t.*,
    d.id         AS decision_id,
    d.kind       AS decision_kind,
    d.reason     AS decision_reason,
    d.decided_by AS decision_by,
    d.decided_at AS decision_at,
    CASE
      WHEN d.kind = 'assess' THEN CASE WHEN d.fine_eur > 0 THEN 'fine' ELSE 'dismissed' END
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

    // Version 2: Rechnungen
    `
  CREATE TABLE invoices (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    number              TEXT NOT NULL UNIQUE,
    billing_month       TEXT NOT NULL CHECK (billing_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    spedv_user_id       TEXT NOT NULL,
    spedv_name          TEXT NOT NULL,
    discord_id          TEXT,
    total_eur           INTEGER NOT NULL CHECK (total_eur > 0),
    status              TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'void')),
    created_at          TEXT NOT NULL,
    created_by          TEXT NOT NULL,
    first_send_at       TEXT,
    last_send_at        TEXT,
    due_at              TEXT,
    delivery            TEXT CHECK (delivery IS NULL OR delivery IN ('pending', 'delivered', 'failed', 'unknown')),
    fallback_status     TEXT CHECK (fallback_status IS NULL OR fallback_status IN ('pending', 'sent', 'unknown')),
    fallback_channel_id TEXT,
    fallback_message_id TEXT,
    fallback_at         TEXT,
    reminder_at         TEXT,
    reminder_delivery   TEXT CHECK (reminder_delivery IS NULL OR reminder_delivery IN ('delivered', 'failed', 'unknown')),
    paid_at             TEXT,
    paid_by             TEXT,
    void_at             TEXT,
    void_by             TEXT,
    void_reason         TEXT
  );

  -- Pro Fahrer und Monat höchstens eine aktive Rechnung
  CREATE UNIQUE INDEX idx_invoices_active ON invoices (billing_month, spedv_user_id) WHERE status <> 'void';
  CREATE INDEX idx_invoices_due ON invoices (status, due_at);

  CREATE TABLE invoice_lines (
    invoice_id       INTEGER NOT NULL REFERENCES invoices (id),
    task_id          TEXT NOT NULL REFERENCES tasks (task_id),
    visible_id       TEXT,
    completed_at     TEXT,
    max_velocity_kmh REAL,
    excess_kmh       INTEGER,
    fine_eur         INTEGER NOT NULL CHECK (fine_eur > 0),
    active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    PRIMARY KEY (invoice_id, task_id)
  );

  -- Ein Auftrag steckt in höchstens einer aktiven Rechnung
  CREATE UNIQUE INDEX idx_lines_active_task ON invoice_lines (task_id) WHERE active = 1;

  -- Ein Auftrag in einer aktiven Rechnung ist gesperrt
  CREATE TRIGGER trg_decisions_insert_invoiced BEFORE INSERT ON decisions
  WHEN EXISTS (SELECT 1 FROM invoice_lines WHERE task_id = NEW.task_id AND active = 1)
  BEGIN
    SELECT RAISE(ABORT, 'Der Auftrag ist bereits in einer Rechnung enthalten.');
  END;

  CREATE TRIGGER trg_decisions_revoke_invoiced BEFORE UPDATE OF revoked_at ON decisions
  WHEN NEW.revoked_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM invoice_lines WHERE task_id = NEW.task_id AND active = 1)
  BEGIN
    SELECT RAISE(ABORT, 'Der Auftrag ist bereits in einer Rechnung enthalten.');
  END;

  CREATE TRIGGER trg_tasks_update_invoiced BEFORE UPDATE ON tasks
  WHEN EXISTS (SELECT 1 FROM invoice_lines WHERE task_id = OLD.task_id AND active = 1)
  BEGIN
    SELECT RAISE(ABORT, 'Der Auftrag ist bereits in einer Rechnung enthalten.');
  END;
  `,
];
