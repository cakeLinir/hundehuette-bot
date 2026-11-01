'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const writeFileAtomic = require('write-file-atomic');

const CACHE_MS = 60_000;

const dataDir = path.join(__dirname, '..', '..', 'data');
const linksPath = path.resolve(
    process.env.ETS_LINKS_PATH || path.join(dataDir, 'etsLinks.json')
);

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(linksPath)) {
    fs.mkdirSync(path.dirname(linksPath), { recursive: true });
    fs.writeFileSync(linksPath, '{}', 'utf8');
}

let cache = { at: 0, users: [] };

const norm = value =>
    String(value ?? '').trim().toLocaleLowerCase('de-DE');

function get(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;

    const found = Object.keys(obj).find(
        current => current.toLowerCase() === key.toLowerCase()
    );

    return found === undefined ? undefined : obj[found];
}

async function call(fn, extraParams = {}) {
    try {
        const { data } = await axios.get(
            `${process.env.SPEDV_API_URL || 'https://api.sped-v.de'}/rest/api`,
            {
                params: {
                    apikey: process.env.SPEDV_API_KEY,
                    function: fn,
                    ...extraParams,
                },
                timeout: 10_000,
            }
        );

        if (!data || typeof data !== 'object' || data.error) {
            throw new Error(`API meldet Fehler: ${data?.msg ?? 'unbekannt'}`);
        }

        return data.result;
    } catch (err) {
        const reason = err.response?.status ?? err.code ?? err.message;
        throw new Error(`SpedV-API Fehler bei ${fn} (${reason})`);
    }
}

function toList(result) {
    if (Array.isArray(result)) return result;

    if (result && typeof result === 'object') {
        const values = Object.values(result);

        if (values.length && values.every(value =>
            value && typeof value === 'object'
        )) {
            return values;
        }
    }

    return [];
}

function normalizeUser(raw) {
    return {
        id: get(raw, 'id'),
        userName: get(raw, 'userName'),
        inSped: get(raw, 'inSped'),
        joinDate: get(raw, 'speditionJoinDate') ?? null,
        rank: {
            name: get(get(raw, 'rank'), 'name') ?? null,
        },
        spedition: {
            id: get(get(raw, 'spedition'), 'id') ?? null,
        },
    };
}

async function fetchUsers() {
    if (Date.now() - cache.at < CACHE_MS && cache.users.length) {
        return cache.users;
    }

    const users = toList(await call('getusers')).map(normalizeUser);
    cache = { at: Date.now(), users };

    return users;
}

function findDriver(users, candidates, options = {}) {
    const wanted = candidates.map(norm).filter(Boolean);
    const spedId = process.env.SPEDV_SPEDITION_ID;
    const { includeInactive = false } = options;

    return users.find(user => {
        if (!includeInactive && user.inSped === false) return false;

        if (
            spedId &&
            String(user.spedition.id) !== String(spedId)
        ) {
            return false;
        }

        return wanted.includes(norm(user.userName));
    }) ?? null;
}

function isRankAllowed(user) {
    const allowed = (process.env.ETS_ALLOWED_RANKS ?? '')
        .split(',')
        .map(norm)
        .filter(Boolean);

    return allowed.includes(norm(user.rank?.name));
}

async function fetchAboutMe(userId) {
    const profile = await call('getuserprofile', { id: userId });
    return String(get(profile, 'aboutMe') ?? '');
}

async function fetchStats(userId) {
    const profile = await call('getuserprofile', { id: userId });
    const km = Number(get(profile, 'kmSum'));

    return {
        km: Number.isFinite(km) ? km : 0,
    };
}

function loadLinks() {
    let links;

    try {
        links = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
    } catch (error) {
        throw new Error(
            `etsLinks.json konnte nicht gelesen werden (${error.message}).`
        );
    }

    if (!links || typeof links !== 'object' || Array.isArray(links)) {
        throw new TypeError('etsLinks.json muss ein JSON-Objekt enthalten.');
    }

    return links;
}

function normalizeLink(spedvName, value) {
    if (typeof value === 'string' || typeof value === 'number') {
        const discordId = String(value).trim();

        return {
            spedvName: String(spedvName).trim(),
            discordId,
            spedvUserId: null,
            verified: false,
            legacy: true,
        };
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(
            `Ungültiger Link-Datensatz für SpedV-Nutzer ${spedvName}.`
        );
    }

    const cleanName = String(value.spedvName || spedvName).trim();
    const discordId = String(value.discordId ?? '').trim();
    const spedvUserId = String(value.spedvUserId ?? '').trim();

    return {
        spedvName: cleanName,
        discordId,
        spedvUserId: spedvUserId || null,
        verified:
            /^\d{17,20}$/.test(discordId) &&
            /^\d+$/.test(spedvUserId),
        legacy: false,
    };
}

