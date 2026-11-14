'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore, StoreError } = require('../src/billing/store');

const NOW = new Date('2026-12-02T10:00:00Z'); // Oktober und November sind abgeschlossen
const DISCORD = '222222222222222222';
const USER = '169742';

function task(overrides = {}) {
    return {
        taskId: '1',
        visibleId: '#1',
        taskState: 2,
        speditionId: '108570',
        spedvUserId: USER,
        spedvName: 'hundekuchen',
        completedAt: '2026-11-15T17:00:00.000Z',
        billingMonth: '2026-11',
        outcome: 'fine',
        reason: null,
        message: '',
        evidence: { maxVelocityKmh: 100, excessKmh: 5, fineEur: 500 },
        ...overrides,
    };
}

const review = overrides => task({
    outcome: 'review',
    reason: 'speed_conflict',
    message: 'Widerspruch',
    evidence: null,
    ...overrides,
});

const october = { billingMonth: '2026-10', completedAt: '2026-10-15T17:00:00.000Z' };
const december = { billingMonth: '2026-12', completedAt: '2026-12-01T17:00:00.000Z' };

/** Oktober bezahlt, November versendet, Dezember offen, dazu ein zweiter Fahrer. */
function seed(store) {
    store.recordEvaluation(task({ taskId: '1', ...october }));
    const oct = store.createDraft({ month: '2026-10', spedvUserId: USER, actor: '1', now: NOW }).invoice.number;
    store.recordSendAttempt({ number: oct, discordId: DISCORD, actor: '1', now: NOW });
    store.markPaid({ number: oct, actor: '1', now: NOW });

    store.recordEvaluation(task({ taskId: '2' }));
    const nov = store.createDraft({ month: '2026-11', spedvUserId: USER, actor: '1', now: NOW }).invoice.number;
    store.recordSendAttempt({ number: nov, discordId: DISCORD, actor: '1', now: NOW });

    store.recordEvaluation(task({ taskId: '3', ...december }));
    store.recordEvaluation(review({ taskId: '4', ...december }));
    store.recordEvaluation(review({ taskId: '5', ...december }));
    store.decide({ taskId: '5', kind: 'assess', reason: 'Video zeigt 100 km/h', actor: '1', speedKmh: 100 });

    store.recordEvaluation(task({ taskId: '9', spedvUserId: '200', spedvName: 'zweiter' }));
    store.createDraft({ month: '2026-11', spedvUserId: '200', actor: '1', now: NOW });
}

test('Vorschau zeigt offene Rechnungen, Strafen und Prüffälle, verändert nichts', () => {
    const store = openStore({ file: ':memory:' });
    seed(store);

    const preview = store.previewDeparture(USER);
    assert.deepEqual(preview.openInvoices.map(invoice => [invoice.number, invoice.status]), [['HKC-2026-11-169742', 'sent']]);
    assert.deepEqual(preview.uninvoicedFines.map(fine => fine.taskId), ['3', '5']);
    assert.deepEqual(preview.openReviews.map(entry => entry.taskId), ['4']);
    assert.deepEqual(preview.paid, { count: 1, totalEur: 500 });
    assert.equal(preview.nothingToDo, false);

    assert.equal(store.getInvoice('HKC-2026-11-169742').status, 'sent');
    assert.equal(store.getEffective('3').effective_status, 'fine');
    store.close();
});

test('Austritt: storniert offene Rechnungen, erlässt Strafen, schließt Prüffälle, bezahlt bleibt', () => {
    const store = openStore({ file: ':memory:' });
    seed(store);

    const result = store.recordDeparture({ spedvUserId: USER, actor: '1', now: NOW });
    assert.deepEqual(result.voided, ['HKC-2026-11-169742']);
    assert.deepEqual(result.waived, ['2', '3', '5']);
    assert.deepEqual(result.dismissed, ['4']);

    // Bezahlt bleibt bezahlt, der Auftrag darin bleibt eine Strafe
    assert.equal(store.getInvoice('HKC-2026-10-169742').status, 'paid');
    assert.equal(store.getEffective('1').effective_status, 'fine');

    const voided = store.getInvoice('HKC-2026-11-169742');
    assert.equal(voided.status, 'void');
    assert.equal(voided.void_reason, 'Austritt aus der Spedition');

    for (const id of ['2', '3', '5']) {
        assert.equal(store.getEffective(id).effective_status, 'waived', id);
        assert.equal(store.getEffective(id).effective_fine_eur, 0, id);
    }
    assert.equal(store.getEffective('4').effective_status, 'dismissed');

    // Der andere Fahrer bleibt unberührt
    assert.equal(store.getInvoice('HKC-2026-11-200').status, 'draft');

    assert.ok(store.auditLog().some(entry => entry.action === 'driver_departed' && entry.subject === USER));
    store.close();
});

test('Nach dem Austritt entsteht kein neuer Entwurf', () => {
    const store = openStore({ file: ':memory:' });
    seed(store);
    store.recordDeparture({ spedvUserId: USER, actor: '1', now: NOW });

    const batch = store.createDraftsForMonth({ month: '2026-11', actor: '1', now: NOW });
    assert.equal(batch.created, 0);
    const active = store.listInvoices({ month: '2026-11', spedvUserId: USER }).filter(invoice => invoice.status !== 'void');
    assert.equal(active.length, 0);
    store.close();
});

test('Ein Entwurf wird ebenfalls storniert', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.createDraft({ month: '2026-11', spedvUserId: USER, actor: '1', now: NOW });

    const result = store.recordDeparture({ spedvUserId: USER, actor: '1', now: NOW });
    assert.deepEqual(result.voided, ['HKC-2026-11-169742']);
    assert.deepEqual(result.waived, ['1']);
    assert.equal(store.getInvoice('HKC-2026-11-169742').status, 'void');
    store.close();
});

test('Zweiter Aufruf ändert nichts', () => {
    const store = openStore({ file: ':memory:' });
    seed(store);
    store.recordDeparture({ spedvUserId: USER, actor: '1', now: NOW });

    const again = store.recordDeparture({ spedvUserId: USER, actor: '1', now: NOW });
    assert.deepEqual(again, { spedvUserId: USER, voided: [], waived: [], dismissed: [] });
    assert.equal(store.previewDeparture(USER).nothingToDo, true);
    store.close();
});

test('Ungültige Angaben werden abgelehnt, ohne etwas zu verändern', () => {
    const store = openStore({ file: ':memory:' });
    seed(store);

    assert.throws(() => store.recordDeparture({ spedvUserId: 'abc', actor: '1' }), StoreError);
    assert.throws(() => store.recordDeparture({ spedvUserId: USER, actor: '' }), StoreError);
    assert.throws(() => store.previewDeparture(null), StoreError);
    assert.equal(store.getInvoice('HKC-2026-11-169742').status, 'sent');
    store.close();
});
