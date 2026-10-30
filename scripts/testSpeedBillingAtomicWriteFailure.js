'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-atomic-failure-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

// Absichtlich ein Verzeichnis statt einer JSON-Datei anlegen.
fs.mkdirSync(storePath);

const store = require('../src/utils/speedBillingStore.js');

function run() {
    console.log('=== HKC Atomic-Write-Fehlertest ===');
    console.log('Temporärer Store:', storePath);

    let writeError = null;

    try {
        store.recordImportBatch([
            {
                type: 'job',
                guildId: 'atomic-failure-test',
                taskId: 'atomic-job-001',
                spedvUserId: '1001',
                discordUserId: '2001',
                completedAt: '2026-11-15T12:00:00.000Z',
                maxVelocityKmh: 98,
                evidenceSource: 'atomic-write-failure-test',
                expectedStatus: 'fine_assessed',
                expectedFineEur: 300,
                expectedExcessKmh: 3,
            },
        ]);
    } catch (error) {
        writeError = error;
    }

    assert.ok(
        writeError instanceof Error,
        'Der Schreibvorgang hätte einen Fehler auslösen müssen.'
    );

    console.log('Schreibfehler:', writeError.message);

    console.log('OK: Schreibvorgang wurde durch den ungültigen Zielpfad abgebrochen.');

    // Das ursprüngliche Verzeichnis muss erhalten bleiben.
    assert.equal(fs.statSync(storePath).isDirectory(), true);

    console.log('OK: Ursprünglicher Zielpfad unverändert.');

    // Die Sperre muss trotz Schreibfehler freigegeben sein.
    assert.equal(
        fs.existsSync(lockPath),
        false,
        'Lock-Datei wurde nach Schreibfehler nicht entfernt.'
    );

    console.log('OK: Lock-Datei nach Schreibfehler entfernt.');

    // Temporäre Schreibdateien dürfen nicht zurückbleiben.
    const tempFiles = fs.readdirSync(tempDir).filter(
        name => name.endsWith('.tmp')
    );

    assert.deepEqual(
        tempFiles,
        [],
        'Temporäre Schreibdateien sind zurückgeblieben.'
    );

    console.log('OK: Keine temporären Schreibdateien vorhanden.');

    console.log('\nALLE ATOMIC-WRITE-FEHLERTESTS BESTANDEN.');
}

try {
    run();
} catch (error) {
    console.error('\nATOMIC-WRITE-TEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}