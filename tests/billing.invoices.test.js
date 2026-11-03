'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore, StoreError } = require('../src/billing/store');

const NOW = new Date('2026-12-02T10:00:00Z'); // der November ist abgeschlossen
const DISCORD = '222222222222222222';

function task(overrides = {}) {
    return {
        taskId: '1',
        visibleId: "#1",
        taskState: 2,
        speditionId: '108570',
        spedvUserId: '169742',
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

const clear = overrides => task({ outcome: 'clear', evidence: { fineEur: 0 }, ...overrides });

const review = overrides => task({
    outcome: 'review',
    reason: 'speed_conflict',
    message: 'Widerspruch',
    evidence: null,
    ...overrides,
});

const draft = (store, user = '169742') =>
    store.createDraft({ month: '2026-11', spedvUserId: user, actor: '1', now: NOW });

test('Der Monat muss abgeschlossen und abrechenbar sein', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());

    assert.throws(
        () => store.createDraft({
            month: '2026-11', spedvUserId: '169742', actor: '1', now: new Date('2026-11-15T10:00:00Z'),
        }),
        StoreError
    );
    assert.throws(
        () => store.createDraft({ month: '2026-10', spedvUserId: '169742', actor: '1', now: NOW }),
        StoreError
    );
    assert.throws(() => store.createDraft({ month: 'x', spedvUserId: '1', actor: '1', now: NOW }), StoreError);
    store.close();
});

test('Entwurf nur für Fahrer mit Strafe, nur mit Strafaufträgen', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(clear({ taskId: '2' }));
    store.recordEvaluation(clear({ taskId: '3', spedvUserId: '200', spedvName: 'sauber' }));

    const none = draft(store, '200');
    assert.equal(none.created, false);
    assert.equal(none.reason, 'no_fines');

    const made = draft(store);
    assert.equal(made.created, true);
    assert.equal(made.invoice.number, 'HKC-2026-11-169742');
    assert.equal(made.invoice.status, 'draft');
    assert.equal(made.invoice.total_eur, 500);
    assert.equal(made.invoice.lines.length, 1);
    assert.equal(made.invoice.lines[0].task_id, '1');
    store.close();
});

test('Ein zweiter Aufruf erzeugt keine zweite Rechnung', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const first = draft(store);
    const second = draft(store);

    assert.equal(second.created, false);
    assert.equal(second.reason, 'exists');
    assert.equal(second.invoice.number, first.invoice.number);
    assert.equal(store.listInvoices({ month: '2026-11' }).length, 1);
    store.close();
});

test('Ein offener Prüffall blockiert nur den betroffenen Fahrer', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(review({ taskId: '9' }));
    store.recordEvaluation(task({ taskId: '2', spedvUserId: '200', spedvName: 'andere' }));

    const blocked = draft(store);
    assert.equal(blocked.reason, 'blocked');
    assert.deepEqual(blocked.blockers, ['9']);
    assert.equal(draft(store, '200').created, true);

    store.decide({ taskId: '9', kind: 'dismiss', reason: 'Beleg geprüft', actor: '1' });
    assert.equal(draft(store).created, true);
    store.close();
});

test('Ein Prüffall ohne Monat blockiert alle Fahrer', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    store.recordEvaluation(review({
        taskId: '8', spedvUserId: '300', billingMonth: null, completedAt: null,
        reason: 'missing_completion_time',
    }));

    assert.equal(draft(store).reason, 'blocked');
    store.decide({ taskId: '8', kind: 'dismiss', reason: 'Alter Auftrag, geklärt', actor: '1' });
    assert.equal(draft(store).created, true);
    store.close();
});

test('Genehmigte Ausnahmen verringern die Rechnung oder verhindern sie', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(task({ taskId: '2', evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));
    store.decide({ taskId: '2', kind: 'waive', reason: 'Genehmigte Ausnahme', actor: '1' });

    const made = draft(store);
    assert.equal(made.invoice.total_eur, 500);
    assert.equal(made.invoice.lines.length, 1);

    const only = openStore({ file: ':memory:' });
    only.recordEvaluation(task());
    only.decide({ taskId: '1', kind: 'waive', reason: 'Genehmigte Ausnahme', actor: '1' });
    assert.equal(draft(only).reason, 'no_fines');
    store.close();
    only.close();
});

