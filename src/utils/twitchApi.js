let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

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
    if (!data.access_token) throw new Error('Twitch Token konnte nicht abgerufen werden');

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
}

// Nach Login-Name (für twitchWatcher-Ersatz falls nötig)
async function getStreamInfoByLogin(username) {
    const token = await getAccessToken();
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await response.json();
    return data.data?.[0] ?? null;
}

// Nach User-ID (für EventSub-Events)
async function getStreamInfoById(userId) {
    const token = await getAccessToken();
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${userId}`, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await response.json();
    return data.data?.[0] ?? null;
}

// User-Info flexibel nach ID oder Login-Name
async function getUserInfo({ userId = null, loginName = null } = {}) {
    const token = await getAccessToken();
    const param = userId ? `id=${userId}` : `login=${loginName}`;
    const response = await fetch(`https://api.twitch.tv/helix/users?${param}`, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await response.json();
    return data.data?.[0] ?? null;
}

module.exports = { getAccessToken, getStreamInfoByLogin, getStreamInfoById, getUserInfo };
