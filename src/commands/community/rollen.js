const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');
const { getGuildSettings } = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/i18n')
const { isModuleEnabled } = require('../../utils/moduleManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rollen-setup')
        .setDescription('Postet die Rollen-Auswahl Nachricht')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'roles')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Rollen-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }
        const guildId = interaction.guild.id;

        // Prüfen ob Buttons konfiguriert sind
        if (!settings.rollenButtons || settings.rollenButtons.length === 0) {
            return interaction.reply({
                embeds: [createErrorEmbed(
                    'Keine Rollen-Buttons konfiguriert!\n' +
                    'Füge zuerst Buttons hinzu mit `/config rollen-add`.'
                )],
                ephemeral: true,
            });
        }

        // Buttons dynamisch aus den Settings bauen
        const buttons = settings.rollenButtons.map(b =>
            new ButtonBuilder()
                .setCustomId(`rolle_${b.roleId}`)
                .setLabel(b.label)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(b.emoji ?? '🎮')
        );

        const row = new ActionRowBuilder().addComponents(buttons);

        // Beschreibung dynamisch generieren
        const rollenText = settings.rollenButtons
            .map(b => `${b.emoji ?? '🎮'} **${b.label}** → <@&${b.roleId}>`)
            .join('\n');

        const embed = createEmbed(
            'info',
            '🎮 Wähle deine Rollen!',
            'Klicke auf einen Button um dir eine Rolle zu holen.\n' +
            'Ein erneuter Klick **entfernt** die Rolle wieder.\n\n' +
            t(guildId, 'roles.title'),
            t(guildId, 'roles.description', { rollen: rollenText })
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });

        await interaction.reply({
            embeds: [createEmbed('success', '✅ Fertig!', 'Die Rollen-Nachricht wurde gepostet.')],
            ephemeral: true,
        });
    }
};
