'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/billing/store');
const { createAbrechnungHandlers } = require('../src/billing/commands');

const GUILD_ID = '444444444444444444';
const NOW = new Date('2026-12-02T10:00:00Z'); // der November ist abgeschlossen
const DRIVER = '222222222222222222';
const OTHER_DRIVER = '777777777777777777';
const STAFF = '555555555555555555';
const BOSS = '666666666666666666';
const CONFIG = {
    iban: 'SP15910353380000377272',
    reportChannelId: '1567138545020305420',
    fallbackChannelId: '1560300974185123840',
    purposePrefix: 'Strafzahlung',
};

const START = '2026-11-15T16:00:00+01:00';

function result(taskId, user, name, overrides = {}) {
    return {
        taskId,
        visibleId: `#${taskId}`,
        taskState: 2,
        speditionId: '108570',
        spedvUserId: user,
        spedvName: name,
        completedAt: '2026-11-15T17:00:00.000Z',
        billingMonth: '2026-11',
        outcome: 'fine',
        reason: null,
        message: '',
        evidence: { maxVelocityKmh: 100, excessKmh: 5, fineEur: 500 },
        ...overrides,
    };
}

const review = (taskId, user, name, overrides = {}) =>
    result(taskId, user, name, {
        outcome: 'review', reason: 'speed_conflict', message: 'Widerspruch', evidence: null, ...overrides,
    });

function seed(store) {
    store.recordEvaluation(result('1', '169742', 'hundekuchen'));
    store.recordEvaluation(result('2', '200', 'zweiter', { evidence: { maxVelocityKmh: 116, excessKmh: 21, fineEur: 2100 } }));
    store.createDraftsForMonth({ month: '2026-11', actor: '1', now: NOW });

    // Danach: ein Fahrer mit Prüffällen und einer Strafe ohne Rechnung
    store.recordEvaluation(review('9', '300', 'dritter'));
    store.recordEvaluation(review('11', '300', 'dritter', { game: 'ats' }));
    store.recordEvaluation(result('12', '300', 'dritter', { evidence: { maxVelocityKmh: 96, excessKmh: 1, fineEur: 100 } }));
}

const tasks = ['1', '2', '9', '11', '12'].map(id => ({
    id: Number(id),
    state: 2,
    userID: { 1: 169742, 2: 200 }[id] ?? 300,
    startTime: START,
}));

function fakeInteraction({ sub, options = {}, user = STAFF, tag = 'staff', click, id = 'int1' }) {
    const calls = { replies: [], followUps: [] };
    return {
        id,
        user: { id: user },
        member: { tag },
        guild: { id: GUILD_ID },
        calls,
        options: {
            getSubcommand: () => sub,
            getString: name => options[name] ?? null,
            getNumber: name => options[name] ?? null,
        },
        async deferReply() { },
        async editReply(payload) {
            calls.replies.push(payload);
            return {
                async awaitMessageComponent({ filter }) {
                    if (!click) throw new Error('time');
                    const component = {
                        customId: `abr-${click.choice}-${id}`,
                        user: { id: click.user ?? user },
                        async update(next) { calls.replies.push(next); },
                    };
                    if (!filter(component)) throw new Error('time');
                    return component;
                },
            };
        },
        async followUp(payload) { calls.followUps.push(payload); },
    };
}

function setup(extra = {}) {
    const store = openStore({ file: ':memory:' });
    seed(store);

    const sent = [];
    const announced = [];
    const links = {
        169742: { verified: true, discordId: DRIVER },
        200: { verified: true, discordId: OTHER_DRIVER },
    };
    const ctx = {
        enabled: true,
        config: CONFIG,
        store,
        spedvClient: { async fetchTasks() { return tasks.map(task => ({ ...task })); } },
        speditionId: '108570',
        runtime: {
            runNow: async () => ({ evaluated: 3, newFines: 1, newReviews: 2, statements: ['2026-11'], closings: [] }),
        },
    };

    const handlers = createAbrechnungHandlers({
        getContext: () => ctx,
        isModuleEnabled: () => true,
        canAct: (interaction, kind) =>
            (kind === 'staff' ? ['staff', 'boss'] : ['boss']).includes(interaction.member.tag),
        findLink: id => links[id] ?? null,
        linksOf: discordId =>
            discordId === DRIVER ? [{ spedvUserId: '169742', spedvName: 'hundekuchen', verified: true }] : [],
        sendInvoice: async args => {
            sent.push(args.number);
            return { number: args.number, delivery: 'delivered', fallback: null, dueAt: '2026-12-16T10:00:00.000Z', messages: 1 };
        },
        announce: async (guild, text) => { announced.push(text); },
        now: () => NOW,
        ...extra,
    });

    return { store, handlers, sent, announced, ctx, links };
}