test('Festgesetzte Strafe: Rechnungszeile zeigt die festgestellte Geschwindigkeit', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(review({ taskId: '5' }));
    store.decide({ taskId: '5', kind: 'assess', reason: 'Video zeigt 100 km/h', actor: '1', speedKmh: 100 });

    const made = draft(store);
    assert.equal(made.invoice.total_eur, 500);
    assert.equal(made.invoice.lines[0].max_velocity_kmh, 100);
    assert.equal(made.invoice.lines[0].excess_kmh, 5);

    // Festgesetzt auf 90 km/h = kein Verstoß, keine Rechnung
    const zero = openStore({ file: ':memory:' });
    zero.recordEvaluation(review({ taskId: '5' }));
    zero.decide({ taskId: '5', kind: 'assess', reason: 'Video zeigt 90 km/h', actor: '1', speedKmh: 90 });
    assert.equal(draft(zero).reason, 'no_fines');
    store.close();
    zero.close();
});

test('Auftrag in der Rechnung ist gesperrt: Entscheidung, Widerruf und Neubewertung', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(review({ taskId: '5' }));
    store.decide({ taskId: '5', kind: 'assess', reason: 'Video zeigt 100 km/h', actor: '1', speedKmh: 100 });
    draft(store);

    assert.throws(
        () => store.decide({ taskId: '1', kind: 'waive', reason: 'zu spät', actor: '1' }),
        error => error instanceof StoreError && /Rechnung/.test(error.message)
    );
    assert.throws(
        () => store.revokeDecision({ taskId: '5', reason: 'zu spät', actor: '1' }),
        error => error instanceof StoreError && /Rechnung/.test(error.message)
    );
    assert.throws(
        () => store.reopenTask({ taskId: '1', reason: 'state_changed', message: 'Status geändert', actor: '1' }),
        error => error instanceof StoreError && /Rechnung/.test(error.message)
    );
    store.close();
});

test('Nachzügler: im Entwurf ergänzt, bei versendeter Rechnung gemeldet', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    const first = draft(store);

    store.recordEvaluation(task({ taskId: '7', evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));
    const updated = draft(store);
    assert.equal(updated.updated, true);
    assert.equal(updated.invoice.total_eur, 600);
    assert.equal(updated.invoice.lines.length, 2);

    store.recordSendAttempt({ number: first.invoice.number, discordId: DISCORD, actor: '1', now: NOW });
    store.recordEvaluation(task({ taskId: '8', evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));

    const late = draft(store);
    assert.equal(late.reason, 'exists_late_fines');
    assert.deepEqual(late.lateTaskIds, ['8']);
    assert.equal(late.invoice.total_eur, 600);
    store.close();
});

test('Entwürfe für alle Fahrer eines Monats', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(task({ taskId: '2', spedvUserId: '200', spedvName: 'zweiter' }));
    store.recordEvaluation(clear({ taskId: '3', spedvUserId: '300', spedvName: 'sauber' }));
    store.recordEvaluation(task({ taskId: '4', spedvUserId: '400', spedvName: 'blockiert' }));
    store.recordEvaluation(review({ taskId: '5', spedvUserId: '400', spedvName: 'blockiert' }));

    const batch = store.createDraftsForMonth({ month: '2026-11', actor: '1', now: NOW });
    assert.equal(batch.created, 2);
    assert.equal(batch.blocked, 1);
    assert.equal(batch.results.length, 3);

    const again = store.createDraftsForMonth({ month: '2026-11', actor: '1', now: NOW });
    assert.equal(again.created, 0);
    assert.equal(again.blocked, 1);
    store.close();
});

