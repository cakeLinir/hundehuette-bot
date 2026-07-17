const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '..', '..', 'data', 'guildSettings.json');

/**
 *  Lädt alle gespeicherten Guild-Settings
 */
function loadSettings() {
    // Ordner erstellen falls er nicht existiert
    const dataDir = path.join(__dirname, '..', '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}


/**
 * Speichert die Guild-Settings
 */
function saveSettings(data) {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
}

/** 
 * Gibt die Settings einer Bestimmten Guild zurück.
 * @param {string} guildId - Die ID der Guild
*/
function getGuildSettings(guildId) {
    const settings = loadSettings();
    if (!settings[guildId]) {
        settings[guildId] = {
            welcomeChannelId: null,
            rollenButtons: [],
        };
        saveSettings(settings);
    }
    return settings[guildId];
}

/** 
 * Überschreibt die Settings einer Bestimmten Guild.
 * @param {string} guildId - Die ID der Guild
 * @param {object} newSettings - Die neuen Settings der Guild
*/
function setGuildSettings(guildId, newSettings) {
    const settings = loadSettings();
    settings[guildId] = { ...settings[guildId], ...newSettings };
    saveSettings(settings);
}

module.exports = {
    getGuildSettings,
    setGuildSettings,
};