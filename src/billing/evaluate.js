'use strict';

const rules = require('./rules');
const {
    parseTimestamp,
    berlinDate,
    berlinMonth,
    formatVisibleId,
} = require('./time');

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
    GAME_UNKNOWN: 'game_unknown',
    GAME_CONFLICT: 'game_conflict',
    MISSING_TELEMETRY: 'missing_telemetry',
    INCOMPLETE_TELEMETRY: 'incomplete_telemetry',
    MISSING_SPEED_SUMMARY: 'missing_speed_summary',
    SPEED_CONFLICT: 'speed_conflict',
});

const UNIT_LABEL = Object.freeze({ kmh: 'km/h', mph: 'mph' });

// Zulässige Abweichung zwischen der umgerechneten Telemetrie und dem MPH-Wert von SpedV
const MPH_TOLERANCE = 1;

function isBillableState(state) {
    return rules.billableStates.includes(Number(state));
}

function stateName(state) {
    return rules.stateNames[String(state)] ?? `Status ${state}`;
}

/** EUR -> ets2, USD -> ats, alles andere -> null. */
function gameFromCurrency(currency) {
    const key = String(currency ?? '').trim().toUpperCase();
    return key ? (rules.currencyGames[key] ?? null) : null;
}

/**
 * Erkennt das Spiel aus den Währungen der übergebenen Quellen (Liste, Details).
 * Fehlende Währungen werden ignoriert. Ist keine bekannt, ist eine unbekannt oder
 * widersprechen sich die Quellen, ist das Ergebnis null.
 */
function detectGame(...sources) {
    const games = sources
        .map(source => String(source?.currency ?? '').trim())
        .filter(Boolean)
        .map(gameFromCurrency);

    if (games.length === 0 || games.includes(null)) return null;
    return games.every(game => game === games[0]) ? games[0] : null;
}

