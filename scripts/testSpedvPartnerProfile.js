'use strict';
require('dotenv').config();
const axios = require('axios');

const base = (process.env.SPEDV_API_URL || 'https://api.sped-v.de').replace(/\/+$/, '');
const PARTNER_ID = process.argv[2] || '107162';

async function legacy(fn, params = {}) {
    try {
        const { data } = await axios.get(`${base}/rest/api`, {
            params: { apikey: process.env.SPEDV_API_KEY, function: fn, ...params },
            timeout: 15_000,
        });
        if (!data || data.error) throw new Error(data?.msg ?? 'API-Fehler');
        return data.result;
    } catch (error) {
        // Kein Axios-Objekt ausgeben: es enthält den API-Key
        throw new Error(`${fn}: ${error.response?.status ?? error.code ?? error.message}`);
    }
}

const pick = (obj, key) => {
    const found = Object.keys(obj ?? {}).find(k => k.toLowerCase() === key.toLowerCase());
    return found === undefined ? undefined : obj[found];
};

(async () => {
    const raw = await legacy('getusers', { includePartnerships: true });
    const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});

    const partner = list.find(user => String(pick(pick(user, 'spedition'), 'id')) === String(PARTNER_ID));
    if (!partner) {
        console.log(`Kein Fahrer der Spedition ${PARTNER_ID} gefunden.`);
        return;
    }

    const profile = await legacy('getuserprofile', { id: pick(partner, 'id') });
    console.log('Profil lesbar: ja');
    console.log('Felder:', Object.keys(profile ?? {}).join(', '));
    console.log('AboutMe vorhanden:', typeof pick(profile, 'aboutMe') === 'string');
})().catch(error => {
    console.error('Fehler:', error.message);
    process.exitCode = 1;
});
