const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const RANKS = require('../../config/ranks');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const logger = require('../../utils/logger');

function describeError(err) {
    if (err.code === 50013) {
        return 'Fehlende Rechte: Meine Bot-Rolle muss über dieser Rolle stehen und die Rechte selbst besitzen.';
    }
    return 'Unbekannter Fehler (siehe Log).';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ets-rollen')
        .setDescription('Erstellt oder aktualisiert die Rang-Rollen der Spedition')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        await guild.roles.fetch();

        const saved = { ...(getGuildSettings(guild.id).etsRankRoles ?? {}) };
        const lines = [];

        // Von oben nach unten anlegen: neue Rollen landen unten, so entsteht die richtige Reihenfolge
        for (const rank of [...RANKS].reverse()) {
            const options = {
                name: rank.role,
                color: rank.color,
                hoist: true, // in der Mitgliederliste getrennt anzeigen
                mentionable: false,
                permissions: rank.permissions,
                reason: 'Spedition: Rang-Rollen eingerichtet',
            };

            try {
                let role =
                    guild.roles.cache.get(saved[rank.key]) ||
                    guild.roles.cache.get(process.env[rank.env]) ||
                    guild.roles.cache.find(r => r.name === rank.role);

                if (role) {
                    await role.edit(options);
                    lines.push(`🔄 ${role} aktualisiert`);
                } else {
                    role = await guild.roles.create(options);
                    lines.push(`✅ ${role} erstellt`);
                }
                saved[rank.key] = role.id;
            } catch (err) {
                logger.error(`ets-rollen: ${rank.role} fehlgeschlagen`, err);
                lines.push(`❌ **${rank.role}**: ${describeError(err)}`);
            }
        }

        setGuildSettings(guild.id, { etsRankRoles: saved });

        const failed = lines.some(l => l.startsWith('❌'));
        return interaction.editReply({
            embeds: [failed
                ? createErrorEmbed(lines.join('\n'))
                : createEmbed(
                    'success',
                    '🚚 Rang-Rollen eingerichtet',
                    `${[...lines].reverse().join('\n')}\n\n` +
                    `Prüfe die **Reihenfolge** in den Servereinstellungen: Meine Bot-Rolle muss über allen Rang-Rollen stehen.`
                )],
        });
    },
};
