'use strict';

const { TIME_ZONE, DEFAULT_LOOKBACK_DAYS } = require('./constants');

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month) {
    if (!MONTH_PATTERN.test(String(month))) {
        throw new TypeError('Abrechnungsmonat muss im Format YYYY-MM angegeben werden.');
    }
    return String(month);
}

function isValidDate(value) {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(new Date(value).getTime());
}

/** Kalendermonat (YYYY-MM) eines Zeitpunkts in Berliner Zeit. */
function monthInBerlin(value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(new Date(value));

    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;

    return `${year}-${month}`;
}

/** Ein Monat ist abgeschlossen, sobald in Berlin ein späterer Monat begonnen hat. */
function isMonthClosed(month, now = new Date()) {
    assertMonth(month);
    return monthInBerlin(now) > month;
}

/**
 * Grobes Startzeit-Fenster für die Vorauswahl. Aufträge außerhalb können nicht
 * im Monat enden. Die exakte Zuordnung erfolgt über die Endzeit. Der Rand von
 * 3 Stunden deckt den Berliner UTC-Offset ab.
 */
function monthWindowMs(month, lookbackDays = DEFAULT_LOOKBACK_DAYS) {
    assertMonth(month);
    const [year, monthNumber] = month.split('-').map(Number);
    const marginMs = 3 * 3_600_000;

    return {
        startMs: Date.UTC(year, monthNumber - 1, 1) - lookbackDays * 86_400_000 - marginMs,
        endMs: Date.UTC(year, monthNumber, 1) + marginMs,
    };
}

/** Ohne gültige Startzeit wird nicht vorab aussortiert. */
function taskStartedInWindow(task, month, lookbackDays = DEFAULT_LOOKBACK_DAYS) {
    const startedMs = new Date(task?.startTime).getTime();
    if (!Number.isFinite(startedMs)) return true;

    const { startMs, endMs } = monthWindowMs(month, lookbackDays);
    return startedMs >= startMs && startedMs <= endMs;
}

/** Zeigt die Nummer so, wie SpedV sie anzeigt: 12657450 -> #12'657'450 */
function formatVisibleTaskId(id) {
    return `#${String(id).replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`;
}

module.exports = {
    assertMonth,
    isValidDate,
    monthInBerlin,
    isMonthClosed,
    monthWindowMs,
    taskStartedInWindow,
    formatVisibleTaskId,
};
