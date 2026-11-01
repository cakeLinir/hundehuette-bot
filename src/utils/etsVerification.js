'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const writeFileAtomic = require('write-file-atomic');

const TTL_MS = 30 * 60 * 1000;

const dataDir = path.join(__dirname, '..', '..', 'data');
const pendingPath = path.join(dataDir, 'etsPending.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(pendingPath)) {
    fs.writeFileSync(pendingPath, '{}', 'utf8');
}

function load() {
    let data;

    try {
        data = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    } catch (error) {
        throw new Error(
            `etsPending.json konnte nicht gelesen werden (${error.message}).`
        );
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('etsPending.json muss ein JSON-Objekt enthalten.');
    }

    let changed = false;

    for (const [id, entry] of Object.entries(data)) {
        if (
            !entry ||
            typeof entry !== 'object' ||
            !Number.isFinite(Number(entry.expiresAt)) ||
            Number(entry.expiresAt) < Date.now()
        ) {
            delete data[id];
            changed = true;
        }
    }

    if (changed) save(data);

    return data;
}

function save(data) {
    writeFileAtomic.sync(
        pendingPath,
        JSON.stringify(data, null, 2),
        { encoding: 'utf8' }
    );
}

function getPending(discordId) {
    return load()[String(discordId)] ?? null;
}

function createPending(discordId, spedvName, spedvUserId) {
    const cleanDiscordId = String(discordId ?? '').trim();
    const cleanSpedvName = String(spedvName ?? '').trim();
    const cleanSpedvUserId = String(spedvUserId ?? '').trim();

    if (!/^\d{17,20}$/.test(cleanDiscordId)) {
        throw new TypeError('Ungültige Discord-ID für Verifizierung.');
    }

    if (!cleanSpedvName) {
        throw new TypeError('SpedV-Name für Verifizierung fehlt.');
    }

    if (!/^\d+$/.test(cleanSpedvUserId)) {
        throw new TypeError('Ungültige SpedV-ID für Verifizierung.');
    }

    const data = load();
    const code = `HKC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    data[cleanDiscordId] = {
        discordId: cleanDiscordId,
        spedvName: cleanSpedvName,
        spedvUserId: cleanSpedvUserId,
        code,
        createdAt: Date.now(),
        expiresAt: Date.now() + TTL_MS,
    };

    save(data);

    return data[cleanDiscordId];
}

function clearPending(discordId) {
    const data = load();
    delete data[String(discordId)];
    save(data);
}

function codeInText(text, code) {
    return String(text ?? '')
        .toUpperCase()
        .includes(String(code).toUpperCase());
}

module.exports = {
    getPending,
    createPending,
    clearPending,
    codeInText,
    TTL_MS,
};