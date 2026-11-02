'use strict';

const SPEED_LIMIT_KMH = 95;
const FINE_PER_KMH_EUR = 100;
const SETTLED_STATE = 2;
const DEFAULT_SPEDITION_ID = '108570';
const TIME_ZONE = 'Europe/Berlin';

function norm(value) {
    return String(value ?? '').trim().toLocaleLowerCase('de-DE');
}

function monthInBerlin(value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(new Date(value));

    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;

    return `${year}-${month}`;
}

function validTimestamp(value) {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(new Date(value).getTime());
}

function validateMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
        throw new TypeError('Abrechnungsmonat muss YYYY-MM sein.');
    }
}

function readLinks(links) {
    if (!links || typeof links !== 'object' || Array.isArray(links)) {
        throw new TypeError('etsLinks muss ein JSON-Objekt sein.');
    }

    const byName = new Map();
    const byId = new Map();

    for (const [name, value] of Object.entries(links)) {
        const key = norm(name);

        if (!key) {
            throw new Error('etsLinks enthält einen leeren SpedV-Namen.');
        }

        // Alte String-Verknüpfungen sind nicht verifiziert.
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
        }

        const spedvName = String(value.spedvName || name).trim();
        const discordId = String(value.discordId ?? '').trim();
        const spedvUserId = String(value.spedvUserId ?? '').trim();

        if (
            !/^\d{17,20}$/.test(discordId) ||
            !/^\d+$/.test(spedvUserId)
        ) {
            continue;
        }

        const record = {
            spedvName,
            discordId,
            spedvUserId,
        };

        const normalizedName = norm(spedvName);

        if (byName.has(normalizedName)) {
            throw new Error(
                `Mehrdeutiger verifizierter SpedV-Name: ${spedvName}.`
            );
        }

        if (byId.has(spedvUserId)) {
            throw new Error(
                `SpedV-Nutzer-ID ${spedvUserId} ist mehrfach verknüpft.`
            );
        }

        byName.set(normalizedName, record);
        byId.set(spedvUserId, record);
    }

    return { byName, byId };
}

function inspectTelemetry(data, taskId) {
    if (!Array.isArray(data) || data.length === 0) {
        return {
            ok: false,
            status: 'review_missing_telemetry',
            reason: 'Telemetrie fehlt, ist kein Array oder enthält keine Messpunkte.',
        };
    }

    let maxVelocity = null;
    let maxTimestamp = null;
    let invalidVelocityPoints = 0;
    let speedLimitZeroPoints = 0;
    const invalidPoints = [];

    for (let i = 0; i < data.length; i += 1) {
        const point = data[i];

        if (!point || typeof point !== 'object' || Array.isArray(point)) {
            return {
                ok: false,
                status: 'review_incomplete_telemetry',
                reason: `Ungültiger Messpunkt an Index ${i}.`,
            };
        }

        if (!validTimestamp(point.timestamp)) {
            return {
                ok: false,
                status: 'review_incomplete_telemetry',
                reason: `Ungültiger Zeitstempel an Index ${i}.`,
            };
        }

        const speed = point.velocity;

        if (
            typeof speed !== 'number' ||
            !Number.isFinite(speed) ||
            speed < 0
        ) {
            invalidVelocityPoints += 1;
            invalidPoints.push({
                index: i,
                timestamp: point.timestamp,
                velocity: speed ?? null,
                reason: 'Geschwindigkeitswert fehlt oder ist ungültig.',
            });
            continue;
        }

        if (Number(point.speedLimit) === 0) {
            speedLimitZeroPoints += 1;
        }

        if (maxVelocity === null || speed > maxVelocity) {
            maxVelocity = speed;
            maxTimestamp = new Date(point.timestamp).toISOString();
        }
    }

    if (maxVelocity === null) {
        return {
            ok: false,
            status: 'review_incomplete_telemetry',
            reason: 'Kein gültiger Geschwindigkeitsmesspunkt vorhanden.',
        };
    }

    return {
        ok: true,
        points: data.length,
        validPoints: data.length - invalidVelocityPoints,
        invalidVelocityPoints,
        invalidPoints,
        speedLimitZeroPoints,
        maxVelocityKmh: maxVelocity,
        maxTimestamp,
    };
}

