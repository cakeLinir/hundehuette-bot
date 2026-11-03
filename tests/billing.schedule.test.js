'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/billing/store');
const { shouldRunDaily, createBillingRuntime } = require('../src/billing/schedule');
const { berlinClock, monthsBetween } = require('../src/billing/time');

const CONFIG = {
    iban: 'SP15910353380000377272',
    reportChannelId: '1567138545020305420',
    fallbackChannelId: '1560300974185123840',
    purposePrefix: 'Strafzahlung',
};
const PING = '333333333333333333';
const DISCORD = '222222222222222222';
const findLink = id => (id === '169742' ? { verified: true, discordId: DISCORD } : null);

// --- reine Zeitfunktionen ---

test('Berliner Uhrzeit, auch über Mitternacht und Sommerzeit', () => {
    assert.deepEqual(berlinClock(new Date('2026-11-30T23:30:00Z')), { date: '2026-12-01', hour: 0, minute: 30 });
    assert.deepEqual(berlinClock(new Date('2026-07-01T04:30:00Z')), { date: '2026-07-01', hour: 6, minute: 30 });
});

test('Monate von bis, auch über den Jahreswechsel', () => {
    assert.deepEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.deepEqual(monthsBetween('2026-11', '2026-11'), ['2026-11']);
    assert.deepEqual(monthsBetween('2026-12', '2026-11'), []);
});

test('Tageslauf ist ab 06:00 Berliner Zeit fällig, einmal pro Tag', () => {
    assert.equal(shouldRunDaily({ now: new Date('2026-11-20T04:59:00Z'), lastRunDate: null }), false);
    assert.equal(shouldRunDaily({ now: new Date('2026-11-20T05:00:00Z'), lastRunDate: null }), true);
    assert.equal(shouldRunDaily({ now: new Date('2026-11-20T05:00:00Z'), lastRunDate: '2026-11-20' }), false);
    assert.equal(shouldRunDaily({ now: new Date('2026-11-20T15:00:00Z'), lastRunDate: '2026-11-19' }), true);
    // Sommerzeit: 06:00 Berlin ist 04:00 UTC
    assert.equal(shouldRunDaily({ now: new Date('2026-07-01T03:59:00Z'), lastRunDate: null }), false);
    assert.equal(shouldRunDaily({ now: new Date('2026-07-01T04:00:00Z'), lastRunDate: null }), true);
});

// --- Attrappen ---

const points = (...values) => values.map((velocity, index) => ({
    timestamp: `2026-11-15T17:${String(index).padStart(2, '0')}:00+01:00`,
    velocity,
    speedLimit: 90,
}));

const task = id => ({
    id,
    state: 2,
    userID: 169742,
    currency: 'EUR',
    startTime: '2026-11-15T16:00:00+01:00',
    ddCleaned: false,
});

function fakeSpedv(tasks) {
    const client = {
        tasks,
        failList: false,
        async fetchTasks() {
            if (client.failList) throw new Error('SpedV-Abfrage fehlgeschlagen (HTTP 503).');
            return client.tasks.map(entry => ({ ...entry }));
        },
        async fetchTaskDetails() {
            return {
                state: 2,
                spedition: { id: 108570 },
                user: { id: 169742, userName: 'hundekuchen' },
                currency: 'EUR',
                endtime: '2026-11-15T18:00:00+01:00',
                ddCleaned: false,
                maxVelocityKMH: 100,
            };
        },
        async fetchDriveData() {
            return points(90, 100);
        },
    };
    return client;
}

function fakeChannel() {
    const messages = new Map();
    let counter = 0;
    const channel = {
        id: CONFIG.reportChannelId,
        sent: [],
        isTextBased: () => true,
        messages: {
            async fetch(id) {
                const message = messages.get(id);
                if (!message) {
                    const error = new Error('Unknown Message');
                    error.code = 10008;
                    throw error;
                }
                return message;
            },
        },
        async send(payload) {
            counter += 1;
            const message = {
                id: String(counter),
                payload,
                edits: [],
                async edit(next) {
                    message.edits.push(next);
                    message.payload = next;
                },
            };
            messages.set(message.id, message);
            channel.sent.push(message);
            return message;
        },
        remove(id) {
            messages.delete(id);
        },
    };
    return channel;
}

