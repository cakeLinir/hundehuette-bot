'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildStatementMessage,
    buildAlertMessage,
    buildClosingMessage,
    buildFailureMessage,
} = require('../src/billing/report');
const { upsertMessage } = require('../src/billing/publisher');
const { roleIds } = require('../src/billing/permissions');

const NOW = new Date('2026-11-20T06:00:00Z');
const nbsp = text => String(text).replace(/\u00a0/g, ' ');

const chars = message => message.embeds.reduce((sum, embed) => {
    const d = embed.data;
    return sum + (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text.length ?? 0) +
        (d.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
}, 0);

const driver = (index, overrides = {}) => ({
    spedvUserId: String(index),
    spedvName: `Fahrer ${index}`,
    fines: 1,
    fineEur: 100 * index,
    openReviews: 0,
    invoice: null,
    ...overrides,
});

const statementOf = drivers => ({
    month: '2026-11',
    drivers,
    globalReviews: [],
    totals: {
        drivers: drivers.length,
        driversWithFines: drivers.filter(d => d.fineEur > 0).length,
        fines: drivers.reduce((s, d) => s + d.fines, 0),
        fineEur: drivers.reduce((s, d) => s + d.fineEur, 0),
        openReviews: drivers.reduce((s, d) => s + d.openReviews, 0),
        invoicedEur: 0,
    },
});

test('Laufende Abrechnung: höchste Strafe zuerst, Rechnungsstatus sichtbar', () => {
    const message = buildStatementMessage({
        statement: statementOf([
            driver(1),
            driver(3, { invoice: { number: 'HKC-1', status: 'draft', totalEur: 300 } }),
            driver(2, { openReviews: 2 }),
        ]),
        closed: false,
        now: NOW,
    });
    const embed = message.embeds[0].data;
    const description = nbsp(embed.description);

    assert.equal(embed.title, '📒 Laufende Abrechnung 2026-11');
    assert.ok(description.indexOf('Fahrer 3') < description.indexOf('Fahrer 2'));
    assert.ok(description.indexOf('Fahrer 2') < description.indexOf('Fahrer 1'));
    assert.match(description, /Entwurf/);
    assert.match(description, /Strafen gesamt: \*\*600 €\*\*/);
    assert.match(description, /Der Monat läuft noch/);
});

test('Abgeschlossener Monat ist als solcher beschriftet', () => {
    const embed = buildStatementMessage({ statement: statementOf([driver(1)]), closed: true, now: NOW })
        .embeds[0].data;
    assert.equal(embed.title, '📒 Abrechnung 2026-11');
    assert.match(embed.description, /Monat abgeschlossen/);
});

test('Viele Fahrer werden begrenzt und bleiben unter den Discord-Grenzen', () => {
    const drivers = Array.from({ length: 60 }, (_, i) => driver(i + 1, { spedvName: `Ein sehr langer Fahrername ${i + 1}` }));
    const message = buildStatementMessage({ statement: statementOf(drivers), closed: false, now: NOW });

    assert.match(message.embeds[0].data.description, /und 20 weitere Fahrer/);
    assert.ok(message.embeds[0].data.description.length <= 4096);
    assert.ok(chars(message) <= 6000);
});

test('Ohne Aufträge steht ein klarer Hinweis da', () => {
    const embed = buildStatementMessage({ statement: statementOf([]), closed: false, now: NOW }).embeds[0].data;
    assert.match(embed.description, /keine ausgewerteten Aufträge/);
});

test('Prüffälle ohne Monat werden hervorgehoben', () => {
    const statement = { ...statementOf([driver(1)]), globalReviews: [{ taskId: '8' }] };
    const embed = buildStatementMessage({ statement, closed: false, now: NOW }).embeds[0].data;
    assert.match(embed.description, /blockieren alle Rechnungen/);
});

test('Änderungsmeldung: nichts Neues, keine Nachricht', () => {
    assert.equal(buildAlertMessage({ run: {}, now: NOW }), null);
    assert.equal(
        buildAlertMessage({
            run: { newFines: [], newReviews: [], reopened: [], staleInvoiced: [], errors: [], drafts: [] },
            now: NOW,
        }),
        null
    );
});

test('Änderungsmeldung: zeigt Strafen in der Einheit des Spiels und pingt niemanden', () => {
    const message = buildAlertMessage({
        run: {
            newFines: [
                { visibleId: "#12'657'450", spedvName: 'Fahrer', maxVelocityKmh: 116, unit: 'kmh', maxSpeed: 116, fineEur: 2100 },
                { visibleId: "#12'658'819", spedvName: 'Raptus', maxVelocityKmh: 137, unit: 'mph', maxSpeed: 85, fineEur: 500 },
            ],
            drafts: [{
                month: '2026-11',
                drivers: [
                    { created: true, number: 'HKC-2026-11-1', totalEur: 2100 },
                    { updated: true, number: 'HKC-2026-11-2', totalEur: 600 },
                    { reason: 'exists_late_fines', number: 'HKC-2026-11-3', lateTaskIds: ['9'] },
                    { reason: 'blocked', blockers: ['5'] },
                ],
            }],
        },
        reminders: [{ number: 'HKC-2026-11-1', delivery: 'failed' }],
        now: NOW,
    });
    const fields = message.embeds[0].data.fields;
    const field = name => nbsp(fields.find(f => f.name.startsWith(name)).value);

    assert.match(field('Neue Strafen'), /116 km\/h · 2\.100 €/);
    assert.match(field('Neue Strafen'), /85 mph · 500 €/);
    assert.match(field('Rechnungsentwürfe'), /HKC-2026-11-1 · neu/);
    assert.match(field('Rechnungsentwürfe'), /HKC-2026-11-2 · ergänzt/);
    assert.match(field('Rechnungsentwürfe'), /Nachzügler 9/);
    assert.ok(!/blocked/.test(field('Rechnungsentwürfe')));
    assert.match(field('Zahlungserinnerungen'), /nicht zustellbar/);
    assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('Änderungsmeldung mit sehr vielen Einträgen bleibt unter den Discord-Grenzen', () => {
    const many = n => Array.from({ length: n }, (_, i) => i);
    const message = buildAlertMessage({
        run: {
            newFines: many(80).map(i => ({ visibleId: `#${i}`, spedvName: 'Ein langer Fahrername', unit: 'kmh', maxSpeed: 120, fineEur: 2500 })),
            newReviews: many(80).map(i => ({ visibleId: `#${i}`, spedvName: 'Name', message: 'Eine ziemlich lange Beschreibung des Problems '.repeat(4) })),
            reopened: many(80).map(i => ({ visibleId: `#${i}`, spedvName: 'Name', message: 'Der Status ist jetzt Cancelled.' })),
            staleInvoiced: many(80).map(i => ({ visibleId: `#${i}`, spedvName: 'Name', billingMonth: '2026-11', message: 'Status geändert' })),
            errors: many(80).map(i => ({ taskId: String(i), message: 'Fehler '.repeat(30) })),
            drafts: [{ month: '2026-11', drivers: many(80).map(i => ({ created: true, number: `HKC-2026-11-${i}`, totalEur: 100 })) }],
        },
        reminders: many(80).map(i => ({ number: `HKC-2026-11-${i}`, delivery: 'delivered' })),
        now: NOW,
    });

    assert.ok(chars(message) <= 6000, `${chars(message)} Zeichen`);
    for (const field of message.embeds[0].data.fields) assert.ok(field.value.length <= 1024);
    assert.match(message.embeds[0].data.fields[0].value, /und \d+ weitere/);
});

const checkOf = (status, items, ready = []) => ({
    month: '2026-11',
    status,
    passed: status !== 'fail',
    items,
    readyDrivers: ready,
});

test('Generalprüfung: Ampel je Prüfpunkt und Zahl der versandbereiten Fahrer', () => {
    const message = buildClosingMessage({
        check: checkOf(
            'warn',
            [
                { id: 'month_closed', label: 'Monat abgeschlossen', status: 'ok', detail: 'Der Monat ist abgeschlossen.', data: [] },
                { id: 'pending_tasks', label: 'Keine offenen Aufträge', status: 'warn', detail: '2 Aufträge sind noch offen.', data: [] },
            ],
            [{ fineEur: 500 }, { fineEur: 2100 }]
        ),
        now: NOW,
    });
    const embed = message.embeds[0].data;

    assert.equal(embed.title, '🧾 Generalprüfung 2026-11');
    assert.equal(embed.color, 0xf39c12);
    assert.match(embed.description, /Bestanden mit Hinweisen/);
    assert.match(embed.description, /✅ \*\*Monat abgeschlossen\*\*/);
    assert.match(embed.description, /⚠️ \*\*Keine offenen Aufträge\*\*/);
    assert.match(nbsp(embed.description), /Versandbereit: \*\*2\*\* Fahrer, zusammen \*\*2\.600 €\*\*/);
});

test('Generalprüfung: durchgefallen ist rot, ohne Fahrer wird das gesagt', () => {
    const embed = buildClosingMessage({
        check: checkOf('fail', [{ id: 'open_reviews', label: 'Keine offenen Prüffälle', status: 'fail', detail: '3 Prüffälle sind offen.', data: [] }]),
        now: NOW,
    }).embeds[0].data;

    assert.equal(embed.color, 0xe74c3c);
    assert.match(embed.description, /Nicht bestanden/);
    assert.match(embed.description, /❌/);
    assert.match(embed.description, /kein Fahrer versandbereit/);
});

test('Fehlermeldung ohne Pings', () => {
    const message = buildFailureMessage('SpedV-Abfrage fehlgeschlagen (HTTP 503).');
    assert.match(message.embeds[0].data.description, /HTTP 503/);
    assert.match(message.embeds[0].data.description, /nächste Versuch/);
    assert.deepEqual(message.allowedMentions, { parse: [] });
});

// --- Nachrichten bearbeiten ---

function fakeChannel(id = '1567138545020305420') {
    const messages = new Map();
    let counter = 0;
    const channel = {
        id,
        sent: [],
        messages: {
            async fetch(messageId) {
                const message = messages.get(messageId);
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
                },
            };
            messages.set(message.id, message);
            channel.sent.push(message);
            return message;
        },
        remove(messageId) {
            messages.delete(messageId);
        },
    };
    return channel;
}

function fakeState() {
    const map = new Map();
    return { get: key => map.get(key) ?? null, set: (key, value) => map.set(key, value) };
}

test('Nachricht wird zuerst gesendet, danach bearbeitet', async () => {
    const channel = fakeChannel();
    const state = fakeState();
    const payload = { embeds: [] };

    const first = await upsertMessage({ channel, state, key: 'statement:2026-11', payload });
    const second = await upsertMessage({ channel, state, key: 'statement:2026-11', payload });

    assert.equal(first.action, 'sent');
    assert.equal(second.action, 'edited');
    assert.equal(second.messageId, first.messageId);
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].edits.length, 1);
});

