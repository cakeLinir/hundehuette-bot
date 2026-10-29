'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkc-speed-billing-'));
process.env.HKC_BILLING_DATA_PATH = path.join(tempDir, 'speedBilling.json');
const store = require('../src/utils/speedBillingStore');

try {
    assert.deepEqual(store.calculateFine(95), { status: 'no_violation', provenMaxKmh: 95, excessKmh: 0, fineEur: 0 });
    assert.equal(store.calculateFine(96).fineEur, 100);
    assert.equal(store.calculateFine(108).fineEur, 1300);
    assert.equal(store.calculateFine(null).status, 'pending_evidence');
    assert.throws(() => store.calculateFine(-1), /nichtnegative/);

    const base = {
        guildId: 'guild-1', taskId: 'task-100', spedvUserId: 'spedv-7', discordUserId: 'discord-7',
        completedAt: '2026-11-01T00:30:00+01:00', evidenceSource: 'test-fixture',
    };
    const first = store.recordCompletedJob({ ...base, maxVelocityKmh: 108 }, 'tester');
    assert.equal(first.created, true);
    assert.equal(first.job.billingMonth, '2026-11');
    assert.equal(first.job.fineEur, 1300);
    const duplicate = store.recordCompletedJob({ ...base, maxVelocityKmh: 130 }, 'tester');
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.job.fineEur, 1300, 'same task must not create or replace a second fine');

    const pending = store.recordCompletedJob({ ...base, taskId: 'task-pending', maxVelocityKmh: null }, 'tester');
    assert.equal(pending.job.status, 'pending_evidence');
    assert.equal(pending.job.fineEur, null, 'missing evidence must not produce a fine');
    const resolved = store.recordCompletedJob({ ...base, taskId: 'task-pending', maxVelocityKmh: 100 }, 'tester');
    assert.equal(resolved.updated, true);
    assert.equal(resolved.job.fineEur, 500);

    const invoiceResult = store.createMonthlyInvoice({ guildId: 'guild-1', discordUserId: 'discord-7', month: '2026-11' }, 'tester');
    assert.equal(invoiceResult.invoice.status, 'draft');
    assert.equal(invoiceResult.invoice.totalEur, 1800);
    assert.equal(invoiceResult.invoice.lineItems.length, 2);
    assert.equal(store.createMonthlyInvoice({ guildId: 'guild-1', discordUserId: 'discord-7', month: '2026-11' }).duplicate, true);

    const sentAt = new Date('2026-12-01T12:00:00Z');
    const sent = store.recordInvoiceSendAttempt(invoiceResult.invoice.id, sentAt, 'failed', 'billing-staff');
    assert.equal(sent.delivery, 'failed');
    assert.equal(sent.dueAt, new Date(sentAt.getTime() + 14 * 86400000).toISOString());
    const retryAt = new Date('2026-12-05T12:00:00Z');
    const retried = store.recordInvoiceSendAttempt(invoiceResult.invoice.id, retryAt, 'delivered', 'billing-staff');
    assert.equal(retried.sendAttemptAt, sent.sendAttemptAt, 'retry must not reset first send-attempt timestamp');
    assert.equal(retried.dueAt, sent.dueAt, 'retry must not extend the original 14-day deadline');
    assert.throws(() => store.markInvoicePaid(invoiceResult.invoice.id, 'unauthorized', ['role-no'], ['role-allowed']), /Keine Berechtigung/);
    const paid = store.markInvoicePaid(invoiceResult.invoice.id, 'billing-staff', ['role-allowed'], ['role-allowed']);
    assert.equal(paid.invoice.status, 'paid');
    assert.equal(store.markInvoicePaid(invoiceResult.invoice.id, 'billing-staff', ['role-allowed'], ['role-allowed']).duplicate, true);

    // Corrupt files must be preserved, not silently replaced.
    fs.writeFileSync(process.env.HKC_BILLING_DATA_PATH, '{broken');
    assert.throws(() => store.listJobs(), /nicht lesbar/);
    assert.equal(fs.readFileSync(process.env.HKC_BILLING_DATA_PATH, 'utf8'), '{broken');

    console.log('OK: speed billing store tests passed');
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
