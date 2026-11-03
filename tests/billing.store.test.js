'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openStore, StoreError } = require('../src/billing/store');

function result(overrides = {}) {
    return {
        taskId: '9001',
        visibleId: "#9'001",
        taskState: 2,
        speditionId: '108570',
        spedvUserId: '169742',
        spedvName: 'hundekuchen',
        completedAt: '2026-11-15T17:00:00.000Z',
        billingMonth: '2026-11',
        outcome: 'fine',
        reason: null,
        message: '100 km/h bei Limit 95',
        evidence: { maxVelocityKmh: 100, excessKmh: 5, fineEur: 500, pointsAboveLimit: 2 },
        ...overrides,
    };
}

function review(overrides = {}) {
    return result({
        outcome: 'review',
        reason: 'speed_conflict',
        message: 'SpedV meldet 91 km/h, die Telemetrie 120 km/h.',
        evidence: null,
        ...overrides,
    });
}

const memory = () => openStore({ file: ':memory:' });

test('Strafe wird gespeichert und ist wirksam', () => {
    const store = memory();
    assert.deepEqual(store.recordEvaluation(result()), { action: 'inserted', outcome: 'fine' });

    const task = store.getEffective('9001');
    assert.equal(task.effective_status, 'fine');
    assert.equal(task.effective_fine_eur, 500);
    assert.equal(task.visible_id, "#9'001");
    store.close();
});

test('Erneutes Speichern ändert nichts und erzeugt keinen Protokolleintrag', () => {
    const store = memory();
    store.recordEvaluation(result());
    const before = store.auditLog().length;

    assert.equal(store.recordEvaluation(result()).action, 'unchanged');
    assert.equal(store.recordEvaluation(result({ evidence: { fineEur: 100 } })).action, 'unchanged');
    assert.equal(store.auditLog().length, before);
    assert.equal(store.getEffective('9001').effective_fine_eur, 500);
    store.close();
});

test('Kein Verstoß wird gespeichert und ist endgültig', () => {
    const store = memory();
    store.recordEvaluation(result({
        taskId: '9002', outcome: 'clear', evidence: { maxVelocityKmh: 91, excessKmh: 0, fineEur: 0 },
    }));
    assert.equal(store.getEffective('9002').effective_status, 'clear');
    assert.equal(store.recordEvaluation(result({ taskId: '9002' })).action, 'unchanged');
    assert.equal(store.getEffective('9002').effective_status, 'clear');
    store.close();
});

test('Nicht speicherbare Ergebnisse werden abgelehnt', () => {
    const store = memory();
    assert.throws(() => store.recordEvaluation(result({ outcome: 'foreign' })), TypeError);
    assert.throws(() => store.recordEvaluation(result({ outcome: 'not_billable' })), TypeError);
    assert.throws(() => store.recordEvaluation(result({ taskId: 'abc' })), TypeError);
    assert.throws(() => store.recordEvaluation(result({ evidence: { fineEur: 0 } })), TypeError);
    assert.throws(() => store.recordEvaluation(review({ reason: '' })), TypeError);
    assert.throws(() => store.recordEvaluation(result({ billingMonth: '2026-13' })), TypeError);
    store.close();
});

test('Prüffall ist offen, nicht endgültig und wird bei Änderung aktualisiert', () => {
    const store = memory();
    store.recordEvaluation(review());

    assert.equal(store.getEffective('9001').effective_status, 'open_review');
    assert.equal(store.knownFinalTaskIds().has('9001'), false);
    assert.equal(store.recordEvaluation(review()).action, 'unchanged');
    assert.equal(
        store.recordEvaluation(review({ reason: 'missing_telemetry', message: 'Telemetrie fehlt.' })).action,
        'updated'
    );
    store.close();
});

test('Ein Prüffall löst sich durch eine erfolgreiche Neuauswertung selbst', () => {
    const store = memory();
    store.recordEvaluation(review());

    assert.deepEqual(store.recordEvaluation(result()), { action: 'updated', outcome: 'fine' });
    assert.equal(store.getEffective('9001').effective_status, 'fine');
    assert.equal(store.knownFinalTaskIds().has('9001'), true);
    assert.ok(store.auditLog().some(entry => entry.action === 'review_resolved_by_evaluation'));
    store.close();
});

