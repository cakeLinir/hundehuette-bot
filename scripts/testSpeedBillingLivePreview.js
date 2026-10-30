
'use strict';

const assert = require('node:assert/strict');
const { buildLivePreview } = require('../src/utils/speedBillingLivePreview');

const baseTask = {
    id: 9001,
    state: 2,
    userID: 169742,
};

const baseDetails = {
    spedition: { id: 108570, name: 'Hundekuchens Cargo' },
    user: { id: 169742, userName: 'hundekuchen' },
    endtime: '2026-11-15T18:00:00+01:00',
    ddCleaned: false,
    maxVelocityKMH: 91,
};

function createClient({ details = baseDetails, driveData, driveError } = {}) {
    return {
        async fetchTasks() {
            return [baseTask];
        },
        async fetchTaskDetails() {
            return details;
        },
        async fetchDriveData() {
            if (driveError) throw new Error(driveError);
            return driveData;
        },
    };
}

async function run() {
    const links = { hundekuchen: 'discord-123' };
    const common = {
        links,
        month: '2026-11',
        guildId: 'guild-1',
    };

    // Fall 1: Keine Ãœberschreitung.
    const noViolation = await buildLivePreview({
        ...common,
        client: createClient({
            driveData: {
                velocity: [80, 90, 91],
                timestamp: [
                    '2026-11-15T17:00:00+01:00',
                    '2026-11-15T17:30:00+01:00',
                    '2026-11-15T17:45:00+01:00',
                ],
                speedLimit: [90, 90, 90],
            },
        }),
    });

    assert.equal(noViolation.noViolationCount, 1);
    assert.equal(noViolation.fineCandidateCount, 0);
    assert.equal(noViolation.items[0].status, 'no_violation');
    assert.equal(noViolation.items[0].fineEur, 0);

    // Fall 2: Bereinigte Telemetrie.
    const cleaned = await buildLivePreview({
        ...common,
        client: createClient({
            details: { ...baseDetails, ddCleaned: true },
            driveData: {
                velocity: [120],
                timestamp: ['2026-11-15T17:00:00+01:00'],
            },
        }),
    });

    assert.equal(cleaned.reviewCount, 1);
    assert.equal(cleaned.items[0].status, 'review_cleaned_telemetry');
    assert.equal(cleaned.fineCandidateCount, 0);

    // Fall 3: Fehlende bzw. unvollstÃ¤ndige Telemetrie.
    const incomplete = await buildLivePreview({
        ...common,
        client: createClient({
            driveData: {
                velocity: [110, 120],
                timestamp: ['2026-11-15T17:00:00+01:00'],
            },
        }),
    });

    assert.equal(incomplete.reviewCount, 1);
    assert.equal(incomplete.items[0].status, 'review_incomplete_telemetry');
    assert.equal(incomplete.fineCandidateCount, 0);

    console.log('OK: Live-Preview-Tests bestanden.');
    console.log('- Keine Ãœberschreitung');
    console.log('- Bereinigte Telemetrie');
    console.log('- UnvollstÃ¤ndige Telemetrie');
}

run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

