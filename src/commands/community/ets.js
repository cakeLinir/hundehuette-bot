const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');
const {
    fetchUsers, findDriver, isRankAllowed, fetchAboutMe, getLinkOwner, setLink,
} = require('../../utils/spedvApi');
const {
    getPending, createPending, clearPending, codeInText, TTL_MS,
} = require('../../utils/etsVerification');
const { applyRoles } = require('../../utils/spedvRoleSync');

const COOLDOWN_MS = 15_000;
const lastUse = new Map();

const norm = v => String(v ?? '').trim().toLowerCase();
const fail = (interaction, text) => interaction.editReply({ embeds: [createErrorEmbed(text)] });

async function grantRoles(interaction, driver) {
    try {
        const { added, removed } = await applyRoles(interaction.member, driver, 'ETS2/ATS: SpedV-Rang geprüft');
        const text = added + removed === 0
            ? `Alles aktuell, **${driver.userName}** (${driver.rank?.name}).`
            : `Deine Rollen sind aktualisiert, **${driver.userName}** (${driver.rank?.name}).`;
        return interaction.editReply({ embeds: [createEmbed('success', '🚚 Willkommen im Fuhrpark!', text)] });
    } catch (err) {
        logger.error('ETS: Rollen konnten nicht vergeben werden', err);
        return fail(
            interaction,
            'Ich darf die Rollen nicht vergeben. Das Team muss meine Bot-Rolle über die ETS2/ATS- und Rang-Rollen schieben.'
        );
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ets')
        .setDescription('Hol dir die ETS2/ATS-Rolle (nur für Fahrer unserer Spedition)')
        .addStringOption(option =>
            option
                .setName('spedv-name')
                .setDescription('Dein SpedV-Name, falls er nicht dein Server-Nickname ist')
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        if (!isModuleEnabled(guildId, 'ets')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das ETS2/ATS-Modul ist auf diesem Server deaktiviert!')],
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { SPEDV_API_KEY, ETS_ROLE_ID, ETS_ALLOWED_RANKS } = process.env;
        if (!SPEDV_API_KEY || !ETS_ROLE_ID || !ETS_ALLOWED_RANKS) {
            logger.warn('ETS: SPEDV_API_KEY, ETS_ROLE_ID oder ETS_ALLOWED_RANKS fehlt in der .env');
            return fail(interaction, 'Das Modul ist noch nicht fertig eingerichtet. Bitte melde dich beim Team.');
        }

        // Schutz vor Spam auf die SpedV-API
        const last = lastUse.get(interaction.user.id);
        if (last && Date.now() - last < COOLDOWN_MS) {
            return fail(interaction, 'Bitte warte ein paar Sekunden, bevor du den Befehl erneut nutzt.');
        }
        lastUse.set(interaction.user.id, Date.now());

        const member = interaction.member;
        const givenName = interaction.options.getString('spedv-name');
        const candidates = givenName
            ? [givenName]
            : [member.displayName, interaction.user.globalName, interaction.user.username];

        let driver;
        try {
            driver = findDriver(await fetchUsers(), candidates);
        } catch (err) {
            logger.error('ETS: SpedV-Abfrage fehlgeschlagen', err);
            return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
        }

        if (!driver) {
            return fail(
                interaction,
                'Ich finde dich nicht in unserer Spedition.\n' +
                'Setz deinen **Server-Nickname auf deinen SpedV-Namen** oder nutze `/ets spedv-name:DeinName`.'
            );
        }

        if (!isRankAllowed(driver)) {
            return fail(interaction, 'Dein Rang reicht noch nicht aus. Du brauchst mindestens **Fahrer auf Probe**.');
        }

        // Schon verifiziert? Dann nur Rollen abgleichen.
        const owner = getLinkOwner(driver.userName);
        if (owner && owner !== interaction.user.id) {
            return fail(interaction, 'Dieser SpedV-Account ist bereits mit einem anderen Discord-Account verknüpft.');
        }
        if (owner === interaction.user.id) {
            return grantRoles(interaction, driver);
        }

        // Verifizierung per Code im SpedV-Profil ("Über mich")
        const pending = getPending(interaction.user.id);

        if (!pending || norm(pending.spedvName) !== norm(driver.userName)) {
            const created = createPending(interaction.user.id, driver.userName);
            return interaction.editReply({
                embeds: [createEmbed(
                    'info',
                    '🔐 Kurze Bestätigung nötig',
                    `Damit niemand deinen Namen missbrauchen kann, bestätige bitte dein SpedV-Profil:\n\n` +
                    `1. Trage diesen Code in SpedV im Profil unter **Über mich** ein:\n` +
                    `**\`${created.code}\`**\n` +
                    `2. Speichere das Profil.\n` +
                    `3. Nutze danach erneut **/ets**.\n\n` +
                    `Der Code ist ${TTL_MS / 60_000} Minuten gültig. Nach der Bestätigung kannst du ihn wieder löschen.`
                )],
            });
        }

        let aboutMe;
        try {
            aboutMe = await fetchAboutMe(driver.id);
        } catch (err) {
            logger.error('ETS: Profil konnte nicht gelesen werden', err);
            return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
        }

        if (!codeInText(aboutMe, pending.code)) {
            return fail(
                interaction,
                `Ich finde den Code noch nicht in deinem Profil.\n` +
                `Trage **\`${pending.code}\`** unter **Über mich** ein, speichere und versuch es nochmal.`
            );
        }

        clearPending(interaction.user.id);
        setLink(driver.userName, interaction.user.id);
        return grantRoles(interaction, driver);
    },
};
