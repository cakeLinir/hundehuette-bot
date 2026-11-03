'use strict';

const axios = require('axios');

const TIMEOUT_MS = 15_000;

function baseUrl() {
    return String(process.env.SPEDV_API_URL || 'https://api.sped-v.de').replace(/\/+$/, '');
}

function describe(error) {
    return error.response?.status ?? error.code ?? error.message;
}

function get(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;
    const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return found === undefined ? undefined : obj[found];
}

function cleanText(value) {
    const text = String(value ?? '').trim();
    return text || null;
}

function requireOwnSpeditionId() {
    const id = String(process.env.SPEDV_SPEDITION_ID ?? '').trim();
    if (!/^\d+$/.test(id)) {
        throw new Error('SPEDV_SPEDITION_ID fehlt oder ist ungültig.');
    }
    return id;
}

function toList(result) {
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
        const values = Object.values(result);
        if (values.length && values.every(v => v && typeof v === 'object')) return values;
    }
    return [];
}

/**
 * Liefert alle Partnerspeditionen mit angenommener Partnerschaft.
 * Doppelte Einträge (eingehend/ausgehend) werden nach Speditions-ID zusammengefasst.
 */
async function fetchAcceptedPartners() {
    const ownId = requireOwnSpeditionId();

    let entries;
    try {
        const { data } = await axios.get(`${baseUrl()}/v1/spedition/partnerships`, {
            params: { onlyAccepted: true },
            headers: { 'X-Api-Key': process.env.SPEDV_API_KEY, Accept: 'application/json' },
            timeout: TIMEOUT_MS,
        });
        if (!Array.isArray(data)) {
            throw new Error('Antwort ist kein Array');
        }
        entries = data;
    } catch (error) {
        // Niemals das Axios-Objekt loggen: enthält den API-Key
        throw new Error(`SpedV-Partnerschaften nicht abrufbar (${describe(error)})`);
    }

    const partners = new Map();
    for (const entry of entries) {
        if (get(entry, 'accepted') !== true) continue;

        const sides = [get(entry, 'initSpedition'), get(entry, 'objectSpedition')];
        const ids = sides.map(side => String(get(side, 'id') ?? ''));
        const ownIndex = ids.indexOf(ownId);
        if (ownIndex === -1) continue;

        const otherIndex = ownIndex === 0 ? 1 : 0;
        const otherId = ids[otherIndex];
        if (!/^\d+$/.test(otherId) || otherId === ownId || partners.has(otherId)) continue;

        partners.set(otherId, {
            id: otherId,
            shortName: cleanText(get(sides[otherIndex], 'shortName')),
            name: cleanText(get(sides[otherIndex], 'name')),
        });
    }

    return [...partners.values()];
}

/**
 * Liefert aktive Fahrer der übergebenen Partnerspeditionen (alte REST-API, includePartnerships).
 * Hinweis: SpedV liefert hier nicht für jede Partnerspedition alle Fahrer.
 * @param {Iterable<string>} partnerIds
 */
async function fetchPartnerUsers(partnerIds) {
    const allowed = new Set([...partnerIds].map(String));

    let result;
    try {
        const { data } = await axios.get(`${baseUrl()}/rest/api`, {
            params: {
                apikey: process.env.SPEDV_API_KEY,
                function: 'getusers',
                includePartnerships: true,
            },
            timeout: TIMEOUT_MS,
        });
        if (!data || typeof data !== 'object' || data.error) {
            throw new Error(`API meldet Fehler: ${data?.msg ?? 'unbekannt'}`);
        }
        result = data.result;
    } catch (error) {
        throw new Error(`SpedV-Partnerfahrer nicht abrufbar (${describe(error)})`);
    }

    return toList(result)
        .map(raw => ({
            id: String(get(raw, 'id') ?? ''),
            userName: cleanText(get(raw, 'userName')),
            inSped: get(raw, 'inSped'),
            spedition: { id: String(get(get(raw, 'spedition'), 'id') ?? '') },
        }))
        .filter(user =>
            /^\d+$/.test(user.id) &&
            user.userName &&
            allowed.has(user.spedition.id) &&
            user.inSped !== false
        );
}

/**
 * Lädt ein einzelnes Profil per ID (funktioniert auch für Fahrer von Partnerspeditionen,
 * die getusers nicht liefert).
 * @returns {Promise<{id:string,userName:string,inSped:*,aboutMe:string,spedition:{id:string}}|null>}
 *   null = Profil nicht gefunden/ungültig. Wirft bei API-Problemen.
 */
async function fetchPartnerProfile(userId) {
    const id = String(userId ?? '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Ungültige SpedV-Nutzer-ID.');

    let result;
    try {
        const { data } = await axios.get(`${baseUrl()}/rest/api`, {
            params: { apikey: process.env.SPEDV_API_KEY, function: 'getuserprofile', id },
            timeout: TIMEOUT_MS,
        });
        if (!data || typeof data !== 'object' || data.error) {
            throw new Error(`API meldet Fehler: ${data?.msg ?? 'unbekannt'}`);
        }
        result = data.result;
    } catch (error) {
        throw new Error(`SpedV-Profil nicht abrufbar (${describe(error)})`);
    }

    if (!result || typeof result !== 'object') return null;

    const profileId = String(get(result, 'id') ?? '');
    const userName = cleanText(get(result, 'userName'));
    if (profileId !== id || !userName) return null;

    return {
        id,
        userName,
        inSped: get(result, 'inSped'),
        aboutMe: String(get(result, 'aboutMe') ?? ''),
        spedition: { id: String(get(get(result, 'spedition'), 'id') ?? '') },
    };
}

module.exports = { fetchAcceptedPartners, fetchPartnerUsers, fetchPartnerProfile };
