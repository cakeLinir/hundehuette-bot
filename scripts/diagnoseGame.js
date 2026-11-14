'use strict';

require('dotenv').config();
const axios = require('axios');

const base = (process.env.SPEDV_API_URL || 'https://api.sped-v.de').replace(/\/+$/, '');
const given = process.argv.slice(2).filter(value => /^\d+$/.test(value));
const TASK_IDS = given.length ? given : ['12658819', '12658843', '12657450'];

async function v1(pathname, params) {
    try {
        const { data } = await axios.get(`${base}${pathname}`, {
            params,
            headers: { 'X-Api-Key': process.env.SPEDV_API_KEY, Accept: 'application/json' },
            timeout: 60_000,
        });
        return data;
    } catch (error) {
        // Kein Axios-Objekt ausgeben: es enthält den API-Key
        throw new Error(`${pathname}: ${error.response?.status ?? error.code ?? error.message}`);
    }
}

function topValues(values, count = 4) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([value, n]) => `${value} (${n}x)`)
        .join(', ');
}

(async () => {
    const all = await v1('/v1/tasks');
    console.log(`--- Filter game ---\nStandard (-1): ${all.length} Aufträge`);

    for (const game of [0, 1]) {
        const list = await v1('/v1/tasks', { game });
        const found = TASK_IDS.filter(id => list.some(task => String(task.id) === id));
        console.log(`game=${game}: ${list.length} Aufträge | enthalten: ${found.join(', ') || '-'}`);
    }

    for (const id of TASK_IDS) {
        const item = all.find(task => String(task.id) === id);
        const details = await v1(`/v1/tasks/${id}/details`);
        const drive = await v1(`/v1/tasks/${id}/drivedata`);

        console.log(`\n--- Auftrag ${id} ---`);
        console.log(`Liste: state=${item?.state} currency=${item?.currency} income=${item?.income}`);
        console.log(
            `Details: game=${details.game} currency=${details.currency} symbol=${details.currencySymbol} ` +
            `isRealScale=${details.isRealScale}`
        );
        console.log(
            `Tempo: maxKMH=${details.maxVelocityKMH} maxMPH=${details.maxVelocityMPH} ` +
            `avgKMH=${details.avgVelocityKMH} avgMPH=${details.avgVelocityMPH}`
        );
        console.log(`Strecke: distKM=${details.distKM} distMI=${details.distMI}`);
        console.log(
            `Felder mit game/mph/mi/dollar: ${Object.keys(details).filter(key => /game|mph|mi$|dollar|scs/i.test(key)).join(', ')}`
        );

        const velocities = drive.map(point => point.velocity).filter(Number.isFinite);
        const limits = drive.map(point => point.speedLimit).filter(value => Number.isFinite(value) && value > 0);
        console.log(
            `Telemetrie: ${drive.length} Punkte | max velocity=${Math.max(...velocities)} | ` +
            `häufigste speedLimit: ${topValues(limits)}`
        );
    }
})().catch(error => {
    console.error('Fehler:', error.message);
    process.exitCode = 1;
});