test('Versand setzt die Frist auf 14 Tage ab dem ersten Versandversuch', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;

    const sent = store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.delivery, 'pending');
    assert.equal(sent.discord_id, DISCORD);
    assert.equal(sent.due_at, '2026-12-16T10:00:00.000Z');

    // Solange das Ergebnis offen ist und nach Zustellung ist kein zweiter Versand erlaubt
    assert.throws(
        () => store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW }),
        StoreError
    );
    store.recordDeliveryResult({ number, delivery: 'delivered', actor: '1' });
    assert.throws(
        () => store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW }),
        StoreError
    );
    assert.throws(() => store.recordDeliveryResult({ number, delivery: 'failed', actor: '1' }), StoreError);
    store.close();
});

test('Ungültiger Empfänger und unbekannte Rechnung werden abgelehnt', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;

    assert.throws(
        () => store.recordSendAttempt({ number, discordId: '123', actor: '1', now: NOW }),
        StoreError
    );
    assert.throws(
        () => store.recordSendAttempt({ number: 'HKC-0', discordId: DISCORD, actor: '1', now: NOW }),
        StoreError
    );
    assert.equal(store.getInvoice('HKC-0'), null);
    store.close();
});

test('Nach fehlgeschlagener DM: neuer Versuch mit unveränderter Frist, Hinweis nur einmal', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;

    store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });
    assert.throws(
        () => store.recordFallbackAttempt({ number, channelId: '1560300974185123840', actor: '1' }),
        StoreError
    );

    store.recordDeliveryResult({ number, delivery: 'failed', actor: '1' });
    store.recordFallbackAttempt({ number, channelId: '1560300974185123840', actor: '1' });
    assert.throws(
        () => store.recordFallbackAttempt({ number, channelId: '1560300974185123840', actor: '1' }),
        StoreError
    );
    const done = store.recordFallbackResult({ number, status: 'sent', messageId: '42', actor: '1' });
    assert.equal(done.fallback_status, 'sent');
    assert.equal(done.fallback_message_id, '42');

    const retry = store.recordSendAttempt({
        number, discordId: DISCORD, actor: '1', now: new Date('2026-12-03T10:00:00Z'),
    });
    assert.equal(retry.delivery, 'pending');
    assert.equal(retry.due_at, '2026-12-16T10:00:00.000Z');
    store.close();
});

test('Genau eine Erinnerung nach Fristende', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;
    store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });
    store.recordDeliveryResult({ number, delivery: 'delivered', actor: '1' });

    assert.equal(store.listDueForReminder(new Date('2026-12-16T09:59:59Z')).length, 0);
    assert.throws(
        () => store.recordReminder({ number, delivery: 'delivered', actor: '1', now: new Date('2026-12-16T09:59:59Z') }),
        StoreError
    );

    const due = store.listDueForReminder(new Date('2026-12-16T10:00:01Z'));
    assert.equal(due.length, 1);
    assert.equal(due[0].number, number);

    const reminded = store.recordReminder({
        number, delivery: 'delivered', actor: '1', now: new Date('2026-12-16T10:00:01Z'),
    });
    assert.equal(reminded.reminder_delivery, 'delivered');
    assert.equal(store.listDueForReminder(new Date('2026-12-30T10:00:00Z')).length, 0);
    assert.throws(
        () => store.recordReminder({ number, delivery: 'delivered', actor: '1', now: new Date('2026-12-17T10:00:00Z') }),
        StoreError
    );
    store.close();
});

test('Bezahlte Rechnungen bekommen keine Erinnerung', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;
    store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });
    store.markPaid({ number, actor: '1', now: new Date('2026-12-05T10:00:00Z') });

    assert.equal(store.listDueForReminder(new Date('2027-01-31T10:00:00Z')).length, 0);
    store.close();
});

test('Zahlung nur für versendete Rechnungen, wiederholbar ohne Wirkung', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;

    assert.throws(() => store.markPaid({ number, actor: '1' }), StoreError);

    store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });
    const paid = store.markPaid({ number, actor: '7', now: new Date('2026-12-05T10:00:00Z') });
    assert.equal(paid.updated, true);
    assert.equal(paid.invoice.status, 'paid');
    assert.equal(paid.invoice.paid_by, '7');

    const again = store.markPaid({ number, actor: '8' });
    assert.equal(again.updated, false);
    assert.equal(again.invoice.paid_by, '7');
    store.close();
});

