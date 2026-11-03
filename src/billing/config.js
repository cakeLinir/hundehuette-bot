'use strict';

const IBAN_PATTERN = /^SP\d{10,30}$/;
const ID_PATTERN = /^\d{17,20}$/;

function clean(value) {
    const text = String(value ?? '').trim();
    return text || null;
}

/**
 * Liest die Abrechnungskonfiguration aus der Umgebung.
 * Ungültige oder fehlende Werte werden zu null und unter "problems" gemeldet.
 */
function loadBillingConfig(env = process.env) {
    const problems = [];

    const ibanRaw = clean(env.BILLING_SPEDV_IBAN)?.replace(/\s+/g, '') ?? null;
    let iban = null;
    if (!ibanRaw) problems.push('BILLING_SPEDV_IBAN fehlt');
    else if (!IBAN_PATTERN.test(ibanRaw)) problems.push('BILLING_SPEDV_IBAN hat ein unerwartetes Format');
    else iban = ibanRaw;

    const channel = (name) => {
        const value = clean(env[name]);
        if (!value || !ID_PATTERN.test(value)) {
            problems.push(`${name} fehlt oder ist ungültig`);
            return null;
        }
        return value;
    };

    return {
        iban,
        reportChannelId: channel('BILLING_REPORT_CHANNEL_ID'),
        fallbackChannelId: channel('BILLING_FALLBACK_CHANNEL_ID'),
        purposePrefix: 'Strafzahlung',
        problems,
    };
}

module.exports = { loadBillingConfig };