'use strict';

/**
 * Verbindliche Abrechnungsregeln der HKC (Regelwerk § 5).
 * Einzige Stelle für diese Werte.
 */
module.exports = Object.freeze({
    // § 5.1: allgemeine interne Höchstgeschwindigkeit
    speedLimitKmh: 95,

    // § 5.4: je angefangenem km/h über dem Limit, virtuelle Strafzahlung
    fineEurPerKmh: 100,

    // Aufträge, die davor abgeschlossen wurden, werden nie abgerechnet (Datum in Berliner Zeit)
    billingStartDate: '2026-11-01',

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
