const logger = require('../utils/logger');
const { getGuildSettings } = require('../utils/settingsManager');
const { createEmbed } = require('../utils/embedBuilder');
const { getStreamInfoById, getUserInfo } = require('../utils/twitchApi');

let discordClient = null;
function setClient(client) { discordClient = client; }

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
            getStreamInfoById(event.broadcaster_user_id),
            getUserInfo({ userId: event.broadcaster_user_id }),
        ]);

        for (const [, guild] of discordClient.guilds.cache) {
            const settings = getGuildSettings(guild.id);
            const stream = settings.streamConfig;
            if (!stream?.channelId || stream.twitchUserId !== event.broadcaster_user_id) continue;

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
                    { name: '🎮 Spiel', value: streamInfo?.game_name ?? 'Unbekannt', inline: true },
                    { name: '👥 Zuschauer', value: `${streamInfo?.viewer_count ?? 0}`, inline: true },
                    { name: '🔗 Link', value: `[Jetzt zuschauen!](https://twitch.tv/${event.broadcaster_user_login})`, inline: true }
                )
                .setImage(
                    streamInfo?.thumbnail_url
                        ?.replace('{width}', '1280')
                        ?.replace('{height}', '720') ?? null
                )
                .setTimestamp();

            const erwaehnung = stream.mentionRoleId ? `<@&${stream.mentionRoleId}>` : null;
            const msg = await kanal.send({ content: erwaehnung ?? undefined, embeds: [embed] });

            // Nachricht-ID speichern um sie beim Offline-Event zu editieren
            const { setGuildSettings } = require('../utils/settingsManager');
            setGuildSettings(guild.id, {
                streamConfig: { ...stream, liveMessageId: msg.id }
            });

            logger.success(`Stream-Benachrichtigung gesendet für ${event.broadcaster_user_name}`);
        }
    } catch (error) {
        logger.error('Fehler bei Stream Online Event', error);
    }
}

async function handleStreamOffline(event) {
    if (!discordClient) return;
    logger.info(`📴 Stream Offline: ${event.broadcaster_user_name}`);

    try {
        for (const [, guild] of discordClient.guilds.cache) {
            const settings = getGuildSettings(guild.id);
            const stream = settings.streamConfig;
            if (!stream?.channelId || stream.twitchUserId !== event.broadcaster_user_id) continue;

            const kanal = guild.channels.cache.get(stream.channelId);
            if (!kanal) continue;

            // Live-Nachricht editieren falls vorhanden
            if (stream.liveMessageId) {
                const liveMsg = await kanal.messages.fetch(stream.liveMessageId).catch(() => null);
                if (liveMsg) {
                    const offlineEmbed = createEmbed(
                        'warning',
                        `⚫ ${event.broadcaster_user_name} ist jetzt offline`,
                        `Der Stream wurde beendet. Bis zum nächsten Mal! 👋`
                    )
                        .setURL(`https://twitch.tv/${event.broadcaster_user_login}`)
                        .setTimestamp();

                    await liveMsg.edit({ content: null, embeds: [offlineEmbed] });
                }

                // liveMessageId aufräumen
                const { setGuildSettings } = require('../utils/settingsManager');
                setGuildSettings(guild.id, {
                    streamConfig: { ...stream, liveMessageId: null }
                });
            }

            logger.info(`Offline-Benachrichtigung für ${event.broadcaster_user_name} (Guild ${guild.id})`);
        }
    } catch (error) {
        logger.error('Fehler bei Stream Offline Event', error);
    }
}

module.exports = { handleStreamOnline, handleStreamOffline, setClient };
