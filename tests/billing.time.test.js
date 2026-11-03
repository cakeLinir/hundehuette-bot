'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    assertMonth,
    isMonthClosed,
    monthWindowMs,
    taskStartedInWindow,
    formatVisibleId,
} = require('../src/billing/time');

test('assertMonth akzeptiert nur YYYY-MM', () => {
    assert.equal(assertMonth('2026-11'), '2026-11');
    for (const invalid of ['2026-13', '2026-00', '26-11', '2026-1', '', null, undefined]) {
        assert.throws(() => assertMonth(invalid), TypeError);
    }
});

test('Ein Monat ist erst nach dem Wechsel in Berlin abgeschlossen', () => {
    // Berlin im November: UTC+1, der 1. Dezember beginnt um 23:00 UTC
    assert.equal(isMonthClosed('2026-11', new Date('2026-11-30T22:59:59Z')), false);
    assert.equal(isMonthClosed('2026-11', new Date('2026-11-30T23:00:00Z')), true);
    assert.equal(isMonthClosed('2026-12', new Date('2026-12-15T12:00:00Z')), false);
    assert.equal(isMonthClosed('2026-10', new Date('2026-11-02T08:00:00Z')), true);
});

test('Fenster reicht von sieben Tage vor Monatsbeginn bis kurz nach Monatsende', () => {
    const { startMs, endMs } = monthWindowMs('2026-11', 7);
    assert.equal(startMs, Date.UTC(2026, 10, 1) - 7 * 86_400_000 - 3 * 3_600_000);
    assert.equal(endMs, Date.UTC(2026, 11, 1) + 3 * 3_600_000);

    // Dezember reicht ins nächste Jahr
    assert.equal(monthWindowMs('2026-12', 0).endMs, Date.UTC(2027, 0, 1) + 3 * 3_600_000);
});

test('Vorauswahl nach Startzeit', () => {
    assert.equal(taskStartedInWindow({ startTime: '2026-11-15T10:00:00+01:00' }, '2026-11'), true);
    assert.equal(taskStartedInWindow({ startTime: '2026-10-28T10:00:00+01:00' }, '2026-11'), true);
    assert.equal(taskStartedInWindow({ startTime: '2026-10-20T10:00:00Z' }, '2026-11'), false);
    assert.equal(taskStartedInWindow({ startTime: '2026-12-01T01:00:00Z' }, '2026-11'), true);
    assert.equal(taskStartedInWindow({ startTime: '2026-12-01T05:00:00Z' }, '2026-11'), false);
});

test('Ohne gültige Startzeit wird nicht vorab aussortiert', () => {
    assert.equal(taskStartedInWindow({}, '2026-11'), true);
    assert.equal(taskStartedInWindow({ startTime: 'kaputt' }, '2026-11'), true);
    assert.equal(taskStartedInWindow(null, '2026-11'), true);
});

test('formatVisibleId', () => {
    assert.equal(formatVisibleId(12657450), "#12'657'450");
    assert.equal(formatVisibleId('abc'), null);
    assert.equal(formatVisibleId(null), null);
});
