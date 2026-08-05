const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verifizierungs-System verwalten')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Richtet das Verifizierungs-System ein')
            .addRoleOption(opt => opt
                .setName('rolle')
                .setDescription('Rolle die nach erfolgreicher Verifizierung vergeben wird')
                .setRequired(true)
            )
            .addChannelOption(opt => opt
                .setName('log-kanal')
                .setDescription('Kanal für Verifizierungs-Logs (optional)')
                .setRequired(false)
            )
        )
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Zeigt die aktuelle Verifizierungs-Konfiguration')
        )
        .addSubcommand(sub => sub
            .setName('disable')
            .setDescription('Deaktiviert das Verifizierungs-System')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'setup') {
            const rolle = interaction.options.getRole('rolle');
            const logKanal = interaction.options.getChannel('log-kanal');

            setGuildSettings(guildId, {
                verifyEnabled: true,
                verifyRoleId: rolle.id,
                verifyLogChannelId: logKanal?.id ?? null,
            });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `**Rolle:** ${rolle}\n` +
                    `**Log-Kanal:** ${logKanal ? `<#${logKanal.id}>` : 'Kein'}\n\n` +
                    `Neue Mitglieder erhalten beim Beitritt automatisch eine DM mit dem Verifizierungs-Link.\n` +
                    `Falls DMs deaktiviert sind, wird die Nachricht im Willkommens-Kanal gepostet.`
                )],
                flags: 64,
            });
        }

        if (sub === 'status') {
            const s = getGuildSettings(guildId);
            if (!s.verifyEnabled || !s.verifyRoleId) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Verifizierungs-System nicht eingerichtet.\nNutze `/verify setup`.')],
                    flags: 64,
                });
            }
            return interaction.reply({
                embeds: [createEmbed('info', '🔐 Verifizierungs-System', [
                    `**Status:** ✅ Aktiv`,
                    `**Rolle:** <@&${s.verifyRoleId}>`,
                    `**Log-Kanal:** ${s.verifyLogChannelId ? `<#${s.verifyLogChannelId}>` : 'Kein'}`,
                ].join('\n'))],
                flags: 64,
            });
        }

        if (sub === 'disable') {
            setGuildSettings(guildId, { verifyEnabled: false });
            return interaction.reply({
                embeds: [createSuccessEmbed('Verifizierungs-System wurde deaktiviert.')],
                flags: 64,
            });
        }
    }
};
