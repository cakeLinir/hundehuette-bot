'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Nie die echte data/etsLinks.json anfassen: eigene Datei im Temp-Ordner
const linksFile = path.join(os.tmpdir(), `hkc-links-test-${process.pid}.json`);
process.env.ETS_LINKS_PATH = linksFile;

const { removeLink, getLinkRecord } = require('../src/utils/spedvApi');

const ID_A = '333006296611684352';
const ID_B = '444006296611684352';

function writeLinks(data) {
    fs.writeFileSync(linksFile, JSON.stringify(data, null, 2), 'utf8');
}

const readLinks = () => JSON.parse(fs.readFileSync(linksFile, 'utf8'));

test.after(() => fs.rmSync(linksFile, { force: true }));

test('Entfernt über die SpedV-ID nur diesen Eintrag', () => {
    writeLinks({
        hundekuchen: { discordId: ID_A, spedvUserId: '169742', spedvName: 'hundekuchen' },
        'marc-': { discordId: ID_B, spedvUserId: '189001', spedvName: 'MARC-' },
    });

    const removed = removeLink({ spedvUserId: '189001' });
    assert.equal(removed.discordId, ID_B);
    assert.deepEqual(Object.keys(readLinks()), ['hundekuchen']);
    assert.equal(getLinkRecord('MARC-'), null);
});

test('Alter Eintrag ohne SpedV-ID wird über den Namen entfernt', () => {
    writeLinks({ 'marc-': ID_B, hundekuchen: { discordId: ID_A, spedvUserId: '169742', spedvName: 'hundekuchen' } });

    const removed = removeLink({ spedvUserId: '189001', spedvName: 'MARC-' });
    assert.equal(removed.discordId, ID_B);
    assert.deepEqual(Object.keys(readLinks()), ['hundekuchen']);
});

test('Unbekannter Fahrer: null, Datei bleibt unverändert', () => {
    const data = { hundekuchen: { discordId: ID_A, spedvUserId: '169742', spedvName: 'hundekuchen' } };
    writeLinks(data);

    assert.equal(removeLink({ spedvUserId: '999', spedvName: 'niemand' }), null);
    assert.deepEqual(readLinks(), data);
});

test('Name gehört zu einer anderen SpedV-ID: Abbruch, nichts wird entfernt', () => {
    const data = { hundekuchen: { discordId: ID_A, spedvUserId: '169742', spedvName: 'hundekuchen' } };
    writeLinks(data);

    assert.throws(() => removeLink({ spedvUserId: '555', spedvName: 'hundekuchen' }), /anderen SpedV-Nutzer-ID/);
    assert.deepEqual(readLinks(), data);
});

test('Ohne Angabe oder mit ungültiger ID: Fehler', () => {
    writeLinks({});
    assert.throws(() => removeLink({}), TypeError);
    assert.throws(() => removeLink({ spedvUserId: 'abc' }), TypeError);
});
