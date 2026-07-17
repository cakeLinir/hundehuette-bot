const { getStreamInfo } = require('./twitchApi');
const { getGuildSettings, setGuildSettings } = require('./settingsManager');
const { createEmbed } = require('./embedBuilder');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

const CHECK_INTERVAL = 2 * 60 * 1000; // Alle 2 Minuten prüfen

/**
 * Prüft alle Server mit konfiguriertem Twitch-Kanal
 */
async function checkAllGuilds(client) {
    const settingsPath = path.join(__dirname, '..', '..', 'data', 'guildSettings.json');
    if (!fs.existsSync(settingsPath)) return;

    const allSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    for (const guildId of Object.keys(allSettings)) {
        const settings = allSettings[guildId];
        const twitch = settings.twitch;

        if (!twitch?.username || !twitch?.notifyChannelId) continue;

        try {
            await checkStream(client, guildId, twitch);
        } catch (error) {
            logger.error(`Twitch Check fehlgeschlagen für Guild ${guildId}`, error);
        }
    }
}

/**
 * Prüft einen einzelnen Twitch-Kanal und postet ggf. eine Benachrichtigung
 */
async function checkStream(client, guildId, twitch) {
    const streamInfo = await getStreamInfo(twitch.username);
    const warVorherLive = twitch.isLive ?? false;
    const istJetztLive = streamInfo !== null;

    // Status aktualisieren
    const settings = getGuildSettings(guildId);
    settings.twitch.isLive = istJetztLive;

    // Nur benachrichtigen wenn der Stream GERADE erst live gegangen ist
    if (istJetztLive && !warVorherLive) {
        const guild = client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(twitch.notifyChannelId);

        if (channel) {
            const rolePing = twitch.roleId ? `<@&${twitch.roleId}>` : '';

            const embed = createEmbed(
                'error', // Twitch-Lila würde noch besser passen, siehe Hinweis unten
                `🔴 ${twitch.username} ist jetzt LIVE!`,
                `**${streamInfo.title}**\n\n` +
                `🎮 Spielt: **${streamInfo.game_name || 'Unbekannt'}**\n` +
                `👀 Zuschauer: **${streamInfo.viewer_count}**\n\n` +
                `[▶️ Jetzt zuschauen](https://twitch.tv/${twitch.username})`
            )
                .setImage(
                    streamInfo.thumbnail_url
                        .replace('{width}', '640')
                        .replace('{height}', '360') + `?t=${Date.now()}`
                )
                .setURL(`https://twitch.tv/${twitch.username}`);

            await channel.send({ content: rolePing || undefined, embeds: [embed] });
            logger.info(`🔴 ${twitch.username} ist live — Benachrichtigung gesendet (Guild ${guildId})`);
        }
    }

    setGuildSettings(guildId, { twitch: settings.twitch });
}

/**
 * Startet den Watcher — wird einmal in index.js aufgerufen
 */
function startTwitchWatcher(client) {
    logger.info('Twitch Watcher gestartet — Prüfung alle 2 Minuten');

    // Erste Prüfung sofort, danach im Intervall
    checkAllGuilds(client);
    setInterval(() => checkAllGuilds(client), CHECK_INTERVAL);
}

module.exports = { startTwitchWatcher };
