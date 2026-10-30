
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speed-billing-import-')
);

const previousDataPath = process.env.HKC_BILLING_DATA_PATH;

process.env.HKC_BILLING_DATA_PATH = path.join(
    tempDirectory,
    'speedBilling.json'
);

// Wichtig: Erst nach Setzen des temporären Pfades laden,
// da speedBillingStore.js den Pfad beim Laden festlegt.
const billingStore = require('../src/utils/speedBillingStore');

const {
    buildImportPlan,
    validateImportPlan,
    applyImportPlan,
} = require('../src/utils/speedBillingImport');

const GUILD_ID = 'guild-test';
const DRIVER_A = 'discord-driver-a';
const ADMIN_ID = 'discord-admin';

function makeReport() {
    return {
        mode: 'live-preview',
        month: '2026-11',
        generatedAt: '2026-11-30T22:00:00.000Z',
        sourceTaskCount: 4,
        items: [
            {
                taskId: '1001',
                status: 'fine_candidate',
                completedAt: '2026-11-03T12:00:00.000Z',
                billingMonth: '2026-11',
                spedvUserId: 'spedv-101',
                spedvName: 'FahrerA',
                discordUserId: DRIVER_A,
                maxVelocityKmh: 98,
                excessKmh: 3,
                fineEur: 300,
                evidenceSource: 'test-telemetry',
            },
            {
                taskId: '1002',
                status: 'no_violation',
                completedAt: '2026-11-05T12:00:00.000Z',
                billingMonth: '2026-11',
                spedvUserId: 'spedv-102',
                spedvName: 'FahrerB',
                discordUserId: 'discord-driver-b',
                maxVelocityKmh: 91,
                excessKmh: 0,
                fineEur: 0,
                evidenceSource: 'test-telemetry',
            },
            {
                taskId: '1003',
                status: 'review_details_unavailable',
                reason: 'Auftragsdetails konnten nicht geladen werden.',
            },
            {
                taskId: '1004',
                status: 'review_unverified_driver_link',
                completedAt: '2026-11-08T12:00:00.000Z',
                billingMonth: '2026-11',
                spedvUserId: 'spedv-104',
                spedvName: 'UnbekannterFahrer',
                discordUserId: null,
                reason: 'Keine eindeutige Discord-Verknüpfung vorhanden.',
            },
        ],
    };
}

function expectThrow(callback, expectedText) {
    assert.throws(callback, error => {
        assert.ok(
            error.message.includes(expectedText),
            `Unerwartete Fehlermeldung: ${error.message}`
        );

        return true;
    });
}

