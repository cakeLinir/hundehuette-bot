
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');

const RANKS = require('../../config/ranks');
const POSITIONS = require('../../config/positions');

const {
    createEmbed,
    createErrorEmbed,
} = require('../../utils/embedBuilder');

const {
    getGuildSettings,
    setGuildSettings,
} = require('../../utils/settingsManager');

const logger = require('../../utils/logger');

function describeError(err) {
    if (err.code === 50013) {
        return 'Fehlende Rechte: Meine Bot-Rolle muss über dieser Rolle stehen und die erforderlichen Rechte besitzen.';
    }

    if (err.code === 30005) {
        return 'Das Rollenlimit dieses Discord-Servers wurde erreicht.';
    }

    return `Unbekannter Fehler (siehe Log${err.code ? `, Code ${err.code}` : ''}).`;
}

async function setupRoles({
    guild,
    definitions,
    savedRoles,
    roleCategory,
    lines,
    reason,
}) {
    // Umgekehrte Reihenfolge: neu angelegte Rollen werden so
    // in der gewünschten Reihenfolge untereinander einsortiert.
    for (const definition of [...definitions].reverse()) {
        const options = {
            name: definition.role,
            color: definition.color,
            hoist: true,
            mentionable: false,
            reason,
        };

        try {
            let role =
                guild.roles.cache.get(savedRoles[definition.key]) ||
                (
                    definition.env
                        ? guild.roles.cache.get(process.env[definition.env])
                        : null
                ) ||
                guild.roles.cache.find(
                    candidate => candidate.name === definition.role
                );

            if (role) {
                await role.edit(options);
                lines.push(`🔄 ${role} aktualisiert`);
            } else {
                role = await guild.roles.create({
                    ...options,
                    permissions: definition.permissions ?? [],
                });
                lines.push(`✅ ${role} erstellt`);
            }

            savedRoles[definition.key] = role.id;
        } catch (err) {
            logger.error(
                `ets-rollen: ${roleCategory} ${definition.role} fehlgeschlagen`,
                err,
            );

            lines.push(
                `❌ **${definition.role}**: ${describeError(err)}`
            );
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ets-rollen')
        .setDescription(
            'Erstellt oder aktualisiert Fahrer-Ränge und Funktionsrollen der Spedition'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral,
        });

        const guild = interaction.guild;

        if (!guild) {
            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Dieser Befehl kann nur auf einem Discord-Server verwendet werden.'
                    ),
                ],
            });
        }

        try {
            await guild.roles.fetch();

            const settings = getGuildSettings(guild.id);

            // Getrennte Konfigurationen. Vorhandene IDs bleiben erhalten.
            const savedRankRoles = {
                ...(settings.etsRankRoles ?? {}),
            };

            const savedPositionRoles = {
                ...(settings.etsPositionRoles ?? {}),
            };

            const lines = [];

            await setupRoles({
                guild,
                definitions: RANKS,
                savedRoles: savedRankRoles,
                roleCategory: 'Fahrerrang',
                lines,
                reason: 'Spedition: Fahrer-Rang-Rollen eingerichtet',
            });

            await setupRoles({
                guild,
                definitions: POSITIONS,
                savedRoles: savedPositionRoles,
                roleCategory: 'Funktionsrolle',
                lines,
                reason: 'Spedition: Funktionsrollen eingerichtet',
            });

            // Beide Maps gemeinsam speichern, ohne andere
            // Guild-Einstellungen zu überschreiben.
            setGuildSettings(guild.id, {
                etsRankRoles: savedRankRoles,
                etsPositionRoles: savedPositionRoles,
            });

            const failed = lines.some(line => line.startsWith('❌'));

            const summary = [
                '**Fahrerränge**',
                ...[...RANKS]
                    .reverse()
                    .map(rank => {
                        const roleId = savedRankRoles[rank.key];
                        return roleId
                            ? `• <@&${roleId}>`
                            : `• ❌ ${rank.role}: keine Rollen-ID gespeichert`;
                    }),
                '',
                '**Funktionsrollen**',
                ...[...POSITIONS]
                    .reverse()
                    .map(position => {
                        const roleId = savedPositionRoles[position.key];
                        return roleId
                            ? `• <@&${roleId}>`
                            : `• ❌ ${position.role}: keine Rollen-ID gespeichert`;
                    }),
                '',
                ...lines,
                '',
                'Prüfe die Rollenreihenfolge in den Servereinstellungen. Die Bot-Rolle muss über allen Rollen liegen, die der Bot verwalten soll.',
            ].join('\n');

            return interaction.editReply({
                embeds: [
                    failed
                        ? createErrorEmbed(summary)
                        : createEmbed(
                            'success',
                            '🚚 Speditionsrollen eingerichtet',
                            summary,
                        ),
                ],
            });
        } catch (err) {
            logger.error('ets-rollen: Einrichtung fehlgeschlagen', err);

            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Die Rolleneinrichtung konnte nicht vollständig ausgeführt werden. Bitte prüfe das Bot-Log.'
                    ),
                ],
            });
        }
    },
};
