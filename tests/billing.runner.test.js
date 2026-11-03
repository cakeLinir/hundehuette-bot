'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/billing/store');
const { runBilling } = require('../src/billing/runner');

const SPEDITION = '108570';
const NOW_OPEN = new Date('2026-11-20T06:00:00Z');   // November läuft noch
const NOW_CLOSED = new Date('2026-12-02T06:00:00Z'); // November ist abgeschlossen
const DISCORD = '222222222222222222';

const points = (...values) => values.map((velocity, index) => ({
    timestamp: `2026-11-15T17:${String(index).padStart(2, '0')}:00+01:00`,
    velocity,
    speedLimit: 90,
}));

const item = (id, overrides = {}) => ({
    id,
    state: 2,
    userID: 169742,
    currency: 'EUR',
    startTime: '2026-11-15T16:00:00+01:00',
    ddCleaned: false,
    ...overrides,
});

const detailsFor = (overrides = {}) => ({
    state: 2,
    spedition: { id: 108570 },
    user: { id: 169742, userName: 'hundekuchen' },
    currency: 'EUR',
    starttime: '2026-11-15T16:00:00+01:00',
    endtime: '2026-11-15T18:00:00+01:00',
    ddCleaned: false,
    maxVelocityKMH: 100,
    maxVelocityMPH: 62,
    ...overrides,
});

function fakeClient({ tasks = [], details = {}, drive = {} } = {}) {
    const calls = { list: 0, details: 0, drive: 0 };
    const client = {
        calls,
        tasks,
        details,
        drive,
        detailsError: new Set(),
        failList: false,
        async fetchTasks() {
            calls.list += 1;
            if (client.failList) throw new Error('SpedV-Abfrage fehlgeschlagen (HTTP 503).');
            return client.tasks.map(task => ({ ...task }));
        },
        async fetchTaskDetails(id) {
            calls.details += 1;
            if (client.detailsError.has(String(id))) {
                throw new Error('SpedV-Abfrage fehlgeschlagen (HTTP 503).');
            }
            return client.details[String(id)] ?? detailsFor();
        },
        async fetchDriveData(id) {
            calls.drive += 1;
            return client.drive[String(id)] ?? points(90, 100);
        },
    };
    return client;
}

const run = (client, store, extra = {}) =>
    runBilling({ client, store, speditionId: SPEDITION, now: NOW_OPEN, ...extra });

test('Neue Strafe wird gespeichert und im Bericht gemeldet', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(1)] });

    const report = await run(client, store);
    assert.equal(report.evaluated, 1);
    assert.equal(report.stored.inserted, 1);
    assert.equal(report.outcomes.fine, 1);
    assert.equal(report.newFines.length, 1);
    assert.equal(report.newFines[0].fineEur, 500);
    assert.equal(report.newFines[0].visibleId, '#1');
    assert.equal(report.newFines[0].game, 'ets2');
    assert.equal(report.newFines[0].unit, 'kmh');
    assert.equal(store.getEffective('1').effective_status, 'fine');
    assert.equal(store.getEffective('1').game, 'ets2');
    store.close();
});

test('Aufträge mit endgültigem Ergebnis werden nicht erneut abgerufen', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(1)] });

    await run(client, store);
    const second = await run(client, store);

    assert.equal(second.skippedKnown, 1);
    assert.equal(second.evaluated, 0);
    assert.equal(client.calls.details, 1);
    assert.equal(client.calls.drive, 1);
    assert.equal(second.newFines.length, 0);
    store.close();
});

test('Nicht abrechenbare Status werden gar nicht abgerufen', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(2, { state: 3 }), item(3, { state: 6 }), item(4, { state: 7 }), item(5, { state: 0 })],
    });

    const report = await run(client, store);
    assert.equal(report.evaluated, 0);
    assert.equal(client.calls.details, 0);
    store.close();
});

test('Sehr alte Aufträge werden übersprungen', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(6, { startTime: '2026-09-01T10:00:00+02:00' })] });

    const report = await run(client, store);
    assert.equal(report.skippedOld, 1);
    assert.equal(client.calls.details, 0);
    store.close();
});

test('Abschluss vor dem Abrechnungsbeginn: gezählt, aber nicht gespeichert', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(7, { startTime: '2026-10-31T20:00:00+01:00' })],
        details: { 7: detailsFor({ endtime: '2026-10-31T22:00:00+01:00' }) },
    });

    const report = await run(client, store);
    assert.equal(report.ignored.before_billing_start, 1);
    assert.equal(client.calls.drive, 0);
    assert.equal(store.getEffective('7'), null);
    store.close();
});

