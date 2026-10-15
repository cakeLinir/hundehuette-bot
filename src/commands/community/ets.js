const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');
const {
    fetchUsers, findDriver, isRankAllowed, fetchDiscordUid, getLinkOwner, setLink,
} = require('../../utils/spedvApi');

const fail = (interaction, text) =>
    interaction.editReply({ embeds: [createErrorEmbed(text)] });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ets')
        .setDescription('Hol dir die ETS2/ATS-Rolle (nur für Fahrer unserer Spedition)'),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        if (!isModuleEnabled(guildId, 'ets')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das ETS2/ATS-Modul ist auf diesem Server deaktiviert!')],
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { SPEDV_API_KEY, ETS_ROLE_ID, ETS_ALLOWED_RANKS, ETS_REQUIRE_DISCORD_UID } = process.env;
        if (!SPEDV_API_KEY || !ETS_ROLE_ID || !ETS_ALLOWED_RANKS) {
            logger.warn('ETS: SPEDV_API_KEY, ETS_ROLE_ID oder ETS_ALLOWED_RANKS fehlt in der .env');
            return fail(interaction, 'Das Modul ist noch nicht fertig eingerichtet. Bitte melde dich beim Team.');
        }

        const member = interaction.member;

        if (member.roles.cache.has(ETS_ROLE_ID)) {
            return interaction.editReply({
                embeds: [createEmbed('info', 'ℹ️ Schon erledigt', 'Du hast die ETS2/ATS-Rolle bereits.')],
            });
        }

        let driver;
        let linkedUid;
        try {
            const users = await fetchUsers();
            driver = findDriver(users, [
                member.displayName,
                interaction.user.globalName,
                interaction.user.username,
            ]);

            if (driver && isRankAllowed(driver)) {
                linkedUid = await fetchDiscordUid(driver.id);
            }
        } catch (err) {
            logger.error('ETS: SpedV-Abfrage fehlgeschlagen', err);
            return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
        }

        if (!driver) {
            return fail(
                interaction,
                'Ich finde dich nicht in unserer Spedition.\n' +
                'Setz deinen **Server-Nickname exakt auf deinen SpedV-Namen** und versuch es nochmal.'
            );
        }

        if (!isRankAllowed(driver)) {
            return fail(interaction, 'Dein Rang reicht noch nicht aus. Du brauchst mindestens **Fahrer auf Probe**.');
        }

        if (linkedUid) {
            // Sicherste Variante: SpedV-Profil ist mit genau diesem Discord-Account verknüpft
            if (linkedUid !== interaction.user.id) {
                return fail(interaction, 'Dieser SpedV-Account ist mit einem anderen Discord-Account verknüpft.');
            }
        } else if (ETS_REQUIRE_DISCORD_UID === 'true') {
            return fail(interaction, 'Bitte hinterlege zuerst deinen Discord-Account in deinem SpedV-Profil.');
        } else {
            // Fallback: Namensabgleich + Bindung SpedV-Name -> Discord-ID
            const owner = getLinkOwner(driver.userName);
            if (owner && owner !== interaction.user.id) {
                return fail(interaction, 'Dieser SpedV-Name ist bereits mit einem anderen Discord-Account verknüpft.');
            }
        }

        try {
            await member.roles.add(ETS_ROLE_ID, 'ETS2/ATS: SpedV-Rang geprüft');
        } catch (err) {
            logger.error('ETS: Rolle konnte nicht vergeben werden', err);
            return fail(
                interaction,
                'Ich darf die Rolle nicht vergeben. Das Team muss meine Bot-Rolle über die ETS2/ATS-Rolle schieben.'
            );
        }

        setLink(driver.userName, interaction.user.id);

        return interaction.editReply({
            embeds: [createEmbed('success', '🚚 Willkommen im Fuhrpark!', `Du hast jetzt die ETS2/ATS-Rolle, **${driver.userName}**.`)],
        });
    },
};
