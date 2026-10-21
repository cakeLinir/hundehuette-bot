const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');

const POSITIONS = require('../../config/positions');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stellenbewerbung')
        .setDescription('Verwaltung der Funktionsstellen-Bewerbungen')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(sub => sub
            .setName('panel')
            .setDescription('Veröffentlicht das Bewerbungsmenü')
            .addChannelOption(option => option
                .setName('kanal')
                .setDescription('Kanal für das Bewerbungsmenü')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('review-kanal')
            .setDescription('Legt den internen Prüfungskanal fest')
            .addChannelOption(option => option
                .setName('kanal')
                .setDescription('Kanal für eingehende Bewerbungen')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('pruefer')
            .setDescription('Konfiguriert zusätzliche Prüferrollen')
            .addStringOption(option => option
                .setName('stelle')
                .setDescription('Funktionsstelle')
                .setRequired(true)
                .addChoices(...POSITIONS.map(position => ({
                    name: position.name,
                    value: position.key,
                })))
            )
            .addRoleOption(option => option
                .setName('rolle')
                .setDescription('Rolle, die Bewerbungen prüfen darf')
                .setRequired(true)
            )
            .addBooleanOption(option => option
                .setName('hinzufuegen')
                .setDescription('Ja = hinzufügen, Nein = entfernen')
                .setRequired(true)
            )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: 'Dieser Befehl kann nur auf einem Server verwendet werden.',
                flags: MessageFlags.Ephemeral,
            });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: 'Du ben?tigst Administratorrechte, um diesen Befehl zu verwenden.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'panel') {
            const channel = interaction.options.getChannel('kanal');

            const menu = new StringSelectMenuBuilder()
                .setCustomId('stellenbewerbung:position')
                .setPlaceholder('Wähle eine Funktionsstelle aus')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(POSITIONS.map(position => ({
                    label: position.name,
                    value: position.key,
                    description: (position.description || position.name).slice(0, 100),
                })));

            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('Bewerbung auf eine Funktionsstelle')
                .setDescription([
                    'Du möchtest eine Funktion innerhalb der Spedition übernehmen?',
                    '',
                    'Wähle unten die gewünschte Stelle aus. Du musst den erforderlichen Fahrerrang besitzen.',
                    'Pro Mitglied ist nur eine aktive Bewerbung gleichzeitig möglich.',
                ].join('\n'))
                .setFooter({ text: 'Die Bewerbung wird intern geprüft.' });

            await channel.send({
                embeds: [embed],
                components: [
                    new ActionRowBuilder().addComponents(menu),
                ],
            });

            return interaction.reply({
                content: `Das Bewerbungsmenü wurde in ${channel} veröffentlicht.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'review-kanal') {
            const channel = interaction.options.getChannel('kanal');

            setGuildSettings(guildId, {
                positionApplicationReviewChannelId: channel.id,
            });

            return interaction.reply({
                content: `Der Prüfungskanal wurde auf ${channel} gesetzt.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'pruefer') {
            const positionKey = interaction.options.getString('stelle');
            const role = interaction.options.getRole('rolle');
            const add = interaction.options.getBoolean('hinzufuegen');
            const position = POSITIONS.find(item => item.key === positionKey);

            if (!position) {
                return interaction.reply({
                    content: 'Die ausgewählte Funktionsstelle wurde nicht gefunden.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const settings = getGuildSettings(guildId);
            const reviewerConfig = {
                ...(settings.positionApplicationReviewers ?? {}),
            };
            const current = new Set(reviewerConfig[positionKey] ?? []);

            if (add) {
                current.add(role.id);
            } else {
                current.delete(role.id);
            }

            reviewerConfig[positionKey] = [...current];

            setGuildSettings(guildId, {
                positionApplicationReviewers: reviewerConfig,
            });

            return interaction.reply({
                content: add
                    ? `${role} darf jetzt Bewerbungen für **${position.name}** prüfen.`
                    : `${role} darf Bewerbungen für **${position.name}** nicht mehr zusätzlich prüfen.`,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
