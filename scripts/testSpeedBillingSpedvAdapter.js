'use strict';

const assert = require('node:assert/strict');
const { buildDryRunPlan } = require('../src/utils/speedBillingSpedvAdapter');

const snapshot = {
    tasks: [
        { ID: 201, UserID: 169742, State: 2, Endtime: '2026-10-05T13:00:00Z', MaxVelocityKMH: 108, DDCleaned: false, User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 202, UserID: 169742, State: 'Settled', Endtime: '2026-10-06T13:00:00Z', MaxVelocityKMH: 95, DDCleaned: false, User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 203, UserID: 169742, State: 1, Endtime: '2026-10-07T13:00:00Z', MaxVelocityKMH: 140, User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 204, UserID: 169742, State: 2, Endtime: '2026-10-08T13:00:00Z', MaxVelocityKMH: 120, DDCleaned: true, User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 205, UserID: 169742, State: 2, Endtime: '2026-10-09T13:00:00Z', User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 206, UserID: 123, State: 2, Endtime: '2026-10-10T13:00:00Z', MaxVelocityKMH: 120, User: { ID: 123, UserName: 'unlinked-driver' } },
        { ID: 207, UserID: 169742, State: 2, Endtime: '2026-10-11T13:00:00Z', MaxVelocityKMH: 120, User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 207, UserID: 169742, State: 2, Endtime: '2026-10-11T13:00:00Z', MaxVelocityKMH: 120, User: { ID: 169742, UserName: 'hundekuchen' } },
        { ID: 208, UserID: 169742, State: 2, Endtime: '2026-10-12T13:00:00Z', MaxVelocityKMH: 108, DDCleaned: false, User: { ID: 169742, UserName: 'hundekuchen' } }
    ],
    links: { 'HUNDEKUCHEN': 'discord-own-id' },
    driveDataByTaskId: { '205': [{ Velocity: 98 }, { Velocity: 101 }, { Velocity: 94 }], '208': [{ Velocity: 101 }] }
};

const report = buildDryRunPlan(snapshot, { mode: 'offline-dry-run', velocityUnit: 'kmh' });
assert.equal(report.apiCallsPerformed, false);
assert.equal(report.writesPerformed, false);
assert.equal(report.discordActionsPerformed, false);
assert.equal(report.fineCandidateCount, 2);
assert.equal(report.proposedFineTotalEur, 1900);
assert.equal(report.items.find(x => x.taskId === '201').proposedFineEur, 1300);
assert.equal(report.items.find(x => x.taskId === '202').status, 'dry_run_no_violation');
assert.equal(report.items.find(x => x.taskId === '203').status, 'ignored_not_settled');
assert.equal(report.items.find(x => x.taskId === '204').status, 'review_cleaned_telemetry');
assert.equal(report.items.find(x => x.taskId === '204').telemetryCleaned, true);
assert.equal(report.items.find(x => x.taskId === '205').maxVelocityKmh, 101);
assert.equal(report.items.find(x => x.taskId === '206').status, 'review_unverified_driver_link');
assert.equal(report.items.find(x => x.taskId === '207').status, 'review_duplicate_in_snapshot');
assert.equal(report.items.find(x => x.taskId === '208').status, 'review_speed_conflict');
assert.throws(() => buildDryRunPlan(snapshot, { mode: 'live' }), /offline-dry-run/);
console.log('OK: verified SpedV-shaped offline adapter tests passed');