function fakeMember() {
    const member = {
        sent: [],
        async send(payload) {
            member.sent.push(payload);
            return { id: 'dm' };
        },
    };
    return member;
}

function setup({ at, tasks = [task(1)], enabled = true, hideChannel = false } = {}) {
    const store = openStore({ file: ':memory:' });
    const channel = fakeChannel();
    const member = fakeMember();
    const guild = {
        id: '444444444444444444',
        channels: { async fetch(id) { return !hideChannel && id === channel.id ? channel : null; } },
        members: { async fetch() { return member; } },
    };
    const map = new Map();
    const state = { get: key => map.get(key) ?? null, set: (key, value) => map.set(key, value) };
    const spedv = fakeSpedv(tasks);
    const clock = { now: new Date(at) };

    const runtime = createBillingRuntime({
        getGuild: () => guild,
        store,
        spedvClient: spedv,
        config: CONFIG,
        speditionId: '108570',
        findLink,
        getState: () => state,
        getPingRoleIds: () => [PING],
        isEnabled: () => enabled,
        now: () => clock.now,
    });

    return { store, channel, member, state, spedv, clock, runtime };
}

const titleOf = message => message.payload.embeds[0].data.title;
const fieldNames = message => message.payload.embeds[0].data.fields.map(field => field.name);

test('Vor 06:00 läuft nichts, danach genau einmal pro Tag', async () => {
    const t = setup({ at: '2026-11-20T04:30:00Z' });

    assert.deepEqual(await t.runtime.dailyTick(), { skipped: 'nicht fällig' });
    assert.equal(t.channel.sent.length, 0);

    t.clock.now = new Date('2026-11-20T05:30:00Z');
    const result = await t.runtime.dailyTick();
    assert.deepEqual(result.statements, ['2026-11']);
    assert.equal(t.state.get('lastRunDate'), '2026-11-20');

    t.clock.now = new Date('2026-11-20T12:00:00Z');
    assert.deepEqual(await t.runtime.dailyTick(), { skipped: 'nicht fällig' });
    t.store.close();
});

test('Laufender Monat: Übersicht und Meldung am ersten Tag, danach nur noch die Übersicht', async () => {
    const t = setup({ at: '2026-11-20T05:30:00Z' });
    await t.runtime.dailyTick();

    assert.equal(t.channel.sent.length, 2);
    assert.equal(titleOf(t.channel.sent[0]), '📒 Laufende Abrechnung 2026-11');
    assert.equal(titleOf(t.channel.sent[1]), '🔔 Abrechnung: Änderungen');
    assert.deepEqual(fieldNames(t.channel.sent[1]), ['Neue Strafen (1)']);

    t.clock.now = new Date('2026-11-21T05:30:00Z');
    await t.runtime.dailyTick();

    assert.equal(t.channel.sent.length, 2);
    assert.equal(t.channel.sent[0].edits.length, 1);
    t.store.close();
});

test('Nach Monatsende: Entwurf, Generalprüfung mit Ping, danach keine neuen Pings', async () => {
    const t = setup({ at: '2026-12-02T05:30:00Z' });
    const result = await t.runtime.dailyTick();

    assert.deepEqual(result.statements.sort(), ['2026-11', '2026-12']);
    assert.deepEqual(result.closings, [{ month: '2026-11', status: 'ok' }]);
    assert.equal(t.store.getInvoice('HKC-2026-11-169742').status, 'draft');

    const closing = t.channel.sent.find(message => titleOf(message) === '🧾 Generalprüfung 2026-11');
    assert.ok(closing);
    assert.match(closing.payload.content, new RegExp(`<@&${PING}>`));
    assert.deepEqual(closing.payload.allowedMentions, { roles: [PING] });

    const alert = t.channel.sent.find(message => titleOf(message) === '🔔 Abrechnung: Änderungen');
    assert.deepEqual(fieldNames(alert), ['Neue Strafen (1)', 'Rechnungsentwürfe (1)']);

    const sentBefore = t.channel.sent.length;
    t.clock.now = new Date('2026-12-03T05:30:00Z');
    await t.runtime.dailyTick();
    assert.equal(t.channel.sent.length, sentBefore);
    t.store.close();
});

