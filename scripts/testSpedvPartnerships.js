'use strict';
require('dotenv').config();
const axios = require('axios');

const base = (process.env.SPEDV_API_URL || 'https://api.sped-v.de').replace(/\/+$/, '');
const ownId = String(process.env.SPEDV_SPEDITION_ID || '108570');

function fail(label, error) {
    // Nie das Axios-Objekt ausgeben: es enthält den API-Key
    const reason = error.response?.status ?? error.code ?? error.message;
    throw new Error(`${label}: ${reason}`);
}

async function v1(pathWithQuery) {
    try {
        const { data } = await axios.get(`${base}${pathWithQuery}`, {
            headers: { 'X-Api-Key': process.env.SPEDV_API_KEY, Accept: 'application/json' },
            timeout: 15_000,
        });
        return data;
    } catch (error) {
        fail(pathWithQuery, error);
    }
}

async function legacyUsers(includePartnerships) {
    try {
        const { data } = await axios.get(`${base}/rest/api`, {
            params: {
                apikey: process.env.SPEDV_API_KEY,
                function: 'getusers',
                ...(includePartnerships ? { includePartnerships: true } : {}),
            },
            timeout: 15_000,
        });
        const result = data?.result;
        return Array.isArray(result) ? result : Object.values(result ?? {});
    } catch (error) {
        fail('getusers', error);
    }
}

const side = s => (s ? `${s.id} | ${s.shortName ?? '-'} | ${s.name ?? '-'}` : '-');

function countBySpedition(users) {
    const counts = new Map();
    for (const user of users) {
        const sp = user.Spedition ?? user.spedition;
        const key = sp ? `${sp.ID ?? sp.id} | ${sp.ShortName ?? sp.shortName ?? '-'}` : 'ohne Spedition';
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

(async () => {
    console.log(`Eigene Spedition: ${ownId}\n`);

    const partnerships = await v1('/v1/spedition/partnerships?onlyAccepted=false');
    console.log(`Partnerschaften (inkl. nicht angenommene): ${partnerships.length}`);
    for (const entry of partnerships) {
        const other = String(entry.initSpedition?.id) === ownId ? entry.objectSpedition : entry.initSpedition;
        console.log(`- Eintrag ${entry.id} | accepted=${entry.accepted} | Gegenseite: ${side(other)}`);
    }

    const own = await legacyUsers(false);
    const withPartners = await legacyUsers(true);
    console.log(`\nFahrer ohne Partnerschaften: ${own.length}`);
    console.log(`Fahrer mit includePartnerships: ${withPartners.length}`);
    for (const [key, count] of countBySpedition(withPartners)) {
        console.log(`- ${key}: ${count}`);
    }
})().catch(error => {
    console.error('Fehler:', error.message);
    process.exitCode = 1;
});
