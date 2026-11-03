'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore, StoreError } = require('../src/billing/store');
const { loadBillingConfig } = require('../src/billing/config');
const { sendInvoice, sendReminder } = require('../src/billing/sender');
const { buildInvoiceMessages } = require('../src/billing/invoiceMessage');

const NOW = new Date('2026-12-02T10:00:00Z');
const DISCORD = '222222222222222222';
const CONFIG = {
    iban: 'SP15910353380000377272',
    fallbackChannelId: '1560300974185123840',
    purposePrefix: 'Strafzahlung',
};
const NO_LOGO = 'gibt-es-nicht.png';
const findLink = id => (id === '169742' ? { verified: true, discordId: DISCORD } : null);

const nbsp = text => String(text).replace(/\u00a0/g, ' ');

function fine(taskId, overrides = {}) {
    return {
        taskId,
        visibleId: `#${taskId}`,
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

function setup() {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(fine('1'));
    const { invoice } = store.createDraft({ month: '2026-11', spedvUserId: '169742', actor: '1', now: NOW });
    return { store, number: invoice.number };
}

function fakeMember(behavior = 'ok') {
    const member = {
        sent: [],
        async send(payload) {
            if (behavior === 'closed') {
                const error = new Error('Cannot send messages to this user');
                error.code = 50007;
                throw error;
            }
            if (behavior === 'broken') throw new Error('Netzwerkfehler');
            member.sent.push(payload);
            return { id: `dm${member.sent.length}` };
        },
    };
    return member;
}

function fakeChannel() {
    const channel = {
        sent: [],
        isTextBased: () => true,
        async send(payload) {
            channel.sent.push(payload);
            return { id: '42' };
        },
    };
    return channel;
}

function fakeGuild({ member = null, channel = null } = {}) {
    return {
        members: {
            async fetch() {
                if (!member) throw new Error('Unknown Member');
                return member;
            },
        },
        channels: { async fetch() { return channel; } },
    };
}

const send = (guild, store, number, extra = {}) =>
    sendInvoice({ guild, store, number, actor: '1', config: CONFIG, now: NOW, findLink, logoPath: NO_LOGO, ...extra });

const fieldOf = (embed, name) => nbsp(embed.data.fields.find(field => field.name === name)?.value);

const charsOf = message => message.embeds.reduce((sum, embed) => {
    const d = embed.data;
    return sum + (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text.length ?? 0) +
        (d.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
}, 0);

test('Rechnung wird per DM zugestellt, Frist läuft 14 Tage', async () => {
    const { store, number } = setup();
    const member = fakeMember();
    const result = await send(fakeGuild({ member }), store, number);

    assert.equal(result.delivery, 'delivered');
    assert.equal(result.fallback, null);
    assert.equal(result.messages, 1);

    const embed = member.sent[0].embeds[0];
    assert.equal(fieldOf(embed, 'Rechnungsnummer'), 'HKC-2026-11-169742');
    assert.equal(fieldOf(embed, 'Gesamtbetrag'), '500,00 €');
    assert.equal(fieldOf(embed, 'Zahlungsfrist'), '16.12.2026');
    assert.equal(fieldOf(embed, 'SpedV-Kontonummer'), CONFIG.iban);
    assert.equal(fieldOf(embed, 'Verwendungszweck'), 'Strafzahlung HKC-2026-11-169742');
    assert.match(embed.data.description, /keine reale Geldforderung/);
    assert.match(nbsp(embed.data.description), /#1 .*100 km\/h/);

    const saved = store.getInvoice(number);
    assert.equal(saved.status, 'sent');
    assert.equal(saved.delivery, 'delivered');
    assert.equal(saved.discord_id, DISCORD);
    assert.equal(saved.due_at, '2026-12-16T10:00:00.000Z');
    store.close();
});

test('DMs gesperrt (50007): neutraler Hinweis im Fahrer-Chat, ohne Betrag', async () => {
    const { store, number } = setup();
    const channel = fakeChannel();
    const result = await send(fakeGuild({ member: fakeMember('closed'), channel }), store, number);

    assert.equal(result.delivery, 'failed');
    assert.equal(result.fallback, 'sent');
    assert.equal(channel.sent.length, 1);
    assert.match(channel.sent[0].content, new RegExp(`<@${DISCORD}>`));
    assert.match(channel.sent[0].content, /\/abrechnung meine/);
    assert.ok(!/500|EUR|€/.test(channel.sent[0].content));
    assert.deepEqual(channel.sent[0].allowedMentions, { users: [DISCORD] });

    const saved = store.getInvoice(number);
    assert.equal(saved.delivery, 'failed');
    assert.equal(saved.fallback_status, 'sent');
    assert.equal(saved.fallback_message_id, '42');
    store.close();
});

test('Anderer DM-Fehler: Zustellung unklar, kein öffentlicher Hinweis, erneuter Versand gesperrt', async () => {
    const { store, number } = setup();
    const channel = fakeChannel();
    const guild = fakeGuild({ member: fakeMember('broken'), channel });

    const result = await send(guild, store, number);
    assert.equal(result.delivery, 'unknown');
    assert.equal(result.fallback, null);
    assert.equal(channel.sent.length, 0);

    await assert.rejects(() => send(fakeGuild({ member: fakeMember(), channel }), store, number), StoreError);
    store.close();
});

test('Nicht verknüpft: nichts wird gesendet, die Frist läuft nicht', async () => {
    const { store, number } = setup();
    const member = fakeMember();

    await assert.rejects(
        () => send(fakeGuild({ member }), store, number, { findLink: () => null }),
        StoreError
    );
    assert.equal(member.sent.length, 0);
    assert.equal(store.getInvoice(number).status, 'draft');
    assert.equal(store.getInvoice(number).due_at, null);
    store.close();
});

test('Fahrer nicht auf dem Server: nichts wird gesendet, die Frist läuft nicht', async () => {
    const { store, number } = setup();

    await assert.rejects(() => send(fakeGuild({ member: null }), store, number), StoreError);
    assert.equal(store.getInvoice(number).status, 'draft');
    store.close();
});

test('Ohne Kontonummer wird nicht gesendet', async () => {
    const { store, number } = setup();
    const member = fakeMember();

    await assert.rejects(
        () => send(fakeGuild({ member }), store, number, { config: { ...CONFIG, iban: null } }),
        StoreError
    );
    assert.equal(member.sent.length, 0);
    assert.equal(store.getInvoice(number).status, 'draft');
    store.close();
});

test('Unbekannte Rechnung', async () => {
    const { store } = setup();
    await assert.rejects(() => send(fakeGuild({ member: fakeMember() }), store, 'HKC-0'), StoreError);
    store.close();
});

test('Fallback-Kanal nicht erreichbar: Zustellung bleibt "fehlgeschlagen", erneuter Versuch möglich', async () => {
    const { store, number } = setup();
    const result = await send(fakeGuild({ member: fakeMember('closed'), channel: null }), store, number);

    assert.equal(result.delivery, 'failed');
    assert.equal(result.fallback, 'skipped');
    assert.equal(store.getInvoice(number).fallback_status, null);
    store.close();
});

test('Erneuter Versuch nach fehlgeschlagener DM: gleiche Frist, kein zweiter öffentlicher Hinweis', async () => {
    const { store, number } = setup();
    const channel = fakeChannel();

    await send(fakeGuild({ member: fakeMember('closed'), channel }), store, number);
    const member = fakeMember();
    const retry = await send(fakeGuild({ member, channel }), store, number, {
        now: new Date('2026-12-03T10:00:00Z'),
    });

    assert.equal(retry.delivery, 'delivered');
    assert.equal(channel.sent.length, 1);
    assert.equal(store.getInvoice(number).due_at, '2026-12-16T10:00:00.000Z');
    assert.equal(fieldOf(member.sent[0].embeds[0], 'Zahlungsfrist'), '16.12.2026');
    store.close();
});

test('Auch beim zweiten gescheiterten Versuch gibt es nur einen öffentlichen Hinweis', async () => {
    const { store, number } = setup();
    const channel = fakeChannel();

    await send(fakeGuild({ member: fakeMember('closed'), channel }), store, number);
    const second = await send(fakeGuild({ member: fakeMember('closed'), channel }), store, number);

    assert.equal(second.delivery, 'failed');
    assert.equal(second.fallback, 'skipped');
    assert.equal(channel.sent.length, 1);
    store.close();
});

test('Lange Rechnung wird auf mehrere Nachrichten verteilt, jede unter dem Discord-Limit', async () => {
    const store = openStore({ file: ':memory:' });
    for (let i = 1; i <= 120; i += 1) {
        store.recordEvaluation(fine(String(i), { evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));
    }
    store.createDraft({ month: '2026-11', spedvUserId: '169742', actor: '1', now: NOW });

    const messages = buildInvoiceMessages({
        invoice: store.getInvoice('HKC-2026-11-169742'),
        getTask: store.getEffective,
        config: CONFIG,
        dueAt: '2026-12-16T10:00:00.000Z',
        logoPath: NO_LOGO,
    });

    assert.ok(messages.length > 1);
    for (const message of messages) {
        assert.ok(charsOf(message) <= 6000, `Nachricht hat ${charsOf(message)} Zeichen`);
        assert.ok(message.embeds[0].data.description.length <= 4096);
    }

    const ids = messages.flatMap(message => message.embeds[0].data.description.match(/#\d+/g) ?? []);
    assert.equal(ids.length, 120);
    assert.equal(new Set(ids).size, 120);
    assert.equal(fieldOf(messages[0].embeds[0], 'Gesamtbetrag'), '12.000,00 €');
    store.close();
});

test('Mehrere Nachrichten: scheitert eine spätere, ist die Zustellung unklar', async () => {
    const store = openStore({ file: ':memory:' });
    for (let i = 1; i <= 120; i += 1) {
        store.recordEvaluation(fine(String(i), { evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));
    }
    store.createDraft({ month: '2026-11', spedvUserId: '169742', actor: '1', now: NOW });

    let calls = 0;
    const member = {
        async send() {
            calls += 1;
            if (calls === 2) {
                const error = new Error('Cannot send messages to this user');
                error.code = 50007;
                throw error;
            }
            return { id: 'dm' };
        },
    };
    const channel = fakeChannel();

    const result = await send(fakeGuild({ member, channel }), store, 'HKC-2026-11-169742');
    assert.equal(result.delivery, 'unknown');
    assert.equal(channel.sent.length, 0);
    store.close();
});

test('ATS-Zeilen stehen in mph', async () => {
    const store = openStore({ file: ':memory:' });
    store.recordEvaluation(fine('7', {
        game: 'ats',
        evidence: {
            game: 'ats', unit: 'mph', maxSpeed: 85, limit: 80, excessUnits: 5, fineEur: 500,
            maxVelocityKmh: 137, excessKmh: null,
        },
    }));
    store.createDraft({ month: '2026-11', spedvUserId: '169742', actor: '1', now: NOW });

    const [message] = buildInvoiceMessages({
        invoice: store.getInvoice('HKC-2026-11-169742'),
        getTask: store.getEffective,
        config: CONFIG,
        dueAt: '2026-12-16T10:00:00.000Z',
        logoPath: NO_LOGO,
    });

    const description = nbsp(message.embeds[0].data.description);
    assert.match(description, /85 mph/);
    assert.match(description, /5 mph/);
    assert.ok(!/km\/h/.test(description));
    store.close();
});

test('Ohne Logo wird trotzdem gesendet, mit Logo hängt es an der ersten Nachricht', () => {
    const { store } = setup();
    const invoice = store.getInvoice('HKC-2026-11-169742');
    const options = { invoice, getTask: store.getEffective, config: CONFIG, dueAt: '2026-12-16T10:00:00.000Z' };

    const without = buildInvoiceMessages({ ...options, logoPath: NO_LOGO });
    assert.equal(without[0].files.length, 0);
    assert.equal(without[0].embeds[0].data.thumbnail, undefined);

    const withLogo = buildInvoiceMessages({ ...options, logoPath: __filename });
    assert.equal(withLogo[0].files.length, 1);
    assert.equal(withLogo[0].embeds[0].data.thumbnail.url, 'attachment://HKC_logo.png');
    store.close();
});

// --- Erinnerung ---

async function sentInvoice() {
    const { store, number } = setup();
    await send(fakeGuild({ member: fakeMember() }), store, number);
    return { store, number };
}

const AFTER_DUE = new Date('2026-12-16T10:00:01Z');

const remind = (guild, store, extra = {}) => {
    const [invoice] = store.listDueForReminder(AFTER_DUE);
    return sendReminder({
        guild, store, invoice, actor: 'system', config: CONFIG, now: AFTER_DUE, findLink, logoPath: NO_LOGO, ...extra,
    });
};

test('Erinnerung geht einmal per DM raus', async () => {
    const { store, number } = await sentInvoice();
    const member = fakeMember();

    const result = await remind(fakeGuild({ member }), store);
    assert.equal(result.delivery, 'delivered');

    const embed = member.sent[0].embeds[0];
    assert.match(embed.data.title, /Zahlungserinnerung/);
    assert.equal(fieldOf(embed, 'Fällig seit'), '16.12.2026');
    assert.equal(fieldOf(embed, 'Gesamtbetrag'), '500,00 €');
    assert.equal(store.getInvoice(number).reminder_delivery, 'delivered');
    assert.equal(store.listDueForReminder(new Date('2026-12-30T10:00:00Z')).length, 0);
    store.close();
});

test('Erinnerung bei gesperrten DMs: festgehalten, aber keine öffentliche Nachricht', async () => {
    const { store, number } = await sentInvoice();
    const channel = fakeChannel();

    const result = await remind(fakeGuild({ member: fakeMember('closed'), channel }), store);
    assert.equal(result.delivery, 'failed');
    assert.equal(channel.sent.length, 0);
    assert.equal(store.getInvoice(number).reminder_delivery, 'failed');
    store.close();
});

test('Erinnerung: anderer Fehler wird als "unklar" festgehalten', async () => {
    const { store, number } = await sentInvoice();

    const result = await remind(fakeGuild({ member: fakeMember('broken') }), store);
    assert.equal(result.delivery, 'unknown');
    assert.equal(store.getInvoice(number).reminder_delivery, 'unknown');
    store.close();
});

test('Erinnerung: Fahrer nicht mehr auf dem Server wird festgehalten, nicht endlos wiederholt', async () => {
    const { store, number } = await sentInvoice();

    const result = await remind(fakeGuild({ member: null }), store);
    assert.equal(result.delivery, 'failed');
    assert.equal(store.getInvoice(number).reminder_delivery, 'failed');
    assert.equal(store.listDueForReminder(AFTER_DUE).length, 0);
    store.close();
});

test('Erinnerung ohne Kontonummer wird nicht verbraucht', async () => {
    const { store } = await sentInvoice();

    await assert.rejects(
        () => remind(fakeGuild({ member: fakeMember() }), store, { config: { ...CONFIG, iban: null } }),
        /Kontonummer/
    );
    assert.equal(store.listDueForReminder(AFTER_DUE).length, 1);
    store.close();
});

// --- Konfiguration ---

test('Konfiguration: Leerzeichen in der Kontonummer werden entfernt', () => {
    const config = loadBillingConfig({
        BILLING_SPEDV_IBAN: 'SP15 9103 5338 0000 3772 72',
        BILLING_REPORT_CHANNEL_ID: '1567138545020305420',
        BILLING_FALLBACK_CHANNEL_ID: '1560300974185123840',
    });
    assert.equal(config.iban, 'SP15910353380000377272');
    assert.equal(config.reportChannelId, '1567138545020305420');
    assert.equal(config.fallbackChannelId, '1560300974185123840');
    assert.deepEqual(config.problems, []);
});

test('Konfiguration: Fehlendes und Ungültiges wird gemeldet', () => {
    const config = loadBillingConfig({ BILLING_SPEDV_IBAN: 'DE123', BILLING_REPORT_CHANNEL_ID: 'abc' });
    assert.equal(config.iban, null);
    assert.equal(config.reportChannelId, null);
    assert.equal(config.fallbackChannelId, null);
    assert.equal(config.problems.length, 3);
});