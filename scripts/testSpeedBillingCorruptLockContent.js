
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-corrupt-lock-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

const originalRenameSync = fs.renameSync;
const originalWriteFileSync = fs.writeFileSync;

let lockCorrupted = false;

try {
    const store = require('../src/utils/speedBillingStore.js');

    console.log('=== HKC Test: Beschädigter Lock-Inhalt ===');
    console.log('Temporärer Store:', storePath);

    assert.deepEqual(store.listJobs(), []);

    // Beim atomaren Speichern wird der Lock-Inhalt absichtlich beschädigt.
    fs.renameSync = function (source, destination) {
        if (
            path.resolve(String(destination)) === path.resolve(storePath) &&
            !lockCorrupted
        ) {
            originalWriteFileSync.call(
                fs,
                lockPath,
                '{ungueltiges-json',
                'utf8'
            );

            lockCorrupted = true;
        }

        return originalRenameSync.call(fs, source, destination);
    };

    const result = store.recordImportBatch([
        {
            type: 'job',
            guildId: 'corrupt-lock-test',
            taskId: 'corrupt-lock-job-001',
            spedvUserId: '1001',
            discordUserId: '2001',
            completedAt: '2026-11-15T12:00:00.000Z',
            maxVelocityKmh: 98,
            evidenceSource: 'corrupt-lock-test',
            expectedStatus: 'fine_assessed',
            expectedFineEur: 300,
            expectedExcessKmh: 3,
        },
    ]);

    assert.equal(lockCorrupted, true);
    console.log('OK: Lock-Inhalt während des Schreibvorgangs beschädigt.');

    assert.equal(
        fs.existsSync(lockPath),
        false,
        'Eigener Lock wurde trotz beschädigtem Inhalt nicht entfernt.'
    );

    console.log('OK: Eigener Lock anhand der Dateiidentität freigegeben.');

    const savedJobs = store.listJobs({
        guildId: 'corrupt-lock-test',
        month: '2026-11',
    });

    assert.equal(savedJobs.length, 1);
    assert.equal(savedJobs[0].taskId, 'corrupt-lock-job-001');
    assert.equal(savedJobs[0].fineEur, 300);

    console.log('OK: Auftrag korrekt gespeichert.');

    assert.equal(result.discordActionsPerformed, false);
    console.log('OK: Keine Discord-Aktionen.');

    console.log('\nALLE TESTS BESTANDEN.');
    } catch (error) {
        console.error('\nTEST FEHLGESCHLAGEN:');
        console.error(error.stack || error.message);
        process.exitCode = 1;
    } finally {
        fs.renameSync = originalRenameSync;
        fs.writeFileSync = originalWriteFileSync;

        fs.rmSync(tempDir, {
            recursive: true,
            force: true,
        });
}
