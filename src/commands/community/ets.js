'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');
const {
    fetchUsers,
    findDriver,
    isRankAllowed,
    fetchAboutMe,
    getLinkRecord,
    getLinkRecordBySpedvUserId,
    setLink,
} = require('../../utils/spedvApi');
const {
    getPending,
    createPending,
    clearPending,
    codeInText,
    TTL_MS,
} = require('../../utils/etsVerification');
const { applyRoles } = require('../../utils/spedvRoleSync');

const COOLDOWN_MS = 15_000;
const lastUse = new Map();

const norm = value => String(value ?? '').trim().toLowerCase();

const fail = (interaction, text) =>
    interaction.editReply({ embeds: [createErrorEmbed(text)] });

async function grantRoles(interaction, driver, { alreadyLinked = false } = {}) {
    try {
        const result = await applyRoles(
            interaction.member,
            driver,
            'ETS2/ATS: SpedV-Rang geprüft'
        );

        if (result.skipped) {
            // Konfigurationsdetails nur ins Log, nicht an den Nutzer
            logger.warn(`ETS: Rollen für ${driver.userName} nicht gesetzt: ${result.reason}`);
            return fail(
                interaction,
                'Deine Verknüpfung ist gespeichert, aber für deinen Rang ist noch keine Rolle eingerichtet. Bitte melde dich bei der Geschäftsführung.'
            );
        }

        const changed = result.added + result.removed > 0;
        const text = changed
            ? `Deine Rollen sind aktualisiert, **${driver.userName}** (${driver.rank?.name}).`
            : `Alles aktuell, **${driver.userName}** (${driver.rank?.name}).`;

        return interaction.editReply({
            embeds: [createEmbed(
                'success',
                alreadyLinked ? '✅ Bereits verknüpft' : '🚚 Willkommen im Fuhrpark!',
                text
            )],
        });
    } catch (error) {
        logger.error('ETS: Rollen konnten nicht vergeben werden', error);
        return fail(
            interaction,
            'Ich darf die Rollen nicht vergeben. Das Team muss meine Bot-Rolle über die ETS2/ATS- und Rang-Rollen schieben.'
        );
    }
}