/**
 * Live-Prüfvorschau.
 * Ruft SpedV live ab, schreibt keine Daten und führt keine Discord-Aktion aus.
 */
async function buildLivePreview({
    client,
    links,
    month,
    guildId,
    speditionId = process.env.SPEDV_SPEDITION_ID || DEFAULT_SPEDITION_ID,
}) {
    if (!client ||
        typeof client.fetchTasks !== 'function' ||
        typeof client.fetchTaskDetails !== 'function' ||
        typeof client.fetchDriveData !== 'function') {
        throw new TypeError('Ein gültiger SpedV-v1-Client ist erforderlich.');
    }

    validateMonth(month);

    const linkMaps = readLinks(links);
    const tasks = await client.fetchTasks();

    const report = {
        mode: 'live-preview',
        month,
        speditionId: String(speditionId),
        generatedAt: new Date().toISOString(),
        sourceTaskCount: tasks.length,
        settledTaskCount: 0,
        hkcTaskCount: 0,
        fineCandidateCount: 0,
        noViolationCount: 0,
        reviewCount: 0,
        ignoredOtherSpeditionCount: 0,
        proposedFineTotalEur: 0,
        unassignedReviewCount: 0,
        writesPerformed: false,
        discordActionsPerformed: false,
        items: [],
        unassignedItems: [],
    };

    for (const task of tasks) {
        if (Number(task.state) !== SETTLED_STATE) continue;

        report.settledTaskCount += 1;

        const taskId = String(task.id);

        let details;

        try {
            details = await client.fetchTaskDetails(taskId);
        } catch (error) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_details_unavailable',
                reason: error.message,
            });
            continue;
        }

        const actualSpeditionId = String(details.spedition?.id ?? '');

        if (actualSpeditionId !== String(speditionId)) {
            report.ignoredOtherSpeditionCount += 1;
            continue;
        }

        report.hkcTaskCount += 1;

        if (Number(details.state) !== SETTLED_STATE) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_state_mismatch',
                taskState: Number(task.state),
                detailsState: details.state ?? null,
                reason: 'Aufgabenstatus und Detailstatus sind nicht beide abgeschlossen.',
            });
            continue;
        }

        const completedAt = details.endtime;

        if (!validTimestamp(completedAt)) {
            // Ohne Abschlusszeit ist der Abrechnungsmonat nicht bestimmbar.
            report.reviewCount += 1;
            report.unassignedReviewCount += 1;
            report.unassignedItems.push({
                taskId,
                status: 'review_missing_completion_time',
                completedAt: null,
                billingMonth: null,
                reason: 'Abschlusszeit fehlt oder ist ungültig. Abrechnungsmonat nicht bestimmbar.',
            });
            continue;
        }

        if (monthInBerlin(completedAt) !== month) continue;

        const spedvName = String(details.user?.userName ?? '').trim();
        const detailsUserId = String(details.user?.id ?? '').trim();
        const taskUserId = String(task.userID ?? '').trim();

        if (
            detailsUserId &&
            taskUserId &&
            detailsUserId !== taskUserId
        ) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_driver_identity_mismatch',
                spedvName: spedvName || null,
                detailsSpedvUserId: detailsUserId,
                taskSpedvUserId: taskUserId,
                completedAt,
                reason: 'SpedV-Nutzer-ID in Aufgabenliste und Auftragsdetails stimmt nicht überein.',
            });
            continue;
        }

        const spedvUserId = detailsUserId || taskUserId;

        if (!spedvName || !/^\d+$/.test(spedvUserId)) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_unverified_driver_link',
                spedvName: spedvName || null,
                spedvUserId: spedvUserId || null,
                completedAt,
                reason: 'SpedV-Name oder gültige SpedV-Nutzer-ID fehlt.',
            });
            continue;
        }

        const linkById = linkMaps.byId.get(spedvUserId);
        const linkByName = linkMaps.byName.get(norm(spedvName));

        if (
            linkByName &&
            (
                linkByName.spedvUserId !== spedvUserId ||
                (linkById && linkByName.discordId !== linkById.discordId)
            )
        ) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_driver_identity_mismatch',
                spedvName,
                spedvUserId,
                completedAt,
                reason: 'Der Namenslink widerspricht der verifizierten SpedV-ID-Zuordnung.',
            });
            continue;
        }

        if (!linkById) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_unverified_driver_link',
                spedvName,
                spedvUserId,
                completedAt,
                reason: 'Für diese SpedV-Nutzer-ID existiert keine verifizierte Discord-Verknüpfung.',
            });
            continue;
        }

        const discordUserId = linkById.discordId;

        if (details.ddCleaned === true) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_cleaned_telemetry',
                spedvName,
                discordUserId,
                completedAt,
                reason: 'ddCleaned ist gesetzt. Keine automatische Strafbewertung.',
            });
            continue;
        }

        let driveData;

        try {
            driveData = await client.fetchDriveData(taskId);
        } catch (error) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_missing_telemetry',
                spedvName,
                discordUserId,
                completedAt,
                reason: error.message,
            });
            continue;
        }

        const telemetry = inspectTelemetry(driveData, taskId);

        if (!telemetry.ok) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: telemetry.status,
                spedvName,
                discordUserId,
                completedAt,
                reason: telemetry.reason,
            });
            continue;
        }

        const rawSummaryMax = details.maxVelocityKMH;

        if (
            rawSummaryMax === null ||
            rawSummaryMax === undefined ||
            rawSummaryMax === '' ||
            !Number.isFinite(Number(rawSummaryMax)) ||
            Number(rawSummaryMax) < 0
        ) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_missing_speed_summary',
                spedvName,
                discordUserId,
                completedAt,
                reason: 'SpedV-Höchstgeschwindigkeit fehlt oder ist ungültig.',
            });
            continue;
        }

        const summaryMax = Number(rawSummaryMax);

        if (
            Math.floor(summaryMax) !==
            Math.floor(telemetry.maxVelocityKmh)
        ) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_speed_conflict',
                spedvName,
                discordUserId,
                completedAt,
                summaryMaxVelocityKmh: Math.floor(summaryMax),
                telemetryMaxVelocityKmh: Math.floor(telemetry.maxVelocityKmh),
                reason: 'API-Zusammenfassung und Telemetrie-Höchstwert stimmen nicht überein.',
            });
            continue;
        }

        const excessKmh = Math.max(
            0,
            Math.floor(telemetry.maxVelocityKmh) - SPEED_LIMIT_KMH
        );

        const fineEur = excessKmh * FINE_PER_KMH_EUR;

        const item = {
            taskId,
            spedvUserId: spedvUserId || null,
            spedvName,
            discordUserId,
            completedAt: new Date(completedAt).toISOString(),
            billingMonth: month,
            telemetryPoints: telemetry.points,
            maxVelocityKmh: telemetry.maxVelocityKmh,
            maxVelocityAt: telemetry.maxTimestamp,
            validTelemetryPoints: telemetry.validPoints,
            invalidVelocityPoints: telemetry.invalidVelocityPoints,
            speedLimitZeroPoints: telemetry.speedLimitZeroPoints,
            limitKmh: SPEED_LIMIT_KMH,
            excessKmh,
            fineEur,
            status: fineEur > 0 ? 'fine_candidate' : 'no_violation',
            evidenceSource: 'SpedV-v1-drivedata',
        };

        report.items.push(item);

        if (fineEur > 0) {
            report.fineCandidateCount += 1;
            report.proposedFineTotalEur += fineEur;
        } else {
            report.noViolationCount += 1;
        }
    }

    return report;
}

module.exports = {
    buildLivePreview,
    inspectTelemetry,
    monthInBerlin,
};