const textOf = payload => (payload?.embeds ?? []).map(embed => {
    const d = embed.data;
    return [d.title, d.description, ...(d.fields ?? []).flatMap(f => [f.name, f.value])].filter(Boolean).join('\n');
}).join('\n').replace(/\u00a0/g, ' ');

const last = interaction => interaction.calls.replies.at(-1);

async function run(t, interactionOptions) {
    const interaction = fakeInteraction(interactionOptions);
    await t.handlers.execute(interaction);
    return interaction;
}

// --- Allgemeines ---

test('Ohne Rolle sind alle Buchhaltungsbefehle gesperrt', async () => {
    const t = setup();
    for (const [sub, options] of [
        ['status', {}], ['pruefung', {}], ['pruefaelle', {}],
        ['klaeren', { auftrag: '9', art: 'kein-verstoss', begruendung: 'Beleg geprüft' }],
        ['senden', { rechnung: 'HKC-2026-11-169742' }], ['bezahlt', { rechnung: 'HKC-2026-11-169742' }],
        ['storno', { rechnung: 'HKC-2026-11-169742', grund: 'Test' }], ['lauf', {}],
    ]) {
        const interaction = await run(t, { sub, options, tag: 'none' });
        assert.match(textOf(last(interaction)), /Berechtigung/, sub);
    }
    assert.deepEqual(t.sent, []);
    assert.deepEqual(t.announced, []);
    t.store.close();
});

test('Abrechnung nicht eingeschaltet: höfliche Meldung ohne Konfigurationsdetails', async () => {
    const t = setup({ getContext: () => ({ enabled: false, reason: 'BILLING_SPEDV_IBAN fehlt' }) });
    const interaction = await run(t, { sub: 'meine', user: DRIVER, tag: 'none' });

    assert.match(textOf(last(interaction)), /noch nicht eingeschaltet/);
    assert.ok(!/IBAN/.test(textOf(last(interaction))));
    t.store.close();
});

test('Abgeschaltetes Modul', async () => {
    const t = setup({ isModuleEnabled: () => false });
    const interaction = await run(t, { sub: 'status' });
    assert.match(textOf(last(interaction)), /deaktiviert/);
    t.store.close();
});

test('Unerwarteter Fehler wird gemeldet, ohne Einzelheiten preiszugeben', async () => {
    const t = setup();
    t.ctx.store = { summarizeMonth() { throw new TypeError('interne Details'); }, listOpenReviews: () => [], listInvoices: () => [] };

    const interaction = await run(t, { sub: 'status' });
    assert.match(textOf(last(interaction)), /Unerwarteter Fehler/);
    assert.ok(!/interne Details/.test(textOf(last(interaction))));
    t.store.close();
});

// --- Fahrer ---

test('meine: der Fahrer sieht nur seine eigenen Strafen und Rechnungen', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'meine', user: DRIVER, tag: 'none' });
    const text = textOf(last(interaction));

    assert.match(text, /2026-11/);
    assert.match(text, /#1 · 100 km\/h · 500 €/);
    assert.match(text, /HKC-2026-11-169742: Entwurf/);
    assert.ok(!/HKC-2026-11-200/.test(text));
    assert.ok(!/zweiter|dritter/.test(text));
    t.store.close();
});

test('meine: versendete Rechnung zeigt die Frist', async () => {
    const t = setup();
    t.store.recordSendAttempt({ number: 'HKC-2026-11-169742', discordId: DRIVER, actor: '1', now: NOW });

    const interaction = await run(t, { sub: 'meine', user: DRIVER, tag: 'none' });
    assert.match(textOf(last(interaction)), /versendet, fällig bis 16\.12\.2026/);
    t.store.close();
});

test('meine: ohne Verknüpfung gibt es einen Hinweis', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'meine', user: '999999999999999999', tag: 'none' });
    assert.match(textOf(last(interaction)), /\/ets link/);
    t.store.close();
});

// --- Übersichten ---

