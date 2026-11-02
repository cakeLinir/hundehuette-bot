'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Ausschließlich temporäre Testdaten verwenden.
const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speedbilling-test-')
);

const dataPath = path.join(tempDir, 'speedBilling.json');

// Wichtig: vor dem Laden des Stores setzen.
process.env.HKC_BILLING_DATA_PATH = dataPath;

const store = require('../src/utils/speedBillingStore');

const GUILD_ID = 'guild-test-001';
const MONTH = '2026-11';

const DRIVER_A = 'discord-am8ne';
const DRIVER_B = 'discord-hundekuchen';

function makeJob(taskId, discordUserId) {
    return {
        guildId: GUILD_ID,
        taskId,
        discordUserId,
        billingMonth: MONTH,
        status: 'fine_assessed',
        invoiceId: null,
        completedAt: '2026-11-01T12:00:00.000Z',
        maxVelocityKmh: 96,
        excessKmh: 1,
        fineEur: 100
    };
}

function writeSeed(reviewCases = {}) {
    const seed = {
        version: 1,
        jobs: {
            'job-am8ne': makeJob('task-am8ne', DRIVER_A),
            'job-hundekuchen': makeJob('task-hundekuchen', DRIVER_B)
        },
        invoices: {},
        reviewCases,
        audit: []
    };

    fs.writeFileSync(
        dataPath,
        JSON.stringify(seed, null, 2),
        'utf8'
    );
}

function createInvoice(discordUserId) {
    return store.createMonthlyInvoice({
        guildId: GUILD_ID,
        discordUserId,
        month: MONTH
    });
}

function expectBlocked(discordUserId) {
    assert.throws(
        () => createInvoice(discordUserId),
        /Rechnung gesperrt/i,
        `Die Rechnung von ${discordUserId} hätte blockiert werden müssen.`
    );
}

function expectAllowed(discordUserId) {
    assert.doesNotThrow(
        () => createInvoice(discordUserId),
        `Die Rechnung von ${discordUserId} hätte erstellt werden dürfen.`
    );
}

test('Prüffälle blockieren nur die vorgesehenen Rechnungen', async (t) => {

    await t.test(
        'Monatlicher Prüffall ohne Discord-ID blockiert keine anderen Fahrer',
        () => {
            writeSeed({
                'review-manfred': {
                    guildId: GUILD_ID,
                    taskId: 'task-manfred',
                    billingMonth: MONTH,
                    discordUserId: null,
                    status: 'review_unverified_driver_link',
                    globalBlock: false
                }
            });

            // Beide anderen Fahrer müssen abrechnen können.
            expectAllowed(DRIVER_A);
            expectAllowed(DRIVER_B);

            // Der Prüffall muss weiterhin vorhanden und offen sein.
            const savedData = JSON.parse(
                fs.readFileSync(dataPath, 'utf8')
            );

            assert.ok(
                savedData.reviewCases['review-manfred'],
                'Manfreds Prüffall darf nicht gelöscht werden.'
            );

            assert.notEqual(
                savedData.reviewCases['review-manfred'].status,
                'resolved',
                'Manfreds Prüffall darf nicht automatisch geschlossen werden.'
            );
        }
    );

    await t.test(
        'Prüffall mit Discord-ID blockiert nur den zugeordneten Fahrer',
        () => {
            writeSeed({
                'review-am8ne': {
                    guildId: GUILD_ID,
                    taskId: 'task-am8ne-review',
                    billingMonth: MONTH,
                    discordUserId: DRIVER_A,
                    status: 'review_open',
                    globalBlock: false
                }
            });

            // Am8ne ist betroffen.
            expectBlocked(DRIVER_A);

            // Der andere Fahrer darf weiterhin abrechnen.
            expectAllowed(DRIVER_B);
        }
    );

    await t.test(
        'Globaler Prüffall blockiert alle Fahrer',
        () => {
            writeSeed({
                'review-global': {
                    guildId: GUILD_ID,
                    taskId: 'task-global',
                    billingMonth: null,
                    discordUserId: null,
                    status: 'review_global',
                    globalBlock: true
                }
            });

            expectBlocked(DRIVER_A);
            expectBlocked(DRIVER_B);
        }
    );
});

test.after(() => {
    fs.rmSync(tempDir, {
        recursive: true,
        force: true
    });
});