function getNormalizedEntries(links) {
    const entries = new Map();

    for (const [name, value] of Object.entries(links)) {
        const link = normalizeLink(name, value);

        if (norm(link.spedvName) !== key) {
            throw new Error(
                `Inkonsistenter SpedV-Name in etsLinks.json: Schlüssel "${name}", gespeicherter Name "${link.spedvName}".`
            );
        }

        entries.set(key, {
            key,
            originalName: name,
            link,
        });
    }

    return [...entries.values()];
}

function getLinkRecord(spedvName) {
    const key = norm(spedvName);
    if (!key) return null;

    const entries = getNormalizedEntries(loadLinks());
    const match = entries.find(entry => entry.key === key);

    return match?.link ?? null;
}

function getLinkOwner(spedvName) {
    return getLinkRecord(spedvName)?.discordId ?? null;
}

function getLinkRecordBySpedvUserId(spedvUserId) {
    const targetId = String(spedvUserId ?? '').trim();
    if (!/^\d+$/.test(targetId)) return null;

    const entries = getNormalizedEntries(loadLinks());
    const matches = entries.filter(
        entry => entry.link.spedvUserId === targetId
    );

    if (matches.length > 1) {
        throw new Error(
            `SpedV-ID ${targetId} ist mehrfach in etsLinks.json eingetragen.`
        );
    }

    return matches[0]?.link ?? null;
}

function setLink(spedvName, discordId, spedvUserId) {
    const key = norm(spedvName);
    const cleanName = String(spedvName ?? '').trim();
    const cleanDiscordId = String(discordId ?? '').trim();
    const cleanSpedvUserId = String(spedvUserId ?? '').trim();

    if (!key || !cleanName) {
        throw new TypeError('Ein gültiger SpedV-Name ist erforderlich.');
    }

    if (!/^\d{17,20}$/.test(cleanDiscordId)) {
        throw new TypeError('Ungültige Discord-ID für SpedV-Verknüpfung.');
    }

    if (!/^\d+$/.test(cleanSpedvUserId)) {
        throw new TypeError('Ungültige SpedV-Nutzer-ID für Verknüpfung.');
    }

    const links = loadLinks();
    const entries = getNormalizedEntries(links);

    const sameName = entries.find(entry => entry.key === key);

    if (sameName) {
        const existing = sameName.link;

        if (
            existing.discordId &&
            existing.discordId !== cleanDiscordId
        ) {
            throw new Error(
                'Dieser SpedV-Name ist bereits mit einem anderen Discord-Konto verknüpft.'
            );
        }

        if (
            existing.spedvUserId &&
            existing.spedvUserId !== cleanSpedvUserId
        ) {
            throw new Error(
                'Dieser SpedV-Name gehört laut bestehender Verknüpfung zu einer anderen SpedV-Nutzer-ID. Die Änderung wird abgelehnt.'
            );
        }
    }

    for (const entry of entries) {
        const existing = entry.link;

        if (
            existing.spedvUserId === cleanSpedvUserId &&
            existing.discordId &&
            existing.discordId !== cleanDiscordId
        ) {
            throw new Error(
                'Diese SpedV-Nutzer-ID ist bereits mit einem anderen Discord-Konto verknüpft.'
            );
        }
    }

    // Eine Namensänderung wird nur bei identischer SpedV-ID
    // und identischer Discord-ID übernommen.
    for (const entry of entries) {
        const existing = entry.link;

        if (
            entry.key !== key &&
            existing.spedvUserId === cleanSpedvUserId &&
            existing.discordId === cleanDiscordId
        ) {
            delete links[entry.originalName];
        }
    }

    links[key] = {
        discordId: cleanDiscordId,
        spedvUserId: cleanSpedvUserId,
        spedvName: cleanName,
    };

    writeFileAtomic.sync(
        linksPath,
        JSON.stringify(links, null, 2),
        { encoding: 'utf8' }
    );
}

function getSpedvNamesByDiscordId(discordId) {
    const targetId = String(discordId);
    const entries = getNormalizedEntries(loadLinks());

    return entries
        .filter(entry => entry.link.discordId === targetId)
        .map(entry => entry.link.spedvName);
}

function getSpedvLinksByDiscordId(discordId) {
    const targetId = String(discordId);
    const entries = getNormalizedEntries(loadLinks());

    return entries
        .filter(entry => entry.link.discordId === targetId)
        .map(entry => entry.link);
}

function getVerifiedSpedvLinksByDiscordId(discordId) {
    return getSpedvLinksByDiscordId(discordId)
        .filter(link => link.verified);
}

module.exports = {
    fetchUsers,
    findDriver,
    isRankAllowed,
    fetchAboutMe,
    fetchStats,
    getLinkOwner,
    getLinkRecord,
    getLinkRecordBySpedvUserId,
    getSpedvNamesByDiscordId,
    getSpedvLinksByDiscordId,
    getVerifiedSpedvLinksByDiscordId,
    setLink,
};