test('status: Standard ist der aktuelle Monat, mit Monat der gewünschte', async () => {
    const t = setup();

    const current = await run(t, { sub: 'status' });
    assert.match(textOf(last(current)), /Laufende Abrechnung 2026-12/);

    const november = await run(t, { sub: 'status', options: { monat: '2026-11' } });
    const text = textOf(last(november));
    assert.match(text, /Abrechnung 2026-11/);
    assert.match(text, /hundekuchen/);
    assert.match(text, /Monat abgeschlossen/);

    const invalid = await run(t, { sub: 'status', options: { monat: '11/2026' } });
    assert.match(textOf(last(invalid)), /JJJJ-MM/);
    t.store.close();
});

test('pruefung: Ergebnis und Details zu den offenen Punkten', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'pruefung' });

    assert.match(textOf(last(interaction)), /Generalprüfung 2026-11/);
    assert.equal(interaction.calls.followUps.length, 1);
    const details = textOf(interaction.calls.followUps[0]);
    assert.match(details, /Keine offenen Prüffälle/);
    assert.match(details, /#9 dritter/);
    assert.match(details, /#11 dritter/);
    t.store.close();
});

test('pruefung: SpedV nicht erreichbar', async () => {
    const t = setup();
    t.ctx.spedvClient = { async fetchTasks() { throw new Error('HTTP 503'); } };

    const interaction = await run(t, { sub: 'pruefung' });
    assert.match(textOf(last(interaction)), /nicht erreichbar/);
    t.store.close();
});

test('pruefaelle: Liste und danach "nichts offen"', async () => {
    const t = setup();
    const before = await run(t, { sub: 'pruefaelle' });
    assert.match(textOf(last(before)), /Offene Prüffälle \(2\)/);
    assert.match(textOf(last(before)), /#9 · dritter · 2026-11/);

    t.store.decide({ taskId: '9', kind: 'dismiss', reason: 'Beleg geprüft', actor: '1' });
    t.store.decide({ taskId: '11', kind: 'dismiss', reason: 'Beleg geprüft', actor: '1' });

    const after = await run(t, { sub: 'pruefaelle' });
    assert.match(textOf(last(after)), /Keine offenen Prüffälle/);
    t.store.close();
});

// --- Klären ---

test('klaeren: Prüffall ohne Verstoß, mit Hinweis im Buchhaltungs-Channel; Eingabe mit # und Punkten', async () => {
    const t = setup();
    const interaction = await run(t, {
        sub: 'klaeren',
        options: { auftrag: "#9", art: 'kein-verstoss', begruendung: 'Screenshot zeigt 91 km/h' },
    });

    assert.match(textOf(last(interaction)), /#9 · kein Verstoß \(geklärt\)/);
    assert.equal(t.store.getEffective('9').effective_status, 'dismissed');
    assert.match(t.announced[0], new RegExp(`<@${STAFF}>`));
    assert.match(t.announced[0], /Screenshot zeigt 91 km\/h/);
    t.store.close();
});

test('klaeren: Strafe festsetzen rechnet im System des Spiels', async () => {
    const t = setup();

    const ets = await run(t, {
        sub: 'klaeren',
        options: { auftrag: '9', art: 'festsetzen', begruendung: 'Video zeigt 100 km/h', geschwindigkeit: 100 },
    });
    assert.match(textOf(last(ets)), /Strafe · 500 € \(100 km\/h\)/);

    const ats = await run(t, {
        sub: 'klaeren',
        options: { auftrag: '11', art: 'festsetzen', begruendung: 'Screenshot zeigt 85 mph', geschwindigkeit: 85 },
    });
    assert.match(textOf(last(ats)), /Strafe · 500 € \(85 mph\)/);

    const missing = await run(t, {
        sub: 'klaeren',
        options: { auftrag: '9', art: 'festsetzen', begruendung: 'ohne Wert' },
    });
    assert.match(textOf(last(missing)), /Geschwindigkeit/);
    t.store.close();
});

test('klaeren: Ausnahmen nur für die Leitung', async () => {
    const t = setup();
    const options = { auftrag: '12', art: 'ausnahme', begruendung: 'Genehmigte Konvoi-Ausnahme' };

    const denied = await run(t, { sub: 'klaeren', options, tag: 'staff' });
    assert.match(textOf(last(denied)), /Geschäftsführung und Stellvertretung/);
    assert.equal(t.store.getEffective('12').effective_status, 'fine');

    const allowed = await run(t, { sub: 'klaeren', options, tag: 'boss', user: BOSS });
    assert.match(textOf(last(allowed)), /Ausnahme genehmigt/);
    assert.equal(t.store.getEffective('12').effective_status, 'waived');
    assert.match(t.announced[0], /Ausnahme genehmigt \(§ 5\.3\)/);
    t.store.close();
});

test('klaeren: Eine Ausnahme widerrufen darf nur die Leitung, andere Entscheidungen auch die Buchhaltung', async () => {
    const t = setup();
    t.store.decide({ taskId: '12', kind: 'waive', reason: 'Ausnahme erteilt', actor: BOSS });
    t.store.decide({ taskId: '9', kind: 'dismiss', reason: 'Beleg geprüft', actor: STAFF });

    const denied = await run(t, {
        sub: 'klaeren', options: { auftrag: '12', art: 'widerrufen', begruendung: 'zurückgezogen' },
    });
    assert.match(textOf(last(denied)), /Geschäftsführung und Stellvertretung/);
    assert.equal(t.store.getEffective('12').effective_status, 'waived');

    const dismissed = await run(t, {
        sub: 'klaeren', options: { auftrag: '9', art: 'widerrufen', begruendung: 'Irrtum' },
    });
    assert.match(textOf(last(dismissed)), /Prüffall offen/);

    const boss = await run(t, {
        sub: 'klaeren', options: { auftrag: '12', art: 'widerrufen', begruendung: 'zurückgezogen' }, tag: 'boss',
    });
    assert.match(textOf(last(boss)), /Strafe · 100 €/);
    t.store.close();
});

test('klaeren: unbekannter oder bereits abgerechneter Auftrag', async () => {
    const t = setup();

    const unknown = await run(t, {
        sub: 'klaeren', options: { auftrag: '999', art: 'kein-verstoss', begruendung: 'Test Test' },
    });
    assert.match(textOf(last(unknown)), /nicht gefunden/);

    const invoiced = await run(t, {
        sub: 'klaeren', options: { auftrag: '1', art: 'ausnahme', begruendung: 'zu spät' }, tag: 'boss',
    });
    assert.match(textOf(last(invoiced)), /Rechnung/);
    assert.equal(t.store.getEffective('1').effective_status, 'fine');
    t.store.close();
});

// --- Versand ---

test('senden: eine Rechnung eines versandbereiten Fahrers', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'senden', options: { rechnung: 'hkc-2026-11-169742' } });

    assert.deepEqual(t.sent, ['HKC-2026-11-169742']);
    assert.match(textOf(last(interaction)), /Rechnung versendet/);
    assert.match(textOf(last(interaction)), /16\.12\.2026/);
    assert.match(t.announced[0], /HKC-2026-11-169742/);
    t.store.close();
});

