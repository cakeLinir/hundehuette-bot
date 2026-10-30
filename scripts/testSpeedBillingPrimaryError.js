
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-primary-error-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

const originalStatSync = fs.statSync;

try {
    const store = require('../src/utils/speedBillingStore.js');

    console.log('=== HKC Test: Ursprünglicher Fehler bleibt erhalten ===');
    console.log('Temporärer Store:', storePath);

    store.listJobs();

    let injected = false;

    fs.statSync = function (filePath, ...args) {
        if (path.resolve(String(filePath)) === path.resolve(lockPath)) {
            injected = true;

            const error = new Error(
                'Simulierter Fehler bei der Lock-Freigabe.'
            );

            error.code = 'EACCES';
            throw error;
        }

        return originalStatSync.call(fs, filePath, ...args);
    };

    let operationError = null;

    try {
        store.recordImportBatch([{
            type: 'invalid',
            guildId: 'primary-error-test',
            taskId: 'invalid-job-001',
        }]);
    } catch (error) {
        operationError = error;
    } finally {
        fs.statSync = originalStatSync;
    }

    assert.equal(injected, true);
    console.log('OK: Fehler bei der Lock-Freigabe gezielt ausgelöst.');

    assert.ok(operationError instanceof Error);
    assert.match(
        operationError.message,
        /unbekannter Operationstyp invalid/i
    );

    console.log('OK: Ursprünglicher Operationsfehler erhalten.');

    assert.ok(
        operationError.releaseError instanceof Error,
        'Der zusätzliche Freigabefehler wurde nicht dokumentiert.'
    );

    assert.match(
        operationError.releaseError.message,
        /Simulierter Fehler bei der Lock-Freigabe/
    );

    console.log('OK: Zusätzlicher Freigabefehler dokumentiert.');

    assert.equal(
        fs.existsSync(lockPath),
        true,
        'Bei nicht möglicher Eigentümerprüfung darf der Lock nicht entfernt werden.'
    );

    console.log('OK: Lock bei nicht möglicher Eigentümerprüfung geschützt.');

    console.log('\nALLE TESTS BESTANDEN.');
} catch (error) {
    console.error('\nTEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.statSync = originalStatSync;

    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}
