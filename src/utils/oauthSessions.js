// Temporärer In-Memory Speicher für OAuth Sessions
// state → { discordUserId, guildId, expiresAt }
const oauthSessions = new Map();

// Sessions nach 10 Minuten automatisch löschen
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of oauthSessions.entries()) {
        if (session.expiresAt < now) {
            oauthSessions.delete(key);
        }
    }
}, 60000);

module.exports = { oauthSessions };
