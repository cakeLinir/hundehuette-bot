const {
    SlashCommandBuilder,
} = require('discord.js');
const { getGuildSettings }               = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed }  = require('../../utils/embedBuilder');
const { isModuleEnabled }                = require('../../utils/moduleManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmd')
        .setDescription('Führt einen Custom Command aus')
        .addStringOption(opt => opt
            .setName('name')
            .setDescription('Name des Custom Commands')
            .setRequired(true)
            .setAutocomplete(true)
        ),

    // Autocomplete — zeigt verfügbare Commands während der Nutzer tippt
    async autocomplete(interaction) {
        const settings       = getGuildSettings(interaction.guild.id);
        const customCommands = settings.customCommands ?? {};
        const focused        = interaction.options.getFocused().toLowerCase();

        const choices = Object.keys(customCommands)
            .filter(name => name.includes(focused))
            .slice(0, 25)
            .map(name => ({ name, value: name }));

        await interaction.respond(choices);
    },

    async execute(interaction) {
        const guildId  = interaction.guild.id;
        const settings = getGuildSettings(guildId);
        const commands = settings.customCommands ?? {};
        const name     = interaction.options.getString('name').toLowerCase();
        const command  = commands[name];

        if (!command) {
            return interaction.reply({
                embeds: [createErrorEmbed(
                    `Der Command \`${name}\` existiert nicht!\n` +
                    `Alle Commands ansehen mit \`/custom list\`.`
                )],
                ephemeral: true,
            });
        }

        await interaction.reply({
            embeds: [createEmbed(command.farbe, command.titel, command.inhalt)],
        });
    }
};