test('Ausnahme (§ 5.3): Verstoß bleibt sichtbar, kostet aber 0 EUR', () => {
    const store = memory();
    store.recordEvaluation(result());

    const effective = store.decide({
        taskId: '9001', kind: 'waive', reason: 'Genehmigte Konvoi-Ausnahme', actor: '111111111111111111',
    });
    assert.equal(effective.effective_status, 'waived');
    assert.equal(effective.effective_fine_eur, 0);
    assert.equal(effective.outcome, 'fine');
    assert.equal(store.listFines({ month: '2026-11', spedvUserId: '169742' }).length, 0);
    assert.ok(store.auditLog().some(entry => entry.action === 'decision_waive' && entry.actor === '111111111111111111'));
    store.close();
});

test('Ausnahme für einen Auftrag ohne Verstoß ist nicht möglich', () => {
    const store = memory();
    store.recordEvaluation(result({ taskId: '9002', outcome: 'clear', evidence: { fineEur: 0 } }));
    assert.throws(
        () => store.decide({ taskId: '9002', kind: 'waive', reason: 'Test', actor: '1' }),
        StoreError
    );
    store.close();
});

test('dismiss und assess gelten nur für Prüffälle', () => {
    const store = memory();
    store.recordEvaluation(result());

    assert.throws(
        () => store.decide({ taskId: '9001', kind: 'dismiss', reason: 'Test', actor: '1' }),
        StoreError
    );
    assert.throws(
        () => store.decide({ taskId: '9001', kind: 'assess', reason: 'Test', actor: '1', speedKmh: 100 }),
        StoreError
    );
    store.close();
});

test('Prüffall geklärt: kein Verstoß', () => {
    const store = memory();
    store.recordEvaluation(review());

    const effective = store.decide({
        taskId: '9001', kind: 'dismiss', reason: 'Screenshot zeigt 91 km/h', actor: '1',
    });
    assert.equal(effective.effective_status, 'dismissed');
    assert.equal(effective.effective_fine_eur, 0);
    store.close();
});

test('Prüffall geklärt: Strafe nach festgestellter Geschwindigkeit', () => {
    const store = memory();
    store.recordEvaluation(review());

    const effective = store.decide({
        taskId: '9001', kind: 'assess', reason: 'Video zeigt 100 km/h', actor: '1', speedKmh: 100,
    });
    assert.equal(effective.effective_status, 'fine');
    assert.equal(effective.effective_fine_eur, 500);

    const second = memory();
    second.recordEvaluation(review());
    assert.equal(
        second.decide({ taskId: '9001', kind: 'assess', reason: 'unter dem Limit', actor: '1', speedKmh: 90 })
            .effective_fine_eur,
        0
    );
    assert.throws(
        () => second.decide({ taskId: '9001', kind: 'assess', reason: 'zweite', actor: '1', speedKmh: 100 }),
        StoreError
    );

    const invalid = memory();
    invalid.recordEvaluation(review());
    assert.throws(
        () => invalid.decide({ taskId: '9001', kind: 'assess', reason: 'ohne Wert', actor: '1' }),
        StoreError
    );
    store.close();
    second.close();
    invalid.close();
});

test('Nur eine aktive Entscheidung, Widerruf stellt das Ergebnis wieder her', () => {
    const store = memory();
    store.recordEvaluation(result());
    store.decide({ taskId: '9001', kind: 'waive', reason: 'Ausnahme', actor: '1' });

    assert.throws(
        () => store.decide({ taskId: '9001', kind: 'waive', reason: 'nochmal', actor: '1' }),
        StoreError
    );

    const revoked = store.revokeDecision({ taskId: '9001', reason: 'Ausnahme zurückgezogen', actor: '2' });
    assert.equal(revoked.effective_status, 'fine');
    assert.equal(revoked.effective_fine_eur, 500);

    assert.throws(
        () => store.revokeDecision({ taskId: '9001', reason: 'doppelt', actor: '2' }),
        StoreError
    );

    // Nach dem Widerruf ist eine neue Entscheidung möglich
    assert.equal(
        store.decide({ taskId: '9001', kind: 'waive', reason: 'neu genehmigt', actor: '3' }).effective_status,
        'waived'
    );
    store.close();
});