test('Gelöschte Nachricht wird neu gesendet und die neue ID gemerkt', async () => {
    const channel = fakeChannel();
    const state = fakeState();

    const first = await upsertMessage({ channel, state, key: 'k', payload: { embeds: [] } });
    channel.remove(first.messageId);
    const again = await upsertMessage({ channel, state, key: 'k', payload: { embeds: [] } });

    assert.equal(again.action, 'sent');
    assert.notEqual(again.messageId, first.messageId);
    assert.equal(state.get('k').messageId, again.messageId);
});

test('Ping nur beim Senden, nicht beim Bearbeiten', async () => {
    const channel = fakeChannel();
    const state = fakeState();
    const mentions = { roles: ['333333333333333333'] };

    await upsertMessage({ channel, state, key: 'k', payload: { embeds: [] }, content: '<@&333333333333333333> Hallo', allowedMentions: mentions });
    await upsertMessage({ channel, state, key: 'k', payload: { embeds: [] }, content: '<@&333333333333333333> Hallo', allowedMentions: mentions });

    assert.equal(channel.sent[0].payload.content, '<@&333333333333333333> Hallo');
    assert.deepEqual(channel.sent[0].payload.allowedMentions, mentions);
    assert.equal(channel.sent[0].edits[0].content, undefined);
});

