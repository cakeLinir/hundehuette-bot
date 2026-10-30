
'use strict';

const SPEED_LIMIT_KMH = 95;
const FINE_PER_KMH_EUR = 100;
const SETTLED_STATE = 2;
const HKC_SPEDITION_ID = '108570';
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
        throw new TypeError('etsLinks muss ein Objekt sein.');
    }

    const result = new Map();

    for (const [name, discordId] of Object.entries(links)) {
        const key = norm(name);
        const id = String(discordId ?? '').trim();

        if (!key || !id) continue;

        if (result.has(key) && result.get(key) !== id) {
            throw new Error(`Mehrdeutiger Discord-Link für SpedV-Nutzer ${name}.`);
        }

        result.set(key, id);
    }

    return result;
}

function inspectTelemetry(data, taskId) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, status: 'review_missing_telemetry', reason: 'Telemetrieantwort fehlt oder ist ungültig.' };
    }

    const velocity = data.velocity;
    const timestamp = data.timestamp;
    const speedLimit = data.speedLimit;

    if (!Array.isArray(velocity) || !Array.isArray(timestamp) ||
        velocity.length === 0 || velocity.length !== timestamp.length) {
        return { ok: false, status: 'review_incomplete_telemetry', reason: 'velocity/timestamp fehlen, sind leer oder unterschiedlich lang.' };
    }

    if (Array.isArray(speedLimit) && speedLimit.length !== velocity.length) {
        return { ok: false, status: 'review_incomplete_telemetry', reason: 'speedLimit hat eine abweichende Anzahl an Messpunkten.' };
    }

    let maxVelocity = null;
    let maxTimestamp = null;

    for (let i = 0; i < velocity.length; i += 1) {
        const speed = Number(velocity[i]);

        if (velocity[i] === null || velocity[i] === '' || !Number.isFinite(speed) || speed < 0) {
            return { ok: false, status: 'review_incomplete_telemetry', reason: `Ungültiger Geschwindigkeitswert an Index ${i}.` };
        }

        if (!validTimestamp(timestamp[i])) {
            return { ok: false, status: 'review_incomplete_telemetry', reason: `Ungültiger Zeitstempel an Index ${i}.` };
        }

        if (maxVelocity === null || speed > maxVelocity) {
            maxVelocity = speed;
            maxTimestamp = new Date(timestamp[i]).toISOString();
        }
    }

    return {
        ok: true,
        points: velocity.length,
        maxVelocityKmh: Math.floor(maxVelocity),
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
    speditionId = HKC_SPEDITION_ID,
}) {
    if (!client ||
        typeof client.fetchTasks !== 'function' ||
        typeof client.fetchTaskDetails !== 'function' ||
        typeof client.fetchDriveData !== 'function') {
        throw new TypeError('Ein gültiger SpedV-v1-Client ist erforderlich.');
    }

    validateMonth(month);

    const linkMap = readLinks(links);
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
        writesPerformed: false,
        discordActionsPerformed: false,
        items: [],
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

        const completedAt = details.endtime;
        if (!validTimestamp(completedAt)) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_missing_completion_time',
                reason: 'details.endtime fehlt oder ist ungültig.',
            });
            continue;
        }

        if (monthInBerlin(completedAt) !== month) continue;

        const spedvName = String(details.user?.userName ?? '').trim();
        const spedvUserId = String(details.user?.id ?? task.userID ?? '').trim();
        const discordUserId = linkMap.get(norm(spedvName));

        if (!spedvName || !discordUserId) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_unverified_driver_link',
                spedvName: spedvName || null,
                spedvUserId: spedvUserId || null,
                completedAt,
                reason: 'Kein exakter SpedV-Nutzername-zu-Discord-ID-Link vorhanden.',
            });
            continue;
        }

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

        const summaryMax = Number(details.maxVelocityKMH);
        if (Number.isFinite(summaryMax) &&
            Math.floor(summaryMax) !== telemetry.maxVelocityKmh) {
            report.reviewCount += 1;
            report.items.push({
                taskId,
                status: 'review_speed_conflict',
                spedvName,
                discordUserId,
                completedAt,
                summaryMaxVelocityKmh: Math.floor(summaryMax),
                telemetryMaxVelocityKmh: telemetry.maxVelocityKmh,
                reason: 'API-Zusammenfassung und Telemetrie-Höchstwert stimmen nicht überein.',
            });
            continue;
        }

        const excessKmh = Math.max(0, telemetry.maxVelocityKmh - SPEED_LIMIT_KMH);
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
