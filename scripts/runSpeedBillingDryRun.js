
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
    buildDryRunPlan,
} = require('../src/utils/speedBillingSpedvAdapter');

function arg(name) {
    const index = process.argv.indexOf(name);

    if (index < 0) return null;

    const value = process.argv[index + 1];

    if (!value || value.startsWith('--')) {
        throw new Error(`Für ${name} fehlt ein Wert.`);
    }

    return value;
}

function printUsage() {
    console.log(`
HKC Speed Billing – Offline Dry-Run

Verwendung:
  node scripts/runSpeedBillingDryRun.js --input <offline-export.json> --config <mapping.json> [--output <report.json>]

Parameter:
  --input    SpedV-Export im JSON-Format
  --config   Dry-Run-Konfiguration im JSON-Format
  --output   Optionaler Speicherort für den Prüfbericht
  --help     Diese Hilfe anzeigen

Sicherheit:
  Keine SpedV-API-Aufrufe
  Keine Discord-Aktionen
  Keine Abrechnungsdaten werden verändert
  Vorhandene Ausgabedateien werden nicht überschrieben
`);
}

function readJsonFile(filePath, description) {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`${description} nicht gefunden: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
        throw new Error(`${description} ist keine reguläre Datei: ${resolvedPath}`);
    }

    let content;

    try {
        content = fs.readFileSync(resolvedPath, 'utf8');
    } catch (error) {
        throw new Error(
            `${description} konnte nicht gelesen werden: ${error.message}`
        );
    }

    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(
            `${description} enthält ungültiges JSON: ${error.message}`
        );
    }
}

function validateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Die Konfiguration muss ein JSON-Objekt sein.');
    }

    if (config.mode !== 'offline-dry-run') {
        throw new Error(
            'Abbruch: mode muss exakt "offline-dry-run" sein.'
        );
    }

    if (
        config.velocityUnit !== undefined &&
        !['kmh', 'ms'].includes(config.velocityUnit)
    ) {
        throw new Error(
            'velocityUnit muss "kmh" oder "ms" sein.'
        );
    }

    if (
        config.billingStartDate !== undefined &&
        typeof config.billingStartDate !== 'string'
    ) {
        throw new Error(
            'billingStartDate muss als Zeichenkette im Format YYYY-MM-DD angegeben werden.'
        );
    }
}

function writeReport(outputPath, output) {
    const resolvedPath = path.resolve(outputPath);
    const directory = path.dirname(resolvedPath);

    if (!fs.existsSync(directory)) {
        throw new Error(
            `Ausgabeverzeichnis existiert nicht: ${directory}`
        );
    }

    if (fs.existsSync(resolvedPath)) {
        throw new Error(
            `Ausgabedatei existiert bereits und wird nicht überschrieben: ${resolvedPath}`
        );
    }

    try {
        fs.writeFileSync(
            resolvedPath,
            `${output}\n`,
            {
                encoding: 'utf8',
                flag: 'wx',
            }
        );
    } catch (error) {
        if (error.code === 'EEXIST') {
            throw new Error(
                `Ausgabedatei existiert bereits: ${resolvedPath}`
            );
        }

        throw new Error(
            `Prüfbericht konnte nicht gespeichert werden: ${error.message}`
        );
    }

    return resolvedPath;
}

function printSummary(report) {
    console.log('');
    console.log('========================================');
    console.log(' HKC SPEED BILLING – DRY-RUN ERGEBNIS');
    console.log('========================================');

    console.log(`Abrechnungsbeginn: ${report.billingStartDate}`);
    console.log(`Zeitzone:          ${report.billingTimeZone}`);
    console.log(`Geprüfte Aufträge: ${report.processedTaskCount}`);
    console.log(`Strafkandidaten:   ${report.fineCandidateCount}`);
    console.log(
        `Strafsumme:        ${report.proposedFineTotalEur.toLocaleString('de-DE')} EUR`
    );

    const statusCounts = {};

    for (const item of report.items) {
        statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    }

    console.log('');
    console.log('Statusübersicht:');

    for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`  ${status}: ${count}`);
    }

    console.log('');
    console.log('Sicherheitsstatus:');
    console.log(`  API-Aufrufe:       ${report.apiCallsPerformed ? 'JA' : 'NEIN'}`);
    console.log(`  Daten geschrieben: ${report.writesPerformed ? 'JA' : 'NEIN'}`);
    console.log(
        `  Discord-Aktionen:  ${report.discordActionsPerformed ? 'JA' : 'NEIN'}`
    );

    console.log('========================================');
}

function main() {
    if (process.argv.includes('--help')) {
        printUsage();
        return;
    }

    const inputPath = arg('--input');
    const configPath = arg('--config');
    const outputPath = arg('--output');

    if (!inputPath || !configPath) {
        printUsage();
        process.exitCode = 2;
        return;
    }

    const resolvedInput = path.resolve(inputPath);
    const resolvedConfig = path.resolve(configPath);

    if (resolvedInput === resolvedConfig) {
        throw new Error(
            'Input- und Konfigurationsdatei dürfen nicht identisch sein.'
        );
    }

    if (outputPath) {
        const resolvedOutput = path.resolve(outputPath);

        if (
            resolvedOutput === resolvedInput ||
            resolvedOutput === resolvedConfig
        ) {
            throw new Error(
                'Der Prüfbericht darf weder Input- noch Konfigurationsdatei überschreiben.'
            );
        }
    }

    const snapshot = readJsonFile(
        resolvedInput,
        'SpedV-Export'
    );

    const config = readJsonFile(
        resolvedConfig,
        'Dry-Run-Konfiguration'
    );

    validateConfig(config);

    const report = buildDryRunPlan(snapshot, config);

    // Zusätzliche Sicherheitsprüfung vor der Ausgabe.
    if (
        report.apiCallsPerformed !== false ||
        report.writesPerformed !== false ||
        report.discordActionsPerformed !== false
    ) {
        throw new Error(
            'Sicherheitsprüfung fehlgeschlagen: Der Bericht meldet unerwartete Live-Aktionen.'
        );
    }

    const output = JSON.stringify(report, null, 2);

    printSummary(report);

    if (outputPath) {
        const savedPath = writeReport(outputPath, output);

        console.log('');
        console.log(`Prüfbericht gespeichert: ${savedPath}`);
    }

    console.log('');
    console.log(
        'DRY-RUN abgeschlossen: Keine API-Aufrufe, keine Discord-Aktionen und keine Abrechnungsdaten geschrieben.'
    );
}

try {
    main();
} catch (error) {
    console.error('');
    console.error(`DRY-RUN ABGEBROCHEN: ${error.message}`);
    process.exitCode = 1;
}
