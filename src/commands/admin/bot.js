const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    REST,
    Routes,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot')
        .setDescription('Bot-Verwaltung (Nur für Entwickler)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(sub => sub
            .setName('sync')
            .setDescription('Synchronisiert alle Slash-Befehle mit Discord')
        )

        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Zeigt den aktuellen Status des Bots')
        ),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();

        // ── Sync ─────────────────────────────────────────────────
        if (sub === 'sync') {

            // Abgelaufene Interactions abfangen
            try {
                await interaction.deferReply({ ephemeral: true });
            } catch (_) {
                console.warn('⚠️  Sync wurde ausgeführt aber Interaction war bereits abgelaufen.');
                return;
            }

            try {
                const commands     = [];
                const commandsPath = path.join(__dirname, '..', '..', 'commands');
                const categories   = fs.readdirSync(commandsPath);

                for (const category of categories) {
                    const categoryPath = path.join(commandsPath, category);
                    if (!fs.statSync(categoryPath).isDirectory()) continue;

                    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

                    for (const file of files) {
                        const filePath = path.join(categoryPath, file);
                        delete require.cache[require.resolve(filePath)];

                        const command = require(filePath);
                        if (command.data) commands.push(command.data.toJSON());
                    }
                }

                const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

                await rest.put(
                    Routes.applicationCommands(process.env.CLIENT_ID),
                    { body: [] }
                );

                await rest.put(
                    Routes.applicationCommands(process.env.CLIENT_ID),
                    { body: commands }
                );

                console.log(`🔄 Sync ausgeführt von ${interaction.user.tag} — ${commands.length} Befehl(e) registriert`);

                await interaction.editReply({
                    embeds: [createEmbed(
                        'success',
                        '🔄 Sync erfolgreich!',
                        `**${commands.length} Befehl(e)** wurden erfolgreich synchronisiert.\n\n` +
                        `> ⏱️ Discord kann bis zu **1-2 Minuten** brauchen bis alle Befehle aktualisiert sind.`
                    )],
                });

            } catch (error) {
                console.error('❌ Fehler beim Sync:', error);

                await interaction.editReply({
                    embeds: [createErrorEmbed(
                        `Sync fehlgeschlagen!\n\`\`\`${error.message}\`\`\``
                    )],
                }).catch(() => {});
            }
        }


        // ── Status ───────────────────────────────────────────────
        if (sub === 'status') {
            try {
                const uptime    = process.uptime();
                const stunden   = Math.floor(uptime / 3600);
                const minuten   = Math.floor((uptime % 3600) / 60);
                const sekunden  = Math.floor(uptime % 60);
                const uptimeStr = `${stunden}h ${minuten}m ${sekunden}s`;

                const memUsage = process.memoryUsage();
                const memMB    = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

                await interaction.reply({
                    embeds: [createEmbed('info', '📊 Bot Status', [
                        `**🟢 Online seit:** \`${uptimeStr}\``,
                        `**💾 Speicher:** \`${memMB} MB\``,
                        `**📡 Latenz:** \`${Math.round(client.ws.ping)}ms\``,
                        `**🌐 Server:** \`${client.guilds.cache.size}\``,
                        `**⚙️ Commands:** \`${client.commands.size}\``,
                        `**🤖 Node.js:** \`${process.version}\``,
                    ].join('\n'))],
                    ephemeral: true,
                });
            } catch (_) {
                console.warn('⚠️  Status Interaction abgelaufen.');
            }
        }
    }
};
