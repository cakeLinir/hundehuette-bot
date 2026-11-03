'use strict';

const rules = require('./rules');

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Zeitzonenangabe ist Pflicht: sonst hinge der Abrechnungsmonat von der Serverzeit ab.
const OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

function assertMonth(month) {
    if (!MONTH_PATTERN.test(String(month ?? ''))) {
        throw new TypeError('Abrechnungsmonat muss im Format YYYY-MM angegeben werden.');
    }
    return String(month);
}

/** Strenger Parser für Zeitpunkte, die den Abrechnungsmonat bestimmen. */
function parseTimestamp(value) {
    if (typeof value !== 'string' || !OFFSET_PATTERN.test(value.trim())) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in Berliner Zeit. */
function berlinDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: rules.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const pick = type => parts.find(part => part.type === type)?.value;
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Kalendermonat (YYYY-MM) eines Zeitpunkts in Berliner Zeit. */
function berlinMonth(date) {
    return berlinDate(date).slice(0, 7);
}

/** Datum und Uhrzeit in Berliner Zeit: { date: 'YYYY-MM-DD', hour, minute }. */
function berlinClock(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: rules.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);

    const pick = type => parts.find(part => part.type === type)?.value;
    return {
        date: `${pick('year')}-${pick('month')}-${pick('day')}`,
        hour: Number(pick('hour')),
        minute: Number(pick('minute')),
    };
}

/** Alle Monate von first bis last, beide eingeschlossen. */
function monthsBetween(first, last) {
    assertMonth(first);
    assertMonth(last);

    const months = [];
    let [year, month] = first.split('-').map(Number);

    for (; ;) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (key > last) break;
        months.push(key);
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }

    return months;
}

/** Ein Monat ist abgeschlossen, sobald in Berlin ein späterer Monat begonnen hat. */
function isMonthClosed(month, now = new Date()) {
    assertMonth(month);
    return berlinMonth(now) > month;
}

/**
 * Grobes Startzeit-Fenster für die Vorauswahl. Aufträge außerhalb können nicht
 * im Monat enden. Die exakte Zuordnung erfolgt über die Endzeit.
 * Der Rand von 3 Stunden deckt den Berliner UTC-Offset ab.
 */
function monthWindowMs(month, lookbackDays = rules.defaultLookbackDays) {
    assertMonth(month);
    const [year, monthNumber] = month.split('-').map(Number);
    const marginMs = 3 * 3_600_000;

    return {
        startMs: Date.UTC(year, monthNumber - 1, 1) - lookbackDays * 86_400_000 - marginMs,
        endMs: Date.UTC(year, monthNumber, 1) + marginMs,
    };
}

/** Ohne gültige Startzeit wird nicht vorab aussortiert. */
function taskStartedInWindow(task, month, lookbackDays = rules.defaultLookbackDays) {
    const startedMs = new Date(task?.startTime).getTime();
    if (!Number.isFinite(startedMs)) return true;

    const { startMs, endMs } = monthWindowMs(month, lookbackDays);
    return startedMs >= startMs && startedMs <= endMs;
}

/** Zeigt die Nummer so, wie SpedV sie anzeigt: 12657450 -> #12'657'450 */
function formatVisibleId(id) {
    const digits = String(id ?? '').trim();
    if (!/^\d+$/.test(digits)) return null;
    return `#${digits.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`;
}

module.exports = {
    assertMonth,
    parseTimestamp,
    berlinDate,
    berlinMonth,
    berlinClock,
    monthsBetween,
    isMonthClosed,
    monthWindowMs,
    taskStartedInWindow,
    formatVisibleId,
};
