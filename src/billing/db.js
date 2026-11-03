'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const MIGRATIONS = require('./migrations');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'billing.sqlite');

/** Fehler mit Text, der einer berechtigten Person direkt angezeigt werden darf. */
class StoreError extends Error { }

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
    return String(month);
}

/** Übersetzt die Sperre der Datenbank (Trigger) in eine verständliche Meldung. */
function asStoreError(error) {
    if (error instanceof StoreError) return error;
    if (/in einer Rechnung enthalten/.test(String(error?.message))) {
        return new StoreError('Der Auftrag ist bereits in einer Rechnung enthalten. Storniere die Rechnung zuerst.');
    }
    return error;
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

function openDatabase(options = {}) {
    const file = options.file ?? process.env.HKC_BILLING_DB ?? DEFAULT_FILE;
    const inMemory = file === ':memory:';

    if (!inMemory) {
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }

    const db = new DatabaseSync(file);
    let insertAudit;

    try {
        db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        if (!inMemory) db.exec('PRAGMA journal_mode = WAL;');
        migrate(db);
        insertAudit = db.prepare(
            'INSERT INTO audit (at, actor, action, subject, details_json) VALUES (?, ?, ?, ?, ?)'
        );
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
            throw asStoreError(error);
        }
    }

    function writeAudit(actor, action, subject, details) {
        insertAudit.run(
            new Date().toISOString(),
            String(actor),
            action,
            subject ?? null,
            details ? JSON.stringify(details) : null
        );
    }

    return { db, file, transaction, writeAudit, close: () => db.close() };
}

module.exports = {
    openDatabase,
    StoreError,
    plain,
    plainAll,
    requireText,
    requireMonth,
};
