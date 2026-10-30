'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-lock-error-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

const store = require('../src/utils/speedBillingStore.js');

function run() {
    console.log('=== HKC Speed-Billing Lock-Fehlertest ===');
    console.log('Temporärer Store:', storePath);

    // Fall 1: Ungültige Operation muss einen Fehler auslösen.
    assert.throws(
        () => store.recordImportBatch([
            {
                type: 'invalid',
                guildId: 'locking-error-test',
                taskId: 'invalid-job-001',
            },
        ]),
        /unbekannter Operationstyp/i
    );

    console.log('OK: Ungültige Operation löst den erwarteten Fehler aus.');

    // Fall 2: Sperre muss nach dem Fehler freigegeben sein.
    assert.equal(
        fs.existsSync(lockPath),
        false,
        'Lock-Datei wurde nach dem Fehler nicht entfernt.'
    );

    console.log('OK: Lock-Datei nach Fehler entfernt.');

    // Fall 3: Ein gültiger Schreibzugriff muss danach funktionieren.
    const result = store.recordImportBatch([
        {
            type: 'job',
            guildId: 'locking-error-test',
            taskId: 'valid-job-001',
            spedvUserId: '1001',
            discordUserId: '2001',
            completedAt: '2026-11-15T12:00:00.000Z',
            maxVelocityKmh: 98,
            evidenceSource: 'lock-error-test',
            expectedStatus: 'fine_assessed',
            expectedFineEur: 300,
            expectedExcessKmh: 3,
        },
    ]);

    assert.equal(result.createdCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(result.discordActionsPerformed, false);

    console.log('OK: Nachfolgender gültiger Import erfolgreich.');

    // Fall 4: Gespeicherte Daten prüfen.
    const jobs = store.listJobs({
        guildId: 'locking-error-test',
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].taskId, 'valid-job-001');

    console.log('OK: Auftrag korrekt gespeichert.');

    // Fall 5: Keine zurückgebliebenen Sperr- oder Temp-Dateien.
    assert.equal(fs.existsSync(lockPath), false);

    const remainingFiles = fs.readdirSync(tempDir);

    assert.deepEqual(
        remainingFiles.sort(),
        ['speedBilling.json'],
        'Unerwartete Dateien im temporären Verzeichnis.'
    );

    console.log('OK: Keine Lock- oder temporären Dateien vorhanden.');
}

try {
    run();
    console.log('\nALLE LOCK-FEHLERTESTS BESTANDEN.');
} catch (error) {
    console.error('\nLOCK-FEHLERTEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}