async function run() {
    console.log('=== HKC Speed Billing Import Tests ===');

    // 1. Importplan erstellen.
    const report = makeReport();

    const plan = buildImportPlan(report, {
        guildId: GUILD_ID,
    });

    assert.ok(plan, 'Importplan wurde nicht erstellt.');
    assert.equal(plan.month, '2026-11');
    assert.equal(plan.guildId, GUILD_ID);
    assert.equal(plan.operationCount, 4);

    assert.equal(
        validateImportPlan(plan),
        true,
        'Importplan wurde nicht als gültig erkannt.'
    );

    console.log('OK: Importplan erstellt und validiert.');

    // 2. Manipulierten Plan erkennen.
    const tamperedPlan = structuredClone(plan);

    tamperedPlan.operations[0].fineEur = 999999;

    expectThrow(
        () => validateImportPlan(tamperedPlan),
        'Plan'
    );

    console.log('OK: Manipulierter Importplan wird abgelehnt.');

    // 3. Import durchführen.
    const importResult = applyImportPlan(plan);

    console.log(
        'Import-Ergebnis:',
        JSON.stringify(importResult, null, 2)
    );

    assert.ok(
        importResult.success,
        'Import wurde nicht erfolgreich abgeschlossen.'
    );

    console.log('OK: Importplan verarbeitet.');

    // 4. Gespeicherte Aufträge kontrollieren.
    const jobs = billingStore.listJobs({
        guildId: GUILD_ID,
        month: '2026-11',
    });

    assert.equal(jobs.length, 2);

    const fineJob = jobs.find(job => job.taskId === '1001');
    const cleanJob = jobs.find(job => job.taskId === '1002');

    assert.ok(fineJob);
    assert.equal(fineJob.status, 'fine_assessed');
    assert.equal(fineJob.maxVelocityKmh, 98);
    assert.equal(fineJob.excessKmh, 3);
    assert.equal(fineJob.fineEur, 300);

    assert.ok(cleanJob);
    assert.equal(cleanJob.status, 'no_violation');
    assert.equal(cleanJob.fineEur, 0);

    console.log('OK: Verstoß und nicht beanstandeter Auftrag gespeichert.');

    // 5. Review-Fälle kontrollieren.
    const reviewCases = billingStore.listReviewCases({
        guildId: GUILD_ID,
    });

    assert.equal(reviewCases.length, 2);

    const globalCase = reviewCases.find(
        reviewCase => reviewCase.taskId === '1003'
    );

    const unassignedCase = reviewCases.find(
        reviewCase => reviewCase.taskId === '1004'
    );

    assert.ok(globalCase);
    assert.equal(globalCase.globalBlock, true);
    assert.equal(globalCase.billingMonth, null);

    assert.ok(unassignedCase);
    assert.equal(unassignedCase.globalBlock, false);
    assert.equal(unassignedCase.billingMonth, '2026-11');
    assert.equal(unassignedCase.discordUserId, null);

    console.log('OK: Globale und monatsbezogene Review-Fälle gespeichert.');

    // 6. Globale Review-Sperre muss Rechnung verhindern.
    expectThrow(
        () => billingStore.createMonthlyInvoice({
            guildId: GUILD_ID,
            discordUserId: DRIVER_A,
            month: '2026-11',
        }),
        'Rechnung gesperrt'
    );

    console.log('OK: Globaler Review-Fall blockiert Rechnungen.');

    // 7. Globalen Review-Fall auflösen.
    const globalResolution = billingStore.resolveReviewCase(
        {
            guildId: GUILD_ID,
            taskId: '1003',
        },
        ADMIN_ID,
        'Test: Auftragsdetails manuell geprüft.'
    );

    assert.equal(globalResolution.updated, true);

    // Der nicht zugeordnete Fall muss weiterhin blockieren.
    expectThrow(
        () => billingStore.createMonthlyInvoice({
            guildId: GUILD_ID,
            discordUserId: DRIVER_A,
            month: '2026-11',
        }),
        'Rechnung gesperrt'
    );

    console.log('OK: Nicht zugeordneter Review-Fall blockiert weiterhin.');

    // 8. Nicht zugeordneten Review-Fall auflösen.
    const unassignedResolution = billingStore.resolveReviewCase(
        {
            guildId: GUILD_ID,
            taskId: '1004',
        },
        ADMIN_ID,
        'Test: Fahrerzuordnung manuell geprüft.'
    );

    assert.equal(unassignedResolution.updated, true);

    // 9. Nach Auflösung aller Sperren Rechnung erstellen.
    const invoiceResult = billingStore.createMonthlyInvoice({
        guildId: GUILD_ID,
        discordUserId: DRIVER_A,
        month: '2026-11',
    });

    assert.equal(invoiceResult.created, true);
    assert.equal(invoiceResult.invoice.totalEur, 300);
    assert.equal(invoiceResult.invoice.lineItems.length, 1);
    assert.equal(
        invoiceResult.invoice.lineItems[0].taskId,
        '1001'
    );

    console.log('OK: Rechnung nach Auflösung aller Review-Fälle erstellt.');
    
    // ============================================================
    // 9a. Nachträglichen Auftrag per Batch importieren.
    // ============================================================

    const lateBatchOperation = {
        type: 'job',
        guildId: GUILD_ID,
        taskId: '1005',
        completedAt: '2026-11-25T12:00:00.000Z',
        billingMonth: '2026-11',
        spedvUserId: 'spedv-101',
        spedvName: 'FahrerA',
        discordUserId: DRIVER_A,
        maxVelocityKmh: 98,
        expectedStatus: 'fine_assessed',
        expectedExcessKmh: 3,
        expectedFineEur: 300,
        evidenceSource: 'test-telemetry',
    };

    const lateBatchResult = billingStore.recordImportBatch(
        [lateBatchOperation],
        ADMIN_ID
    );

    console.log(
        'Nachträglicher Batch-Import:',
        JSON.stringify(lateBatchResult, null, 2)
    );

    // ============================================================
    // 10. Dieselben Daten erneut importieren.
    // ============================================================

    const repeatedImport = applyImportPlan(plan);

    assert.ok(
        repeatedImport.success,
        'Wiederholter Import ist fehlgeschlagen.'
    );

    const finalJobs = billingStore.listJobs({
        guildId: GUILD_ID,
        month: '2026-11',
    });

    const finalInvoices = billingStore.listInvoices({
        guildId: GUILD_ID,
        month: '2026-11',
    });

    const finalReviews = billingStore.listReviewCases({
        guildId: GUILD_ID,
        includeResolved: true,
    });

    assert.equal(finalJobs.length, 3);
    assert.equal(finalInvoices.length, 1);
    assert.equal(finalInvoices[0].totalEur, 600);
    assert.equal(finalInvoices[0].lineItems.length, 2);
    assert.equal(finalReviews.length, 2);

    assert.ok(
        finalJobs.some(job => job.taskId === '1005'),
        'Der nachträglich importierte Auftrag 1005 wurde nicht erhalten.'
    );

    assert.ok(
        finalInvoices[0].lineItems.some(item => item.taskId === '1005'),
        'Auftrag 1005 fehlt nach dem Wiederholungsimport in der Rechnung.'
    );

    assert.ok(
        finalReviews.every(item => item.status === 'resolved'),
        'Ein Review-Fall wurde beim Wiederholungsimport erneut geöffnet.'
    );

    console.log('OK: Wiederholungsimport erzeugt keine Duplikate.');

    console.log('');
    console.log('Alle Speed-Billing-Import-Tests bestanden.');
}

try {
    run();
} catch (error) {
    console.error('');
    console.error('FEHLER IM SPEED-BILLING-IMPORT-TEST');
    console.error('Nachricht:', error.message);
    console.error('Stack:', error.stack);
    process.exitCode = 1;
} finally {
    try {
        fs.rmSync(tempDirectory, {
            recursive: true,
            force: true,
        });
    } catch (cleanupError) {
        console.error(
            'WARNUNG: Temporärer Testordner konnte nicht entfernt werden:',
            cleanupError.message
        );
        process.exitCode = 1;
    }

    if (previousDataPath === undefined) {
        delete process.env.HKC_BILLING_DATA_PATH;
    } else {
        process.env.HKC_BILLING_DATA_PATH = previousDataPath;
    }
}
