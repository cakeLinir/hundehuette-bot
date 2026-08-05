const { oauthSessions } = require('../utils/oauthSessions');
const { getGuildSettings } = require('../utils/settingsManager');
const { createEmbed } = require('../utils/embedBuilder');
const logger = require('../utils/logger');

module.exports = async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send(errorPage('Ungültige Anfrage.'));

    const session = oauthSessions.get(state);
    if (!session) return res.status(400).send(errorPage('Link abgelaufen. Bitte den Button erneut klicken.'));
    oauthSessions.delete(state);

    try {
        // Code → Access Token
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${process.env.BOT_URL}/auth/discord/callback`,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('Kein Access Token erhalten');

        // User-Info von Discord holen
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const discordUser = await userRes.json();

        // Sicherheitscheck: OAuth-User muss der Session-User sein
        // → verhindert dass jemand seinen Link an andere weitergibt
        if (discordUser.id !== session.discordUserId) {
            return res.status(403).send(errorPage(
                'Falscher Account. Bitte verifiziere dich mit dem Account, mit dem du dem Server beigetreten bist.'
            ));
        }

        // Rolle vergeben
        const client = req.app.locals.client;
        const guild = client?.guilds.cache.get(session.guildId);
        if (!guild) return res.status(500).send(errorPage('Server nicht gefunden.'));

        const member = await guild.members.fetch(session.discordUserId).catch(() => null);
        if (!member) return res.status(404).send(errorPage('Mitglied nicht auf dem Server gefunden.'));

        const settings = getGuildSettings(session.guildId);
        const memberRole = settings.verifyRoleId
            ? guild.roles.cache.get(settings.verifyRoleId)
            : null;

        if (!memberRole) return res.status(500).send(errorPage('Verifizierungs-Rolle nicht gefunden. Bitte einen Admin kontaktieren.'));

        await member.roles.add(memberRole);

        // Log in Discord-Kanal
        if (settings.verifyLogChannelId) {
            const logKanal = guild.channels.cache.get(settings.verifyLogChannelId);
            await logKanal?.send({
                embeds: [createEmbed(
                    'success',
                    '✅ Mitglied verifiziert',
                    [
                        `**User:** ${discordUser.username} (<@${discordUser.id}>)`,
                        `**Rolle erhalten:** <@&${memberRole.id}>`,
                        `**Zeit:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                    ].join('\n')
                )]
            }).catch(() => { });
        }

        logger.success(`Verifiziert: ${discordUser.username} (${discordUser.id}) auf ${guild.name}`);

        return res.send(successPage(guild.name, discordUser.username));

    } catch (error) {
        logger.error('Fehler beim Discord OAuth Callback', error);
        return res.status(500).send(errorPage('Ein Fehler ist aufgetreten. Bitte erneut versuchen.'));
    }
};

// ── HTML-Seiten ─────────────────────────────────────────────
function successPage(guildName, username) {
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Verifizierung erfolgreich</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #1e1f22; color: #fff;
           display: flex; justify-content: center; align-items: center; height: 100vh; }
    .card { background: #2b2d31; border-radius: 16px; padding: 2.5rem 3rem; text-align: center; max-width: 420px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: #57F287; margin-bottom: .75rem; }
    p { color: #b5bac1; line-height: 1.6; }
    .name { color: #fff; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🐾</div>
    <h1>Verifizierung erfolgreich!</h1>
    <p>Hey <span class="name">${username}</span>,<br>
    du hast dich erfolgreich auf <span class="name">${guildName}</span> verifiziert.<br><br>
    Du kannst dieses Fenster jetzt schließen.</p>
  </div>
</body>
</html>`;
}

function errorPage(message) {
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Fehler</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #1e1f22; color: #fff;
           display: flex; justify-content: center; align-items: center; height: 100vh; }
    .card { background: #2b2d31; border-radius: 16px; padding: 2.5rem 3rem; text-align: center; max-width: 420px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: #ED4245; margin-bottom: .75rem; }
    p { color: #b5bac1; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Fehler</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
