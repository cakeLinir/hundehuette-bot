
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-billing-timezones-')
);

process.env.HKC_BILLING_DATA_PATH = path.join(
    tempDir,
    'speedBilling.json'
);

const store = require('../src/utils/speedBillingStore');

const cases = [
    {
        name: 'Normalfall',
        attemptedAt: '2026-11-01T10:00:00.000Z',
        expectedDueAt: '2026-11-15T10:00:00.000Z',
        expectedHours: 336,
    },
    {
        name: 'Beginn Sommerzeit',
        attemptedAt: '2027-03-20T12:00:00.000Z',
        expectedDueAt: '2027-04-03T11:00:00.000Z',
        expectedHours: 335,
    },
    {
        name: 'Ende Sommerzeit',
        attemptedAt: '2027-10-24T12:00:00.000Z',
        expectedDueAt: '2027-11-07T13:00:00.000Z',
        expectedHours: 337,
    },
    {
        name: 'Nicht existente Zielzeit im Frühjahr',
        attemptedAt: '2027-03-14T01:30:00.000Z',
        expectedDueAt: '2027-03-28T01:30:00.000Z',
        expectedHours: 336,
    },
];

function createTestInvoice(index, attemptedAt, deliveryResult = 'delivered') {
    const guildId = `test-guild-${index}`;
    const discordUserId = `test-driver-${index}`;

    store.recordCompletedJob({
        guildId,
        taskId: `test-task-${index}`,
        spedvUserId: `test-spedv-${index}`,
        discordUserId,
        completedAt: '2026-11-03T12:00:00.000Z',
        maxVelocityKmh: 100,
    });

    const result = store.createMonthlyInvoice({
        guildId,
        discordUserId,
        month: '2026-11',
    });

    assert.equal(result.created, true);

    const invoiceId = result.invoice.id;

    store.recordInvoiceSendAttempt(
        invoiceId,
        attemptedAt,
        'pending'
    );

    store.recordInvoiceDeliveryResult(
        invoiceId,
        deliveryResult
    );

    return invoiceId;
}

try {
    console.log('=== Speed Billing Zeitzonentests ===');

    for (let i = 0; i < cases.length; i += 1) {
        const testCase = cases[i];

        const invoiceId = createTestInvoice(
            i + 1,
            testCase.attemptedAt
        );

        const invoice = store.listInvoices({
            status: 'sent',
        }).find(item => item.id === invoiceId);

        assert.ok(invoice, `${testCase.name}: Rechnung fehlt`);

        assert.equal(
            invoice.dueAt,
            testCase.expectedDueAt,
            `${testCase.name}: falsches Fälligkeitsdatum`
        );

        const elapsedHours = (
            new Date(invoice.dueAt).getTime() -
            new Date(invoice.sendAttemptAt).getTime()
        ) / (60 * 60 * 1000);

        assert.equal(
            elapsedHours,
            testCase.expectedHours,
            `${testCase.name}: falsche verstrichene Stunden`
        );

        console.log(
            `OK: ${testCase.name} – ${invoice.dueAt} (${elapsedHours} h)`
        );
    }

    // Wiederholter Versand darf die ursprüngliche Frist nicht ändern.
    // Die Rechnung wird zunächst mit fehlgeschlagener Zustellung erstellt.
    const retryInvoiceId = createTestInvoice(
        99,
        '2026-11-01T10:00:00.000Z',
        'failed'
    );

    const beforeRetry = store.listInvoices().find(
        item => item.id === retryInvoiceId
    );

    assert.ok(beforeRetry, 'Rechnung für Wiederholungsversand fehlt');

    assert.equal(
        beforeRetry.delivery,
        'failed',
        'Erster Zustellversuch muss fehlgeschlagen sein'
    );

    const originalSendAttemptAt = beforeRetry.sendAttemptAt;
    const originalDueAt = beforeRetry.dueAt;

    // Erneuter Versand nach fehlgeschlagener Zustellung.
    store.recordInvoiceSendAttempt(
        retryInvoiceId,
        '2026-11-05T10:00:00.000Z',
        'pending'
    );

    // Erneute Zustellung ist erfolgreich.
    store.recordInvoiceDeliveryResult(
        retryInvoiceId,
        'delivered'
    );

    const afterRetry = store.listInvoices().find(
        item => item.id === retryInvoiceId
    );

    assert.ok(afterRetry, 'Rechnung nach Wiederholungsversand fehlt');

    assert.equal(
        afterRetry.delivery,
        'delivered',
        'Erneuter Zustellversuch muss erfolgreich sein'
    );

    assert.equal(
        afterRetry.sendAttemptAt,
        originalSendAttemptAt,
        'Ursprünglicher Versandzeitpunkt darf sich nicht ändern'
    );

    assert.equal(
        afterRetry.dueAt,
        originalDueAt,
        'Ursprüngliche Zahlungsfrist darf sich nicht ändern'
    );

    console.log('OK: Wiederholter Versand verändert die Frist nicht');

    // Überfälligkeit erst nach Ablauf des exakten Fälligkeitszeitpunkts.
    const dueAt = new Date(originalDueAt);

    const overdueBefore = store.listOverdueInvoices(
        new Date(dueAt.getTime() - 1)
    );

    const overdueAt = store.listOverdueInvoices(dueAt);

    const overdueAfter = store.listOverdueInvoices(
        new Date(dueAt.getTime() + 1)
    );

    assert.equal(
        overdueBefore.some(item => item.id === retryInvoiceId),
        false
    );

    assert.equal(
        overdueAt.some(item => item.id === retryInvoiceId),
        false
    );

    assert.equal(
        overdueAfter.some(item => item.id === retryInvoiceId),
        true
    );

    console.log('OK: Überfälligkeit wird erst nach Fristablauf erkannt');

    console.log('\nAlle Zeitzonentests erfolgreich.');
} finally {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true,
    });
}
