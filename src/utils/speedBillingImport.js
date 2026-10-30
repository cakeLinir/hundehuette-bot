
'use strict';

const crypto = require('node:crypto');

const {
    BILLING_START_MONTH,
    calculateFine,
    recordImportBatch,
} = require('./speedBillingStore');

const {
    monthInBerlin,
} = require('./speedBillingLivePreview');


const REVIEW_STATUS_PREFIX = 'review_';

const ALLOWED_REVIEW_STATUSES = new Set([
    'pending_evidence',
    'review_cleaned_telemetry',
    'review_missing_telemetry',
    'review_incomplete_telemetry',
    'review_speed_conflict',
    'review_details_unavailable',
    'review_missing_completion_time',
    'review_unverified_driver_link',
]);

function requireText(value, label) {
    const result = String(value ?? '').trim();

    if (!result) {
        throw new TypeError(`${label} fehlt.`);
    }

    return result;
}

function isObject(value) {
    return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value);
}

function isReviewStatus(status) {
    return typeof status === 'string' &&
        (
            ALLOWED_REVIEW_STATUSES.has(status) ||
            status.startsWith(REVIEW_STATUS_PREFIX)
        );
}

function validateMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
        throw new TypeError(
            'Abrechnungsmonat muss im Format YYYY-MM angegeben werden.'
        );
    }

    if (month < BILLING_START_MONTH) {
        throw new Error(
            `Import gesperrt: Abrechnungsbeginn ist ${BILLING_START_MONTH}.`
        );
    }
}

function validTimestamp(value) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return false;
    }

    return Number.isFinite(new Date(value).getTime());
}

function deriveBillingMonth(item) {
    if (
        typeof item.billingMonth === 'string' &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(item.billingMonth)
    ) {
        return item.billingMonth;
    }

    if (validTimestamp(item.completedAt)) {
        return monthInBerlin(item.completedAt);
    }

    return null;
}

function makePlanId(payload) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex')
        .slice(0, 20);
}

function createReviewOperation(item, report) {
    const taskId = requireText(item.taskId, 'taskId');

    const billingMonth = deriveBillingMonth(item);

    if (billingMonth !== null) {
        validateMonth(billingMonth);
    }

    const status = isReviewStatus(item.status)
        ? item.status
        : 'pending_evidence';

    const discordUserId = item.discordUserId
        ? String(item.discordUserId).trim()
        : null;

    const spedvUserId = item.spedvUserId
        ? String(item.spedvUserId).trim()
        : null;

    const spedvName = item.spedvName
        ? String(item.spedvName).trim()
        : null;

    return {
        type: 'review',
        guildId: requireText(report.guildId, 'guildId'),
        taskId,
        billingMonth,
        discordUserId: discordUserId || null,
        spedvUserId: spedvUserId || null,
        spedvName: spedvName || null,
        status,
        reason: String(
            item.reason ||
            'Manuelle Nachweisprüfung erforderlich.'
        ),
    };
}

function createJobOperation(item, report) {
    const taskId = requireText(item.taskId, 'taskId');
    const guildId = requireText(report.guildId, 'guildId');
    const billingMonth = deriveBillingMonth(item);

    if (!validTimestamp(item.completedAt)) {
        throw new Error(
            `Auftrag ${taskId}: Abschlusszeitpunkt fehlt oder ist ungültig.`
        );
    }

    if (!billingMonth) {
        throw new Error(
            `Auftrag ${taskId}: Abrechnungsmonat konnte nicht bestimmt werden.`
        );
    }

    validateMonth(billingMonth);

    if (billingMonth !== report.month) {
        throw new Error(
            `Auftrag ${taskId}: Monatsabweichung. Vorschau=${report.month}, Auftrag=${billingMonth}.`
        );
    }

    const spedvUserId = requireText(
        item.spedvUserId,
        `Auftrag ${taskId}: SpedV-Fahrer-ID`
    );

    const discordUserId = requireText(
        item.discordUserId,
        `Auftrag ${taskId}: Discord-Fahrer-ID`
    );

    const maxVelocityKmh = Number(item.maxVelocityKmh);

    if (
        item.maxVelocityKmh === null ||
        item.maxVelocityKmh === undefined ||
        item.maxVelocityKmh === '' ||
        !Number.isFinite(maxVelocityKmh) ||
        maxVelocityKmh < 0
    ) {
        throw new Error(
            `Auftrag ${taskId}: Höchstgeschwindigkeit ist ungültig.`
        );
    }

    const calculation = calculateFine(maxVelocityKmh);

    if (
        item.status === 'fine_candidate' &&
        calculation.status !== 'fine_assessed'
    ) {
        throw new Error(
            `Auftrag ${taskId}: Vorschau und Store-Berechnung widersprechen sich. Erwartet wurde ein Verstoß.`
        );
    }

    if (
        item.status === 'no_violation' &&
        calculation.status !== 'no_violation'
    ) {
        throw new Error(
            `Auftrag ${taskId}: Vorschau und Store-Berechnung widersprechen sich. Erwartet wurde kein Verstoß.`
        );
    }

    if (
        item.fineEur !== undefined &&
        Number(item.fineEur) !== calculation.fineEur
    ) {
        throw new Error(
            `Auftrag ${taskId}: Abweichender Strafbetrag. Vorschau=${item.fineEur}, Store=${calculation.fineEur}.`
        );
    }

    if (
        item.excessKmh !== undefined &&
        Number(item.excessKmh) !== calculation.excessKmh
    ) {
        throw new Error(
            `Auftrag ${taskId}: Abweichende Überschreitung. Vorschau=${item.excessKmh}, Store=${calculation.excessKmh}.`
        );
    }

    return {
        type: 'job',
        guildId,
        taskId,
        spedvUserId,
        discordUserId,
        completedAt: new Date(item.completedAt).toISOString(),
        maxVelocityKmh,
        evidenceSource: String(
            item.evidenceSource || 'SpedV-v1-drivedata'
        ),
        expectedStatus: calculation.status,
        expectedFineEur: calculation.fineEur,
        expectedExcessKmh: calculation.excessKmh,
    };
}

