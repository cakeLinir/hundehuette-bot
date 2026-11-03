'use strict';

const TASK_STATE = Object.freeze({
    IN_DRIVE: 0,
    DONE: 1,
    SETTLED: 2,
    FAIL: 3,
    ADMIN_CHECK: 4,
    PAUSED: 5,
    CANCELLED: 6,
    INVALID: 7,
});

module.exports = Object.freeze({
    TASK_STATE,

    // Abgerechnet werden Settled (2) und AdminCheck (4, vorläufig)
    BILLABLE_STATES: Object.freeze([TASK_STATE.SETTLED, TASK_STATE.ADMIN_CHECK]),

    // Noch nicht abrechenbar, im Bericht als "offen" ausweisen
    OPEN_STATES: Object.freeze([TASK_STATE.DONE, TASK_STATE.PAUSED]),

    SPEED_LIMIT_KMH: 95,
    FINE_PER_KMH_EUR: 100,
    BILLING_START_MONTH: '2026-11',
    TIME_ZONE: 'Europe/Berlin',
    DEFAULT_LOOKBACK_DAYS: 7,

    OUTCOME: Object.freeze({
        FINE: 'fine',
        CLEAN: 'clean',
        REVIEW: 'review',
        IGNORED: 'ignored',
    }),

    // Wen ein Prüffall blockiert
    SCOPE: Object.freeze({
        DRIVER: 'driver',
        UNASSIGNED: 'unassigned',
        GLOBAL: 'global',
    }),

    REVIEW: Object.freeze({
        DETAILS_UNAVAILABLE: 'details_unavailable',
        STATE_MISMATCH: 'state_mismatch',
        MISSING_COMPLETION_TIME: 'missing_completion_time',
        IDENTITY_MISMATCH: 'identity_mismatch',
        UNVERIFIED_DRIVER: 'unverified_driver',
        TELEMETRY_CLEANED: 'telemetry_cleaned',
        TELEMETRY_UNAVAILABLE: 'telemetry_unavailable',
        TELEMETRY_MISSING: 'telemetry_missing',
        TELEMETRY_INCOMPLETE: 'telemetry_incomplete',
        SPEED_SUMMARY_MISSING: 'speed_summary_missing',
        SPEED_CONFLICT: 'speed_conflict',
    }),

    IGNORED: Object.freeze({
        STATE_NOT_BILLABLE: 'state_not_billable',
        FOREIGN_SPEDITION: 'foreign_spedition',
        OUTSIDE_MONTH: 'outside_month',
        BEFORE_BILLING_START: 'before_billing_start',
    }),
});
