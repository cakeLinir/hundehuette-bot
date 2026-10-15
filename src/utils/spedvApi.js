const fs = require('fs');
const path = require('path');
const axios = require('axios');
const writeFileAtomic = require('write-file-atomic');
const logger = require('./logger');

const CACHE_MS = 60_000;

const dataDir = path.join(__dirname, '..', '..', 'data');
const linksPath = path.join(dataDir, 'etsLinks.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(linksPath)) fs.writeFileSync(linksPath, '{}');

let cache = { at: 0, users: [] };

const norm = v => String(v ?? '').trim().toLowerCase();

// Case-insensitiver Feldzugriff: die alte API liefert PascalCase (UserName), V1 camelCase (userName)
function get(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
  return found === undefined ? undefined : obj[found];
}

// DiscordUID ist int64 -> als JS-Number würde die ID gerundet (> 2^53). Deshalb vor dem Parsen zu String machen.
function parseSafe(raw) {
  if (typeof raw !== 'string') return raw;
  const fixed = raw.replace(/("discord_?uid"\s*:\s*)(\d{15,})/gi, '$1"$2"');
  try {
    return JSON.parse(fixed);
  } catch {
    return raw;
  }
}

/** Ruft die SpedV REST-API (bisherige Version) auf und gibt `result` zurück. */
async function call(fn, extraParams = {}) {
  try {
    const { data } = await axios.get(
      `${process.env.SPEDV_API_URL || 'https://api.sped-v.de'}/rest/api`,
      {
        params: { apikey: process.env.SPEDV_API_KEY, function: fn, ...extraParams },
        timeout: 10_000,
        transformResponse: [parseSafe],
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

// Einheitliches internes Format, unabhängig von API-Version und Schreibweise
function normalizeUser(raw) {
  return {
    id: get(raw, 'id'),
    userName: get(raw, 'userName'),
    inSped: get(raw, 'inSped'),
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

function findDriver(users, candidates) {
  const wanted = candidates.map(norm).filter(Boolean);
  const spedId = process.env.SPEDV_SPEDITION_ID;

  return users.find(u => {
    if (u.inSped === false) return false;
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

/** Liefert die verknüpfte Discord-ID (String) oder null, falls im SpedV-Profil keine hinterlegt ist. */
async function fetchDiscordUid(userId) {
  const profile = await call('getuserprofile', { id: userId });
  const raw = get(profile, 'discordUID');

  if (raw === undefined) {
    logger.warn('SpedV: Feld "DiscordUID" fehlt in getuserprofile (Fallback auf Namensabgleich)');
    return null;
  }
  const uid = String(raw ?? '');
  return uid && uid !== '0' ? uid : null;
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

module.exports = { fetchUsers, findDriver, isRankAllowed, fetchDiscordUid, getLinkOwner, setLink };
