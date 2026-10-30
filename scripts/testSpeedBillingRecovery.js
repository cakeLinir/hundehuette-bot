
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-recovery-')
);

const storePath = path.join(tempDir, 'speedBilling.json');
const lockPath = `${storePath}.lock`;

process.env.HKC_BILLING_DATA_PATH = storePath;

const store = require('../src/utils/speedBillingStore.js');

function createOperation() {
    return {
        type: 'job',
        guildId: 'recovery-test',
        taskId: 'recovery-job-001',
        spedvUserId: '1001',
        discordUserId: '2001',
        completedAt: '2026-11-15T12:00:00.000Z',
        maxVelocityKmh: 98,
        evidenceSource: 'recovery-test',
        expectedStatus: 'fine_assessed',
        expectedFineEur: 300,
        expectedExcessKmh: 3,
    };
}

function run() {
    console.log('=== HKC Test: Wiederherstellung nach Absturz ===');

    // Zurückgebliebene Lock-Datei simulieren.
    fs.writeFileSync(lockPath, JSON.stringify({
        token: 'orphaned-lock-token',
        pid: 999999,
        createdAt: new Date().toISOString(),
    }), 'utf8');

    console.log('OK: Verwaiste Lock-Datei angelegt.');

    // Ohne Lock darf kein Schreibvorgang erfolgen.
    assert.throws(
        () => store.recordImportBatch([createOperation()]),
        /weiterhin gesperrt/
    );

    assert.equal(
        fs.existsSync(storePath),
        false,
        'Store wurde trotz aktiver Fremdsperre angelegt.'
    );

    console.log('OK: Schreibzugriff während der Sperre verhindert.');

    // Kontrollierte administrative Bereinigung.
    fs.unlinkSync(lockPath);

    console.log('OK: Verwaiste Lock-Datei kontrolliert entfernt.');

    // Schreibvorgang nach Wiederherstellung.
    const result = store.recordImportBatch([createOperation()]);

    assert.equal(result.createdCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(result.discordActionsPerformed, false);

    console.log('OK: Schreibvorgang nach Wiederherstellung erfolgreich.');

    // Persistenz und Duplikatfreiheit prüfen.
    const jobs = store.listJobs({
        guildId: 'recovery-test',
        month: '2026-11',
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].taskId, 'recovery-job-001');
    assert.equal(jobs[0].fineEur, 300);

    console.log('OK: Auftrag genau einmal gespeichert.');

    assert.equal(
        fs.existsSync(lockPath),
        false,
        'Lock-Datei wurde nach erfolgreichem Schreibvorgang nicht freigegeben.'
    );

    console.log('OK: Lock-Datei ordnungsgemäß freigegeben.');
    console.log('\nALLE WIEDERHERSTELLUNGSTESTS BESTANDEN.');
}

try {
    run();
} catch (error) {
    console.error('\nWIEDERHERSTELLUNGSTEST FEHLGESCHLAGEN:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
} finally {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}
