const { getGuildSettings, setGuildSettings } = require('./settingsManager');

// Alle verfügbaren Module mit Standardwert
const DEFAULT_MODULES = {
    welcome:       true,
    roles:         true,
    tickets:       true,
    feedback:      true,
    automod:       false,
    announcements: true,
    moderation:    true,
};

/**
 * Gibt alle Module eines Servers zurück
 * Falls ein Modul noch nicht gesetzt ist, wird der Standardwert verwendet
 * @param {string} guildId
 */
function getModules(guildId) {
    const settings = getGuildSettings(guildId);
    const modules  = settings.modules ?? {};

    // Fehlende Module mit Standardwerten auffüllen
    for (const [key, defaultVal] of Object.entries(DEFAULT_MODULES)) {
        if (modules[key] === undefined) {
            modules[key] = defaultVal;
        }
    }

    return modules;
}

/**
 * Prüft ob ein bestimmtes Modul aktiv ist
 * @param {string} guildId
 * @param {string} moduleName
 */
function isModuleEnabled(guildId, moduleName) {
    const modules = getModules(guildId);
    return modules[moduleName] ?? false;
}

/**
 * Aktiviert oder deaktiviert ein Modul
 * @param {string} guildId
 * @param {string} moduleName
 * @param {boolean} enabled
 */
function setModule(guildId, moduleName, enabled) {
    const settings = getGuildSettings(guildId);
    const modules  = getModules(guildId);

    modules[moduleName] = enabled;
    setGuildSettings(guildId, { modules });
}

module.exports = {
    getModules,
    isModuleEnabled,
    setModule,
    DEFAULT_MODULES,
};