/**
 * Erstellt aus einer Live-Vorschau einen Importplan.
 *
 * Diese Funktion schreibt keine Daten.
 * Sie ruft keine Discord-Aktionen auf.
 */
function buildImportPlan(report, options = {}) {
    if (!isObject(report)) {
        throw new TypeError('Live-Vorschau ist kein gültiges Objekt.');
    }

    if (report.mode !== 'live-preview') {
        throw new Error(
            'Import abgebrochen: Es wurde keine Live-Preview übergeben.'
        );
    }

    const month = requireText(
        report.month,
        'Abrechnungsmonat der Vorschau'
    );

    validateMonth(month);

    if (!Array.isArray(report.items)) {
        throw new TypeError(
            'Live-Vorschau enthält keine gültige items-Liste.'
        );
    }

    const guildId = requireText(
        options.guildId ?? report.guildId,
        'guildId'
    );

    const operations = [];
    const rejected = [];
    const seenTaskIds = new Set();

    let fineCandidateCount = 0;
    let noViolationCount = 0;
    let reviewCount = 0;

    for (let index = 0; index < report.items.length; index += 1) {
        const item = report.items[index];

        try {
            if (!isObject(item)) {
                throw new TypeError(
                    'Eintrag ist kein gültiges Objekt.'
                );
            }

            const taskId = requireText(
                item.taskId,
                `Eintrag ${index}: taskId`
            );

            if (seenTaskIds.has(taskId)) {
                throw new Error(
                    `Auftrag ${taskId} kommt mehrfach in der Vorschau vor.`
                );
            }

            seenTaskIds.add(taskId);

            let operation;

            if (isReviewStatus(item.status)) {
                operation = createReviewOperation(item, {
                    ...report,
                    guildId,
                });

                reviewCount += 1;
            } else if (
                item.status === 'fine_candidate' ||
                item.status === 'no_violation'
            ) {
                operation = createJobOperation(item, {
                    ...report,
                    guildId,
                });

                if (item.status === 'fine_candidate') {
                    fineCandidateCount += 1;
                } else {
                    noViolationCount += 1;
                }
            } else {
                throw new Error(
                    `Unbekannter Importstatus: ${String(item.status)}`
                );
            }

            operations.push(operation);
        } catch (error) {
            rejected.push({
                index,
                taskId: item?.taskId == null
                    ? null
                    : String(item.taskId),
                status: item?.status == null
                    ? null
                    : String(item.status),
                reason: error.message,
            });
        }
    }

    const planPayload = {
        version: 1,
        mode: 'dry-run',
        month,
        guildId,
        sourceGeneratedAt: report.generatedAt || null,
        createdAt: new Date().toISOString(),
        sourceTaskCount: Number(report.sourceTaskCount || 0),
        operationCount: operations.length,
        fineCandidateCount,
        noViolationCount,
        reviewCount,
        rejectedCount: rejected.length,
        operations,
        rejected,
    };

    const planId = makePlanId(planPayload);

    return {
        ...planPayload,
        planId,
        writesPerformed: false,
        discordActionsPerformed: false,
        readyToCommit: rejected.length === 0,
    };
}

