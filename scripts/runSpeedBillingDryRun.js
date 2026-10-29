'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildDryRunPlan } = require('../src/utils/speedBillingSpedvAdapter');

function arg(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const inputPath = arg('--input');
const configPath = arg('--config');
const outputPath = arg('--output');
if (!inputPath || !configPath) {
    console.error('Verwendung: node scripts/runSpeedBillingDryRun.js --input <offline-export.json> --config <mapping.json> [--output <report.json>]');
    process.exitCode = 2;
} else {
    try {
        const snapshot = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
        const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
        const report = buildDryRunPlan(snapshot, config);
        const output = JSON.stringify(report, null, 2);
        if (outputPath) fs.writeFileSync(path.resolve(outputPath), output + '\n', { encoding: 'utf8', flag: 'wx' });
        console.log(output);
        console.error('\nDRY-RUN: Keine API-Aufrufe, keine Discord-Aktionen und keine Abrechnungsdaten geschrieben.');
    } catch (error) {
        console.error(`Dry-Run abgebrochen: ${error.message}`);
        process.exitCode = 1;
    }
}