test('Gelöschte Übersicht wird am nächsten Tag neu geschrieben', async () => {
    const t = setup({ at: '2026-11-20T05:30:00Z' });
    await t.runtime.dailyTick();

    const old = t.state.get('statement:2026-11').messageId;
    t.channel.remove(old);

    t.clock.now = new Date('2026-11-21T05:30:00Z');
    await t.runtime.dailyTick();

    assert.equal(t.channel.sent.length, 3);
    assert.notEqual(t.state.get('statement:2026-11').messageId, old);
    t.store.close();
});

test('SpedV nicht erreichbar: eine Fehlermeldung pro Tag, späterer Versuch klappt', async () => {
    const t = setup({ at: '2026-11-20T05:30:00Z' });
    t.spedv.failList = true;

    const first = await t.runtime.dailyTick();
    assert.match(first.error, /HTTP 503/);
    assert.equal(t.channel.sent.length, 1);
    assert.equal(titleOf(t.channel.sent[0]), 'Abrechnungslauf fehlgeschlagen');
    assert.equal(t.state.get('lastRunDate'), null);

    t.clock.now = new Date('2026-11-20T05:35:00Z');
    const second = await t.runtime.dailyTick();
    assert.match(second.error, /HTTP 503/);
    assert.equal(t.channel.sent.length, 1);

    t.spedv.failList = false;
    t.clock.now = new Date('2026-11-20T05:40:00Z');
    const third = await t.runtime.dailyTick();
    assert.deepEqual(third.statements, ['2026-11']);
    assert.equal(t.state.get('lastRunDate'), '2026-11-20');
    t.store.close();
});

test('Abgeschaltetes Modul: nichts passiert', async () => {
    const t = setup({ at: '2026-11-20T05:30:00Z', enabled: false });

    assert.deepEqual(await t.runtime.dailyTick(), { skipped: 'inaktiv' });
    assert.deepEqual(await t.runtime.reminderTick(), { skipped: 'inaktiv' });
    assert.equal(t.channel.sent.length, 0);
    t.store.close();
});

test('Buchhaltungs-Channel nicht erreichbar: Fehler wird zurückgegeben, nichts stürzt ab', async () => {
    const t = setup({ at: '2026-11-20T05:30:00Z', hideChannel: true });

    const result = await t.runtime.dailyTick();
    assert.match(result.error, /Buchhaltungs-Channel/);
    assert.equal(t.state.get('lastRunDate'), null);
    t.store.close();
});

test('Erinnerung geht unmittelbar nach Fristende raus, einmal, mit Meldung an die Buchhaltung', async () => {
    const t = setup({ at: '2026-12-02T05:30:00Z' });
    await t.runtime.dailyTick();
    t.store.recordSendAttempt({
        number: 'HKC-2026-11-169742',
        discordId: DISCORD,
        actor: '1',
        now: new Date('2026-12-02T10:00:00Z'),
    });
    const before = t.channel.sent.length;

    t.clock.now = new Date('2026-12-16T09:00:00Z');
    assert.deepEqual(await t.runtime.reminderTick(), { reminders: 0 });
    assert.equal(t.member.sent.length, 0);

    t.clock.now = new Date('2026-12-16T10:05:00Z');
    assert.deepEqual(await t.runtime.reminderTick(), { reminders: 1 });
    assert.equal(t.member.sent.length, 1);
    assert.match(t.member.sent[0].embeds[0].data.title, /Zahlungserinnerung/);
    assert.equal(t.channel.sent.length, before + 1);
    assert.deepEqual(fieldNames(t.channel.sent.at(-1)), ['Zahlungserinnerungen (1)']);

    t.clock.now = new Date('2026-12-16T10:20:00Z');
    assert.deepEqual(await t.runtime.reminderTick(), { reminders: 0 });
    assert.equal(t.member.sent.length, 1);
    assert.equal(t.channel.sent.length, before + 1);
    t.store.close();
});
