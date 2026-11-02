'use strict';

const assert = require('node:assert/strict');
const { buildLivePreview } = require('../src/utils/speedBillingLivePreview');

const SPEDITION_ID = '108570';

const verifiedLinks = {
    hundekuchen: {
        discordId: '111111111111111111',
        spedvUserId: '169742',
        spedvName: 'hundekuchen',
    },
};

const baseTask = { id: 9001, state: 2, userID: 169742 };

const baseDetails = {
    state: 2,
    spedition: { id: 108570, name: 'Hundekuchens Cargo' },
    user: { id: 169742, userName: 'hundekuchen' },
    endtime: '2026-11-15T18:00:00+01:00',
    ddCleaned: false,
    maxVelocityKMH: 91,
};

function points(velocities) {
    return velocities.map((velocity, index) => ({
        timestamp: `2026-11-15T17:${String(index).padStart(2, '0')}:00+01:00`,
        velocity,
        speedLimit: 90,
    }));
}

function createClient({
    task = baseTask,
    details = baseDetails,
    driveData = points([80, 90, 91]),
    driveError = null,
} = {}) {
    return {
        async fetchTasks() {
            return [task];
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

function preview(clientOptions = {}, links = verifiedLinks, month = '2026-11') {
    return buildLivePreview({
        client: createClient(clientOptions),
        links,
        month,
        guildId: 'guild-1',
        speditionId: SPEDITION_ID,
    });
}

async function run() {
    // 1: Keine Überschreitung
    const noViolation = await preview();
    assert.equal(noViolation.noViolationCount, 1);
    assert.equal(noViolation.fineCandidateCount, 0);
    assert.equal(noViolation.items[0].status, 'no_violation');
    assert.equal(noViolation.items[0].fineEur, 0);
    assert.equal(noViolation.writesPerformed, false);

    // 2: Überschreitung: 100 km/h bei Limit 95 = 5 km/h = 500 EUR
    const fine = await preview({
        details: { ...baseDetails, maxVelocityKMH: 100 },
        driveData: points([90, 100]),
    });
    assert.equal(fine.fineCandidateCount, 1);
    assert.equal(fine.items[0].status, 'fine_candidate');
    assert.equal(fine.items[0].excessKmh, 5);
    assert.equal(fine.items[0].fineEur, 500);
    assert.equal(fine.proposedFineTotalEur, 500);

    // 3: Zusammenfassung und Telemetrie widersprechen sich
    const conflict = await preview({
        details: { ...baseDetails, maxVelocityKMH: 91 },
        driveData: points([90, 100]),
    });
    assert.equal(conflict.reviewCount, 1);
    assert.equal(conflict.items[0].status, 'review_speed_conflict');
    assert.equal(conflict.fineCandidateCount, 0);

    // 4: Bereinigte Telemetrie
    const cleaned = await preview({
        details: { ...baseDetails, ddCleaned: true },
    });
    assert.equal(cleaned.reviewCount, 1);
    assert.equal(cleaned.items[0].status, 'review_cleaned_telemetry');

    // 5: Unvollständige Telemetrie (ungültiger Zeitstempel)
    const incomplete = await preview({
        driveData: [{ timestamp: 'kaputt', velocity: 120 }],
    });
    assert.equal(incomplete.reviewCount, 1);
    assert.equal(incomplete.items[0].status, 'review_incomplete_telemetry');

    // 6: Leere Telemetrie
    const empty = await preview({ driveData: [] });
    assert.equal(empty.items[0].status, 'review_missing_telemetry');

    // 7: Telemetrie nicht abrufbar
    const unreachable = await preview({ driveError: 'Netzwerkfehler' });
    assert.equal(unreachable.items[0].status, 'review_missing_telemetry');

    // 8: Alte, unverifizierte String-Verknüpfung
    const unverified = await preview({}, { hundekuchen: 'discord-123' });
    assert.equal(unverified.reviewCount, 1);
    assert.equal(unverified.items[0].status, 'review_unverified_driver_link');

    // 9: Auftrag einer anderen Spedition wird ignoriert
    const other = await preview({
        details: { ...baseDetails, spedition: { id: 999, name: 'Fremd' } },
    });
    assert.equal(other.ignoredOtherSpeditionCount, 1);
    assert.equal(other.hkcTaskCount, 0);
    assert.equal(other.items.length, 0);

    // 10: Regression: fehlende Endzeit darf die Vorschau nicht abstürzen lassen
    const noEnd = await preview({
        details: { ...baseDetails, endtime: null },
    });
    assert.equal(noEnd.reviewCount, 1);
    assert.equal(noEnd.unassignedReviewCount, 1);
    assert.equal(noEnd.unassignedItems.length, 1);
    assert.equal(noEnd.unassignedItems[0].status, 'review_missing_completion_time');
    assert.equal(noEnd.items.length, 0);

    // 11: Auftrag aus einem anderen Monat
    const otherMonth = await preview({
        details: { ...baseDetails, endtime: '2026-12-01T10:00:00+01:00' },
    });
    assert.equal(otherMonth.items.length, 0);
    assert.equal(otherMonth.unassignedItems.length, 0);

    // 12: Fahrer-ID in Liste und Details stimmt nicht überein
    const mismatch = await preview({
        task: { ...baseTask, userID: 1 },
    });
    assert.equal(mismatch.items[0].status, 'review_driver_identity_mismatch');

    console.log('OK: Live-Preview-Tests bestanden (12 Fälle).');
}

run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