test('Begründung und Person sind Pflicht', () => {
    const store = memory();
    store.recordEvaluation(result());
    assert.throws(() => store.decide({ taskId: '9001', kind: 'waive', reason: '', actor: '1' }), StoreError);
    assert.throws(() => store.decide({ taskId: '9001', kind: 'waive', reason: 'ok ok', actor: '' }), StoreError);
    assert.throws(() => store.decide({ taskId: '9001', kind: 'unbekannt', reason: 'ok ok', actor: '1' }), StoreError);
    store.close();
});

test('Ein Prüffall blockiert nur den betroffenen Fahrer im betroffenen Monat', () => {
    const store = memory();
    store.recordEvaluation(review({ taskId: '1', spedvUserId: '10' }));

    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '10' }).length, 1);
    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '11' }).length, 0);
    assert.equal(store.listBlockingReviews({ month: '2026-12', spedvUserId: '10' }).length, 0);
    store.close();
});

test('Ein Prüffall ohne Monat blockiert alle, bis er geklärt ist', () => {
    const store = memory();
    store.recordEvaluation(review({
        taskId: '2', spedvUserId: '12', billingMonth: null, completedAt: null,
        reason: 'missing_completion_time', message: 'Abschlusszeit fehlt.',
    }));

    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '11' }).length, 1);
    assert.equal(store.listOpenReviews({ month: '2026-11' }).length, 1);

    store.decide({ taskId: '2', kind: 'dismiss', reason: 'Auftrag im Nachhinein geprüft', actor: '1' });
    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '11' }).length, 0);
    assert.equal(store.listOpenReviews().length, 0);
    store.close();
});

test('Monatsübersicht zählt nach wirksamem Ergebnis', () => {
    const store = memory();
    store.recordEvaluation(result({ taskId: '1' }));
    store.recordEvaluation(result({ taskId: '2', evidence: { fineEur: 100 } }));
    store.recordEvaluation(result({ taskId: '3', outcome: 'clear', evidence: { fineEur: 0 } }));
    store.recordEvaluation(review({ taskId: '4' }));
    store.recordEvaluation(result({ taskId: '5', spedvUserId: '200', spedvName: 'andere' }));
    store.decide({ taskId: '2', kind: 'waive', reason: 'Ausnahme erteilt', actor: '1' });

    const rows = store.summarizeMonth('2026-11');
    const driver = rows.find(row => row.spedv_user_id === '169742');

    assert.equal(driver.tasks, 4);
    assert.equal(driver.fines, 1);
    assert.equal(driver.fine_eur, 500);
    assert.equal(driver.clears, 1);
    assert.equal(driver.waived, 1);
    assert.equal(driver.open_reviews, 1);

    const other = rows.find(row => row.spedv_user_id === '200');
    assert.equal(other.fine_eur, 500);
    assert.equal(store.listFines({ month: '2026-11', spedvUserId: '169742' }).length, 1);
    store.close();
});

test('Fehlgeschlagene Entscheidung verändert weder Daten noch Protokoll', () => {
    const store = memory();
    store.recordEvaluation(result());
    const before = store.auditLog().length;

    assert.throws(
        () => store.decide({ taskId: '404', kind: 'waive', reason: 'gibt es nicht', actor: '1' }),
        StoreError
    );
    assert.equal(store.auditLog().length, before);
    store.close();
});

test('Daten bleiben nach erneutem Öffnen erhalten', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkc-billing-'));
    const file = path.join(dir, 'billing.sqlite');

    try {
        let store = openStore({ file });
        store.recordEvaluation(result());
        store.decide({ taskId: '9001', kind: 'waive', reason: 'Ausnahme', actor: '1' });
        store.close();

        store = openStore({ file });
        assert.equal(store.getEffective('9001').effective_status, 'waived');
        assert.equal(store.auditLog().length, 2);
        store.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Eine neuere Datenbankversion wird abgelehnt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkc-billing-'));
    const file = path.join(dir, 'billing.sqlite');

    try {
        const db = new DatabaseSync(file);
        db.exec('PRAGMA user_version = 99');
        db.close();

        assert.throws(() => openStore({ file }), StoreError);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
