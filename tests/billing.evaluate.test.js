'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    OUTCOMES,
    REASONS,
    evaluateTask,
    formatVisibleId,
    parseTimestamp,
    berlinMonth,
} = require('../src/billing/evaluate');

const CONTEXT = { speditionId: '108570' };

function drivePoints(...velocities) {
    return velocities.map((velocity, index) => ({
        timestamp: `2026-11-15T17:${String(index).padStart(2, '0')}:00+01:00`,
        velocity,
        speedLimit: 90,
    }));
}

function makeInput({ list = {}, details = {}, drive = drivePoints(80, 90, 91) } = {}) {
    let loads = 0;

    return {
        input: {
            listItem: { id: 9001, state: 2, userID: 169742, ddCleaned: false, ...list },
            details: {
                state: 2,
                spedition: { id: 108570 },
                user: { id: 169742, userName: 'hundekuchen' },
                starttime: '2026-11-15T16:00:00+01:00',
                endtime: '2026-11-15T18:00:00+01:00',
                ddCleaned: false,
                maxVelocityKMH: 91,
                ...details,
            },
            async loadDriveData() {
                loads += 1;
                if (drive instanceof Error) throw drive;
                return drive;
            },
        },
        loads: () => loads,
    };
}

async function run(options) {
    const { input, loads } = makeInput(options);
    const result = await evaluateTask(input, CONTEXT);
    return { result, loads: loads() };
}

// Regelwerk § 5.4: Beispiele
for (const [speed, expectedFine] of [
    [95, 0], [96, 100], [97, 200], [98, 300], [100, 500], [105, 1000], [110, 1500],
]) {
    test(`§ 5.4: ${speed} km/h = ${expectedFine} EUR`, async () => {
        const { result } = await run({
            details: { maxVelocityKMH: speed },
            drive: drivePoints(80, speed),
        });
        assert.equal(result.outcome, expectedFine > 0 ? OUTCOMES.FINE : OUTCOMES.CLEAR);
        assert.equal(result.evidence.fineEur, expectedFine);
    });
}

test('§ 5.4: angefangene km/h werden aufgerundet (96,4 -> 2 km/h -> 200 EUR)', async () => {
    const { result } = await run({
        details: { maxVelocityKMH: 96 },
        drive: drivePoints(80, 96.4),
    });
    assert.equal(result.outcome, OUTCOMES.FINE);
    assert.equal(result.evidence.excessKmh, 2);
    assert.equal(result.evidence.fineEur, 200);
});

test('Ergebnis enthält Nachweis und Auftragsnummer', async () => {
    const { result } = await run({
        list: { id: 12657450 },
        details: { maxVelocityKMH: 100 },
        drive: drivePoints(90, 100, 100),
    });
    assert.equal(result.visibleId, "#12'657'450");
    assert.equal(result.evidence.pointsAboveLimit, 2);
    assert.equal(result.evidence.maxVelocityKmh, 100);
    assert.equal(result.spedvUserId, '169742');
    assert.equal(result.billingMonth, '2026-11');
});

test('Status AdminCheck (4) wird abgerechnet', async () => {
    const { result } = await run({ list: { state: 4 }, details: { state: 4 } });
    assert.equal(result.outcome, OUTCOMES.CLEAR);
});

for (const state of [0, 1, 3, 5, 6, 7]) {
    test(`Status ${state} ist nicht abrechenbar und lädt keine Telemetrie`, async () => {
        const { result, loads } = await run({ list: { state } });
        assert.equal(result.outcome, OUTCOMES.NOT_BILLABLE);
        assert.equal(loads, 0);
    });
}

test('Details melden anderen Status: Prüffall', async () => {
    const { result, loads } = await run({ details: { state: 6 } });
    assert.equal(result.outcome, OUTCOMES.REVIEW);
    assert.equal(result.reason, REASONS.STATE_MISMATCH);
    assert.equal(loads, 0);
});

test('Fremde Spedition wird ignoriert, ohne Telemetrie zu laden', async () => {
    const { result, loads } = await run({ details: { spedition: { id: 999 } } });
    assert.equal(result.outcome, OUTCOMES.FOREIGN);
    assert.equal(loads, 0);
});

test('Fehlende Endzeit: Prüffall ohne Monat', async () => {
    const { result, loads } = await run({ details: { endtime: null } });
    assert.equal(result.outcome, OUTCOMES.REVIEW);
    assert.equal(result.reason, REASONS.MISSING_COMPLETION_TIME);
    assert.equal(result.billingMonth, null);
    assert.equal(loads, 0);
});

test('Endzeit ohne Zeitzone: Prüffall statt Raten', async () => {
    const { result } = await run({ details: { endtime: '2026-11-15T18:00:00' } });
    assert.equal(result.reason, REASONS.MISSING_COMPLETION_TIME);
});

