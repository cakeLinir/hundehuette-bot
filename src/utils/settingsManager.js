const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');

const dataDir = path.join(__dirname, '..', '..', 'data');
const settingsPath = path.join(dataDir, 'guildSettings.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, '{}');

function loadSettings() {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

function saveSettings(data) {
    // Atomares Schreiben — kein Datenverlust bei Absturz oder gleichzeitigem Zugriff
    writeFileAtomic.sync(settingsPath, JSON.stringify(data, null, 2));
}

function getGuildSettings(guildId) {
    const settings = loadSettings();
    if (!settings[guildId]) {
        settings[guildId] = { welcomeChannelId: null, rollenButtons: [] };
        saveSettings(settings);
    }
    return settings[guildId];
}

function setGuildSettings(guildId, newSettings) {
    const settings = loadSettings();
    settings[guildId] = { ...settings[guildId], ...newSettings };
    saveSettings(settings);
}

module.exports = { getGuildSettings, setGuildSettings };