test('senden: nicht versandbereit (nicht verknüpft) wird nicht gesendet', async () => {
    const t = setup();
    delete t.links[200];

    const interaction = await run(t, { sub: 'senden', options: { rechnung: 'HKC-2026-11-200' } });
    assert.match(textOf(last(interaction)), /noch nicht versandbereit/);
    assert.match(textOf(last(interaction)), /verknüpft/);
    assert.deepEqual(t.sent, []);
    t.store.close();
});

test('senden: genau eine Angabe ist nötig, unbekannte Rechnung', async () => {
    const t = setup();

    const none = await run(t, { sub: 'senden' });
    assert.match(textOf(last(none)), /entweder/);

    const both = await run(t, { sub: 'senden', options: { rechnung: 'HKC-2026-11-200', monat: '2026-11' } });
    assert.match(textOf(last(both)), /entweder/);

    const unknown = await run(t, { sub: 'senden', options: { rechnung: 'HKC-0' } });
    assert.match(textOf(last(unknown)), /nicht gefunden/);
    assert.deepEqual(t.sent, []);
    t.store.close();
});

test('senden monat: erst Vorschau, gesendet wird erst nach der Bestätigung', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'senden', options: { monat: '2026-11' }, click: { choice: 'yes' } });

    const preview = textOf(interaction.calls.replies[0]);
    assert.match(preview, /2 Rechnungen/);
    assert.match(preview, /2\.600 €/);
    assert.equal(interaction.calls.replies[0].components.length, 1);

    assert.deepEqual(t.sent.sort(), ['HKC-2026-11-169742', 'HKC-2026-11-200']);
    assert.match(textOf(last(interaction)), /Zugestellt: 2/);
    assert.match(t.announced[0], /zugestellt 2/);
    t.store.close();
});

