'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-rename-failure-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

const originalRenameSync = fs.renameSync;
let renameCalls = 0;

// Nur in diesem Testprozess wird renameSync gezielt gestört.
fs.renameSync = function (source, destination) {
    renameCalls += 1;

    const error = new Error(
        'Simulierter Fehler direkt in renameSync.'
    );

    error.code = 'EIO';

    throw error;
};

const store = require('../src/utils/speedBillingStore.js');

function run() {
    console.log('=== HKC renameSync-Fehlertest ===');
    console.log('Temporärer Store:', storePath);

    // Initialisierung vor der Fehlerinjektion wäre erforderlich.
    // Der Store wird deshalb zunächst durch einen Lesezugriff angelegt.
    // Dieser Zugriff verwendet kein renameSync.
    assert.deepEqual(store.listJobs(), []);

    let writeError = null;

    try {
        store.recordImportBatch([
            {
                type: 'job',
                guildId: 'rename-failure-test',
                taskId: 'rename-job-001',
                spedvUserId: '1001',
                discordUserId: '2001',
                completedAt: '2026-11-15T12:00:00.000Z',
                maxVelocityKmh: 98,
                evidenceSource: 'rename-failure-test',
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
        'Der Schreibvorgang hätte fehlschlagen müssen.'
    );

    assert.match(
        writeError.message,
        /Simulierter Fehler direkt in renameSync/
    );

    assert.equal(renameCalls, 1);

    console.log('OK: renameSync-Fehler gezielt ausgelöst.');

    assert.equal(
        fs.existsSync(lockPath),
        false,
        'Lock-Datei wurde nach renameSync-Fehler nicht entfernt.'
    );

    console.log('OK: Lock-Datei freigegeben.');

    const remainingTempFiles = fs.readdirSync(tempDir).filter(
        name => name.endsWith('.tmp')
    );

    assert.deepEqual(
        remainingTempFiles,
        [],
        'Temporäre Schreibdatei wurde nicht entfernt.'
    );

    console.log('OK: Temporäre Schreibdatei entfernt.');

    // Der ursprüngliche Store muss unverändert geblieben sein.
    const originalData = JSON.parse(
        fs.readFileSync(storePath, 'utf8')
    );

    assert.deepEqual(originalData.jobs, {});
    assert.deepEqual(originalData.audit, []);

    console.log('OK: Ursprünglicher Store unverändert.');

    console.log('\nALLE RENAME-FEHLERTESTS BESTANDEN.');
}

try {
    run();
} catch (error) {
    console.error('\nRENAME-FEHLERTEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.renameSync = originalRenameSync;

    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}