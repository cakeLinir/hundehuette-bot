'use strict';

require('dotenv').config();

const { createSpedvClient } = require('../src/billing/spedvClient');
const { openStore } = require('../src/billing/store');
const { runBilling } = require('../src/billing/runner');

function argument(name) {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Für ${name} fehlt ein Wert.`);
    return value;
}

function printList(title, list, format, limit = 10) {
    if (list.length === 0) return;
    console.log(`\n${title} (${list.length})`);
    for (const entry of list.slice(0, limit)) console.log(`  ${format(entry)}`);
    if (list.length > limit) console.log(`  ... und ${list.length - limit} weitere`);
}

const unitLabel = unit => (unit === 'mph' ? 'mph' : 'km/h');

async function main() {
    if (!process.env.HKC_BILLING_DB && !process.argv.includes('--use-default-db')) {
        throw new Error(
            'Abbruch: HKC_BILLING_DB ist nicht gesetzt. Für Tests z. B. $env:HKC_BILLING_DB=":memory:" setzen. ' +
            'Die Standarddatenbank wird nur mit --use-default-db verwendet.'
        );
    }

    const speditionId = process.env.SPEDV_SPEDITION_ID;
    if (!speditionId) throw new Error('SPEDV_SPEDITION_ID fehlt in der .env.');

    const nowArgument = argument('--now');
    const now = nowArgument ? new Date(nowArgument) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error('--now ist kein gültiger Zeitpunkt.');

    const store = openStore();

    try {
        const report = await runBilling({
            client: createSpedvClient(),
            store,
            speditionId,
            now,
            createDrafts: !process.argv.includes('--no-drafts'),
        });

        if (report.skipped) {
            console.log(report.skipped);
            return;
        }

        console.log('=== ABRECHNUNGSLAUF ===');
        console.log(`Zeitpunkt (simuliert):  ${now.toISOString()}`);
        console.log(`Dauer:                  ${(report.durationMs / 1000).toFixed(1)} s`);
        console.log(`Aufträge in der Liste:  ${report.listed}`);
        console.log(`Zu alt (übersprungen):  ${report.skippedOld}`);
        console.log(`Bereits bekannt:        ${report.skippedKnown}`);
        console.log(`Ausgewertet:            ${report.evaluated} (zurückgestellt: ${report.deferred})`);
        console.log(
            `Gespeichert:            ${report.stored.inserted} neu, ${report.stored.updated} aktualisiert, ${report.stored.unchanged} unverändert`
        );
        console.log(
            `Ergebnis:               ${report.outcomes.fine} Strafen, ${report.outcomes.clear} ohne Verstoß, ${report.outcomes.review} Prüffälle`
        );
        console.log(`Ignoriert:              ${JSON.stringify(report.ignored)}`);
        console.log(`Offene Aufträge:        ${report.openTaskCount} (Done/Paused)`);

        printList('Neue Strafen', report.newFines, f =>
            `${f.visibleId} | ${f.spedvName} | ${f.billingMonth} | ${f.game ?? '?'} | ` +
            `${f.maxSpeed ?? f.maxVelocityKmh} ${unitLabel(f.unit)} | ${f.fineEur} EUR`);
        printList('Neue Prüffälle', report.newReviews, r =>
            `${r.visibleId} | ${r.spedvName ?? 'unbekannt'} | ${r.game ?? '?'} | ${r.reason} | ${r.message}`);
        printList('Wieder geöffnet', report.reopened, r => `${r.visibleId} | ${r.spedvName} | ${r.message}`);
        printList('Rechnung prüfen (Status geändert)', report.staleInvoiced, r =>
            `${r.visibleId} | ${r.spedvName} | ${r.billingMonth} | ${r.message}`);
        printList('Rechnungsentwürfe', report.drafts.flatMap(batch => batch.drivers), d =>
            `${d.number ?? '-'} | ${d.created ? 'neu' : d.updated ? 'ergänzt' : d.reason} | ${d.totalEur ?? '-'} EUR`);
        printList('Fällige Erinnerungen', report.dueReminders, i => `${i.number} | fällig seit ${i.due_at}`);
        printList('Fehler', report.errors, e => `${e.taskId} | ${e.message}`);
    } finally {
        store.close();
    }
}

main().catch(error => {
    console.error('\nAbrechnungslauf fehlgeschlagen:');
    console.error(error.message);
    process.exitCode = 1;
});