test('Storno gibt die Aufträge frei, eine neue Rechnung bekommt eine neue Nummer', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    const first = draft(store).invoice;

    assert.throws(() => store.voidInvoice({ number: first.number, reason: '', actor: '1' }), StoreError);

    const voided = store.voidInvoice({ number: first.number, reason: 'Ausnahme nachträglich erteilt', actor: '1' });
    assert.equal(voided.status, 'void');
    assert.throws(
        () => store.voidInvoice({ number: first.number, reason: 'doppelt', actor: '1' }),
        StoreError
    );

    // Der Auftrag ist wieder frei: Entscheidung möglich, danach keine Strafe mehr offen
    store.decide({ taskId: '1', kind: 'waive', reason: 'Ausnahme nachträglich erteilt', actor: '1' });
    assert.equal(draft(store).reason, 'no_fines');

    // Ohne Ausnahme entsteht eine neue Rechnung mit Revisionsnummer
    const other = openStore({ file: ':memory:' });
    other.recordEvaluation(task({ taskId: '1' }));
    const a = draft(other).invoice;
    other.voidInvoice({ number: a.number, reason: 'Testweise storniert', actor: '1' });
    const b = draft(other).invoice;
    assert.equal(b.number, 'HKC-2026-11-169742-2');
    store.close();
    other.close();
});

test('Bezahlte Rechnungen lassen sich nicht stornieren, versendete schon', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task());
    const { number } = draft(store).invoice;
    store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });

    const sentVoid = openStore({ file: ':memory:' });
    sentVoid.recordEvaluation(task());
    const second = draft(sentVoid).invoice.number;
    sentVoid.recordSendAttempt({ number: second, discordId: DISCORD, actor: '1', now: NOW });
    assert.equal(
        sentVoid.voidInvoice({ number: second, reason: 'Irrtum bei der Auswertung', actor: '1' }).status,
        'void'
    );

    store.markPaid({ number, actor: '1' });
    assert.throws(
        () => store.voidInvoice({ number, reason: 'zu spät', actor: '1' }),
        StoreError
    );
    store.close();
    sentVoid.close();
});

test('Statusänderung nach der Auswertung: Auftrag wird wieder zum Prüffall und blockiert', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));

    const result = store.reopenTask({
        taskId: '1', reason: 'state_changed', message: 'Status ist jetzt Cancelled', actor: 'system',
    });
    assert.equal(result.action, 'reopened');
    assert.equal(store.getEffective('1').effective_status, 'open_review');
    assert.equal(store.getEffective('1').effective_fine_eur, 0);
    assert.equal(draft(store).reason, 'blocked');

    assert.equal(
        store.reopenTask({ taskId: '1', reason: 'state_changed', message: 'nochmal', actor: 'system' }).action,
        'unchanged'
    );
    store.close();
});

test('Rechnungen lassen sich nach Monat, Status und Fahrer filtern', () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(task({ taskId: '1' }));
    store.recordEvaluation(task({ taskId: '2', spedvUserId: '200', spedvName: 'zweiter' }));
    store.createDraftsForMonth({ month: '2026-11', actor: '1', now: NOW });
    const { number } = store.getInvoice('HKC-2026-11-200');
    store.recordSendAttempt({ number, discordId: DISCORD, actor: '1', now: NOW });

    assert.equal(store.listInvoices({ month: '2026-11' }).length, 2);
    assert.equal(store.listInvoices({ status: 'sent' }).length, 1);
    assert.equal(store.listInvoices({ spedvUserId: '169742' }).length, 1);
    assert.equal(store.listInvoices({ month: '2026-12' }).length, 0);
    assert.throws(() => store.listInvoices({ status: 'egal' }), StoreError);
    store.close();
});
