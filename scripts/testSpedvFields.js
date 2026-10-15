require('dotenv').config();
const axios = require('axios');
const { fetchUsers } = require('../src/utils/spedvApi');

async function fieldsOf(fn, params = {}) {
    try {
        const { data } = await axios.get('https://api.sped-v.de/rest/api', {
            params: { apikey: process.env.SPEDV_API_KEY, function: fn, ...params },
            timeout: 10_000,
        });
        const result = data?.result;
        const first = Array.isArray(result) ? result[0] : result;
        const keys = first && typeof first === 'object' ? Object.keys(first) : [];
        return { error: data?.error, list: Array.isArray(result), keys };
    } catch (err) {
        return { error: `HTTP ${err.response?.status ?? err.code ?? 'unbekannt'}`, list: false, keys: [] };
    }
}

(async () => {
    const [me] = await fetchUsers();

    const tests = [
        ['getusers', {}],
        ['getuserprofile', { id: me.id }],
        ['getuserprofiles', {}],
    ];

    for (const [fn, params] of tests) {
        const r = await fieldsOf(fn, params);
        console.log(`\n${fn} | error=${r.error} | liste=${r.list}`);
        console.log(r.keys.join(', ') || '(keine Felder)');
    }
})().catch(err => {
    console.error('Fehler:', err.message);
    process.exit(1);
});
