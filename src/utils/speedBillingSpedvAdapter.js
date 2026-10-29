'use strict';

const SPEED_LIMIT_KMH = 95;
const FINE_PER_KMH_EUR = 100;

// Confirmed from local SpedV DLL reflection: ETSTaskState.Settled = 2.
const SETTLED_STATE = 2;

function get(obj, field) {
    if (!obj || typeof obj !== 'object' || !field) return undefined;
    const path = String(field).split('.');
    let value = obj;
    for (const part of path) {
        if (!value || typeof value !== 'object') return undefined;
        const key = Object.keys(value).find(candidate => candidate.toLowerCase() === part.toLowerCase());
        if (key === undefined) return undefined;
        value = value[key];
    }
    return value;
}

function norm(value) {
    return String(value ?? '').trim().toLowerCase();
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
}

function toKmh(value, unit = 'kmh') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    if (unit === 'kmh') return Math.floor(n);
    if (unit === 'ms') return Math.floor(n * 3.6);
    return null;
}

function readSettled(task, stateField) {
    const state = get(task, stateField);
    if (state === SETTLED_STATE || state === '2') return true;
    return norm(state) === 'settled';
}

function readTaskUserId(task, configuredField) {
    const explicit = configuredField ? get(task, configuredField) : undefined;
    if (explicit !== undefined && explicit !== null && explicit !== '') return String(explicit);
    const fallback = get(task, 'UserID') ?? get(task, 'User.ID');
    return fallback == null || fallback === '' ? '' : String(fallback);
}

function readTaskUserName(task, configuredField) {
    const explicit = configuredField ? get(task, configuredField) : undefined;
    const value = explicit ?? get(task, 'User.UserName') ?? get(task, 'UserName');
    return value == null || value === '' ? '' : String(value);
}

/**
 * Offline-only dry run for SpedV exports shaped like the local DLL models.
 * Confirmed local model fields include ID, UserID, State, StartTime, DDCleaned,
 * User.ID, User.UserName, Endtime, MaxVelocityKMH and SCSTaskDriveData.Velocity.
 *
 * This function never calls SpedV, writes billing data, or contacts Discord.
 */
