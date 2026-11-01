
'use strict';

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');

const {
    buildImportPlan,
    validateImportPlan,
    applyImportPlan,
} = require('../src/utils/speedBillingImport');

const {
    assertCommitHasOperations,
} = require('../src/utils/speedBillingCommitGuard');

const {
    getLinkRecordBySpedvUserId,
} = require('../src/utils/spedvApi');

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

function hasFlag(name) {
    return process.argv.includes(name);
}

function printPlan(plan) {
    console.log('\n=== HKC SPEED-BILLING IMPORTPLAN ===');
    console.log(`Plan-ID:                 ${plan.planId}`);
    console.log(`Abrechnungsmonat:        ${plan.month}`);
    console.log(`Discord-Server-ID:       ${plan.guildId}`);
    console.log(`Quellaufträge:           ${plan.sourceTaskCount}`);
    console.log(`Geplante Operationen:    ${plan.operationCount}`);
    console.log(`Strafkandidaten:         ${plan.fineCandidateCount}`);
    console.log(`Ohne Verstoß:            ${plan.noViolationCount}`);
    console.log(`Manuelle Prüfung:        ${plan.reviewCount}`);
    console.log(`Abgelehnte Einträge:     ${plan.rejectedCount}`);
    console.log(`Schreibvorgänge:         ${plan.writesPerformed ? 'JA' : 'NEIN'}`);
    console.log(`Discord-Aktionen:        ${plan.discordActionsPerformed ? 'JA' : 'NEIN'}`);
    console.log(`Commit freigegeben:      ${plan.readyToCommit ? 'JA' : 'NEIN'}`);
    console.log(`Davon ohne Monatszuordnung: ${plan.unassignedReviewCount || 0}`);
    if (plan.rejected.length > 0) {
        console.log('\n=== ABGELEHNTE EINTRÄGE ===');

        for (const entry of plan.rejected) {
            console.log(
                `Index ${entry.index} | Auftrag ${entry.taskId || 'unbekannt'} | ${entry.reason}`
            );
        }
    }

    console.log('\n=== GEPLANTE OPERATIONEN ===');

    for (const operation of plan.operations) {
        if (operation.type === 'job') {
            console.log(
                `${operation.taskId} | JOB | ${operation.expectedStatus} | ${operation.maxVelocityKmh} km/h | ${operation.expectedFineEur.toFixed(2)} EUR | Discord ${operation.discordUserId}`
            );
        } else {
            console.log(
                `${operation.taskId} | REVIEW | ${operation.status} | Monat ${operation.billingMonth || 'global'} | ${operation.reason}`
            );
        }
    }
}

async function createDryRun() {
    const previewArgument = getArgument('--preview');
    const guildId = getArgument('--guild-id');

    if (!previewArgument || !guildId) {
        throw new Error(
            'Dry-Run benötigt --preview <JSON-Datei> und --guild-id <Discord-Server-ID>.'
        );
    }

    const previewPath = path.resolve(previewArgument);
    const previewRaw = await fs.readFile(previewPath, 'utf8');
    const report = JSON.parse(previewRaw);

    console.log(`Live-Preview: ${previewPath}`);

    const plan = buildImportPlan(report, {
        guildId,
    });

    printPlan(plan);

    const planDirectory = path.resolve(
        './data/speedBillingImportPlans'
    );

    await fs.mkdir(planDirectory, {
        recursive: true,
    });

    const planPath = path.join(
        planDirectory,
        `${plan.month}-${plan.planId}.json`
    );

    // Keine vorhandenen Importpläne überschreiben.
    await fs.writeFile(
        planPath,
        `${JSON.stringify(plan, null, 2)}\n`,
        {
            encoding: 'utf8',
            flag: 'wx',
        }
    );

    console.log(`\nImportplan gespeichert: ${planPath}`);

    if (!plan.readyToCommit) {
        console.error(
            '\nDRY-RUN NICHT COMMIT-BEREIT: Es gibt abgelehnte Einträge.'
        );
        process.exitCode = 2;
        return;
    }

    validateImportPlan(plan);

    console.log('\nDRY-RUN ERFOLGREICH.');
    console.log('Es wurden keine Abrechnungsdaten geschrieben.');
    console.log('Für einen Commit ist eine separate Bestätigung erforderlich.');
}

