const axios = require('axios');
const logger = require('../utils/logger');
const { getGuildSettings } = require('../utils/settingsManager');
const { createEmbed } = require('../utils/embedBuilder');

let discordClient = null;

function setClient(client) {
    discordClient = client;
}

/**
 * Holt Stream-Informationen von der Twitch API
 */
async function getStreamInfo(userId) {
    const token = await getAppToken();

    const res = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${userId}`, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
        }
    });

    return res.data.data[0] ?? null;
}

/**
 * Holt User-Informationen von der Twitch API
 */
async function getUserInfo(userId = null, loginName = null) {
    const token = await getAppToken();

    const param = userId
        ? `id=${userId}`
        : `login=${loginName}`;

    const res = await axios.get(`https://api.twitch.tv/helix/users?${param}`, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
        }
    });

    return res.data.data[0] ?? null;
}


/**
 * App Access Token holen (für API-Anfragen ohne User-Kontext)
 */
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAppToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

    const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
            client_id: process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials',
        }
    });

    cachedToken = res.data.access_token;
    tokenExpiresAt = Date.now() + (res.data.expires_in * 1000) - 60000;

    return cachedToken;
}

/**
 * Stream Online Event verarbeiten
 */
async function handleStreamOnline(event) {
    if (!discordClient) return;

    logger.info(`🎥 Stream Online: ${event.broadcaster_user_name}`);

    try {
        const [streamInfo, userInfo] = await Promise.all([
            getStreamInfo(event.broadcaster_user_id),
            getUserInfo(event.broadcaster_user_id),
        ]);

        // Alle Server nach Stream-Config durchsuchen
        const guilds = discordClient.guilds.cache;

        for (const [, guild] of guilds) {
            const settings = getGuildSettings(guild.id);
            const stream = settings.streamConfig;

            if (!stream?.channelId || !stream?.twitchUserId) continue;
            if (stream.twitchUserId !== event.broadcaster_user_id) continue;

            const kanal = guild.channels.cache.get(stream.channelId);
            if (!kanal) continue;

            const embed = createEmbed(
                'success',
                `🔴 ${event.broadcaster_user_name} ist jetzt LIVE!`,
                streamInfo?.title ?? 'Kein Titel'
            )
                .setURL(`https://twitch.tv/${event.broadcaster_user_login}`)
                .setThumbnail(userInfo?.profile_image_url ?? null)
                .addFields(
                    {
                        name: '🎮 Spiel',
                        value: streamInfo?.game_name ?? 'Unbekannt',
                        inline: true,
                    },
                    {
                        name: '👥 Zuschauer',
                        value: `${streamInfo?.viewer_count ?? 0}`,
                        inline: true,
                    },
                    {
                        name: '🔗 Link',
                        value: `[Jetzt zuschauen!](https://twitch.tv/${event.broadcaster_user_login})`,
                        inline: true,
                    }
                )
                .setImage(
                    streamInfo?.thumbnail_url
                        ?.replace('{width}', '1280')
                        ?.replace('{height}', '720')
                    ?? null
                );

            const erwaehnung = stream.mentionRoleId
                ? `<@&${stream.mentionRoleId}>`
                : null;

            await kanal.send({
                content: erwaehnung ?? undefined,
                embeds: [embed],
            });

            logger.success(`Stream-Benachrichtigung gesendet für ${event.broadcaster_user_name}`);
        }
    } catch (error) {
        logger.error('Fehler bei Stream Online Event', error);
    }
}

/**
 * Stream Offline Event verarbeiten
 */
async function handleStreamOffline(event) {
    logger.info(`📴 Stream Offline: ${event.broadcaster_user_name}`);
    // Optional: Offline-Nachricht senden
}

module.exports = { handleStreamOnline, handleStreamOffline, getAppToken, getUserInfo, setClient };