test('senden monat: Abbrechen, Zeitablauf und fremder Klick senden nichts', async () => {
    for (const click of [{ choice: 'no' }, undefined, { choice: 'yes', user: OTHER_DRIVER }]) {
        const t = setup();
        const interaction = await run(t, { sub: 'senden', options: { monat: '2026-11' }, click });

        assert.deepEqual(t.sent, []);
        assert.match(textOf(last(interaction)), /nichts versendet/);
        t.store.close();
    }
});

test('senden monat: nur versandbereite Fahrer, ein Fehler stoppt die anderen nicht', async () => {
    const { StoreError } = require('../src/billing/db');
    const t = setup({
        sendInvoice: async args => {
            if (args.number === 'HKC-2026-11-169742') throw new StoreError('Der Fahrer ist nicht auf dem Discord-Server.');
            return { number: args.number, delivery: 'failed', fallback: 'sent', dueAt: '2026-12-16T10:00:00.000Z', messages: 1 };
        },
    });

    const interaction = await run(t, { sub: 'senden', options: { monat: '2026-11' }, click: { choice: 'yes' } });
    const text = textOf(last(interaction));

    assert.match(text, /Fehler: \*\*1\*\*/);
    assert.match(text, /hundekuchen: Der Fahrer ist nicht auf dem Discord-Server/);
    assert.match(text, /Hinweis im Chat: 1\): \*\*1\*\*/);
    t.store.close();
});

test('senden monat: Monat ohne versandbereite Entwürfe', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'senden', options: { monat: '2026-12' }, click: { choice: 'yes' } });

    assert.match(textOf(last(interaction)), /keine versandbereiten Entwürfe/);
    assert.deepEqual(t.sent, []);
    t.store.close();
});

// --- Zahlung, Storno, Lauf ---

test('bezahlt: nur für versendete Rechnungen, wiederholbar', async () => {
    const t = setup();

    const draft = await run(t, { sub: 'bezahlt', options: { rechnung: 'HKC-2026-11-169742' } });
    assert.match(textOf(last(draft)), /versendet/);

    t.store.recordSendAttempt({ number: 'HKC-2026-11-169742', discordId: DRIVER, actor: '1', now: NOW });
    const paid = await run(t, { sub: 'bezahlt', options: { rechnung: 'hkc-2026-11-169742' } });
    assert.match(textOf(last(paid)), /Zahlung bestätigt/);
    assert.equal(t.store.getInvoice('HKC-2026-11-169742').paid_by, STAFF);
    assert.match(t.announced[0], /bezahlt/);

    const again = await run(t, { sub: 'bezahlt', options: { rechnung: 'HKC-2026-11-169742' } });
    assert.match(textOf(last(again)), /bereits als bezahlt/);
    assert.equal(t.announced.length, 1);
    t.store.close();
});

test('storno: mit Grund, gibt die Aufträge frei', async () => {
    const t = setup();

    const noReason = await run(t, { sub: 'storno', options: { rechnung: 'HKC-2026-11-169742', grund: '' } });
    assert.match(textOf(last(noReason)), /Begründung/);

    const done = await run(t, { sub: 'storno', options: { rechnung: 'HKC-2026-11-169742', grund: 'Ausnahme nachträglich erteilt' } });
    assert.match(textOf(last(done)), /storniert/);
    assert.equal(t.store.getInvoice('HKC-2026-11-169742').status, 'void');
    assert.match(t.announced[0], /Ausnahme nachträglich erteilt/);
    t.store.close();
});

test('lauf: führt den Tageslauf sofort aus', async () => {
    const t = setup();
    const interaction = await run(t, { sub: 'lauf' });

    const text = textOf(last(interaction));
    assert.match(text, /Lauf abgeschlossen/);
    assert.match(text, /Ausgewertet: \*\*3\*\*/);
    assert.match(text, /Neue Prüffälle: \*\*2\*\*/);

    t.ctx.runtime = null;
    const stopped = await run(t, { sub: 'lauf' });
    assert.match(textOf(last(stopped)), /Zeitplan/);

    t.ctx.runtime = { runNow: async () => ({ skipped: 'läuft bereits' }) };
    const skipped = await run(t, { sub: 'lauf' });
    assert.match(textOf(last(skipped)), /läuft bereits/);
    t.store.close();
});
