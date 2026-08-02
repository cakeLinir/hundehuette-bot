const axios = require('axios');
const logger = require('../utils/logger');
const { setGuildSettings, getGuildSettings } = require('../utils/settingsManager');
const { oauthSessions } = require('../utils/oauthSessions');

module.exports = async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state) {
        return res.status(400).send('Ungültige Anfrage.');
    }

    // State prüfen
    const session = oauthSessions.get(state);
    if (!session) {
        return res.status(400).send('Ungültige oder abgelaufene Session.');
    }

    oauthSessions.delete(state);

    try {
        // Code gegen Access Token tauschen
        const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: `${process.env.BOT_URL}/auth/twitch/callback`,
            }
        });

        const accessToken = tokenRes.data.access_token;

        // Twitch User-Informationen holen
        const userRes = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
            }
        });

        const twitchUser = userRes.data.data[0];

        // Verknüpfung in Settings speichern
        const settings = getGuildSettings(session.guildId);
        const linkedUsers = settings.linkedTwitchUsers ?? {};

        linkedUsers[session.discordUserId] = {
            twitchId: twitchUser.id,
            twitchLogin: twitchUser.login,
            twitchName: twitchUser.display_name,
            linkedAt: Date.now(),
        };

        setGuildSettings(session.guildId, { linkedTwitchUsers: linkedUsers });

        logger.success(`Twitch verknüpft: ${twitchUser.display_name} → Discord ${session.discordUserId}`);

        // Erfolgsseite anzeigen
        res.send(`
            <!DOCTYPE html>
            <html lang="de">
            <head>
                <meta charset="UTF-8">
                <title>Hundehütte — Verknüpfung erfolgreich</title>
                <style>
                    body {
                        background: #313338;
                        color: #dbdee1;
                        font-family: 'Segoe UI', Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        flex-direction: column;
                        gap: 16px;
                    }
                    h1 { color: #00ff99; }
                    p  { color: #949ba4; }
                </style>
            </head>
            <body>
                <h1>🐾 Verknüpfung erfolgreich!</h1>
                <p>Dein Twitch-Account <strong>${twitchUser.display_name}</strong> wurde mit deinem Discord-Account verknüpft.</p>
                <p>Du kannst dieses Fenster jetzt schließen.</p>
            </body>
            </html>
        `);

    } catch (error) {
        logger.error('Fehler beim OAuth Callback', error);
        res.status(500).send('Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
    }
};
