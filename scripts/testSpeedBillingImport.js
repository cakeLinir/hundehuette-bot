
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ============================================================
// 1. Isolierte Testumgebung
// ============================================================

const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speed-billing-import-')
);

const previousDataPath = process.env.HKC_BILLING_DATA_PATH;

process.env.HKC_BILLING_DATA_PATH = path.join(
    tempDirectory,
    'speedBilling.json'
);

// Store erst nach Setzen des temporären Datenpfades laden.
const billingStore = require('../src/utils/speedBillingStore');

const {
    buildImportPlan,
    validateImportPlan,
    applyImportPlan,
} = require('../src/utils/speedBillingImport');

// ============================================================
// 2. Testkonfiguration
// ============================================================

const GUILD_ID = 'guild-test';
const DRIVER_A = '111111111111111111';
const ADMIN_ID = 'discord-admin';
const BILLING_MONTH = '2026-11';

// ============================================================
// 3. Testbericht
// ============================================================

function makeReport() {
    return {
        mode: 'live-preview',
        month: BILLING_MONTH,
        generatedAt: '2026-11-30T22:00:00.000Z',
        sourceTaskCount: 4,

        items: [
            {
                taskId: '1001',
                status: 'fine_candidate',
                completedAt: '2026-11-03T12:00:00.000Z',
                billingMonth: BILLING_MONTH,
                spedvUserId: '101',
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
                billingMonth: BILLING_MONTH,
                spedvUserId: '102',
                spedvName: 'FahrerB',
                discordUserId: '111111111111111112',
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
                billingMonth: BILLING_MONTH,
                spedvUserId: '104',
                spedvName: 'UnbekannterFahrer',
                discordUserId: null,
                reason: 'Keine eindeutige Discord-Verknüpfung vorhanden.',
            },
        ],
    };
}

// ============================================================
// 4. Hilfsfunktionen
// ============================================================

function expectThrow(callback, expectedText) {
    assert.throws(callback, error => {
        assert.ok(
            error.message.includes(expectedText),
            `Unerwartete Fehlermeldung: ${error.message}`
        );

        return true;
    });
}

function findReviewCase(taskId, options = {}) {
    const cases = billingStore.listReviewCases({
        guildId: GUILD_ID,
        includeResolved: true,
        ...options,
    });

    return cases.find(reviewCase => reviewCase.taskId === taskId);
}

// ============================================================
// 5. Haupttest
// ============================================================

