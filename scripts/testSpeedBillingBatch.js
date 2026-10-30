
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speed-billing-batch-')
);

const storePath = path.join(tempDirectory, 'speedBilling.json');

process.env.HKC_BILLING_DATA_PATH = storePath;

const store = require('../src/utils/speedBillingStore');

function readRawStore() {
    return fs.readFileSync(storePath, 'utf8');
}

function run() {
    try {
        // Store initialisieren.
        store.listJobs();

        const initialContent = readRawStore();

        // Ungültige Operation muss vor dem Schreiben scheitern.
        assert.throws(
            () => store.recordImportBatch([
                {
                    type: 'job',
                    guildId: 'test-guild',
                    taskId: 'invalid-job',
                    completedAt: '2026-11-15T12:00:00.000Z',
                    spedvUserId: '123',
                    discordUserId: '456',
                    maxVelocityKmh: 120,
                    expectedStatus: 'fine_assessed',
                    expectedFineEur: 1,
                    expectedExcessKmh: 25,
                },
            ]),
            /Bewertung stimmt nicht/
        );

        assert.equal(
            readRawStore(),
            initialContent,
            'Ungültiger Batch darf den Store nicht verändern.'
        );

        // Erfolgreicher Batch mit einem Verstoß und einem Review-Fall.
        const result = store.recordImportBatch([
            {
                type: 'job',
                guildId: 'test-guild',
                taskId: 'job-001',
                spedvUserId: '1001',
                discordUserId: '2001',
                completedAt: '2026-11-15T12:00:00.000Z',
                maxVelocityKmh: 98,
                evidenceSource: 'test-telemetry',
                expectedStatus: 'fine_assessed',
                expectedFineEur: 300,
                expectedExcessKmh: 3,
            },
            {
                type: 'review',
                guildId: 'test-guild',
                taskId: 'job-002',
                billingMonth: '2026-11',
                discordUserId: '2002',
                spedvUserId: '1002',
                spedvName: 'Testfahrer',
                status: 'review_missing_telemetry',
                reason: 'Test: Telemetrie fehlt.',
            },
        ]);

        assert.equal(result.attemptedCount, 2);
        assert.equal(result.createdCount, 2);
        assert.equal(result.failedCount, 0);
        assert.equal(result.writesPerformed, true);
        assert.equal(result.discordActionsPerformed, false);

        const jobs = store.listJobs({
            guildId: 'test-guild',
            month: '2026-11',
        });

        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].taskId, 'job-001');
        assert.equal(jobs[0].fineEur, 300);
        assert.equal(jobs[0].excessKmh, 3);

        const reviews = store.listReviewCases({
            guildId: 'test-guild',
            month: '2026-11',
        });

        assert.equal(reviews.length, 1);
        assert.equal(reviews[0].taskId, 'job-002');

        // Wiederholung darf keine neuen Datensätze erzeugen.
        const duplicateResult = store.recordImportBatch([
            {
                type: 'job',
                guildId: 'test-guild',
                taskId: 'job-001',
                spedvUserId: '1001',
                discordUserId: '2001',
                completedAt: '2026-11-15T12:00:00.000Z',
                maxVelocityKmh: 98,
                evidenceSource: 'test-telemetry',
                expectedStatus: 'fine_assessed',
                expectedFineEur: 300,
                expectedExcessKmh: 3,
            },
            {
                type: 'review',
                guildId: 'test-guild',
                taskId: 'job-002',
                billingMonth: '2026-11',
                discordUserId: '2002',
                spedvUserId: '1002',
                spedvName: 'Testfahrer',
                status: 'review_missing_telemetry',
                reason: 'Test: Telemetrie fehlt.',
            },
        ]);

        assert.equal(duplicateResult.duplicateCount, 2);
        assert.equal(duplicateResult.createdCount, 0);
        assert.equal(duplicateResult.updatedCount, 0);

        console.log('Alle Batch-Commit-Tests erfolgreich.');
    } finally {
        fs.rmSync(tempDirectory, {
            recursive: true,
            force: true,
        });
    }
}

run();