function inspectTelemetry(data, limitKmh = rules.speedLimitKmh) {
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

        if (speed > limitKmh) pointsAboveLimit += 1;

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

function validSpeed(raw) {
    return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0;
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
 * @param {string|null} [context.game]   'ets2' | 'ats'. null = nicht erkennbar (Prüffall).
 *                                       Ohne Angabe wird ETS2 angenommen.
 */
async function evaluateTask({ listItem, details, loadDriveData }, context) {
    const ownSpeditionId = String(context?.speditionId ?? '').trim();
    if (!/^\d+$/.test(ownSpeditionId)) {
        throw new TypeError('context.speditionId fehlt oder ist ungültig.');
    }
    if (!listItem || listItem.id === undefined || listItem.id === null) {
        throw new TypeError('listItem.id fehlt.');
    }

    const game = context?.game === undefined ? 'ets2' : context.game;

    const taskId = String(listItem.id);
    const detailsUserId = String(details?.user?.id ?? '').trim();
    const listUserId = String(listItem.userID ?? '').trim();

    const base = {
        taskId,
        visibleId: formatVisibleId(taskId),
        game,
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

    if (game === null) {
        return review(
            REASONS.GAME_UNKNOWN,
            'Das Spiel (ETS2 oder ATS) ist nicht erkennbar. Keine automatische Bewertung.'
        );
    }

    const gameRules = rules.games[game];
    if (!gameRules) throw new TypeError(`Unbekanntes Spiel: ${game}`);

    // Gegenprobe: die Währung in den Details muss zum angenommenen Spiel passen
    const detailsCurrency = String(details.currency ?? '').trim();
    if (detailsCurrency && gameFromCurrency(detailsCurrency) !== game) {
        return review(
            REASONS.GAME_CONFLICT,
            `Die Währung ${detailsCurrency} passt nicht zum erkannten Spiel.`
        );
    }

    const label = UNIT_LABEL[gameRules.unit];
    const isMph = gameRules.unit === 'mph';
    const limitKmh = isMph ? gameRules.limit * rules.kmhPerMph : gameRules.limit;

    let driveData;
    try {
        driveData = await loadDriveData();
    } catch (error) {
        return review(REASONS.MISSING_TELEMETRY, `Telemetrie nicht abrufbar: ${error.message}`);
    }

    const telemetry = inspectTelemetry(driveData, limitKmh);
    if (!telemetry.ok) {
        return review(telemetry.reason, telemetry.message);
    }

    if (!validSpeed(details.maxVelocityKMH)) {
        return review(
            REASONS.MISSING_SPEED_SUMMARY,
            'SpedV-Höchstgeschwindigkeit fehlt oder ist ungültig.'
        );
    }

    const summaryMaxKmh = Number(details.maxVelocityKMH);
    if (Math.floor(summaryMaxKmh) !== Math.floor(telemetry.maxVelocityKmh)) {
        return review(
            REASONS.SPEED_CONFLICT,
            `SpedV meldet ${Math.floor(summaryMaxKmh)} km/h, die Telemetrie ${Math.floor(telemetry.maxVelocityKmh)} km/h.`,
            {
                evidence: {
                    summaryMaxVelocityKmh: Math.floor(summaryMaxKmh),
                    telemetryMaxVelocityKmh: Math.floor(telemetry.maxVelocityKmh),
                },
            }
        );
    }

    // Maßgeblich ist der Wert in der Einheit des Spiels
    let maxSpeed = telemetry.maxVelocityKmh;

    if (isMph) {
        if (!validSpeed(details.maxVelocityMPH)) {
            return review(
                REASONS.MISSING_SPEED_SUMMARY,
                'SpedV-Höchstgeschwindigkeit in mph fehlt oder ist ungültig.'
            );
        }

        const summaryMph = Number(details.maxVelocityMPH);
        const telemetryMph = telemetry.maxVelocityKmh / rules.kmhPerMph;

        if (Math.abs(telemetryMph - summaryMph) > MPH_TOLERANCE) {
            return review(
                REASONS.SPEED_CONFLICT,
                `SpedV meldet ${Math.floor(summaryMph)} mph, die Telemetrie entspricht ${telemetryMph.toFixed(1)} mph.`,
                {
                    evidence: {
                        summaryMaxVelocityMph: summaryMph,
                        telemetryMaxVelocityMph: Number(telemetryMph.toFixed(1)),
                    },
                }
            );
        }

        maxSpeed = summaryMph;
    }

    // § 5.4 und § 5.9: je angefangener Einheit über dem Limit
    const excessUnits = Math.max(0, Math.ceil(maxSpeed) - gameRules.limit);
    const fineEur = excessUnits * gameRules.finePerUnit;

    const evidence = {
        game,
        unit: gameRules.unit,
        maxSpeed,
        limit: gameRules.limit,
        excessUnits,
        fineEur,
        // physikalische Werte aus der Telemetrie (immer km/h)
        maxVelocityKmh: telemetry.maxVelocityKmh,
        limitKmh: Number(limitKmh.toFixed(2)),
        excessKmh: isMph ? null : excessUnits,
        maxVelocityAt: telemetry.maxVelocityAt,
        telemetryPoints: telemetry.points,
        pointsAboveLimit: telemetry.pointsAboveLimit,
        invalidVelocityPoints: telemetry.invalidVelocityPoints,
    };

    if (fineEur > 0) {
        return done(OUTCOMES.FINE, {
            evidence,
            message: `${maxSpeed} ${label} bei Limit ${gameRules.limit}: ${excessUnits} ${label} zu schnell, ${fineEur} EUR.`,
        });
    }

    return done(OUTCOMES.CLEAR, { evidence, message: 'Kein Verstoß.' });
}

module.exports = {
    OUTCOMES,
    REASONS,
    evaluateTask,
    detectGame,
    gameFromCurrency,
    isBillableState,
    stateName,
    formatVisibleId,
    parseTimestamp,
    berlinDate,
    berlinMonth,
};