test('Abrechnungsbeginn: 31.10. 23:30 Berliner Zeit zählt nicht, 01.11. 00:30 schon', async () => {
    const before = await run({ details: { endtime: '2026-10-31T22:30:00Z' } });
    assert.equal(before.result.outcome, OUTCOMES.BEFORE_START);
    assert.equal(before.loads, 0);

    const after = await run({ details: { endtime: '2026-10-31T23:30:00Z' } });
    assert.equal(after.result.outcome, OUTCOMES.CLEAR);
    assert.equal(after.result.billingMonth, '2026-11');
});

test('Monatsgrenze nach Berliner Zeit', async () => {
    const november = await run({ details: { endtime: '2026-11-30T22:30:00Z' } });
    assert.equal(november.result.billingMonth, '2026-11');

    const december = await run({ details: { endtime: '2026-11-30T23:30:00Z' } });
    assert.equal(december.result.billingMonth, '2026-12');
});

test('Fahrer-ID in Liste und Details abweichend: Prüffall', async () => {
    const { result, loads } = await run({ list: { userID: 1 } });
    assert.equal(result.reason, REASONS.IDENTITY_MISMATCH);
    assert.equal(loads, 0);
});

test('Fehlende Fahrer-ID: Prüffall', async () => {
    const { result } = await run({ details: { user: null } });
    assert.equal(result.reason, REASONS.IDENTITY_MISSING);
});

test('Bereinigte Telemetrie (Liste oder Details): Prüffall ohne Telemetrie-Abruf', async () => {
    const fromDetails = await run({ details: { ddCleaned: true } });
    assert.equal(fromDetails.result.reason, REASONS.CLEANED_TELEMETRY);
    assert.equal(fromDetails.loads, 0);

    const fromList = await run({ list: { ddCleaned: true } });
    assert.equal(fromList.result.reason, REASONS.CLEANED_TELEMETRY);
});

test('Telemetrie nicht abrufbar: Prüffall', async () => {
    const { result } = await run({ drive: new Error('SpedV-Abfrage fehlgeschlagen (HTTP 503).') });
    assert.equal(result.reason, REASONS.MISSING_TELEMETRY);
});

test('Leere Telemetrie: Prüffall', async () => {
    const { result } = await run({ drive: [] });
    assert.equal(result.reason, REASONS.MISSING_TELEMETRY);
});

test('Ungültiger Zeitstempel in der Telemetrie: Prüffall', async () => {
    const { result } = await run({ drive: [{ timestamp: 'kaputt', velocity: 120 }] });
    assert.equal(result.reason, REASONS.INCOMPLETE_TELEMETRY);
});

test('Ungültige Geschwindigkeitswerte werden gezählt, nicht verworfen', async () => {
    const { result } = await run({
        details: { maxVelocityKMH: 100 },
        drive: [
            ...drivePoints(80),
            { timestamp: '2026-11-15T17:01:00+01:00', velocity: null },
            { timestamp: '2026-11-15T17:02:00+01:00', velocity: 100 },
        ],
    });
    assert.equal(result.outcome, OUTCOMES.FINE);
    assert.equal(result.evidence.invalidVelocityPoints, 1);
});

test('Fehlende SpedV-Höchstgeschwindigkeit: Prüffall', async () => {
    const { result } = await run({ details: { maxVelocityKMH: null } });
    assert.equal(result.reason, REASONS.MISSING_SPEED_SUMMARY);
});

test('Telemetrie und SpedV-Höchstgeschwindigkeit widersprechen sich: Prüffall, keine Strafe', async () => {
    const { result } = await run({
        details: { maxVelocityKMH: 91 },
        drive: drivePoints(90, 120),
    });
    assert.equal(result.outcome, OUTCOMES.REVIEW);
    assert.equal(result.reason, REASONS.SPEED_CONFLICT);
    assert.equal(result.evidence.telemetryMaxVelocityKmh, 120);
});

test('formatVisibleId', () => {
    assert.equal(formatVisibleId(12657450), "#12'657'450");
    assert.equal(formatVisibleId('999'), '#999');
    assert.equal(formatVisibleId('1000'), "#1'000");
    assert.equal(formatVisibleId('abc'), null);
});

test('parseTimestamp verlangt eine Zeitzone', () => {
    assert.ok(parseTimestamp('2026-11-15T18:00:00+01:00'));
    assert.ok(parseTimestamp('2026-11-15T17:00:00Z'));
    assert.equal(parseTimestamp('2026-11-15T18:00:00'), null);
    assert.equal(parseTimestamp(null), null);
    assert.equal(berlinMonth(new Date('2026-11-30T23:30:00Z')), '2026-12');
});

test('Ohne Speditions-ID im Kontext wird abgebrochen', async () => {
    const { input } = makeInput();
    await assert.rejects(() => evaluateTask(input, {}), TypeError);
});
