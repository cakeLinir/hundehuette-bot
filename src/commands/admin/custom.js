const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('custom')
        .setDescription('Verwalte eigene Custom Commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // ── Erstellen ──
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Erstellt einen neuen Custom Command')
            .addStringOption(opt => opt
                .setName('name')
                .setDescription('Name des Commands (z.B. "socials")')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('titel')
                .setDescription('Titel des Embeds')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('inhalt')
                .setDescription('Inhalt des Embeds')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('farbe')
                .setDescription('Farbe des Embeds')
                .setRequired(false)
                .addChoices(
                    { name: '🟢 Grün', value: 'success' },
                    { name: '🔵 Blau', value: 'info' },
                    { name: '🟡 Orange', value: 'warning' },
                    { name: '🔴 Rot', value: 'error' },
                    { name: '⚫ Grau', value: 'default' },
                )
            )
        )

        // ── Löschen ──
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Löscht einen Custom Command')
            .addStringOption(opt => opt
                .setName('name')
                .setDescription('Name des Commands der gelöscht werden soll')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )

        // ── Liste ──
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Zeigt alle Custom Commands dieses Servers')
        ),

    // Autocomplete für delete
    async autocomplete(interaction) {
        const settings = getGuildSettings(interaction.guild.id);
        const customCommands = settings.customCommands ?? {};
        const focused = interaction.options.getFocused().toLowerCase();

        const choices = Object.keys(customCommands)
            .filter(name => name.includes(focused))
            .slice(0, 25)
            .map(name => ({ name, value: name }));

        await interaction.respond(choices);
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const settings = getGuildSettings(guildId);
        const commands = settings.customCommands ?? {};

        // ── Create ───────────────────────────────────────────────
        if (sub === 'create') {
            const name = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
            const titel = interaction.options.getString('titel');
            const inhalt = interaction.options.getString('inhalt');
            const farbe = interaction.options.getString('farbe') ?? 'info';

            // Max 25 Custom Commands pro Server
            if (Object.keys(commands).length >= 25) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        'Maximal **25 Custom Commands** pro Server möglich!\n' +
                        'Lösche erst einen Command mit `/custom delete`.'
                    )],
                    ephemeral: true,
                });
            }

            if (commands[name]) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        `Der Command \`${name}\` existiert bereits!\n` +
                        `Lösche ihn zuerst mit \`/custom delete\`.`
                    )],
                    ephemeral: true,
                });
            }

            commands[name] = { titel, inhalt, farbe };
            setGuildSettings(guildId, { customCommands: commands });

            return interaction.reply({
                embeds: [createEmbed(
                    'success',
                    '✅ Custom Command erstellt!',
                    `Der Command \`${name}\` wurde erstellt!\n\n` +
                    `Nutze ihn mit \`/cmd name:${name}\``
                )],
                ephemeral: true,
            });
        }

        // ── Delete ───────────────────────────────────────────────
        if (sub === 'delete') {
            const name = interaction.options.getString('name').toLowerCase();

            if (!commands[name]) {
                return interaction.reply({
                    embeds: [createErrorEmbed(`Der Command \`${name}\` existiert nicht!`)],
                    ephemeral: true,
                });
            }

            delete commands[name];
            setGuildSettings(guildId, { customCommands: commands });

            return interaction.reply({
                embeds: [createSuccessEmbed(`Der Command \`${name}\` wurde gelöscht!`)],
                ephemeral: true,
            });
        }

        // ── List ─────────────────────────────────────────────────
        if (sub === 'list') {
            if (Object.keys(commands).length === 0) {
                return interaction.reply({
                    embeds: [createEmbed(
                        'info',
                        '📋 Custom Commands',
                        'Noch keine Custom Commands erstellt!\n' +
                        'Erstelle einen mit `/custom create`.'
                    )],
                    ephemeral: true,
                });
            }

            const liste = Object.entries(commands)
                .map(([name, data]) => `\`${name}\` — **${data.titel}**`)
                .join('\n');

            return interaction.reply({
                embeds: [createEmbed(
                    'info',
                    `📋 Custom Commands (${Object.keys(commands).length}/25)`,
                    liste
                )],
                ephemeral: true,
            });
        }
    }
};
