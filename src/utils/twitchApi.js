let cachedToken = null;
let tokenExpiry = 0;

/**
 * Holt einen App Access Token von Twitch (wird gecached bis er abläuft)
 */
async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials',
        }),
    });

    const data = await response.json();

    if (!data.access_token) {
        throw new Error('Twitch Token konnte nicht abgerufen werden');
    }

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 60s Puffer

    return cachedToken;
}

/**
 * Prüft ob ein Twitch-Kanal aktuell live ist
 * @param {string} username - Twitch Login-Name (kleingeschrieben)
 * @returns {object|null} Stream-Daten oder null wenn offline
 */
async function getStreamInfo(username) {
    const token = await getAccessToken();

    const response = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${username}`,
        {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
        return null; // Offline
    }

    return data.data[0]; // Live-Daten
}

module.exports = { getAccessToken, getStreamInfo };
