const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const logger = require('../../utils/logger');

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
                .setDescription('Rolle die nach Verifizierung vergeben wird')
                .setRequired(true)
            )
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Kanal in dem der Verify-Button gepostet wird')
                .setRequired(true)
            )
            .addChannelOption(opt => opt
                .setName('log-kanal')
                .setDescription('Kanal für Verifizierungs-Logs (optional)')
                .setRequired(false)
            )
        )
        .addSubcommand(sub => sub
            .setName('post')
            .setDescription('Postet die Verifizierungs-Nachricht erneut im konfigurierten Kanal')
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

        // ── Setup ────────────────────────────────────────────
        if (sub === 'setup') {
            const rolle = interaction.options.getRole('rolle');
            const kanal = interaction.options.getChannel('kanal');
            const logKanal = interaction.options.getChannel('log-kanal');

            setGuildSettings(guildId, {
                verifyEnabled: true,
                verifyRoleId: rolle.id,
                verifyChannelId: kanal.id,
                verifyLogChannelId: logKanal?.id ?? null,
            });

            // Embed direkt posten
            await postVerifyEmbed(interaction.guild, kanal.id);

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `**Rolle:** ${rolle}\n` +
                    `**Verify-Kanal:** <#${kanal.id}>\n` +
                    `**Log-Kanal:** ${logKanal ? `<#${logKanal.id}>` : 'Kein'}\n\n` +
                    `✅ Verifizierungs-Nachricht wurde in <#${kanal.id}> gepostet.\n\n` +
                    `**Tipp:** Stelle sicher dass \`@everyone\` nur <#${kanal.id}> sehen kann und \`${rolle.name}\` Zugang zum Rest des Servers hat.`
                )],
                flags: 64,
            });
        }

        // ── Post ─────────────────────────────────────────────
        if (sub === 'post') {
            const settings = getGuildSettings(guildId);
            if (!settings.verifyEnabled || !settings.verifyChannelId) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Bitte zuerst `/verify setup` ausführen.')],
                    flags: 64,
                });
            }
            await interaction.deferReply({ flags: 64 });
            await postVerifyEmbed(interaction.guild, settings.verifyChannelId);
            return interaction.editReply({
                embeds: [createSuccessEmbed(`Verifizierungs-Nachricht wurde erneut in <#${settings.verifyChannelId}> gepostet.`)],
            });
        }

        // ── Status ───────────────────────────────────────────
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
                    `**Verify-Kanal:** <#${s.verifyChannelId}>`,
                    `**Log-Kanal:** ${s.verifyLogChannelId ? `<#${s.verifyLogChannelId}>` : 'Kein'}`,
                ].join('\n'))],
                flags: 64,
            });
        }

        // ── Disable ──────────────────────────────────────────
        if (sub === 'disable') {
            setGuildSettings(guildId, { verifyEnabled: false });
            return interaction.reply({
                embeds: [createSuccessEmbed('Verifizierungs-System wurde deaktiviert.')],
                flags: 64,
            });
        }
    }
};

// ── Hilfsfunktion: Embed posten ──────────────────────────────
async function postVerifyEmbed(guild, channelId) {
    const kanal = guild.channels.cache.get(channelId);
    if (!kanal) return;

    const embed = createEmbed(
        'info',
        '🔐 Server-Verifizierung',
        [
            `Willkommen auf **${guild.name}**! 🐾`,
            ``,
            `Um Zugang zum Server zu erhalten, musst du dich einmalig verifizieren.`,
            ``,
            `**So funktioniert es:**`,
            `> 1. Klicke auf **"Verifizieren"**`,
            `> 2. Du wirst zu Discord weitergeleitet`,
            `> 3. Bestätige dort einmalig deine Identität`,
            `> 4. Du erhältst automatisch Zugang zum Server`,
            ``,
            `🔒 Wir erhalten dabei **ausschließlich** deine Discord-User-ID — kein Passwort, keine E-Mail.`,
        ].join('\n')
    ).setThumbnail(guild.iconURL({ extension: 'webp' }));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verify_btn:${guild.id}`)
            .setLabel('Verifizieren')
            .setEmoji('🔐')
            .setStyle(ButtonStyle.Primary)
    );

    await kanal.send({ embeds: [embed], components: [row] });
}
module.exports.postVerifyEmbed = postVerifyEmbed;