/**
 * Prüft einen Importplan nochmals vor dem Schreiben.
 */
function validateImportPlan(plan) {
    if (!isObject(plan)) {
        throw new TypeError('Importplan ist ungültig.');
    }

    if (plan.version !== 1 || plan.mode !== 'dry-run') {
        throw new Error(
            'Importplan-Version oder Modus ist nicht zulässig.'
        );
    }

    validateMonth(plan.month);
    requireText(plan.guildId, 'guildId');
    requireText(plan.planId, 'planId');

    if (!Array.isArray(plan.operations)) {
        throw new TypeError(
            'Importplan enthält keine gültige operations-Liste.'
        );
    }

    if (!Array.isArray(plan.rejected)) {
        throw new TypeError(
            'Importplan enthält keine gültige rejected-Liste.'
        );
    }

    if (plan.rejected.length > 0) {
        throw new Error(
            `Commit gesperrt: ${plan.rejected.length} Eintrag/Einträge wurden beim Planaufbau abgelehnt.`
        );
    }

    const expectedId = makePlanId({
        version: plan.version,
        mode: plan.mode,
        month: plan.month,
        guildId: plan.guildId,
        sourceGeneratedAt: plan.sourceGeneratedAt,
        createdAt: plan.createdAt,
        sourceTaskCount: plan.sourceTaskCount,
        operationCount: plan.operationCount,
        fineCandidateCount: plan.fineCandidateCount,
        noViolationCount: plan.noViolationCount,
        reviewCount: plan.reviewCount,
        rejectedCount: plan.rejectedCount,
        operations: plan.operations,
        rejected: plan.rejected,
    });

    if (expectedId !== plan.planId) {
        throw new Error(
            'Commit gesperrt: Importplan-ID stimmt nicht mit dem Inhalt überein. Der Plan wurde möglicherweise verändert.'
        );
    }

    for (const operation of plan.operations) {
        if (!isObject(operation)) {
            throw new TypeError(
                'Importplan enthält eine ungültige Operation.'
            );
        }

        if (operation.guildId !== plan.guildId) {
            throw new Error(
                'Importplan enthält eine abweichende guildId.'
            );
        }

        requireText(operation.taskId, 'taskId');

        if (operation.type === 'review') {
            if (!isReviewStatus(operation.status)) {
                throw new Error(
                    `Auftrag ${operation.taskId}: ungültiger Review-Status.`
                );
            }

            if (
                operation.billingMonth !== null &&
                operation.billingMonth !== undefined
            ) {
                validateMonth(operation.billingMonth);
            }
        } else if (operation.type === 'job') {
            if (
                operation.expectedStatus !== 'fine_assessed' &&
                operation.expectedStatus !== 'no_violation'
            ) {
                throw new Error(
                    `Auftrag ${operation.taskId}: ungültiger Bewertungsstatus.`
                );
            }

            validateMonth(monthInBerlin(operation.completedAt));

            if (
                monthInBerlin(operation.completedAt) !== plan.month
            ) {
                throw new Error(
                    `Auftrag ${operation.taskId}: Abschlussmonat stimmt nicht mit dem Planmonat überein.`
                );
            }
        } else {
            throw new Error(
                `Unbekannter Operationstyp: ${String(operation.type)}`
            );
        }
    }

    return true;
}


function applyImportPlan(plan, options = {}) {
    validateImportPlan(plan);

    if (plan.operations.length === 0) {
        throw new Error(
            'Commit gesperrt: Der Importplan enthält keine Operationen.'
        );
    }

    const startedAt = new Date().toISOString();

    const batchResult = recordImportBatch(
        plan.operations,
        options.actorDiscordId ?? null
    );

    return {
        planId: plan.planId,
        month: plan.month,
        guildId: plan.guildId,
        startedAt,
        completedAt: new Date().toISOString(),
        attemptedCount: batchResult.attemptedCount,
        createdCount: batchResult.createdCount,
        updatedCount: batchResult.updatedCount,
        duplicateCount: batchResult.duplicateCount,
        reviewCaseCount: batchResult.reviewCaseCount,
        jobCount: batchResult.jobCount,
        failedCount: batchResult.failedCount,
        writesPerformed: batchResult.writesPerformed,
        discordActionsPerformed: false,
        results: batchResult.results,
        success: batchResult.failedCount === 0,
    };
}


module.exports = {
    buildImportPlan,
    validateImportPlan,
    applyImportPlan,
};