function buildDryRunPlan(snapshot, config = {}) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Input-Snapshot fehlt.');
    if (config.mode !== 'offline-dry-run') throw new Error('Abbruch: config.mode muss exakt "offline-dry-run" sein.');
    const unit = config.velocityUnit ?? 'kmh';
    if (!['kmh', 'ms'].includes(unit)) throw new Error('velocityUnit muss "kmh" oder "ms" sein.');

    const fields = {
        taskId: config.fields?.taskId ?? 'ID',
        state: config.fields?.state ?? 'State',
        completedAt: config.fields?.completedAt ?? 'Endtime',
        taskUserId: config.fields?.taskUserId ?? 'UserID',
        taskUserName: config.fields?.taskUserName ?? 'User.UserName',
        taskMaxVelocity: config.fields?.taskMaxVelocity ?? 'MaxVelocityKMH',
        velocity: config.fields?.velocity ?? 'Velocity',
        cleaned: config.fields?.cleaned ?? 'DDCleaned',
    };

    const links = snapshot.links && typeof snapshot.links === 'object' ? snapshot.links : {};
    const driveDataByTaskId = snapshot.driveDataByTaskId && typeof snapshot.driveDataByTaskId === 'object'
        ? snapshot.driveDataByTaskId : {};
    const tasks = asArray(snapshot.tasks);
    const idCounts = new Map();

    for (const task of tasks) {
        const id = get(task, fields.taskId);
        if (id !== undefined && id !== null && String(id).trim() !== '') {
            const key = String(id);
            idCounts.set(key, (idCounts.get(key) || 0) + 1);
        }
    }

    const items = [];

    for (const task of tasks) {
        const rawId = get(task, fields.taskId);
        if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
            items.push({ status: 'review_missing_task_id', reason: 'Auftrag ohne erkennbare ID.' });
            continue;
        }

        const taskId = String(rawId);
        if (idCounts.get(taskId) > 1) {
            items.push({ taskId, status: 'review_duplicate_in_snapshot', reason: 'Auftrags-ID mehrfach im Snapshot; alle Vorkommen ausgeschlossen.' });
            continue;
        }

        if (!readSettled(task, fields.state)) {
            const state = get(task, fields.state);
            items.push({
                taskId,
                status: 'ignored_not_settled',
                state: state ?? null,
                reason: 'Nur ETSTaskState.Settled (2) wird standardmäßig für die Abrechnungsprüfung berücksichtigt.'
            });
            continue;
        }

        const completedAtRaw = get(task, fields.completedAt);
        const completedAt = new Date(completedAtRaw);
        if (completedAtRaw == null || completedAtRaw === '' || !Number.isFinite(completedAt.getTime())) {
            items.push({ taskId, status: 'review_missing_completion_time', reason: 'Endtime fehlt oder ist ungültig.' });
            continue;
        }

        const spedvUserId = readTaskUserId(task, fields.taskUserId);
        const spedvName = readTaskUserName(task, fields.taskUserName);
        const linkedDiscordId = spedvName
            ? Object.entries(links).find(([name]) => norm(name) === norm(spedvName))?.[1]
            : null;

        if (!spedvUserId || !spedvName || !linkedDiscordId) {
            items.push({
                taskId, status: 'review_unverified_driver_link',
                spedvUserId: spedvUserId || null, spedvName: spedvName || null,
                completedAt: completedAt.toISOString(),
                reason: 'SpedV-Benutzer-ID, Benutzername oder passender Discord-Link fehlt.'
            });
            continue;
        }

        const driveRows = asArray(driveDataByTaskId[taskId]);
        const directMaxRaw = get(task, fields.taskMaxVelocity);
        const directMax = directMaxRaw !== undefined && directMaxRaw !== null && directMaxRaw !== ''
            ? toKmh(directMaxRaw, 'kmh') : null;
        const telemetryValues = [];
        for (const row of driveRows) {
            const value = get(row, fields.velocity);
            if (value !== undefined && value !== null && value !== '') {
                const n = toKmh(value, unit);
                if (n !== null) telemetryValues.push(n);
            }
        }
        const telemetryMax = telemetryValues.length ? Math.max(...telemetryValues) : null;
        const cleaned = get(task, fields.cleaned) === true || norm(get(task, fields.cleaned)) === 'true';
        const common = {
            taskId, spedvUserId, spedvName, discordUserId: String(linkedDiscordId),
            completedAt: completedAt.toISOString(), telemetryPoints: driveRows.length,
            telemetryCleaned: cleaned,
        };

        if (cleaned) {
            items.push({
                ...common, status: 'review_cleaned_telemetry',
                maxVelocityKmh: directMax,
                reason: 'DDCleaned ist gesetzt. Der aggregierte Höchstwert reicht in diesem Dry-Run nicht für einen automatischen Strafvorschlag.'
            });
            continue;
        }

        if (directMax !== null && telemetryMax !== null && directMax !== telemetryMax) {
            items.push({
                ...common, status: 'review_speed_conflict',
                summaryMaxVelocityKmh: directMax, telemetryMaxVelocityKmh: telemetryMax,
                reason: 'MaxVelocityKMH und maximale Telemetrie stimmen nicht überein; manuelle Prüfung erforderlich.'
            });
            continue;
        }

        const maxVelocityKmh = telemetryMax ?? directMax;
        if (maxVelocityKmh === null) {
            items.push({
                ...common, status: 'review_missing_speed_evidence',
                reason: 'Keine verwertbare Höchstgeschwindigkeit vorhanden; keine Strafe vorgeschlagen.'
            });
            continue;
        }

        const excessKmh = Math.max(0, maxVelocityKmh - SPEED_LIMIT_KMH);
        items.push({
            ...common,
            status: excessKmh > 0 ? 'dry_run_fine_candidate' : 'dry_run_no_violation',
            maxVelocityKmh,
            evidenceSources: [telemetryMax !== null ? 'driveData.Velocity' : 'MaxVelocityKMH'],
            limitKmh: SPEED_LIMIT_KMH,
            excessKmh,
            proposedFineEur: excessKmh * FINE_PER_KMH_EUR,
            reason: 'Offline-Prüfvorschlag; keine Speicherung und keine Rechnungsstellung.'
        });
    }

    const fineCandidates = items.filter(item => item.status === 'dry_run_fine_candidate');
    return {
        mode: 'offline-dry-run',
        generatedAt: new Date().toISOString(),
        sourceTaskCount: tasks.length,
        processedTaskCount: items.length,
        fineCandidateCount: fineCandidates.length,
        proposedFineTotalEur: fineCandidates.reduce((sum, item) => sum + item.proposedFineEur, 0),
        writesPerformed: false,
        apiCallsPerformed: false,
        discordActionsPerformed: false,
        items
    };
}

module.exports = { buildDryRunPlan };