async function verifySpedvName(interaction) {
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
        return fail(
            interaction,
            'Das Modul ist noch nicht fertig eingerichtet. Bitte melde dich beim Team.'
        );
    }

    const last = lastUse.get(interaction.user.id);
    if (last && Date.now() - last < COOLDOWN_MS) {
        return fail(interaction, 'Bitte warte ein paar Sekunden, bevor du den Befehl erneut nutzt.');
    }
    lastUse.set(interaction.user.id, Date.now());

    const givenName = interaction.options.getString('spedv-name', true).trim();
    if (!givenName) {
        return fail(interaction, 'Bitte gib deinen SpedV-Namen an.');
    }

    let driver;
    try {
        driver = findDriver(await fetchUsers(), [givenName]);
    } catch (error) {
        logger.error('ETS: SpedV-Abfrage fehlgeschlagen', error);
        return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
    }

    if (!driver) {
        return fail(
            interaction,
            'Ich finde diesen Namen nicht in unserer Spedition. Prüfe die Schreibweise deines SpedV-Namens und versuche es erneut.'
        );
    }

    if (!isRankAllowed(driver)) {
        return fail(
            interaction,
            'Dein Rang reicht noch nicht aus. Du brauchst mindestens **Fahrer auf Probe**.'
        );
    }

    const driverSpedvId = String(driver.id ?? '').trim();
    if (!/^\d+$/.test(driverSpedvId)) {
        return fail(
            interaction,
            'Die SpedV-Nutzer-ID ist ungültig. Eine sichere Verknüpfung ist nicht möglich.'
        );
    }

    let existingByName;
    let existingById;
    try {
        existingByName = getLinkRecord(driver.userName);
        existingById = getLinkRecordBySpedvUserId(driverSpedvId);
    } catch (error) {
        logger.error('ETS: Bestehende SpedV-Verknüpfungen konnten nicht eindeutig gelesen werden', error);
        return fail(
            interaction,
            'Deine bestehende SpedV-Verknüpfung ist nicht eindeutig. Bitte wende dich an die Geschäftsführung.'
        );
    }

    if (existingByName && existingByName.discordId !== interaction.user.id) {
        return fail(interaction, 'Dieser SpedV-Name ist bereits mit einem anderen Discord-Konto verknüpft.');
    }

    if (existingById && existingById.discordId !== interaction.user.id) {
        return fail(interaction, 'Dieses SpedV-Konto ist bereits mit einem anderen Discord-Konto verknüpft.');
    }

    if (
        existingByName?.spedvUserId &&
        existingByName.spedvUserId !== driverSpedvId
    ) {
        return fail(
            interaction,
            'Der SpedV-Name ist bereits einer anderen SpedV-Nutzer-ID zugeordnet. Eine automatische Änderung ist nicht möglich.'
        );
    }

    // Bereits verifiziert: nur Rollen abgleichen
    if (
        existingByName?.verified &&
        existingByName.discordId === interaction.user.id &&
        existingByName.spedvUserId === driverSpedvId
    ) {
        return grantRoles(interaction, driver, { alreadyLinked: true });
    }

    const pending = getPending(interaction.user.id);
    const pendingMatchesDriver =
        pending &&
        String(pending.spedvUserId) === driverSpedvId &&
        norm(pending.spedvName) === norm(driver.userName);

    if (!pendingMatchesDriver) {
        clearPending(interaction.user.id);
        const created = createPending(interaction.user.id, driver.userName, driverSpedvId);

        return interaction.editReply({
            embeds: [createEmbed(
                'info',
                '🔐 Kurze Bestätigung nötig',
                'Damit niemand deinen Namen missbraucht, bestätige bitte dein SpedV-Profil:\n\n' +
                `1. Trage diesen Code in SpedV im Profil unter **Über mich** ein:\n**\`${created.code}\`**\n` +
                '2. Speichere das Profil.\n' +
                '3. Führe danach erneut **/ets link** aus und gib denselben SpedV-Namen an.\n\n' +
                `Der Code ist ${TTL_MS / 60_000} Minuten gültig. Nach der Bestätigung kannst du ihn wieder löschen.`
            )],
        });
    }

    let aboutMe;
    try {
        aboutMe = await fetchAboutMe(driverSpedvId);
    } catch (error) {
        logger.error('ETS: Profil konnte nicht gelesen werden', error);
        return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
    }

    if (!codeInText(aboutMe, pending.code)) {
        return fail(
            interaction,
            'Ich finde den Code noch nicht in deinem Profil.\n' +
            `Trage **\`${pending.code}\`** unter **Über mich** ein, speichere und führe **/ets link** mit deinem SpedV-Namen erneut aus.`
        );
    }

    clearPending(interaction.user.id);

    try {
        setLink(driver.userName, interaction.user.id, driverSpedvId);
    } catch (error) {
        logger.error('ETS: Verknüpfung konnte nicht gespeichert werden', error);
        return fail(
            interaction,
            'Die Verknüpfung konnte nicht gespeichert werden. Möglicherweise ist dein SpedV-Konto bereits mit einem anderen Discord-Konto verknüpft. Bitte melde dich bei der Geschäftsführung.'
        );
    }

    return grantRoles(interaction, driver);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ets')
        .setDescription('ETS2/ATS- und SpedV-Funktionen')
        .addSubcommand(subcommand =>
            subcommand
                .setName('link')
                .setDescription('Verknüpfe deinen Discord-Account mit SpedV')
                .addStringOption(option =>
                    option
                        .setName('spedv-name')
                        .setDescription('Dein exakter SpedV-Name')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        if (interaction.options.getSubcommand(false) === 'link') {
            return verifySpedvName(interaction);
        }

        return interaction.reply({
            embeds: [createErrorEmbed('Dieser ETS-Befehl ist nicht bekannt.')],
            flags: MessageFlags.Ephemeral,
        });
    },
};
