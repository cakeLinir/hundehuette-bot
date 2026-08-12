const { execSync } = require('child_process');
const { EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('./settingsManager');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function scheduleAutoRestart(client) {
    setTimeout(async () => {
        const guildId = process.env.GUILD_ID;
        const settings = getGuildSettings(guildId);
        const channelId = settings?.restartLogChannelId;
        const channel = channelId ? client.channels.cache.get(channelId) : null;

        // 1. Channel-Log
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('🔄 Automatischer Neustart')
                .setDescription('Der Bot führt jetzt seinen geplanten 24h-Neustart durch.\nUpdates werden gezogen – bin gleich zurück.')
                .setTimestamp();
            await channel.send({ embeds: [embed] }).catch(() => { });
        }

        // 2. Git Pull + npm install
        try {
            console.log('[AutoRestart] Ziehe Updates...');
            execSync('git pull', { stdio: 'inherit' });
            execSync('npm install --omit=dev', { stdio: 'inherit' });
            console.log('[AutoRestart] Updates fertig.');
        } catch (err) {
            console.error('[AutoRestart] Update fehlgeschlagen:', err.message);
        }

        // 3. Neustart via PM2
        console.log('[AutoRestart] Starte neu...');
        process.exit(0);

    }, INTERVAL_MS);

    console.log('[AutoRestart] Neustart geplant in 24h.');
}

module.exports = { scheduleAutoRestart };