test('Prüffall: einmal gemeldet, später von selbst gelöst', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(8)], drive: { 8: [] } });

    const first = await run(client, store);
    assert.equal(first.newReviews.length, 1);
    assert.equal(first.newReviews[0].reason, 'missing_telemetry');

    // Derselbe Prüffall wird weiter geprüft, aber nicht erneut gemeldet
    const second = await run(client, store);
    assert.equal(second.evaluated, 1);
    assert.equal(second.newReviews.length, 0);
    assert.equal(second.stored.unchanged, 1);

    // Telemetrie ist jetzt vorhanden
    client.drive[8] = points(90, 100);
    const third = await run(client, store);
    assert.equal(third.newFines.length, 1);
    assert.equal(store.getEffective('8').effective_status, 'fine');
    store.close();
});

test('Details nicht ladbar: Prüffall mit Monat und Spiel, blockiert nur diesen Fahrer', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(9)] });
    client.detailsError.add('9');

    const report = await run(client, store);
    assert.equal(report.newReviews[0].reason, 'details_unavailable');
    assert.equal(store.getEffective('9').billing_month, '2026-11');
    assert.equal(store.getEffective('9').game, 'ets2');
    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '169742' }).length, 1);
    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '200' }).length, 0);

    // Beim nächsten Mal klappt es
    client.detailsError.clear();
    const again = await run(client, store);
    assert.equal(again.newFines.length, 1);
    assert.equal(store.listBlockingReviews({ month: '2026-11', spedvUserId: '169742' }).length, 0);
    store.close();
});

test('Ein Fehler bei einem Auftrag stoppt den Lauf nicht', async () => {
    const store = openStore({ file: ':memory:' });
    const flaky = {
        ...store,
        recordEvaluation(result, options) {
            if (result.taskId === '2') throw new Error('Datenbank kaputt');
            return store.recordEvaluation(result, options);
        },
    };
    const client = fakeClient({ tasks: [item(1), item(2), item(3)] });

    const report = await run(client, flaky);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].taskId, '2');
    assert.equal(report.stored.inserted, 2);
    store.close();
});

test('Statusänderung vor der Rechnung macht aus der Strafe wieder einen Prüffall', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(10, { state: 4 })],
        details: { 10: detailsFor({ state: 4 }) },
    });

    await run(client, store);
    assert.equal(store.getEffective('10').effective_status, 'fine');

    client.tasks[0].state = 6;
    const report = await run(client, store);
    assert.equal(report.reopened.length, 1);
    assert.match(report.reopened[0].message, /Cancelled/);
    assert.equal(store.getEffective('10').effective_status, 'open_review');
    store.close();
});

test('Verschwundener Auftrag: Strafe wird wieder zum Prüffall', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(11)] });

    await run(client, store);
    client.tasks = [];
    const report = await run(client, store);

    assert.equal(report.reopened.length, 1);
    assert.match(report.reopened[0].message, /nicht mehr vorhanden/);
    store.close();
});

test('Auftrag in einer Rechnung mit geändertem Status landet im Bericht, die Rechnung bleibt', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(12, { state: 4 })],
        details: { 12: detailsFor({ state: 4 }) },
    });

    const first = await run(client, store, { now: NOW_CLOSED });
    assert.equal(first.drafts[0].created, 1);

    client.tasks[0].state = 6;
    const second = await run(client, store, { now: NOW_CLOSED });
    assert.equal(second.staleInvoiced.length, 1);
    assert.equal(second.staleInvoiced[0].taskId, '12');
    assert.equal(store.getInvoice('HKC-2026-11-169742').status, 'draft');
    store.close();
});

test('Entwürfe erst nach Monatsende und nur einmal', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(13)] });

    const open = await run(client, store, { now: NOW_OPEN });
    assert.equal(open.drafts.length, 0);

    const closed = await run(client, store, { now: NOW_CLOSED });
    assert.equal(closed.drafts.length, 1);
    assert.equal(closed.drafts[0].drivers[0].number, 'HKC-2026-11-169742');
    assert.equal(closed.drafts[0].drivers[0].totalEur, 500);

    const again = await run(client, store, { now: NOW_CLOSED });
    assert.equal(again.drafts.length, 0);
    assert.equal(store.listInvoices({ month: '2026-11' }).length, 1);
    store.close();
});

test('Ohne Entwürfe, wenn nicht gewünscht', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(14)] });

    const report = await run(client, store, { now: NOW_CLOSED, createDrafts: false });
    assert.equal(report.drafts.length, 0);
    assert.equal(store.listInvoices().length, 0);
    store.close();
});

