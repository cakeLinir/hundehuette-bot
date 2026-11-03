'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/billing/store');
const { buildStatement, runClosingCheck } = require('../src/billing/closing');

const CLOSED = new Date('2026-12-02T06:00:00Z');
const OPEN = new Date('2026-11-20T06:00:00Z');
const START = '2026-11-15T16:00:00+01:00';

function task(overrides = {}) {
    return {
        taskId: '1',
        visibleId: '#1',
        taskState: 2,
        speditionId: '108570',
        spedvUserId: '169742',
        spedvName: 'hundekuchen',
        completedAt: '2026-11-15T17:00:00.000Z',
        billingMonth: '2026-11',
        outcome: 'fine',
        reason: null,
        message: '',
        evidence: { maxVelocityKmh: 100, excessKmh: 5, fineEur: 500 },
        ...overrides,
    };
}

const clear = overrides => task({ outcome: 'clear', evidence: { fineEur: 0 }, ...overrides });

const review = overrides => task({
    outcome: 'review',
    reason: 'speed_conflict',
    message: 'Widerspruch',
    evidence: null,
    ...overrides,
});

const listed = (id, overrides = {}) => ({ id, state: 2, userID: 169742, startTime: START, ...overrides });

function check(store, tasks, extra = {}) {
    return runClosingCheck({
        store,
        listedTasks: tasks,
        linkedUserIds: ['169742', '200'],
        month: '2026-11',
        now: CLOSED,
        ...extra,
    });
}

const item = (report, id) => report.items.find(entry => entry.id === id);

test('Läuft der Monat noch, ist die Prüfung durchgefallen und nichts versandbereit', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());

    const report = check(store, [listed(1)], { now: OPEN });
    assert.equal(item(report, 'month_closed').status, 'fail');
    assert.equal(report.passed, false);
    assert.deepEqual(report.readyDrivers, []);
    store.close();
});

test('Alles in Ordnung: erst Hinweis "Entwurf fehlt", nach den Entwürfen alles grün', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    const tasks = [listed(1)];

    const before = check(store, tasks);
    assert.equal(before.passed, true);
    assert.equal(before.status, 'warn');
    assert.equal(item(before, 'drafts_missing').status, 'warn');
    assert.equal(before.readyDrivers.length, 1);
    assert.equal(before.readyDrivers[0].invoiceNumber, null);

    store.createDraftsForMonth({ month: '2026-11', actor: '1', now: CLOSED });

    const after = check(store, tasks);
    assert.equal(after.status, 'ok');
    assert.deepEqual(after.readyDrivers.map(driver => driver.invoiceNumber), ['HKC-2026-11-169742']);
    assert.equal(after.statement.totals.invoicedEur, 500);
    store.close();
});

test('Nicht ausgewertete Aufträge lassen die Prüfung durchfallen', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));

    const report = check(store, [listed(1), listed(99)]);
    assert.equal(item(report, 'not_evaluated').status, 'fail');
    assert.deepEqual(item(report, 'not_evaluated').data.map(entry => entry.taskId), ['99']);
    store.close();
});

test('Offene Aufträge sind ein Hinweis, Oktoberaufträge zählen nicht', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));

    const report = check(store, [
        listed(1),
        listed(70, { state: 1 }),
        listed(71, { state: 0 }),
        listed(72, { state: 5, startTime: '2026-10-20T10:00:00+02:00' }),
    ]);

    const pending = item(report, 'pending_tasks');
    assert.equal(pending.status, 'warn');
    assert.deepEqual(pending.data.map(entry => entry.taskId).sort(), ['70', '71']);
    assert.equal(report.passed, true);
    store.close();
});

test('AdminCheck ist ein Hinweis, der Fahrer bleibt versandbereit', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1', taskState: 4 }));

    const report = check(store, [listed(1, { state: 4 })]);
    assert.equal(item(report, 'provisional_tasks').status, 'warn');
    assert.equal(item(report, 'state_changed').status, 'ok');
    assert.equal(report.readyDrivers.length, 1);
    store.close();
});

test('Geänderter Status eines Strafauftrags: durchgefallen, Fahrer nicht versandbereit', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(task({ taskId: '2', spedvUserId: '200', spedvName: 'zweiter' }));

    const report = check(store, [listed(1, { state: 6 }), listed(2, { userID: 200 })]);
    assert.equal(item(report, 'state_changed').status, 'fail');
    assert.equal(item(report, 'state_changed').data[0].state, 'Cancelled');
    assert.deepEqual(report.readyDrivers.map(driver => driver.spedvUserId), ['200']);

    // Verschwundener Auftrag
    const gone = check(store, [listed(2, { userID: 200 })]);
    assert.equal(item(gone, 'state_changed').data[0].state, 'nicht mehr vorhanden');
    store.close();
});

