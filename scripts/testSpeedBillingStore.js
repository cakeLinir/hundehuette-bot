
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speed-billing-')
);

process.env.HKC_BILLING_DATA_PATH = path.join(
    tempDir,
    'speedBilling.json'
);

const store = require('../src/utils/speedBillingStore');

try {
    // ============================================================
    // 1. Strafberechnung
    // ============================================================

    assert.deepEqual(
        store.calculateFine(95),
        {
            status: 'no_violation',
            provenMaxKmh: 95,
            excessKmh: 0,
            fineEur: 0,
        }
    );

    assert.equal(store.calculateFine(96).fineEur, 100);
    assert.equal(store.calculateFine(108).fineEur, 1300);
    assert.equal(store.calculateFine(130).fineEur, 3500);

    assert.equal(
        store.calculateFine(null).status,
        'pending_evidence'
    );

    assert.throws(
        () => store.calculateFine(-1),
        /nichtnegative/
    );

    // ============================================================
    // 2. Testdaten
    // ============================================================

    const base = {
        guildId: 'guild-1',
        taskId: 'task-100',
        spedvUserId: 'spedv-7',
        discordUserId: 'discord-7',
        completedAt: '2026-11-01T00:30:00+01:00',
        evidenceSource: 'test-fixture',
    };

    // ============================================================
    // 3. Auftrag erfassen
    // ============================================================

    const first = store.recordCompletedJob(
        {
            ...base,
            maxVelocityKmh: 108,
        },
        'tester'
    );

    assert.equal(first.created, true);
    assert.equal(first.updated, false);
    assert.equal(first.job.billingMonth, '2026-11');
    assert.equal(first.job.fineEur, 1300);
    assert.equal(first.job.status, 'fine_assessed');

    // ============================================================
    // 4. Doppelte Auftragserfassung verhindern
    // ============================================================

    const duplicate = store.recordCompletedJob(
        {
            ...base,
            maxVelocityKmh: 130,
        },
        'tester'
    );

    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.job.fineEur, 1300);

    // ============================================================
    // 5. Fehlende Nachweise und nachträgliche Klärung
    // ============================================================

    const pending = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-pending',
            maxVelocityKmh: null,
        },
        'tester'
    );

    assert.equal(pending.created, true);
    assert.equal(pending.job.status, 'pending_evidence');
    assert.equal(pending.job.fineEur, null);

    const resolved = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-pending',
            maxVelocityKmh: 100,
        },
        'tester'
    );

    assert.equal(resolved.updated, true);
    assert.equal(resolved.job.status, 'fine_assessed');
    assert.equal(resolved.job.fineEur, 500);

    // ============================================================
    // 5a. Fahrer- und Monatstrennung vorbereiten
    // ============================================================

    // Anderer Fahrer, gleicher Monat.
    const otherDriverJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-other-driver',
            discordUserId: 'discord-8',
            maxVelocityKmh: 110,
        },
        'tester'
    );

    assert.equal(otherDriverJob.created, true);
    assert.equal(otherDriverJob.job.billingMonth, '2026-11');

    // Gleicher Fahrer, anderer Monat.
    const otherMonthJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-other-month',
            completedAt: '2026-12-01T12:00:00+01:00',
            maxVelocityKmh: 120,
        },
        'tester'
    );

    assert.equal(otherMonthJob.created, true);
    assert.equal(otherMonthJob.job.billingMonth, '2026-12');

    // ============================================================
    // 6. Monatsrechnung erstellen
    // ============================================================

    const invoiceResult = store.createMonthlyInvoice(
        {
            guildId: 'guild-1',
            discordUserId: 'discord-7',
            month: '2026-11',
        },
        'tester'
    );

    assert.equal(invoiceResult.created, true);
    assert.equal(invoiceResult.invoice.status, 'draft');
    assert.equal(invoiceResult.invoice.totalEur, 1800);
    assert.equal(invoiceResult.invoice.lineItems.length, 2);

    const duplicateInvoice = store.createMonthlyInvoice({
        guildId: 'guild-1',
        discordUserId: 'discord-7',
        month: '2026-11',
    });

    assert.equal(duplicateInvoice.duplicate, true);

    // ============================================================
    // 6a. Fahrer- und Monatstrennung der Rechnungspositionen
    // ============================================================

    const novemberInvoice = store.listInvoices().find(
        invoice => invoice.id === 'guild-1:2026-11:discord-7'
    );

    assert.equal(novemberInvoice.lineItems.length, 2);

    assert.deepEqual(
        novemberInvoice.lineItems.map(item => item.taskId).sort(),
        ['task-100', 'task-pending'].sort()
    );

    assert.equal(
        novemberInvoice.lineItems.some(
            item => item.taskId === 'task-other-driver'
        ),
        false
    );

    assert.equal(
        novemberInvoice.lineItems.some(
            item => item.taskId === 'task-other-month'
        ),
        false
    );

    const otherDriverInvoice = store.createMonthlyInvoice({
        guildId: 'guild-1',
        discordUserId: 'discord-8',
        month: '2026-11',
    });

    assert.equal(otherDriverInvoice.created, true);
    assert.equal(otherDriverInvoice.invoice.lineItems.length, 1);
    assert.equal(
        otherDriverInvoice.invoice.lineItems[0].taskId,
        'task-other-driver'
    );

    const otherMonthInvoice = store.createMonthlyInvoice({
        guildId: 'guild-1',
        discordUserId: 'discord-7',
        month: '2026-12',
    });

    assert.equal(otherMonthInvoice.created, true);
    assert.equal(otherMonthInvoice.invoice.lineItems.length, 1);
    assert.equal(
        otherMonthInvoice.invoice.lineItems[0].taskId,
        'task-other-month'
    );

    // ============================================================
    // 7. Rechnungspositionen nach Fakturierung schützen
    // ============================================================

    const attemptedChange = store.recordCompletedJob(
        {
            ...base,
            maxVelocityKmh: 150,
        },
        'tester'
    );

    assert.equal(attemptedChange.duplicate, true);
    assert.equal(attemptedChange.job.fineEur, 1300);


    // ============================================================
    // 7a. Nachträglicher Auftrag aktualisiert Rechnungsentwurf
    // ============================================================

    const lateJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-after-invoice',
            maxVelocityKmh: 105,
        },
        'tester'
    );

    assert.equal(lateJob.created, true);
    assert.equal(lateJob.job.status, 'fine_assessed');
    assert.equal(
        lateJob.invoiceReconciliation.action,
        'added_to_draft'
    );

    assert.equal(
        lateJob.job.invoiceId,
        'guild-1:2026-11:discord-7'
    );

    assert.equal(lateJob.job.billingFollowUp, null);

    const updatedDraft = store.listInvoices({
        guildId: 'guild-1',
        month: '2026-11',
    }).find(invoice =>
        invoice.discordUserId === 'discord-7'
    );

    assert.equal(updatedDraft.status, 'draft');
    assert.equal(updatedDraft.lineItems.length, 3);
    assert.equal(updatedDraft.totalEur, 2800);

    assert.equal(
        updatedDraft.lineItems.some(
            item => item.taskId === 'task-after-invoice'
        ),
        true
    );

    // Wiederholte Erfassung darf keine zweite Rechnungsposition erzeugen.
    const duplicateLateJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-after-invoice',
            maxVelocityKmh: 105,
        },
        'tester'
    );

    assert.equal(duplicateLateJob.duplicate, true);
    assert.equal(
        store.listInvoices({
            guildId: 'guild-1',
            month: '2026-11',
        }).find(invoice =>
            invoice.discordUserId === 'discord-7'
        ).lineItems.length,
        3
    );


    // ============================================================
    // 8. Versandversuch und 14-Tage-Frist
    // ============================================================

    const sentAt = new Date('2026-12-01T12:00:00Z');

    const sent = store.recordInvoiceSendAttempt(
        invoiceResult.invoice.id,
        sentAt,
        'failed',
        'billing-staff'
    );

    assert.equal(sent.status, 'sent');

    // Nachträglicher Auftrag darf eine versendete Rechnung nicht verändern.
    const sentInvoiceBeforeLateJob = store.listInvoices({
        guildId: 'guild-1',
        month: '2026-11',
    }).find(invoice => invoice.id === invoiceResult.invoice.id);

    const sentLateJob = store.recordCompletedJob({
        guildId: 'guild-1',
        taskId: 'task-after-sent-invoice',
        spedvUserId: 'spedv-7',
        discordUserId: 'discord-7',
        completedAt: '2026-11-20T12:00:00.000Z',
        maxVelocityKmh: 108,
    }, 'tester');

    assert.equal(sentLateJob.created, true);
    assert.equal(sentLateJob.job.status, 'fine_assessed');
    assert.equal(sentLateJob.job.invoiceId, null);
    assert.equal(sentLateJob.job.billingFollowUp.status, 'open');
    assert.equal(
        sentLateJob.job.billingFollowUp.invoiceId,
        invoiceResult.invoice.id
    );

    const sentInvoiceAfterLateJob = store.listInvoices({
        guildId: 'guild-1',
        month: '2026-11',
    }).find(invoice => invoice.id === invoiceResult.invoice.id);

    assert.deepEqual(
        sentInvoiceAfterLateJob,
        sentInvoiceBeforeLateJob
    );
    assert.equal(
        sent.dueAt,
        new Date(
            sentAt.getTime() + 14 * 24 * 60 * 60 * 1000
        ).toISOString()
    );

    // ============================================================
    // 9. Wiederholter Versand darf Frist nicht zurücksetzen
    // ============================================================

    const originalAttempt = sent.sendAttemptAt;
    const originalDueAt = sent.dueAt;

    const retryAt = new Date('2026-12-05T12:00:00Z');

    const retried = store.recordInvoiceSendAttempt(
        invoiceResult.invoice.id,
        retryAt,
        'delivered',
        'billing-staff'
    );

    assert.equal(retried.sendAttemptAt, originalAttempt);
    assert.equal(retried.dueAt, originalDueAt);
    assert.equal(retried.delivery, 'delivered');

    // ============================================================
    // 10. Zahlungsbestätigung und Berechtigungen
    // ============================================================

    assert.throws(
        () => store.markInvoicePaid(
            invoiceResult.invoice.id,
            'unauthorized',
            ['role-no'],
            ['role-allowed']
        ),
        /Keine Berechtigung/
    );

    const paid = store.markInvoicePaid(
        invoiceResult.invoice.id,
        'billing-staff',
        ['role-allowed'],
        ['role-allowed']
    );

    assert.equal(paid.updated, true);
    assert.equal(paid.invoice.status, 'paid');
    
    // Nachträglicher Auftrag darf eine bezahlte Rechnung nicht verändern.
    const paidInvoiceBeforeLateJob = store.listInvoices({
        guildId: 'guild-1',
        month: '2026-11',
    }).find(invoice => invoice.id === invoiceResult.invoice.id);

    const paidLateJob = store.recordCompletedJob({
        guildId: 'guild-1',
        taskId: 'task-after-paid-invoice',
        spedvUserId: 'spedv-7',
        discordUserId: 'discord-7',
        completedAt: '2026-11-21T12:00:00.000Z',
        maxVelocityKmh: 110,
    }, 'tester');

    assert.equal(paidLateJob.created, true);
    assert.equal(paidLateJob.job.status, 'fine_assessed');
    assert.equal(paidLateJob.job.invoiceId, null);
    assert.equal(paidLateJob.job.billingFollowUp.status, 'open');
    assert.equal(
        paidLateJob.job.billingFollowUp.invoiceId,
        invoiceResult.invoice.id
    );

    const paidInvoiceAfterLateJob = store.listInvoices({
        guildId: 'guild-1',
        month: '2026-11',
    }).find(invoice => invoice.id === invoiceResult.invoice.id);

    assert.deepEqual(
        paidInvoiceAfterLateJob,
        paidInvoiceBeforeLateJob
    );

    const duplicatePayment = store.markInvoicePaid(
        invoiceResult.invoice.id,
        'billing-staff',
        ['role-allowed'],
        ['role-allowed']
    );

    assert.equal(duplicatePayment.duplicate, true);

    // ============================================================
    // 10a. Batch-Import bei versendeter Rechnung
    // ============================================================

    const sentBatchDriver = 'discord-sent-batch';

    const sentBatchJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-sent-batch-initial',
            discordUserId: sentBatchDriver,
            maxVelocityKmh: 100,
        },
        'tester'
    );

    assert.equal(sentBatchJob.created, true);

    const sentBatchInvoiceResult = store.createMonthlyInvoice({
        guildId: 'guild-1',
        discordUserId: sentBatchDriver,
        month: '2026-11',
    });

    assert.equal(sentBatchInvoiceResult.created, true);

    const sentBatchInvoiceId = sentBatchInvoiceResult.invoice.id;

    store.recordInvoiceSendAttempt(
        sentBatchInvoiceId,
        new Date('2026-12-01T12:00:00Z'),
        'delivered',
        'billing-staff'
    );

    const sentBatchInvoiceBefore = store.listInvoices().find(
        invoice => invoice.id === sentBatchInvoiceId
    );

    const sentBatchResult = store.recordImportBatch(
        [{
            type: 'job',
            guildId: 'guild-1',
            taskId: 'task-sent-batch-late',
            spedvUserId: 'spedv-7',
            spedvName: 'Fahrer Sent Batch',
            discordUserId: sentBatchDriver,
            completedAt: '2026-11-22T12:00:00.000Z',
            maxVelocityKmh: 105,
            expectedStatus: 'fine_assessed',
            expectedExcessKmh: 10,
            expectedFineEur: 1000,
            evidenceSource: 'test-batch-telemetry',
        }],
        'tester'
    );

    assert.equal(sentBatchResult.failedCount, 0);
    assert.equal(sentBatchResult.createdCount, 1);
    assert.equal(
        sentBatchResult.results[0].invoiceReconciliation.action,
        'manual_follow_up'
    );

    const sentBatchLateJob = store.listJobs().find(
        job => job.taskId === 'task-sent-batch-late'
    );

    assert.equal(sentBatchLateJob.status, 'fine_assessed');
    assert.equal(sentBatchLateJob.invoiceId, null);
    assert.equal(sentBatchLateJob.billingFollowUp.status, 'open');
    assert.equal(
        sentBatchLateJob.billingFollowUp.invoiceId,
        sentBatchInvoiceId
    );

    const sentBatchInvoiceAfter = store.listInvoices().find(
        invoice => invoice.id === sentBatchInvoiceId
    );

    assert.deepEqual(
        sentBatchInvoiceAfter,
        sentBatchInvoiceBefore
    );

    assert.equal(
        store.listInvoices().filter(
            invoice =>
                invoice.guildId === 'guild-1' &&
                invoice.discordUserId === sentBatchDriver &&
                invoice.month === '2026-11'
        ).length,
        1
    );

    // ============================================================
    // 10b. Batch-Import bei bezahlter Rechnung
    // ============================================================

    const paidBatchDriver = 'discord-paid-batch';

    const paidBatchJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-paid-batch-initial',
            discordUserId: paidBatchDriver,
            maxVelocityKmh: 100,
        },
        'tester'
    );

    assert.equal(paidBatchJob.created, true);

    const paidBatchInvoiceResult = store.createMonthlyInvoice({
        guildId: 'guild-1',
        discordUserId: paidBatchDriver,
        month: '2026-11',
    });

    assert.equal(paidBatchInvoiceResult.created, true);

    const paidBatchInvoiceId = paidBatchInvoiceResult.invoice.id;

    store.recordInvoiceSendAttempt(
        paidBatchInvoiceId,
        new Date('2026-12-01T12:00:00Z'),
        'delivered',
        'billing-staff'
    );

    store.markInvoicePaid(
        paidBatchInvoiceId,
        'billing-staff',
        ['role-allowed'],
        ['role-allowed']
    );

    const paidBatchInvoiceBefore = store.listInvoices().find(
        invoice => invoice.id === paidBatchInvoiceId
    );

    const paidBatchResult = store.recordImportBatch(
        [{
            type: 'job',
            guildId: 'guild-1',
            taskId: 'task-paid-batch-late',
            spedvUserId: 'spedv-7',
            spedvName: 'Fahrer Paid Batch',
            discordUserId: paidBatchDriver,
            completedAt: '2026-11-23T12:00:00.000Z',
            maxVelocityKmh: 110,
            expectedStatus: 'fine_assessed',
            expectedExcessKmh: 15,
            expectedFineEur: 1500,
            evidenceSource: 'test-batch-telemetry',
        }],
        'tester'
    );

    assert.equal(paidBatchResult.failedCount, 0);
    assert.equal(paidBatchResult.createdCount, 1);
    assert.equal(
        paidBatchResult.results[0].invoiceReconciliation.action,
        'manual_follow_up'
    );

    const paidBatchLateJob = store.listJobs().find(
        job => job.taskId === 'task-paid-batch-late'
    );

    assert.equal(paidBatchLateJob.status, 'fine_assessed');
    assert.equal(paidBatchLateJob.invoiceId, null);
    assert.equal(paidBatchLateJob.billingFollowUp.status, 'open');
    assert.equal(
        paidBatchLateJob.billingFollowUp.invoiceId,
        paidBatchInvoiceId
    );

    const paidBatchInvoiceAfter = store.listInvoices().find(
        invoice => invoice.id === paidBatchInvoiceId
    );

    assert.deepEqual(
        paidBatchInvoiceAfter,
        paidBatchInvoiceBefore
    );

    assert.equal(
        store.listInvoices().filter(
            invoice =>
                invoice.guildId === 'guild-1' &&
                invoice.discordUserId === paidBatchDriver &&
                invoice.month === '2026-11'
        ).length,
        1
    );

    console.log(
        'OK: Batch-Import verändert versendete und bezahlte Rechnungen nicht.'
    );

    // ============================================================
    // 11. Überfällige Rechnung
    // ============================================================

    const overdueJob = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-overdue',
            discordUserId: 'discord-overdue',
            maxVelocityKmh: 96,
        },
        'tester'
    );

    assert.equal(overdueJob.job.status, 'fine_assessed');
    assert.equal(overdueJob.job.fineEur, 100);

    const overdueInvoiceResult = store.createMonthlyInvoice(
        {
            guildId: 'guild-1',
            discordUserId: 'discord-overdue',
            month: '2026-11',
        },
        'tester'
    );

    const overdueInvoice = overdueInvoiceResult.invoice;

    const overdueSentAt = new Date('2026-12-01T12:00:00Z');

    const overdueSent = store.recordInvoiceSendAttempt(
        overdueInvoice.id,
        overdueSentAt,
        'delivered',
        'billing-staff'
    );

    const dueAt = new Date(overdueSent.dueAt);
    const afterDueAt = new Date(dueAt.getTime() + 1000);

    assert.equal(
        store.listOverdueInvoices(
            new Date(dueAt.getTime() - 1000)
        ).some(invoice => invoice.id === overdueInvoice.id),
        false
    );

    assert.equal(
        store.listOverdueInvoices(dueAt)
            .some(invoice => invoice.id === overdueInvoice.id),
        false
    );

    assert.throws(
        () => store.markInvoiceWarningSent(
            overdueInvoice.id,
            dueAt,
            'billing-staff'
        ),
        /Zahlungsfrist ist noch nicht abgelaufen/
    );

    assert.equal(
        store.listOverdueInvoices(afterDueAt)
            .some(invoice => invoice.id === overdueInvoice.id),
        true
    );

    const warning = store.markInvoiceWarningSent(
        overdueInvoice.id,
        afterDueAt,
        'billing-staff'
    );

    assert.equal(warning.updated, true);
    assert.equal(warning.duplicate, false);
    assert.equal(
        warning.invoice.warningSentAt,
        afterDueAt.toISOString()
    );

    const duplicateWarning = store.markInvoiceWarningSent(
        overdueInvoice.id,
        new Date(afterDueAt.getTime() + 60_000),
        'billing-staff'
    );

    assert.equal(duplicateWarning.updated, false);
    assert.equal(duplicateWarning.duplicate, true);

    assert.equal(
        store.listOverdueInvoices(
            new Date(afterDueAt.getTime() + 60_000)
        ).some(invoice => invoice.id === overdueInvoice.id),
        false
    );

    // ============================================================
    // 12. Rechnung ohne abrechenbare Verstöße verhindern
    // ============================================================

    assert.throws(
        () => store.createMonthlyInvoice({
            guildId: 'guild-1',
            discordUserId: 'discord-no-fines',
            month: '2026-11',
        }),
        /Keine abrechenbaren Verstöße/
    );

    // ============================================================
    // 13. Fehlende Nachweise sperren Monatsrechnung
    // ============================================================

    store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-open-evidence',
            discordUserId: 'discord-pending',
            maxVelocityKmh: null,
        },
        'tester'
    );

    assert.throws(
        () => store.createMonthlyInvoice({
            guildId: 'guild-1',
            discordUserId: 'discord-pending',
            month: '2026-11',
        }),
        /Nachweisprüfung/
    );

    // ============================================================
    // 13a. Harter Abrechnungsbeginn
    // ============================================================

    assert.throws(
        () => store.recordCompletedJob(
            {
                ...base,
                taskId: 'task-before-billing-start',
                completedAt: '2026-10-31T23:59:59+01:00',
                maxVelocityKmh: 120,
            },
            'tester'
        ),
        /Abrechnung gesperrt/
    );

    assert.throws(
        () => store.createMonthlyInvoice({
            guildId: 'guild-1',
            discordUserId: 'discord-7',
            month: '2026-10',
        }),
        /Abrechnung gesperrt/
    );

    // ============================================================
    // 13b. Geprüfter Auftrag ohne Verstoß wird dokumentiert
    // ============================================================

    const noViolation = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-no-violation',
            discordUserId: 'discord-no-violation',
            maxVelocityKmh: 95,
        },
        'tester'
    );

    assert.equal(noViolation.created, true);
    assert.equal(noViolation.job.status, 'no_violation');
    assert.equal(noViolation.job.fineEur, 0);

    assert.throws(
        () => store.createMonthlyInvoice({
            guildId: 'guild-1',
            discordUserId: 'discord-no-violation',
            month: '2026-11',
        }),
        /Keine abrechenbaren Verstöße/
    );

    // ============================================================
    // 13c. Spezifische manuelle Prüfstatus sperren Rechnungen
    // ============================================================

    const cleanedReview = store.recordCompletedJob(
        {
            ...base,
            taskId: 'task-cleaned-review',
            discordUserId: 'discord-cleaned-review',
            status: 'review_cleaned_telemetry',
            reviewReason: 'Telemetrie wurde bereinigt.',
            evidenceSource: 'SpedV-v1-drivedata',
        },
        'tester'
    );

    assert.equal(cleanedReview.created, true);
    assert.equal(
        cleanedReview.job.status,
        'review_cleaned_telemetry'
    );
    assert.equal(cleanedReview.job.fineEur, null);

    assert.throws(
        () => store.createMonthlyInvoice({
            guildId: 'guild-1',
            discordUserId: 'discord-cleaned-review',
            month: '2026-11',
        }),
        /manuelle Nachweisprüfung/
    );

    // ============================================================
    // 14. Beschädigte Datendatei darf nicht überschrieben werden
    // ============================================================

    fs.writeFileSync(
        process.env.HKC_BILLING_DATA_PATH,
        '{broken'
    );

    assert.throws(
        () => store.listJobs(),
        /nicht lesbar/
    );

    assert.equal(
        fs.readFileSync(
            process.env.HKC_BILLING_DATA_PATH,
            'utf8'
        ),
        '{broken'
    );

    console.log('OK: speed billing store tests passed');
} finally {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}