function assertCurrentDriverLinks(plan) {
    const checkedDrivers = new Map();

    for (const operation of plan.operations) {
        if (operation.type !== 'job') {
            continue;
        }

        const spedvUserId = String(operation.spedvUserId ?? '').trim();
        const discordUserId = String(operation.discordUserId ?? '').trim();

        if (!/^\d+$/.test(spedvUserId)) {
            throw new Error(
                `Commit gesperrt: Ungültige SpedV-ID bei Auftrag ${operation.taskId}.`
            );
        }

        if (!/^\d{17,20}$/.test(discordUserId)) {
            throw new Error(
                `Commit gesperrt: Ungültige Discord-ID bei Auftrag ${operation.taskId}.`
            );
        }

        let currentLink = checkedDrivers.get(spedvUserId);

        if (!currentLink) {
            currentLink = getLinkRecordBySpedvUserId(spedvUserId);

            if (!currentLink || currentLink.verified !== true) {
                throw new Error(
                    `Commit gesperrt: Keine aktuelle verifizierte Verknüpfung für SpedV-ID ${spedvUserId}.`
                );
            }

            checkedDrivers.set(spedvUserId, currentLink);
        }

        if (String(currentLink.discordId) !== discordUserId) {
            throw new Error(
                `Commit gesperrt: Discord-Zuordnung für SpedV-ID ${spedvUserId} hat sich geändert. Auftrag ${operation.taskId}.`
            );
        }
    }

    console.log(
        `Aktuelle Fahrer-Verknüpfungen geprüft: ${checkedDrivers.size}`
    );
}

async function commitPlan() {
    const planArgument = getArgument('--commit');
    const confirmationId = getArgument('--confirm-plan-id');

    if (!planArgument) {
        throw new Error('Für den Commit fehlt die Importplandatei.');
    }

    if (!confirmationId) {
        throw new Error(
            'Commit gesperrt: --confirm-plan-id <exakte Plan-ID> fehlt.'
        );
    }

    if (!hasFlag('--allow-production-write')) {
        throw new Error(
            'Commit gesperrt: --allow-production-write muss ausdrücklich angegeben werden.'
        );
    }

    const planPath = path.resolve(planArgument);
    const planRaw = await fs.readFile(planPath, 'utf8');
    const plan = JSON.parse(planRaw);

    if (confirmationId !== plan.planId) {
        throw new Error(
            'Commit gesperrt: Die angegebene Bestätigungs-ID stimmt nicht exakt mit der Plan-ID überein.'
        );
    }

    validateImportPlan(plan);
    
    assertCurrentDriverLinks(plan);

    assertCommitHasOperations(plan);

    console.log('\n=== COMMIT-BESTÄTIGUNG ===');
    console.log(`Importplan:              ${planPath}`);
    console.log(`Plan-ID:                 ${plan.planId}`);
    console.log(`Abrechnungsmonat:        ${plan.month}`);
    console.log(`Geplante Operationen:    ${plan.operationCount}`);
    console.log(`Bestätigungs-ID:         ${confirmationId}`);
    console.log('Explizite Schreibfreigabe: JA');

    const storePath = path.resolve(
        process.env.HKC_BILLING_DATA_PATH || './data/speedBilling.json'
    );

    console.log(`Zieldatei:               ${storePath}`);

    const result = await applyImportPlan(plan);

    console.log('\n=== COMMIT-ERGEBNIS ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.failedCount > 0) {
        console.error(
            '\nWARNUNG: Mindestens eine Operation ist fehlgeschlagen.'
        );
        console.error(
            'Der Import ist nicht atomar. Bereits erfolgreich gespeicherte Operationen bleiben bestehen.'
        );
        process.exitCode = 1;
        return;
    }

    console.log('\nCOMMIT ABGESCHLOSSEN.');
    console.log(`Erstellte Datensätze: ${result.createdCount}`);
    console.log(`Aktualisierte Datensätze: ${result.updatedCount}`);
    console.log(`Duplikate: ${result.duplicateCount}`);
    console.log(`Schreibvorgänge durchgeführt: ${result.writesPerformed ? 'JA' : 'NEIN'}`);
    console.log('Discord-Aktionen: NEIN');
}

async function main() {
    if (hasFlag('--commit')) {
        if (hasFlag('--preview')) {
            throw new Error(
                '--preview darf nicht zusammen mit --commit verwendet werden.'
            );
        }

        await commitPlan();
        return;
    }

    if (
        hasFlag('--allow-production-write') ||
        hasFlag('--confirm-plan-id')
    ) {
        throw new Error(
            'Bestätigungsparameter sind nur im Commit-Modus zulässig.'
        );
    }

    await createDryRun();
}

main().catch(error => {
    console.error('\nSpeed-Billing-Import fehlgeschlagen:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
