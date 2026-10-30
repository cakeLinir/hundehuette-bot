'use strict';

const assert = require('node:assert/strict');
const {
    buildDryRunPlan,
} = require('../src/utils/speedBillingSpedvAdapter');

const snapshot = {
    tasks: [
        // Historischer Auftrag: muss ausgeschlossen werden.
        {
            ID: 199,
            UserID: 169742,
            State: 2,
            Endtime: '2026-10-31T12:00:00Z',
            MaxVelocityKMH: 130,
            DDCleaned: false,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // November: 108 km/h = 13 km/h Überschreitung = 1.300 €.
        {
            ID: 201,
            UserID: 169742,
            State: 2,
            Endtime: '2026-11-05T13:00:00Z',
            MaxVelocityKMH: 108,
            DDCleaned: false,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // November: keine Geschwindigkeitsüberschreitung.
        {
            ID: 202,
            UserID: 169742,
            State: 'Settled',
            Endtime: '2026-11-06T13:00:00Z',
            MaxVelocityKMH: 95,
            DDCleaned: false,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // Nicht abgeschlossen: wird nicht abgerechnet.
        {
            ID: 203,
            UserID: 169742,
            State: 1,
            Endtime: '2026-11-07T13:00:00Z',
            MaxVelocityKMH: 140,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // Bereinigte Telemetrie: manuelle Prüfung.
        {
            ID: 204,
            UserID: 169742,
            State: 2,
            Endtime: '2026-11-08T13:00:00Z',
            MaxVelocityKMH: 120,
            DDCleaned: true,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // November: Telemetrie 101 km/h = 600 €.
        {
            ID: 205,
            UserID: 169742,
            State: 2,
            Endtime: '2026-11-09T13:00:00Z',
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // Nicht verknüpfter Fahrer: manuelle Prüfung.
        {
            ID: 206,
            UserID: 123,
            State: 2,
            Endtime: '2026-11-10T13:00:00Z',
            MaxVelocityKMH: 120,
            User: { ID: 123, UserName: 'unlinked-driver' },
        },

        // Doppelte Auftrags-ID: beide Vorkommen müssen geprüft werden.
        {
            ID: 207,
            UserID: 169742,
            State: 2,
            Endtime: '2026-11-11T13:00:00Z',
            MaxVelocityKMH: 120,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },
        {
            ID: 207,
            UserID: 169742,
            State: 2,
            Endtime: '2026-11-11T13:00:00Z',
            MaxVelocityKMH: 120,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },

        // Widerspruch zwischen direktem Wert und Telemetrie.
        {
            ID: 208,
            UserID: 169742,
            State: 2,
            Endtime: '2026-11-12T13:00:00Z',
            MaxVelocityKMH: 108,
            DDCleaned: false,
            User: { ID: 169742, UserName: 'hundekuchen' },
        },
    ],

    links: {
        HUNDEKUCHEN: 'discord-own-id',
    },

    driveDataByTaskId: {
        205: [
            { Velocity: 98 },
            { Velocity: 101 },
            { Velocity: 94 },
        ],
        208: [
            { Velocity: 101 },
        ],
    },
};

const report = buildDryRunPlan(snapshot, {
    mode: 'offline-dry-run',
    velocityUnit: 'kmh',
    billingStartDate: '2026-11-01',
});

// Sicherheitsprüfungen: keinerlei Live-Aktionen.
assert.equal(report.apiCallsPerformed, false);
assert.equal(report.writesPerformed, false);
assert.equal(report.discordActionsPerformed, false);

// Abrechnungsbeginn.
assert.equal(report.billingStartDate, '2026-11-01');
assert.equal(report.billingTimeZone, 'Europe/Berlin');

// Genau zwei Strafkandidaten.
assert.equal(report.fineCandidateCount, 2);
assert.equal(report.proposedFineTotalEur, 1900);

// Historischer Auftrag wird ausgeschlossen.
assert.equal(
    report.items.find(x => x.taskId === '199').status,
    'ignored_historical_before_billing_start'
);

// Reguläre Geschwindigkeitsprüfung.
assert.equal(
    report.items.find(x => x.taskId === '201').proposedFineEur,
    1300
);

assert.equal(
    report.items.find(x => x.taskId === '202').status,
    'dry_run_no_violation'
);

// Status- und Datenprüfungen.
assert.equal(
    report.items.find(x => x.taskId === '203').status,
    'ignored_not_settled'
);

assert.equal(
    report.items.find(x => x.taskId === '204').status,
    'review_cleaned_telemetry'
);

assert.equal(
    report.items.find(x => x.taskId === '204').telemetryCleaned,
    true
);

assert.equal(
    report.items.find(x => x.taskId === '205').maxVelocityKmh,
    101
);

assert.equal(
    report.items.find(x => x.taskId === '205').proposedFineEur,
    600
);

assert.equal(
    report.items.find(x => x.taskId === '206').status,
    'review_unverified_driver_link'
);

assert.equal(
    report.items.find(x => x.taskId === '207').status,
    'review_duplicate_in_snapshot'
);

assert.equal(
    report.items.find(x => x.taskId === '208').status,
    'review_speed_conflict'
);

// Ungültige Konfigurationen müssen abbrechen.
assert.throws(
    () => buildDryRunPlan(snapshot, { mode: 'live' }),
    /offline-dry-run/
);

assert.throws(
    () => buildDryRunPlan(snapshot, {
        mode: 'offline-dry-run',
        billingStartDate: '01.11.2026',
    }),
    /YYYY-MM-DD/
);

assert.throws(
    () => buildDryRunPlan(snapshot, {
        mode: 'offline-dry-run',
        billingStartDate: '2026-02-30',
    }),
    /gültiges Datum/
);

console.log('OK: SpedV offline adapter tests passed');
console.log(`Abrechnungsbeginn: ${report.billingStartDate}`);
console.log(`Zeitzone: ${report.billingTimeZone}`);
console.log(`Strafkandidaten: ${report.fineCandidateCount}`);
console.log(`Vorgeschlagene Gesamtsumme: ${report.proposedFineTotalEur} EUR`);