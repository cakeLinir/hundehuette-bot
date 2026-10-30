'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-lock-timeout-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

const foreignLockContent = JSON.stringify({
    token: 'foreign-lock-token',
    pid: 999999,
    createdAt: new Date().toISOString(),
});

process.env.HKC_BILLING_DATA_PATH = storePath;

const store = require('../src/utils/speedBillingStore.js');

function run() {
    console.log('=== HKC Speed-Billing Lock-Timeout-Test ===');
    console.log('Temporärer Store:', storePath);

    // Eine fremde Lock-Datei simulieren.
    fs.writeFileSync(lockPath, foreignLockContent, 'utf8');

    console.log('OK: Fremde Lock-Datei angelegt.');

    const startedAt = Date.now();

    assert.throws(
        () => store.recordImportBatch([
            {
                type: 'job',
                guildId: 'locking-timeout-test',
                taskId: 'timeout-job-001',
                spedvUserId: '1001',
                discordUserId: '2001',
                completedAt: '2026-11-15T12:00:00.000Z',
                maxVelocityKmh: 98,
                evidenceSource: 'lock-timeout-test',
                expectedStatus: 'fine_assessed',
                expectedFineEur: 300,
                expectedExcessKmh: 3,
            },
        ]),
        /weiterhin gesperrt/
    );

    const elapsedMs = Date.now() - startedAt;

    assert.ok(
        elapsedMs >= 14000,
        `Timeout trat unerwartet früh ein: ${elapsedMs} ms`
    );

    console.log(`OK: Lock-Timeout nach ${elapsedMs} ms ausgelöst.`);

    // Die fremde Lock-Datei darf nicht verändert werden.
    assert.equal(
        fs.readFileSync(lockPath, 'utf8'),
        foreignLockContent,
        'Fremde Lock-Datei wurde verändert.'
    );

    console.log('OK: Fremde Lock-Datei unverändert erhalten.');

    // Ohne erfolgreichen Lock-Zugriff darf kein Store entstehen.
    assert.equal(
        fs.existsSync(storePath),
        false,
        'Store wurde trotz fehlender Sperre angelegt.'
    );

    console.log('OK: Kein Schreibzugriff auf den Store erfolgt.');

    console.log('\nALLE LOCK-TIMEOUT-TESTS BESTANDEN.');
}

try {
    run();
} catch (error) {
    console.error('\nLOCK-TIMEOUT-TEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}