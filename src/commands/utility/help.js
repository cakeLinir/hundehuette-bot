const { SlashCommandBuilder } = require('discord.js');
const { createEmbed }         = require('../../utils/embedBuilder');
const { getModules }          = require('../../utils/moduleManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Zeigt alle verfügbaren Befehle'),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const modules = getModules(guildId);

        const embed = createEmbed(
            'info',
            '🐾 Hundehütte — Hilfe',
            'Hier sind alle verfügbaren Befehle.\n' +
            'Deaktivierte Module werden ausgeblendet.'
        );

        // ── Admin ──
        embed.addFields({
            name: '⚙️ Administration',
            value: [
                '`/config` — Server Konfiguration',
                '`/module` — Module & Sprache verwalten',
                '`/custom` — Custom Commands verwalten',
                '`/bot sync` — Commands synchronisieren',
                '`/bot status` — Bot Status anzeigen',
            ].join('\n'),
        });

        // ── Community (nur aktive Module) ──
        const communityFields = [];

        if (modules.announcements) {
            communityFields.push('`/ankuendigung` — Ankündigung posten');
        }
        if (modules.roles) {
            communityFields.push('`/rollen-setup` — Rollen-Nachricht posten');
        }
        if (modules.feedback) {
            communityFields.push('`/feedback` — Feedback an das Team senden');
        }
        if (modules.tickets) {
            communityFields.push('`/ticket setup` — Ticket-System einrichten');
        }

        if (communityFields.length > 0) {
            embed.addFields({
                name: '🎮 Community',
                value: communityFields.join('\n'),
            });
        }

        // ── Moderation ──
        if (modules.moderation) {
            embed.addFields({
                name: '🔨 Moderation',
                value: [
                    '`/kick` — Mitglied kicken',
                    '`/ban` — Mitglied bannen',
                    '`/clear` — Nachrichten löschen',
                ].join('\n'),
            });
        }

        // ── Utility ──
        embed.addFields({
            name: '🔧 Utility',
            value: [
                '`/ping` — Bot Latenz anzeigen',
                '`/cmd` — Custom Command ausführen',
                '`/help` — Diese Hilfe anzeigen',
            ].join('\n'),
        });

        embed.setFooter({ text: 'Hundehütte • hundekuchenlive' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
