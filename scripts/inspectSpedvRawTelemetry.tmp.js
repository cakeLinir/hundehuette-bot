require('dotenv').config();

const axios = require('axios');

(async () => {
    const apiKey = process.env.SPEDV_API_KEY;
    const baseUrl = (process.env.SPEDV_API_URL || 'https://api.sped-v.de')
        .replace(/\/+$/, '');

    const taskId = '12656323';

    const config = {
        headers: {
            'X-Api-Key': apiKey,
            Accept: 'application/json',
        },
        timeout: 30000,
    };

    const [driveResponse, detailResponse] = await Promise.all([
        axios.get(`${baseUrl}/v1/tasks/${taskId}/drivedata`, config),
        axios.get(`${baseUrl}/v1/tasks/${taskId}/details`, config),
    ]);

    const points = driveResponse.data;
    const details = detailResponse.data;

    if (!Array.isArray(points)) {
        throw new Error('Telemetrie ist kein Array.');
    }

    const limitCounts = new Map();

    for (const point of points) {
        const key = String(point.speedLimit);
        limitCounts.set(key, (limitCounts.get(key) || 0) + 1);
    }

    const zeroLimitPoints = points.filter(
        point => Number(point.speedLimit) === 0
    );

    const negativePoints = points.filter(
        point => Number(point.velocity) < 0
    );

    const validVelocities = points
        .map(point => Number(point.velocity))
        .filter(value => Number.isFinite(value) && value >= 0);

    console.log('\n=== AUFTRAGSDETAIL ===');
    console.log('Auftrags-ID:', details.id);
    console.log('Status:', details.state);
    console.log('Start:', details.starttime);
    console.log('Ende:', details.endtime);
    console.log('SpedV-Höchstgeschwindigkeit:', details.maxVelocityKMH);

    console.log('\n=== SPEEDLIMIT-VERTEILUNG ===');
    console.table(
        [...limitCounts.entries()].map(([speedLimit, count]) => ({
            speedLimit,
            count,
        }))
    );

    console.log('\n=== MESSPUNKTE MIT SPEEDLIMIT 0 ===');
    console.table(zeroLimitPoints.slice(0, 15).map(point => ({
        timestamp: point.timestamp,
        velocity: point.velocity,
        speedLimit: point.speedLimit,
        mpServer: point.mpServer,
    })));

    console.log('\n=== NEGATIVE MESSPUNKTE ===');
    console.table(negativePoints.map(point => ({
        timestamp: point.timestamp,
        velocity: point.velocity,
        speedLimit: point.speedLimit,
    })));

    console.log('\n=== VERGLEICH ===');
    console.log(
        'Telemetrie-Maximum:',
        Math.max(...validVelocities)
    );
    console.log(
        'SpedV-Maximum:',
        details.maxVelocityKMH
    );
    console.log(
        'Anzahl speedLimit-0-Punkte:',
        zeroLimitPoints.length
    );
})().catch(error => {
    console.error(
        'Diagnose fehlgeschlagen:',
        error.response?.status || error.message
    );
    process.exitCode = 1;
});