test('Anderer Kanal: neue Nachricht', async () => {
    const state = fakeState();
    await upsertMessage({ channel: fakeChannel('111111111111111111'), state, key: 'k', payload: { embeds: [] } });
    const other = fakeChannel('222222222222222222');
    const result = await upsertMessage({ channel: other, state, key: 'k', payload: { embeds: [] } });

    assert.equal(result.action, 'sent');
    assert.equal(other.sent.length, 1);
});

test('Andere Discord-Fehler werden nicht verschluckt', async () => {
    const channel = fakeChannel();
    const state = fakeState();
    await upsertMessage({ channel, state, key: 'k', payload: { embeds: [] } });
    channel.messages.fetch = async () => {
        throw new Error('Missing Access');
    };

    await assert.rejects(() => upsertMessage({ channel, state, key: 'k', payload: { embeds: [] } }), /Missing Access/);
});

// --- Rollen ---

test('Rollen-IDs werden aus den Funktionsstellen gelesen, ungültige ignoriert', () => {
    const ids = roleIds(
        '1',
        ['buchhaltungsleiter', 'buchhaltung', 'gibt_es_nicht'],
        (guildId, position) => ({ buchhaltungsleiter: '333333333333333333', buchhaltung: 'keine-id' })[position.key]
    );
    assert.deepEqual(ids, ['333333333333333333']);
});
