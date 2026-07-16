const fs   = require('fs');
const path = require('path');
const { getGuildSettings } = require('./settingsManager');

// Geladene Sprachen cachen damit wir nicht bei jeder
// Nachricht die JSON Datei neu einlesen müssen
const cache = {};

/**
 * Lädt eine Sprachdatei und cached sie
 * @param {string} lang - Sprachcode z.B. 'de' oder 'en'
 */
function loadLang(lang) {
    if (cache[lang]) return cache[lang];

    const filePath = path.join(__dirname, '..', 'locales', `${lang}.json`);

    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  Sprachdatei nicht gefunden: ${lang}.json — Fallback auf 'de'`);
        return loadLang('de');
    }

    cache[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return cache[lang];
}

/**
 * Gibt einen übersetzten Text zurück
 * @param {string} guildId  - ID des Servers
 * @param {string} key      - Pfad zum Text z.B. 'ticket.btn_create'
 * @param {object} vars     - Variablen die ersetzt werden sollen z.B. { user: '@Justin' }
 */
function t(guildId, key, vars = {}) {
    const settings = getGuildSettings(guildId);
    const lang     = settings.language ?? 'de';
    const strings  = loadLang(lang);

    // Pfad auflösen z.B. 'ticket.btn_create' → strings.ticket.btn_create
    const value = key.split('.').reduce((obj, k) => obj?.[k], strings);

    if (!value) {
        console.warn(`⚠️  Übersetzung nicht gefunden: ${key} (${lang})`);
        return key;
    }

    // Variablen ersetzen z.B. {user} → '@Justin'
    return Object.entries(vars).reduce(
        (str, [k, v]) => str.replaceAll(`{${k}}`, v),
        value
    );
}

/**
 * Gibt die aktuelle Sprache eines Servers zurück
 * @param {string} guildId
 */
function getLang(guildId) {
    const settings = getGuildSettings(guildId);
    return settings.language ?? 'de';
}

module.exports = { t, getLang };