async function run() {
    console.log('');
    console.log('================================================');
    console.log(' HKC SPEED BILLING IMPORT TESTS');
    console.log('================================================');
    console.log('');

    // --------------------------------------------------------
    // Test 1: Importplan erstellen und validieren
    // --------------------------------------------------------

    const report = makeReport();

    const plan = buildImportPlan(report, {
        guildId: GUILD_ID,
    });

    assert.ok(
        plan,
        'Importplan wurde nicht erstellt.'
    );

    assert.equal(plan.month, BILLING_MONTH);
    assert.equal(plan.guildId, GUILD_ID);
    assert.equal(plan.operationCount, 4);

    assert.equal(
        validateImportPlan(plan),
        true,
        'Importplan wurde nicht als gültig erkannt.'
    );

    console.log('OK: Importplan erstellt und validiert.');

    // --------------------------------------------------------
    // Test 2: Manipulierten Importplan erkennen
    // --------------------------------------------------------

    const tamperedPlan = structuredClone(plan);

    tamperedPlan.operations[0].fineEur = 999999;

    expectThrow(
        () => validateImportPlan(tamperedPlan),
        'Plan'
    );

    console.log('OK: Manipulierter Importplan wird abgelehnt.');

    // --------------------------------------------------------
    // Test 3: Import durchführen
    // --------------------------------------------------------

    const importResult = await applyImportPlan(plan);

    console.log(
        'Import-Ergebnis:',
        JSON.stringify(importResult, null, 2)
    );

    assert.ok(
        importResult.success,
        'Import wurde nicht erfolgreich abgeschlossen.'
    );

    console.log('OK: Importplan verarbeitet.');

    // --------------------------------------------------------
    // Test 4: Importierte Aufträge kontrollieren
    // --------------------------------------------------------

    const jobs = billingStore.listJobs({
        guildId: GUILD_ID,
        month: BILLING_MONTH,
    });

    assert.equal(
        jobs.length,
        2,
        'Es wurden nicht genau zwei reguläre Aufträge gespeichert.'
    );

    const fineJob = jobs.find(job => job.taskId === '1001');
    const cleanJob = jobs.find(job => job.taskId === '1002');

    assert.ok(fineJob, 'Bußgeld-Auftrag 1001 fehlt.');
    assert.equal(fineJob.status, 'fine_assessed');
    assert.equal(fineJob.maxVelocityKmh, 98);
    assert.equal(fineJob.excessKmh, 3);
    assert.equal(fineJob.fineEur, 300);

    assert.ok(cleanJob, 'Nicht beanstandeter Auftrag 1002 fehlt.');
    assert.equal(cleanJob.status, 'no_violation');
    assert.equal(cleanJob.fineEur, 0);

    console.log('OK: Verstoß und nicht beanstandeter Auftrag gespeichert.');

    // --------------------------------------------------------
    // Test 5: Review-Fälle kontrollieren
    // --------------------------------------------------------

    const reviewCases = billingStore.listReviewCases({
        guildId: GUILD_ID,
        includeResolved: true,
    });

    assert.equal(
        reviewCases.length,
        2,
        'Es wurden nicht genau zwei Prüffälle gespeichert.'
    );

    const globalCase = findReviewCase('1003');
    const unassignedCase = findReviewCase('1004');

    assert.ok(globalCase, 'Globaler Prüffall 1003 fehlt.');
    assert.equal(globalCase.globalBlock, true);
    assert.equal(globalCase.billingMonth, null);

    assert.ok(unassignedCase, 'Nicht zugeordneter Prüffall 1004 fehlt.');
    assert.equal(unassignedCase.globalBlock, false);
    assert.equal(unassignedCase.billingMonth, BILLING_MONTH);
    assert.equal(unassignedCase.discordUserId, null);

    assert.notEqual(
        unassignedCase.status,
        'resolved',
        'Der nicht zugeordnete Prüffall darf nicht automatisch aufgelöst werden.'
    );

    console.log('OK: Globale und monatsbezogene Prüffälle gespeichert.');

    // --------------------------------------------------------
    // Test 6: Globaler Prüffall blockiert Rechnungen
    // --------------------------------------------------------

    expectThrow(
        () => billingStore.createMonthlyInvoice({
            guildId: GUILD_ID,
            discordUserId: DRIVER_A,
            month: BILLING_MONTH,
        }),
        'Rechnung gesperrt'
    );

    console.log('OK: Globaler Prüffall blockiert Rechnungen.');

    // --------------------------------------------------------
    // Test 7: Globalen Prüffall auflösen
    // --------------------------------------------------------

    const globalResolution = billingStore.resolveReviewCase(
        {
            guildId: GUILD_ID,
            taskId: '1003',
        },
        ADMIN_ID,
        'Test: Auftragsdetails manuell geprüft.'
    );

    assert.equal(
        globalResolution.updated,
        true,
        'Globaler Prüffall konnte nicht aufgelöst werden.'
    );

    const resolvedGlobalCase = findReviewCase('1003');

    assert.ok(resolvedGlobalCase);
    assert.equal(
        resolvedGlobalCase.status,
        'resolved',
        'Globaler Prüffall wurde nicht als erledigt gespeichert.'
    );

    console.log('OK: Globaler Prüffall wurde aufgelöst.');

    // --------------------------------------------------------
    // Test 8: Nicht zugeordneter Prüffall blockiert andere Fahrer
    // --------------------------------------------------------

    const stillOpenCase = findReviewCase('1004', {
        month: BILLING_MONTH,
    });

    assert.ok(
        stillOpenCase,
        'Nicht zugeordneter Prüffall wurde nicht gefunden.'
    );

    assert.equal(
        stillOpenCase.discordUserId,
        null,
        'Der Prüffall besitzt unerwartet eine Discord-Zuordnung.'
    );

    assert.notEqual(
        stillOpenCase.status,
        'resolved',
        'Der Prüffall wurde unerwartet aufgelöst.'
    );

    // Die Rechnung für DRIVER_A muss trotz des offenen,
    // nicht zugeordneten Prüffalls erstellt werden können.
    const invoiceResult = billingStore.createMonthlyInvoice({
        guildId: GUILD_ID,
        discordUserId: DRIVER_A,
        month: BILLING_MONTH,
    });

    assert.equal(
        invoiceResult.created,
        true,
        'Rechnung wurde trotz nicht blockierendem Prüffall nicht erstellt.'
    );

    assert.equal(invoiceResult.invoice.totalEur, 300);
    assert.equal(invoiceResult.invoice.lineItems.length, 1);

    assert.equal(
        invoiceResult.invoice.lineItems[0].taskId,
        '1001'
    );

    // Prüffall nach Rechnungserstellung erneut kontrollieren.
    const caseAfterInvoice = findReviewCase('1004', {
        month: BILLING_MONTH,
    });

    assert.ok(caseAfterInvoice);

    assert.notEqual(
        caseAfterInvoice.status,
        'resolved',
        'Rechnungserstellung hat den Prüffall unerwartet aufgelöst.'
    );

    console.log(
        'OK: Nicht zugeordneter Prüffall bleibt offen und blockiert andere Fahrer nicht.'
    );

    // --------------------------------------------------------
    // Test 9: Nachträglichen Auftrag importieren
    // --------------------------------------------------------

    const lateBatchOperation = {
        type: 'job',
        guildId: GUILD_ID,
        taskId: '1005',
        completedAt: '2026-11-25T12:00:00.000Z',
        billingMonth: BILLING_MONTH,
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

    // --------------------------------------------------------
    // Test 10: Wiederholungsimport darf keine Duplikate erzeugen
    // --------------------------------------------------------

    const repeatedImport = await applyImportPlan(plan);

    assert.ok(
        repeatedImport.success,
        'Wiederholter Import ist fehlgeschlagen.'
    );

    const finalJobs = billingStore.listJobs({
        guildId: GUILD_ID,
        month: BILLING_MONTH,
    });

    const finalInvoices = billingStore.listInvoices({
        guildId: GUILD_ID,
        month: BILLING_MONTH,
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
        'Nachträglich importierter Auftrag 1005 fehlt.'
    );

    assert.ok(
        finalInvoices[0].lineItems.some(
            item => item.taskId === '1005'
        ),
        'Auftrag 1005 fehlt nach dem Wiederholungsimport in der Rechnung.'
    );

    const finalGlobalCase = finalReviews.find(
        item => item.taskId === '1003'
    );

    const finalUnassignedCase = finalReviews.find(
        item => item.taskId === '1004'
    );

    assert.ok(finalGlobalCase, 'Globaler Prüffall fehlt.');
    assert.equal(
        finalGlobalCase.status,
        'resolved',
        'Aufgelöster globaler Prüffall wurde erneut geöffnet.'
    );

    assert.ok(finalUnassignedCase, 'Nicht zugeordneter Prüffall fehlt.');

    assert.notEqual(
        finalUnassignedCase.status,
        'resolved',
        'Nicht zugeordneter Prüffall wurde unerwartet aufgelöst.'
    );

    assert.equal(
        finalUnassignedCase.discordUserId,
        null
    );

    console.log('OK: Wiederholungsimport erzeugt keine Duplikate.');
    console.log('OK: Prüffallstatus bleibt korrekt erhalten.');

    // --------------------------------------------------------
    // Testergebnis
    // --------------------------------------------------------

    console.log('');
    console.log('================================================');
    console.log(' ALLE SPEED-BILLING-IMPORT-TESTS BESTANDEN');
    console.log('================================================');
    console.log('');
}

// ============================================================
// 6. Testausführung und zuverlässige Fehlerbehandlung
// ============================================================

async function main() {
    let exitCode = 0;

    try {
        await run();
    } catch (error) {
        exitCode = 1;

        console.error('');
        console.error('================================================');
        console.error(' FEHLER IM SPEED-BILLING-IMPORT-TEST');
        console.error('================================================');
        console.error('');

        console.error('Nachricht:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        try {
            fs.rmSync(tempDirectory, {
                recursive: true,
                force: true,
            });

            console.log('Temporäre Testdaten wurden entfernt.');
        } catch (cleanupError) {
            exitCode = 1;

            console.error(
                'WARNUNG: Temporärer Testordner konnte nicht entfernt werden:',
                cleanupError.message
            );
        }

        if (previousDataPath === undefined) {
            delete process.env.HKC_BILLING_DATA_PATH;
        } else {
            process.env.HKC_BILLING_DATA_PATH = previousDataPath;
        }
    }

    if (exitCode !== 0) {
        process.exitCode = exitCode;
    }
}

main().catch(error => {
    console.error('Unerwarteter Fehler beim Teststart:', error);
    process.exitCode = 1;
});
