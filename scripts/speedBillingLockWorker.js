'use strict';

const path = require('node:path');

const storePath = process.env.HKC_BILLING_DATA_PATH;

if (!storePath) {
    throw new Error('HKC_BILLING_DATA_PATH ist nicht gesetzt.');
}

const store = require(
    path.resolve(__dirname, '..', 'src', 'utils', 'speedBillingStore.js')
);

const workerId = Number(process.argv[2]);
const jobsPerWorker = Number(process.argv[3]);

if (
    !Number.isInteger(workerId) ||
    workerId < 1 ||
    !Number.isInteger(jobsPerWorker) ||
    jobsPerWorker < 1
) {
    throw new Error('Ungültige Worker-Parameter.');
}

const operations = [];

for (let index = 0; index < jobsPerWorker; index += 1) {
    operations.push({
        type: 'job',
        guildId: 'locking-test',
        taskId: `worker-${workerId}-job-${index}`,
        spedvUserId: String(100000 + workerId),
        discordUserId: String(200000 + workerId),
        completedAt: '2026-11-15T12:00:00.000Z',
        maxVelocityKmh: 98,
        evidenceSource: 'parallel-locking-test',
        expectedStatus: 'fine_assessed',
        expectedFineEur: 300,
        expectedExcessKmh: 3,
    });
}

const result = store.recordImportBatch(operations);

if (
    result.createdCount !== jobsPerWorker ||
    result.failedCount !== 0 ||
    result.discordActionsPerformed !== false
) {
    throw new Error(
        `Unerwartetes Batch-Ergebnis: ${JSON.stringify(result)}`
    );
}

process.stdout.write(JSON.stringify({
    workerId,
    createdCount: result.createdCount,
    failedCount: result.failedCount,
}));