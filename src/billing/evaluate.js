'use strict';

const rules = require('./rules');

const OUTCOMES = Object.freeze({
    FINE: 'fine',
    CLEAR: 'clear',
    REVIEW: 'review',
    NOT_BILLABLE: 'not_billable',
    FOREIGN: 'foreign',
    BEFORE_START: 'before_billing_start',
});

const REASONS = Object.freeze({
    STATE_NOT_BILLABLE: 'state_not_billable',
    STATE_MISMATCH: 'state_mismatch',
    DETAILS_UNAVAILABLE: 'details_unavailable',
    MISSING_COMPLETION_TIME: 'missing_completion_time',
    IDENTITY_MISSING: 'identity_missing',
    IDENTITY_MISMATCH: 'identity_mismatch',
    CLEANED_TELEMETRY: 'cleaned_telemetry',
    MISSING_TELEMETRY: 'missing_telemetry',
    INCOMPLETE_TELEMETRY: 'incomplete_telemetry',
    MISSING_SPEED_SUMMARY: 'missing_speed_summary',
    SPEED_CONFLICT: 'speed_conflict',
});

// Zeitzonenangabe ist Pflicht: sonst hinge der Abrechnungsmonat von der Serverzeit ab.
const OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Strenger Parser für Zeitpunkte, die den Abrechnungsmonat bestimmen. */
function parseTimestamp(value) {
    if (typeof value !== 'string' || !OFFSET_PATTERN.test(value.trim())) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function berlinDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: rules.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const pick = type => parts.find(part => part.type === type)?.value;
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function berlinMonth(date) {
    return berlinDate(date).slice(0, 7);
}

/** 12657450 -> "#12'657'450" (so sehen die Fahrer die Nummer in SpedV). */
function formatVisibleId(id) {
    const digits = String(id ?? '').trim();
    if (!/^\d+$/.test(digits)) return null;
    return `#${digits.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`;
}

function isBillableState(state) {
    return rules.billableStates.includes(Number(state));
}

function stateName(state) {
    return rules.stateNames[String(state)] ?? `Status ${state}`;
}

function inspectTelemetry(data) {
    const incomplete = message => ({
        ok: false,
        reason: REASONS.INCOMPLETE_TELEMETRY,
        message,
    });

    if (!Array.isArray(data) || data.length === 0) {
        return {
            ok: false,
            reason: REASONS.MISSING_TELEMETRY,
            message: 'Telemetrie fehlt oder enthält keine Messpunkte.',
        };
    }

    let maxVelocity = null;
    let maxTimestamp = null;
    let invalidVelocityPoints = 0;
    let pointsAboveLimit = 0;

    for (let index = 0; index < data.length; index += 1) {
        const point = data[index];

        if (!point || typeof point !== 'object' || Array.isArray(point)) {
            return incomplete(`Ungültiger Messpunkt an Index ${index}.`);
        }

        // Der Zeitstempel ist nur Zusatzinformation, daher nur auf Gültigkeit geprüft.
        const at = new Date(point.timestamp);
        if (!Number.isFinite(at.getTime())) {
            return incomplete(`Ungültiger Zeitstempel an Index ${index}.`);
        }

        const speed = point.velocity;
        if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) {
            invalidVelocityPoints += 1;
            continue;
        }

        if (speed > rules.speedLimitKmh) pointsAboveLimit += 1;

        if (maxVelocity === null || speed > maxVelocity) {
            maxVelocity = speed;
            maxTimestamp = at.toISOString();
        }
    }

    if (maxVelocity === null) {
        return incomplete('Kein gültiger Geschwindigkeitsmesspunkt vorhanden.');
    }

    return {
        ok: true,
        points: data.length,
        invalidVelocityPoints,
        pointsAboveLimit,
        maxVelocityKmh: maxVelocity,
        maxVelocityAt: maxTimestamp,
    };
}

/**
 * Wertet einen Auftrag aus. Reine Logik: kein Speicher, kein Discord.
 *
 * @param {object} input
 * @param {object} input.listItem        Eintrag aus GET /v1/tasks
 * @param {object} input.details         Antwort von GET /v1/tasks/{id}/details
 * @param {Function} input.loadDriveData async () => Telemetrie-Array; wird nur bei Bedarf aufgerufen
 * @param {object} context
 * @param {string} context.speditionId   Unsere Speditions-ID
 */
