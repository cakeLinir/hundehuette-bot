const logger = require('../utils/logger');
const { getGuildSettings, setGuildSettings } = require('../utils/settingsManager');
const { createEmbed } = require('../utils/embedBuilder');
const { getStreamInfoById, getUserInfo } = require('../utils/twitchApi');

let discordClient = null;
function setClient(client) { discordClient = client; }

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

            if (stream.liveMessageId) {
                const liveMsg = await kanal.messages.fetch(stream.liveMessageId).catch(() => null);
                if (liveMsg) {
                    await liveMsg.edit({
                        content: null,
                        embeds: [createEmbed(
                            'warning',
                            `⚫ ${event.broadcaster_user_name} ist jetzt offline`,
                            `Der Stream wurde beendet. Bis zum nächsten Mal! 👋`
                        ).setURL(`https://twitch.tv/${event.broadcaster_user_login}`).setTimestamp()],
                    });
                }

                setGuildSettings(guild.id, {
                    streamConfig: { ...stream, liveMessageId: null }
                });
            }

            logger.info(`Offline-Status aktualisiert für ${event.broadcaster_user_name}`);
        }
    } catch (error) {
        logger.error('Fehler bei Stream Offline Event', error);
    }
}

module.exports = { handleStreamOnline, handleStreamOffline, setClient };
