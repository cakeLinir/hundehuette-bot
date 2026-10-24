const fs = require('fs');
const path = require('path');
const axios = require('axios');
const writeFileAtomic = require('write-file-atomic');

const CACHE_MS = 60_000;

const dataDir = path.join(__dirname, '..', '..', 'data');
const linksPath = path.join(dataDir, 'etsLinks.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(linksPath)) fs.writeFileSync(linksPath, '{}');

let cache = { at: 0, users: [] };

const norm = v => String(v ?? '').trim().toLowerCase();

// Case-insensitiver Feldzugriff: die alte API liefert PascalCase (UserName)
function get(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;
    const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return found === undefined ? undefined : obj[found];
}

/** Ruft die SpedV REST-API (bisherige Version) auf und gibt `result` zurück. */
async function call(fn, extraParams = {}) {
    try {
        const { data } = await axios.get(
            `${process.env.SPEDV_API_URL || 'https://api.sped-v.de'}/rest/api`,
            {
                params: { apikey: process.env.SPEDV_API_KEY, function: fn, ...extraParams },
                timeout: 10_000,
            }
        );
        if (!data || typeof data !== 'object' || data.error) {
            throw new Error(`API meldet Fehler: ${data?.msg ?? 'unbekannt'}`);
        }
        return data.result;
    } catch (err) {
        // Niemals das Axios-Error-Objekt loggen: enthält die URL mit apikey
        const reason = err.response?.status ?? err.code ?? err.message;
        throw new Error(`SpedV-API Fehler bei ${fn} (${reason})`);
    }
}

function toList(result) {
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
        const values = Object.values(result);
        if (values.length && values.every(v => v && typeof v === 'object')) return values;
    }
    return [];
}

// Einheitliches internes Format
function normalizeUser(raw) {
    return {
        id: get(raw, 'id'),
        userName: get(raw, 'userName'),
        inSped: get(raw, 'inSped'),
        joinDate: get(raw, 'speditionJoinDate') ?? null,
        rank: { name: get(get(raw, 'rank'), 'name') ?? null },
        spedition: { id: get(get(raw, 'spedition'), 'id') ?? null },
    };
}

async function fetchUsers() {
    if (Date.now() - cache.at < CACHE_MS && cache.users.length) return cache.users;

    const users = toList(await call('getusers')).map(normalizeUser);
    cache = { at: Date.now(), users };
    return users;
}

function findDriver(users, candidates, options = {}) {
    const wanted = candidates.map(norm).filter(Boolean);
    const spedId = process.env.SPEDV_SPEDITION_ID;
    const { includeInactive = false } = options;

    return users.find(u => {
        if (!includeInactive && u.inSped === false) return false;
        if (spedId && String(u.spedition.id) !== String(spedId)) return false;
        return wanted.includes(norm(u.userName));
    }) ?? null;
}

function isRankAllowed(user) {
    const allowed = (process.env.ETS_ALLOWED_RANKS ?? '')
        .split(',')
        .map(norm)
        .filter(Boolean);
    return allowed.includes(norm(user.rank?.name));
}

/** Liest nur das "Über mich"-Feld des Profils (für die Code-Verifizierung). */
async function fetchAboutMe(userId) {
    const profile = await call('getuserprofile', { id: userId });
    return String(get(profile, 'aboutMe') ?? '');
}

/** Liest nur die gefahrenen Kilometer aus dem Profil (für Beförderungsempfehlungen). */
async function fetchStats(userId) {
    const profile = await call('getuserprofile', { id: userId });
    const km = Number(get(profile, 'kmSum'));
    return { km: Number.isFinite(km) ? km : 0 };
}

function loadLinks() {
    return JSON.parse(fs.readFileSync(linksPath, 'utf-8'));
}

function getLinkOwner(spedvName) {
    return loadLinks()[norm(spedvName)] ?? null;
}

function setLink(spedvName, discordId) {
    const links = loadLinks();
    links[norm(spedvName)] = discordId;
    writeFileAtomic.sync(linksPath, JSON.stringify(links, null, 2));
}

module.exports = {
    fetchUsers, findDriver, isRankAllowed, fetchAboutMe, fetchStats, getLinkOwner, setLink,
};
