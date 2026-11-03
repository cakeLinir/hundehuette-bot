'use strict';

const games = Object.freeze({
    // § 5.1 bis 5.4: Euro Truck Simulator 2, km/h
    ets2: Object.freeze({ unit: 'kmh', limit: 95, finePerUnit: 100 }),
    // § 5.9: American Truck Simulator, mph
    ats: Object.freeze({ unit: 'mph', limit: 80, finePerUnit: 100 }),
});

/**
 * Verbindliche Abrechnungsregeln der HKC (Regelwerk § 5).
 * Einzige Stelle für diese Werte.
 */
module.exports = Object.freeze({
    games,

    // Währung des Auftrags -> Spiel (per Messung: EUR bei ETS2, USD bei ATS)
    currencyGames: Object.freeze({ EUR: 'ets2', USD: 'ats' }),

    kmhPerMph: 1.609344,

    // Kurzformen für ETS2 (km/h)
    speedLimitKmh: games.ets2.limit,
    fineEurPerKmh: games.ets2.finePerUnit,

    // Aufträge, die davor abgeschlossen wurden, werden nie abgerechnet (Datum in Berliner Zeit)
    billingStartDate: '2026-10-01',

    timeZone: 'Europe/Berlin',

    // Zahlungsfrist in Tagen, gerechnet ab dem ersten Versandversuch
    paymentDays: 14,

    // SpedV ETSTaskState: 2 = Settled, 4 = AdminCheck
    billableStates: Object.freeze([2, 4]),

    // 1 = Done, 5 = Paused: noch nicht abrechenbar, im Monatsbericht als "offen" ausweisen
    openStates: Object.freeze([1, 5]),

    // Wie viele Tage vor Monatsbeginn gestartete Aufträge noch geprüft werden
    defaultLookbackDays: 7,

    // Namen laut SpedV-DLL (nur für Berichte und Meldungen)
    stateNames: Object.freeze({
        '-1': 'NotAvaliable',
        0: 'InDrive',
        1: 'Done',
        2: 'Settled',
        3: 'Fail',
        4: 'AdminCheck',
        5: 'Paused',
        6: 'Cancelled',
        7: 'Invalid',
    }),
});