test('Fällige Erinnerungen stehen im Bericht', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(15)] });

    await run(client, store, { now: NOW_CLOSED });
    store.recordSendAttempt({
        number: 'HKC-2026-11-169742', discordId: DISCORD, actor: '1', now: NOW_CLOSED,
    });

    const before = await run(client, store, { now: new Date('2026-12-15T06:00:00Z') });
    assert.equal(before.dueReminders.length, 0);

    const after = await run(client, store, { now: new Date('2026-12-16T06:00:01Z') });
    assert.equal(after.dueReminders.length, 1);
    assert.equal(after.dueReminders[0].number, 'HKC-2026-11-169742');
    store.close();
});

test('Offene Aufträge (Done, Paused) werden gemeldet, nicht abgerufen', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(16, { state: 1 }), item(17, { state: 5 })] });

    const report = await run(client, store);
    assert.equal(report.openTaskCount, 2);
    assert.deepEqual(report.openTasks.map(task => task.stateName).sort(), ['Done', 'Paused']);
    assert.equal(client.calls.details, 0);
    store.close();
});

test('Obergrenze pro Lauf: der Rest folgt im nächsten Lauf', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(21), item(22), item(23)] });

    const first = await run(client, store, { maxEvaluations: 2 });
    assert.equal(first.evaluated, 2);
    assert.equal(first.deferred, 1);

    const second = await run(client, store, { maxEvaluations: 2 });
    assert.equal(second.evaluated, 1);
    assert.equal(second.deferred, 0);
    store.close();
});

test('Zwei Läufe gleichzeitig: der zweite wird übersprungen', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(31)] });

    const [a, b] = await Promise.all([run(client, store), run(client, store)]);
    assert.equal(Boolean(a.skipped), false);
    assert.match(b.skipped, /bereits aktiv/);
    store.close();
});

test('Ausfall der Auftragsliste: Fehler, danach läuft es wieder', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({ tasks: [item(41)] });

    client.failList = true;
    await assert.rejects(() => run(client, store), /HTTP 503/);

    client.failList = false;
    const report = await run(client, store);
    assert.equal(report.stored.inserted, 1);
    store.close();
});

test('ATS-Auftrag (USD) wird nach mph bewertet: 85 mph bei Limit 80 = 500 EUR', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(51, { currency: 'USD' })],
        details: { 51: detailsFor({ currency: 'USD', maxVelocityKMH: 137, maxVelocityMPH: 85 }) },
        drive: { 51: points(110, 137) },
    });

    const report = await run(client, store);
    assert.equal(report.newFines.length, 1);
    assert.equal(report.newFines[0].game, 'ats');
    assert.equal(report.newFines[0].unit, 'mph');
    assert.equal(report.newFines[0].maxSpeed, 85);
    assert.equal(report.newFines[0].fineEur, 500);
    assert.equal(store.getEffective('51').game, 'ats');
    store.close();
});

test('ATS genau am Limit (Raptus: 129 km/h = 80 mph) kostet nichts', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(52, { currency: 'USD' }), item(53, { currency: 'USD' })],
        details: {
            52: detailsFor({ currency: 'USD', maxVelocityKMH: 129, maxVelocityMPH: 80 }),
            53: detailsFor({ currency: 'USD', maxVelocityKMH: 113, maxVelocityMPH: 70 }),
        },
        drive: { 52: points(100, 129), 53: points(100, 113) },
    });

    const report = await run(client, store);
    assert.equal(report.outcomes.clear, 2);
    assert.equal(report.newFines.length, 0);
    store.close();
});

test('Unbekannte Währung: Prüffall, nie eine Strafe', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(54, { currency: 'GBP' })],
        details: { 54: detailsFor({ currency: 'GBP' }) },
    });

    const report = await run(client, store);
    assert.equal(report.newReviews[0].reason, 'game_unknown');
    assert.equal(store.getEffective('54').game, null);
    assert.equal(client.calls.drive, 0);
    store.close();
});

test('Liste und Details widersprechen sich bei der Währung: Prüffall', async () => {
    const store = openStore({ file: ':memory:' });
    const client = fakeClient({
        tasks: [item(55, { currency: 'EUR' })],
        details: { 55: detailsFor({ currency: 'USD' }) },
    });

    const report = await run(client, store);
    assert.equal(report.newReviews[0].reason, 'game_conflict');
    assert.equal(client.calls.drive, 0);
    store.close();
});
