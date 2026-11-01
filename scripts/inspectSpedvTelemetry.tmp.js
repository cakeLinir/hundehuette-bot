require('dotenv').config();

const { createSpedvV1Client } = require('../src/utils/speedBillingSpedvV1');

const HKC_SPEDITION_ID = '108570';

(async () => {
    const client = createSpedvV1Client();
    const tasks = await client.fetchTasks();

    let selected = null;

    for (const task of tasks) {
        if (Number(task.state) !== 2) continue;

        const details = await client.fetchTaskDetails(task.id);

        if (String(details.spedition?.id ?? '') !== HKC_SPEDITION_ID) continue;
        if (Number(details.state) !== 2) continue;
        if (details.ddCleaned === true) continue;

        if (!details.starttime || !details.endtime) continue;

        selected = { task, details };
        break;
    }

    if (!selected) {
        throw new Error('Kein geeigneter abgeschlossener HKC-Auftrag gefunden.');
    }

    const { task, details } = selected;
    const driveData = await client.fetchDriveData(task.id);

    const velocity = driveData.velocity;
    const timestamp = driveData.timestamp;

    console.log('\n=== AUFTRAG ===');
    console.log('Auftrags-ID:', task.id);
    console.log('Aufgabenstatus:', task.state);
    console.log('Detailstatus:', details.state);
    console.log('Auftragsbeginn:', details.starttime);
    console.log('Auftragsabschluss:', details.endtime);
    console.log('Telemetry bereinigt:', details.ddCleaned);

    console.log('\n=== TELEMETRIESTRUKTUR ===');
    console.log('Messpunkte:', velocity.length);
    console.log('Geschwindigkeit Datentyp:', typeof velocity[0]);
    console.log('Zeitstempel Datentyp:', typeof timestamp[0]);
    console.log('Erster Geschwindigkeitswert:', velocity[0]);
    console.log('Erster Zeitstempel:', timestamp[0]);
    console.log('Letzter Geschwindigkeitswert:', velocity.at(-1));
    console.log('Letzter Zeitstempel:', timestamp.at(-1));

    const samples = velocity.map((speed, index) => ({
        index,
        speed: Number(speed),
        timestamp: timestamp[index],
    }));

    const valid = samples.filter(item =>
        Number.isFinite(item.speed) &&
        item.speed >= 0 &&
        Number.isFinite(new Date(item.timestamp).getTime())
    );

    const max = valid.reduce((best, item) =>
        !best || item.speed > best.speed ? item : best,
        null
    );

    const start = new Date(details.starttime).getTime();
    const end = new Date(details.endtime).getTime();

    const outside = valid.filter(item => {
        const time = new Date(item.timestamp).getTime();
        return time < start || time > end;
    });

    console.log('\n=== MESSWERTANALYSE ===');
    console.log('Gültige Messpunkte:', valid.length);
    console.log('Ungültige Messpunkte:', samples.length - valid.length);
    console.log('Niedrigster Messwert:', Math.min(...valid.map(x => x.speed)));
    console.log('Höchster Messwert:', max?.speed ?? null);
    console.log('Zeitpunkt Höchstwert:', max?.timestamp ?? null);
    console.log('SpedV-Zusammenfassung:', details.maxVelocityKMH);
    console.log('Messpunkte außerhalb Auftragszeit:', outside.length);

    console.log('\n=== ERSTE 10 MESSPUNKTE ===');
    console.table(samples.slice(0, 10));

    console.log('\n=== HÖCHSTGESCHWINDIGKEIT ===');
    console.log(max);

    console.log('\n=== ZEITSTEMPEL AUSSERHALB DES AUFTRAGS ===');
    console.table(outside.slice(0, 10));

})().catch(error => {
    console.error('\nAnalyse fehlgeschlagen:', error.message);
    process.exitCode = 1;
});
