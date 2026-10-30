'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-lock-release-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

const store = require('../src/utils/speedBillingStore.js');
const originalReadFileSync = fs.readFileSync;

try {
    console.log('=== HKC Lock-Freigabe-Fehlertest ===');
    console.log('Temporärer Store:', storePath);

    // Store vor dem Test initialisieren.
    assert.deepEqual(store.listJobs(), []);

    let injected = false;

    // Nur das Lesen der Lock-Datei wird gezielt gestört.
    fs.readFileSync = function (filePath, ...args) {
        if (path.resolve(String(filePath)) === path.resolve(lockPath)) {
            injected = true;
            return '{ungueltiges-json';
        }

        return originalReadFileSync.call(fs, filePath, ...args);
    };

    let operationError = null;

    try {
        store.recordImportBatch([
            {
                type: 'job',
                guildId: 'lock-release-test',
                taskId: 'release-job-001',
                spedvUserId: '1001',
                discordUserId: '2001',
                completedAt: '2026-11-15T12:00:00.000Z',
                maxVelocityKmh: 98,
                evidenceSource: 'lock-release-test',
                expectedStatus: 'fine_assessed',
                expectedFineEur: 300,
                expectedExcessKmh: 3,
            },
        ]);
    } catch (error) {
        operationError = error;
    } finally {
        fs.readFileSync = originalReadFileSync;
    }

    assert.equal(
        injected,
        true,
        'Der Lock-Lesezugriff wurde nicht abgefangen.'
    );

    console.log('OK: Lock-Lesezugriff gezielt gestört.');

    assert.ok(
        operationError instanceof Error,
        'Es wurde ein Fehler beim Freigeben erwartet.'
    );

    console.log('Erwarteter Fehler:', operationError.message);

    const lockStillExists = fs.existsSync(lockPath);

    console.log(
        lockStillExists
            ? 'BEFUND: Lock-Datei ist nach dem Fehler noch vorhanden.'
            : 'BEFUND: Lock-Datei wurde trotz Lesefehler entfernt.'
    );

    // Prüfen, ob der eigentliche Schreibvorgang bereits erfolgt ist.
    const savedData = JSON.parse(
        originalReadFileSync.call(fs, storePath, 'utf8')
    );

    const jobExists = Boolean(savedData.jobs?.['release-job-001']);

    console.log(
        jobExists
            ? 'BEFUND: Auftrag wurde gespeichert, obwohl der Aufruf einen Fehler meldete.'
            : 'BEFUND: Auftrag wurde nicht gespeichert.'
    );

    console.log('\nDIAGNOSTIK ABGESCHLOSSEN.');
} catch (error) {
    console.error('\nTEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.readFileSync = originalReadFileSync;

    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}