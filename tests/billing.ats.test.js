'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    OUTCOMES,
    REASONS,
    evaluateTask,
    detectGame,
    gameFromCurrency,
} = require('../src/billing/evaluate');
const { openStore, StoreError } = require('../src/billing/store');

const ATS = { speditionId: '108570', game: 'ats' };

function drivePoints(...velocities) {
    return velocities.map((velocity, index) => ({
        timestamp: `2026-11-15T17:${String(index).padStart(2, '0')}:00+01:00`,
        velocity,
        speedLimit: 129,
    }));
}

function makeInput({ list = {}, details = {}, drive = drivePoints(110, 137) } = {}) {
    let loads = 0;

    return {
        input: {
            listItem: { id: 9001, state: 2, userID: 300, ddCleaned: false, currency: 'USD', ...list },
            details: {
                state: 2,
                spedition: { id: 108570 },
                user: { id: 300, userName: 'raptus' },
                currency: 'USD',
                endtime: '2026-11-15T18:00:00+01:00',
                ddCleaned: false,
                maxVelocityKMH: 137,
                maxVelocityMPH: 85,
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

async function run(options, context = ATS) {
    const { input, loads } = makeInput(options);
    return { result: await evaluateTask(input, context), loads: loads() };
}

// Regelwerk § 5.9: Grenze 80 mph, 100 EUR je mph darüber
for (const [mph, kmh, expectedFine] of [
    [80, 129, 0], [81, 130, 100], [85, 137, 500], [90, 145, 1000],
]) {
    test(`§ 5.9: ${mph} mph (${kmh} km/h) = ${expectedFine} EUR`, async () => {
        const { result } = await run({
            details: { maxVelocityKMH: kmh, maxVelocityMPH: mph },
            drive: drivePoints(100, kmh),
        });
        assert.equal(result.outcome, expectedFine > 0 ? OUTCOMES.FINE : OUTCOMES.CLEAR);
        assert.equal(result.evidence.fineEur, expectedFine);
        assert.equal(result.evidence.unit, 'mph');
        assert.equal(result.evidence.maxSpeed, mph);
        assert.equal(result.game, 'ats');
    });
}

test('Raptus: 70 mph (113 km/h) kostet nichts', async () => {
    const { result } = await run({
        details: { maxVelocityKMH: 113, maxVelocityMPH: 70 },
        drive: drivePoints(100, 113),
    });
    assert.equal(result.outcome, OUTCOMES.CLEAR);
});

test('Nachweis enthält die physikalischen Werte und zählt Punkte über der mph-Grenze', async () => {
    const { result } = await run({ drive: drivePoints(120, 129, 131, 137) });
    assert.equal(result.evidence.maxVelocityKmh, 137);
    assert.equal(result.evidence.excessKmh, null);
    assert.equal(result.evidence.excessUnits, 5);
    assert.equal(result.evidence.pointsAboveLimit, 3);
    assert.ok(Math.abs(result.evidence.limitKmh - 128.75) < 0.01);
});

test('Fehlender MPH-Wert: Prüffall', async () => {
    const { result } = await run({ details: { maxVelocityMPH: null } });
    assert.equal(result.outcome, OUTCOMES.REVIEW);
    assert.equal(result.reason, REASONS.MISSING_SPEED_SUMMARY);
});

test('MPH-Wert passt nicht zur Telemetrie (mehr als 1 mph): Prüffall, keine Strafe', async () => {
    const { result } = await run({ details: { maxVelocityMPH: 95 } });
    assert.equal(result.outcome, OUTCOMES.REVIEW);
    assert.equal(result.reason, REASONS.SPEED_CONFLICT);
    assert.equal(result.evidence.summaryMaxVelocityMph, 95);
});

test('Abweichung bis 1 mph wird toleriert', async () => {
    const { result } = await run({ details: { maxVelocityMPH: 86 } });
    assert.equal(result.outcome, OUTCOMES.FINE);
    assert.equal(result.evidence.maxSpeed, 86);
    assert.equal(result.evidence.fineEur, 600);
});

test('km/h-Feld und Telemetrie widersprechen sich auch bei ATS: Prüffall', async () => {
    const { result } = await run({ details: { maxVelocityKMH: 120 } });
    assert.equal(result.reason, REASONS.SPEED_CONFLICT);
});

test('Spiel nicht erkennbar: Prüffall ohne Telemetrie-Abruf', async () => {
    const { result, loads } = await run({}, { speditionId: '108570', game: null });
    assert.equal(result.outcome, OUTCOMES.REVIEW);
    assert.equal(result.reason, REASONS.GAME_UNKNOWN);
    assert.equal(result.game, null);
    assert.equal(loads, 0);
});

test('Währung in den Details passt nicht zum Spiel: Prüffall', async () => {
    const { result, loads } = await run({ details: { currency: 'EUR' } });
    assert.equal(result.reason, REASONS.GAME_CONFLICT);
    assert.equal(loads, 0);
});

test('Ohne Spielangabe gilt ETS2: eine USD-Währung fällt als Prüffall auf', async () => {
    const { result } = await run({}, { speditionId: '108570' });
    assert.equal(result.reason, REASONS.GAME_CONFLICT);
});

test('Unbekanntes Spiel im Kontext ist ein Programmfehler', async () => {
    const { input } = makeInput();
    await assert.rejects(() => evaluateTask(input, { speditionId: '108570', game: 'xyz' }), TypeError);
});

test('Spiel aus der Währung erkennen', () => {
    assert.equal(gameFromCurrency('EUR'), 'ets2');
    assert.equal(gameFromCurrency('usd'), 'ats');
    assert.equal(gameFromCurrency('GBP'), null);
    assert.equal(gameFromCurrency(''), null);

    assert.equal(detectGame({ currency: 'EUR' }), 'ets2');
    assert.equal(detectGame({ currency: 'USD' }, { currency: 'USD' }), 'ats');
    assert.equal(detectGame({ currency: 'EUR' }, {}), 'ets2');
    assert.equal(detectGame({ currency: 'EUR' }, null), 'ets2');
    assert.equal(detectGame({ currency: 'EUR' }, { currency: 'USD' }), null);
    assert.equal(detectGame({ currency: 'GBP' }), null);
    assert.equal(detectGame({}, {}), null);
    assert.equal(detectGame(), null);
});

// --- Speicher ---

function atsReview(overrides = {}) {
    return {
        taskId: '51',
        visibleId: "#51",
        game: 'ats',
        taskState: 2,
        speditionId: '108570',
        spedvUserId: '300',
        spedvName: 'raptus',
        completedAt: '2026-11-15T17:00:00.000Z',
        billingMonth: '2026-11',
        outcome: 'review',
        reason: 'speed_conflict',
        message: 'Widerspruch',
        evidence: null,
        ...overrides,
    };
}

test('Festsetzung bei ATS rechnet in mph und speichert km/h', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(atsReview());
    assert.equal(store.getEffective('51').game, 'ats');

    const effective = store.decide({
        taskId: '51', kind: 'assess', reason: 'Screenshot zeigt 85 mph', actor: '1', speed: 85,
    });
    assert.equal(effective.effective_status, 'fine');
    assert.equal(effective.effective_fine_eur, 500);

    const draft = store.createDraft({
        month: '2026-11', spedvUserId: '300', actor: '1', now: new Date('2026-12-02T10:00:00Z'),
    });
    assert.equal(draft.invoice.total_eur, 500);
    assert.equal(Math.round(draft.invoice.lines[0].max_velocity_kmh), 137);
    assert.equal(draft.invoice.lines[0].excess_kmh, null);
    store.close();
});

test('Festsetzung bei ATS unter dem Limit: kein Verstoß', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(atsReview());

    const effective = store.decide({
        taskId: '51', kind: 'assess', reason: 'Screenshot zeigt 79 mph', actor: '1', speed: 79,
    });
    assert.equal(effective.effective_status, 'dismissed');
    assert.equal(effective.effective_fine_eur, 0);
    store.close();
});

test('Festsetzung ohne bekanntes Spiel oder mit zwei Geschwindigkeiten wird abgelehnt', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(atsReview({ taskId: '52', game: null }));
    store.recordEvaluation(atsReview({ taskId: '53' }));

    assert.throws(
        () => store.decide({ taskId: '52', kind: 'assess', reason: 'Beleg liegt vor', actor: '1', speed: 85 }),
        StoreError
    );
    assert.throws(
        () => store.decide({
            taskId: '53', kind: 'assess', reason: 'Beleg liegt vor', actor: '1', speed: 85, speedKmh: 137,
        }),
        StoreError
    );
    store.close();
});

test('Ergebnis ohne Spielangabe gilt als ETS2, ein unbekanntes Spiel wird abgelehnt', () => {
    const store = openStore({ file: ':memory:' });
    const { game, ...withoutGame } = atsReview({ taskId: '60' });

    store.recordEvaluation(withoutGame);
    assert.equal(store.getEffective('60').game, 'ets2');

    assert.throws(() => store.recordEvaluation(atsReview({ taskId: '61', game: 'xyz' })), TypeError);
    store.close();
});