async function evaluateTask({ listItem, details, loadDriveData }, context) {
    const ownSpeditionId = String(context?.speditionId ?? '').trim();
    if (!/^\d+$/.test(ownSpeditionId)) {
        throw new TypeError('context.speditionId fehlt oder ist ungültig.');
    }
    if (!listItem || listItem.id === undefined || listItem.id === null) {
        throw new TypeError('listItem.id fehlt.');
    }

    const taskId = String(listItem.id);
    const detailsUserId = String(details?.user?.id ?? '').trim();
    const listUserId = String(listItem.userID ?? '').trim();

    const base = {
        taskId,
        visibleId: formatVisibleId(taskId),
        taskState: Number(details?.state ?? listItem.state),
        speditionId: String(details?.spedition?.id ?? '').trim() || null,
        spedvUserId: detailsUserId || listUserId || null,
        spedvName: String(details?.user?.userName ?? '').trim() || null,
        completedAt: null,
        billingMonth: null,
        reason: null,
        message: '',
        evidence: null,
    };

    const done = (outcome, extra = {}) => ({ ...base, outcome, ...extra });
    const review = (reason, message, extra = {}) =>
        done(OUTCOMES.REVIEW, { reason, message, ...extra });

    if (!isBillableState(listItem.state)) {
        return done(OUTCOMES.NOT_BILLABLE, {
            reason: REASONS.STATE_NOT_BILLABLE,
            message: `Status ${stateName(listItem.state)} wird nicht abgerechnet.`,
        });
    }

    if (!details || typeof details !== 'object') {
        return review(REASONS.DETAILS_UNAVAILABLE, 'Auftragsdetails konnten nicht geladen werden.');
    }

    if (base.speditionId !== ownSpeditionId) {
        return done(OUTCOMES.FOREIGN, { message: 'Auftrag gehört zu einer anderen Spedition.' });
    }

    if (!isBillableState(details.state)) {
        return review(
            REASONS.STATE_MISMATCH,
            `Liste meldet ${stateName(listItem.state)}, Details melden ${stateName(details.state)}.`
        );
    }

    const completed = parseTimestamp(details.endtime);
    if (!completed) {
        return review(
            REASONS.MISSING_COMPLETION_TIME,
            'Abschlusszeit fehlt, ist ungültig oder enthält keine Zeitzone. Abrechnungsmonat nicht bestimmbar.'
        );
    }

    base.completedAt = completed.toISOString();
    base.billingMonth = berlinMonth(completed);

    if (berlinDate(completed) < rules.billingStartDate) {
        return done(OUTCOMES.BEFORE_START, {
            message: `Abgeschlossen vor dem Abrechnungsbeginn ${rules.billingStartDate}.`,
        });
    }

    if (!/^\d+$/.test(detailsUserId) || !/^\d+$/.test(listUserId)) {
        return review(REASONS.IDENTITY_MISSING, 'SpedV-Fahrer-ID fehlt in Liste oder Details.');
    }
    if (detailsUserId !== listUserId) {
        return review(
            REASONS.IDENTITY_MISMATCH,
            'Fahrer-ID in Auftragsliste und Auftragsdetails stimmt nicht überein.'
        );
    }

    if (details.ddCleaned === true || listItem.ddCleaned === true) {
        return review(
            REASONS.CLEANED_TELEMETRY,
            'Telemetrie wurde bereinigt (ddCleaned). Keine automatische Bewertung.'
        );
    }

    let driveData;
    try {
        driveData = await loadDriveData();
    } catch (error) {
        return review(REASONS.MISSING_TELEMETRY, `Telemetrie nicht abrufbar: ${error.message}`);
    }

    const telemetry = inspectTelemetry(driveData);
    if (!telemetry.ok) {
        return review(telemetry.reason, telemetry.message);
    }

    const rawSummary = details.maxVelocityKMH;
    if (
        rawSummary === null ||
        rawSummary === undefined ||
        rawSummary === '' ||
        !Number.isFinite(Number(rawSummary)) ||
        Number(rawSummary) < 0
    ) {
        return review(
            REASONS.MISSING_SPEED_SUMMARY,
            'SpedV-Höchstgeschwindigkeit fehlt oder ist ungültig.'
        );
    }

    const summaryMax = Number(rawSummary);
    if (Math.floor(summaryMax) !== Math.floor(telemetry.maxVelocityKmh)) {
        return review(
            REASONS.SPEED_CONFLICT,
            `SpedV meldet ${Math.floor(summaryMax)} km/h, die Telemetrie ${Math.floor(telemetry.maxVelocityKmh)} km/h.`,
            {
                evidence: {
                    summaryMaxVelocityKmh: Math.floor(summaryMax),
                    telemetryMaxVelocityKmh: Math.floor(telemetry.maxVelocityKmh),
                },
            }
        );
    }

    // § 5.4: je angefangenem km/h über dem Limit
    const excessKmh = Math.max(0, Math.ceil(telemetry.maxVelocityKmh) - rules.speedLimitKmh);
    const fineEur = excessKmh * rules.fineEurPerKmh;

    const evidence = {
        maxVelocityKmh: telemetry.maxVelocityKmh,
        maxVelocityAt: telemetry.maxVelocityAt,
        telemetryPoints: telemetry.points,
        pointsAboveLimit: telemetry.pointsAboveLimit,
        invalidVelocityPoints: telemetry.invalidVelocityPoints,
        limitKmh: rules.speedLimitKmh,
        excessKmh,
        fineEur,
    };

    if (fineEur > 0) {
        return done(OUTCOMES.FINE, {
            evidence,
            message: `${telemetry.maxVelocityKmh} km/h bei Limit ${rules.speedLimitKmh}: ${excessKmh} km/h zu schnell, ${fineEur} EUR.`,
        });
    }

    return done(OUTCOMES.CLEAR, { evidence, message: 'Kein Verstoß.' });
}

module.exports = {
    OUTCOMES,
    REASONS,
    evaluateTask,
    isBillableState,
    stateName,
    formatVisibleId,
    parseTimestamp,
    berlinDate,
    berlinMonth,
};
