const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'guildSettings.db'));

// Tabelle erstellen falls nicht vorhanden
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        data     TEXT NOT NULL DEFAULT '{}'
    )
`);

const stmtGet = db.prepare('SELECT data FROM guild_settings WHERE guild_id = ?');
const stmtUpsert = db.prepare(`
    INSERT INTO guild_settings (guild_id, data) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data
`);

/**
 * Gibt die Settings einer Guild zurück.
 */
function getGuildSettings(guildId) {
    const row = stmtGet.get(guildId);
    if (!row) {
        const defaults = { welcomeChannelId: null, rollenButtons: [] };
        stmtUpsert.run(guildId, JSON.stringify(defaults));
        return defaults;
    }
    return JSON.parse(row.data);
}

/**
 * Überschreibt/merged die Settings einer Guild.
 */
function setGuildSettings(guildId, newSettings) {
    const current = getGuildSettings(guildId);
    const merged = { ...current, ...newSettings };
    stmtUpsert.run(guildId, JSON.stringify(merged));
}

module.exports = { getGuildSettings, setGuildSettings };
