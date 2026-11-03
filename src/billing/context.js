'use strict';

const { loadBillingConfig } = require('./config');

let context = null;

function buildContext(env) {
    const config = loadBillingConfig(env);
    const problems = [...config.problems];

    for (const name of ['SPEDV_API_KEY', 'SPEDV_SPEDITION_ID', 'GUILD_ID']) {
        if (!env[name]) problems.push(`${name} fehlt in der .env`);
    }

    const off = reason => ({
        enabled: false,
        reason,
        config,
        store: null,
        spedvClient: null,
        speditionId: null,
        runtime: null,
    });

    if (env.BILLING_ENABLED !== 'true') return off('BILLING_ENABLED ist nicht "true"');
    if (problems.length > 0) return off(problems.join('; '));

    // Erst bei Bedarf laden: node:sqlite soll nur mit eingeschalteter Abrechnung geladen werden
    const { openStore } = require('./store');
    const { createSpedvClient } = require('./spedvClient');

    return {
        enabled: true,
        reason: null,
        config,
        store: openStore(),
        spedvClient: createSpedvClient(),
        speditionId: String(env.SPEDV_SPEDITION_ID),
        runtime: null,
    };
}

/** Gemeinsamer Zugriff auf Speicher, SpedV-Client und Konfiguration (einmal pro Prozess). */
function getBillingContext() {
    if (!context) context = buildContext(process.env);
    return context;
}

/** Nur für Tests. */
function resetBillingContext() {
    if (context?.store) context.store.close();
    context = null;
}

module.exports = { getBillingContext, resetBillingContext };