test('Ein offener Prüffall macht nur diesen Fahrer unfertig', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(task({ taskId: '2', spedvUserId: '200', spedvName: 'zweiter' }));
    store.recordEvaluation(review({ taskId: '3', spedvUserId: '200', spedvName: 'zweiter' }));

    const report = check(store, [listed(1), listed(2, { userID: 200 }), listed(3, { userID: 200 })]);
    assert.equal(item(report, 'open_reviews').status, 'fail');
    assert.equal(item(report, 'open_reviews').data[0].global, false);
    assert.equal(report.passed, false);
    assert.deepEqual(report.readyDrivers.map(driver => driver.spedvUserId), ['169742']);
    store.close();
});

test('Ein Prüffall ohne Monat blockiert alle', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(review({
        taskId: '8', spedvUserId: '300', billingMonth: null, completedAt: null,
        reason: 'missing_completion_time',
    }));

    const report = check(store, [listed(1)]);
    assert.equal(item(report, 'open_reviews').data[0].global, true);
    assert.deepEqual(report.readyDrivers, []);
    assert.equal(report.statement.globalReviews.length, 1);

    store.decide({ taskId: '8', kind: 'dismiss', reason: 'Alter Auftrag, geklärt', actor: '1' });
    assert.equal(check(store, [listed(1)]).readyDrivers.length, 1);
    store.close();
});

test('Fahrer ohne Discord-Verknüpfung fallen durch und sind nicht versandbereit', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));

    const report = check(store, [listed(1)], { linkedUserIds: [] });
    assert.equal(item(report, 'unlinked_drivers').status, 'fail');
    assert.equal(item(report, 'unlinked_drivers').data[0].spedvName, 'hundekuchen');
    assert.deepEqual(report.readyDrivers, []);
    store.close();
});

test('Nachzügler nach dem Entwurf werden als Hinweis gemeldet', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.createDraftsForMonth({ month: '2026-11', actor: '1', now: CLOSED });

    store.recordEvaluation(task({
        taskId: '7', evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 },
    }));
    store.recordSendAttempt({
        number: 'HKC-2026-11-169742', discordId: '222222222222222222', actor: '1', now: CLOSED,
    });

    const report = check(store, [listed(1), listed(7)]);
    assert.equal(item(report, 'late_fines').status, 'warn');
    assert.equal(item(report, 'late_fines').data[0].taskId, '7');
    assert.equal(item(report, 'drafts_missing').status, 'ok');
    store.close();
});

test('Eine Rechnung, deren Summe nicht zu den Zeilen passt, lässt die Prüfung durchfallen', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.createDraftsForMonth({ month: '2026-11', actor: '1', now: CLOSED });

    const broken = {
        ...store,
        getInvoice(number) {
            const invoice = store.getInvoice(number);
            return { ...invoice, total_eur: invoice.total_eur + 100 };
        },
    };

    const report = check(broken, [listed(1)]);
    assert.equal(item(report, 'invoice_totals').status, 'fail');
    assert.equal(item(report, 'invoice_totals').data[0].lineSumEur, 500);
    assert.equal(item(report, 'invoice_totals').data[0].totalEur, 600);
    store.close();
});

test('Laufende Abrechnung zeigt je Fahrer die aktuellen Zahlen', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(task({ taskId: '2', evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));
    store.recordEvaluation(clear({ taskId: '3' }));
    store.recordEvaluation(review({ taskId: '4' }));
    store.recordEvaluation(task({ taskId: '5', spedvUserId: '200', spedvName: 'zweiter' }));
    store.decide({ taskId: '2', kind: 'waive', reason: 'Genehmigte Ausnahme', actor: '1' });

    const statement = buildStatement({ store, month: '2026-11' });
    const first = statement.drivers.find(driver => driver.spedvUserId === '169742');

    assert.equal(first.tasks, 4);
    assert.equal(first.fines, 1);
    assert.equal(first.fineEur, 500);
    assert.equal(first.waived, 1);
    assert.equal(first.openReviews, 1);
    assert.equal(first.invoice, null);

    assert.equal(statement.totals.drivers, 2);
    assert.equal(statement.totals.driversWithFines, 2);
    assert.equal(statement.totals.fineEur, 1000);
    assert.equal(statement.totals.openReviews, 1);
    assert.equal(statement.totals.invoicedEur, 0);
    store.close();
});
