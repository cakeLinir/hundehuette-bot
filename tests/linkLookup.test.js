'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { discordIdOfLink, findDiscordIdForDriver } = require('../src/utils/linkLookup');

const ID_A = '333006296611684352';
const ID_B = '444006296611684352';

const links = {
    hundekuchen: { discordId: ID_A, spedvUserId: '169742', spedvName: 'hundekuchen' },
    'aaron kentovski': { discordId: ID_B, spedvUserId: '189001', spedvName: 'Aaron Kentovski' },
};

test('Neues Format: Discord-ID wird über die SpedV-ID gefunden', () => {
    assert.equal(findDiscordIdForDriver(links, { id: 189001, userName: 'Irgendwas' }), ID_B);
});

test('Neues Format: Fallback über den Namen, ohne Beachtung der Schreibweise', () => {
    assert.equal(findDiscordIdForDriver(links, { userName: 'Aaron Kentovski' }), ID_B);
    assert.equal(findDiscordIdForDriver(links, { id: 189001, userName: 'AARON KENTOVSKI' }), ID_B);
});

test('Altes Format (Text oder Zahl) funktioniert weiter', () => {
    assert.equal(findDiscordIdForDriver({ alt: ID_A }, { userName: 'Alt' }), ID_A);
    assert.equal(findDiscordIdForDriver({ alt: Number('123456789012345678') }, { userName: 'alt' }), '123456789012345678');
});

test('Ergebnis ist nie "[object Object]", sondern eine ID oder null', () => {
    const broken = { kaputt: { spedvUserId: '5', spedvName: 'Kaputt' } };
    assert.equal(findDiscordIdForDriver(broken, { id: 5, userName: 'Kaputt' }), null);
    assert.equal(discordIdOfLink({ spedvUserId: '5' }), null);
    assert.equal(discordIdOfLink({ discordId: { verschachtelt: true } }), null);
});

test('Ungültige IDs werden nicht verwendet', () => {
    assert.equal(discordIdOfLink('123'), null);
    assert.equal(discordIdOfLink(''), null);
    assert.equal(discordIdOfLink(null), null);
    assert.equal(discordIdOfLink(undefined), null);
    assert.equal(discordIdOfLink({ discordId: 'abc' }), null);
    assert.equal(discordIdOfLink(ID_A), ID_A);
});

test('Gleicher Name, aber anderes SpedV-Konto: kein Ping an die falsche Person', () => {
    assert.equal(findDiscordIdForDriver(links, { id: 999999, userName: 'hundekuchen' }), null);
});

test('Namensänderung in SpedV: die SpedV-ID entscheidet', () => {
    assert.equal(findDiscordIdForDriver(links, { id: 169742, userName: 'hundekuchen_neu' }), ID_A);
});

test('Ungültige Eingaben ergeben null statt eines Fehlers', () => {
    assert.equal(findDiscordIdForDriver(null, { userName: 'x' }), null);
    assert.equal(findDiscordIdForDriver([], { userName: 'x' }), null);
    assert.equal(findDiscordIdForDriver(links, null), null);
    assert.equal(findDiscordIdForDriver(links, {}), null);
});
