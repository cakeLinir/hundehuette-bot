const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const writeFileAtomic = require('write-file-atomic');

const TTL_MS = 30 * 60 * 1000; // Code ist 30 Minuten gültig

const dataDir = path.join(__dirname, '..', '..', 'data');
const pendingPath = path.join(dataDir, 'etsPending.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(pendingPath)) fs.writeFileSync(pendingPath, '{}');

function load() {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    } catch {
        data = {};
    }
    // Abgelaufene Codes entfernen
    for (const [id, entry] of Object.entries(data)) {
        if (entry.expiresAt < Date.now()) delete data[id];
    }
    return data;
}

function save(data) {
    writeFileAtomic.sync(pendingPath, JSON.stringify(data, null, 2));
}

function getPending(discordId) {
    return load()[discordId] ?? null;
}

function createPending(discordId, spedvName) {
    const data = load();
    const code = `HKC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    data[discordId] = { spedvName, code, expiresAt: Date.now() + TTL_MS };
    save(data);
    return data[discordId];
}

function clearPending(discordId) {
    const data = load();
    delete data[discordId];
    save(data);
}

function codeInText(text, code) {
    return String(text ?? '').toUpperCase().includes(String(code).toUpperCase());
}

module.exports = { getPending, createPending, clearPending, codeInText, TTL_MS };
