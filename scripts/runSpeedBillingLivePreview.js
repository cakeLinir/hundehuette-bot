
'use strict';

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');

const {
    createSpedvV1Client,
} = require('../src/utils/speedBillingSpedvV1');

const {
    buildLivePreview,
} = require('../src/utils/speedBillingLivePreview');

function getArgument(name) {
    const index = process.argv.indexOf(name);

    if (index === -1) {
        return null;
    }

    const value = process.argv[index + 1];

    if (!value || value.startsWith('--')) {
        throw new Error(`Für ${name} fehlt ein Wert.`);
    }

    return value;
}

function createDefaultOutputPath(month) {
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-');

    return path.resolve(
        `./data/speedBillingPreviews/${month}-${timestamp}.json`
    );
}

async function main() {
    const month = process.argv[2];

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error(
            'Bitte den Abrechnungsmonat angeben, z. B.: node scripts/runSpeedBillingLivePreview.js 2026-11'
        );
    }

    if (!process.env.SPEDV_API_KEY) {
        throw new Error(
            'SPEDV_API_KEY fehlt. Bitte die .env-Konfiguration prüfen.'
        );
    }

    const linksPath = path.resolve(
        process.env.ETS_LINKS_PATH || './data/etsLinks.json'
    );

    const linksRaw = await fs.readFile(linksPath, 'utf8');
    const links = JSON.parse(linksRaw);

    const client = createSpedvV1Client();

    console.log(`Starte SpedV-Live-Prüfung für ${month} ...`);

    const report = await buildLivePreview({
        client,
        links,
        month,
    });

    console.log('\n=== HKC GESCHWINDIGKEITS-PRÜFBERICHT ===');
    console.log(`Monat:                 ${report.month}`);
    console.log(`SpedV-Aufträge:        ${report.sourceTaskCount}`);
    console.log(`Abgeschlossene Jobs:   ${report.settledTaskCount}`);
    console.log(`HKC-Aufträge:          ${report.hkcTaskCount}`);
    console.log(`Andere Speditionen:    ${report.ignoredOtherSpeditionCount}`);
    console.log(`Strafkandidaten:       ${report.fineCandidateCount}`);
    console.log(`Ohne Verstoß:          ${report.noViolationCount}`);
    console.log(`Manuelle Prüfung:      ${report.reviewCount}`);
    console.log(
        `Vorgeschlagene Summe:  ${Number(report.proposedFineTotalEur || 0).toFixed(2)} EUR`
    );

    console.log('\n=== EINZELERGEBNISSE ===');

    for (const item of report.items) {
        const speed = Number.isFinite(item.maxVelocityKmh)
            ? `${item.maxVelocityKmh} km/h`
            : 'kein belastbarer Geschwindigkeitswert';

        const fine = Number.isFinite(item.fineEur)
            ? `${item.fineEur.toFixed(2)} EUR`
            : 'keine automatische Berechnung';

        console.log(
            `${item.taskId} | ${item.status} | ${item.spedvName || 'unbekannt'} | ${speed} | ${fine}`
        );

        if (item.reason) {
            console.log(`  Grund: ${item.reason}`);
        }
    }

    console.log('\n=== SICHERHEITSSTATUS ===');
    console.log(`Schreibvorgänge:       ${report.writesPerformed ? 'JA' : 'NEIN'}`);
    console.log(`Discord-Aktionen:      ${report.discordActionsPerformed ? 'JA' : 'NEIN'}`);

    if (report.writesPerformed || report.discordActionsPerformed) {
        throw new Error(
            'Sicherheitsprüfung fehlgeschlagen: Unerwartete Aktion erkannt.'
        );
    }

    const requestedOutput = getArgument('--output');

    const outputPath = requestedOutput
        ? path.resolve(requestedOutput)
        : createDefaultOutputPath(month);

    await fs.mkdir(path.dirname(outputPath), {
        recursive: true,
    });

    // wx verhindert, dass eine vorhandene Preview-Datei überschrieben wird.
    await fs.writeFile(
        outputPath,
        `${JSON.stringify(report, null, 2)}\n`,
        {
            encoding: 'utf8',
            flag: 'wx',
        }
    );

    console.log(`\nLive-Preview gespeichert: ${outputPath}`);
    console.log('Es wurden keine Abrechnungsdaten verändert.');
}

main().catch(error => {
    console.error('\nLive-Preview fehlgeschlagen:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
