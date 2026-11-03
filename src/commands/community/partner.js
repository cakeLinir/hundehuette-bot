'use strict';

const {
    SlashCommandBuilder,
    MessageFlags,
    PermissionFlagsBits,
} = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');
const { fetchAboutMe, getSpedvNamesByDiscordId } = require('../../utils/spedvApi');
const {
    fetchAcceptedPartners,
    fetchPartnerUsers,
    fetchPartnerProfile,
} = require('../../utils/spedvPartners');
const {
    getPending,
    createPending,
    clearPending,
    codeInText,
    TTL_MS,
} = require('../../utils/etsVerification');
const {
    PartnerLinkError,
    listPartnerLinks,
    getPartnerLinkByDiscordId,
    getPartnerLinkBySpedvUserId,
    setPartnerLink,
    removePartnerLink,
    readRegistry,
    grantPartnerRole,
    syncPartners,
} = require('../../utils/partnerRoles');

const COOLDOWN_MS = 15_000;
const lastUse = new Map();

const norm = value => String(value ?? '').trim().toLocaleLowerCase('de-DE');
const fail = (interaction, text) => interaction.editReply({ embeds: [createErrorEmbed(text)] });
const isAdmin = interaction =>
    Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));

async function grantAndReply(interaction, partner, driver) {
    try {
        const { role } = await grantPartnerRole(interaction.guild, interaction.member, partner);
        return interaction.editReply({
            embeds: [createEmbed(
                'success',
                '🤝 Willkommen, Partner!',
                `Du hast jetzt die Rolle ${role} (**${driver.userName}**, ${partner.name ?? partner.shortName}).`
            )],
        });
    } catch (error) {
        if (error instanceof PartnerLinkError) return fail(interaction, error.message);
        logger.error('Partner: Rolle konnte nicht vergeben werden', error);
        return fail(
            interaction,
            'Deine Verknüpfung ist gespeichert, aber ich konnte die Rolle nicht vergeben. Das Team muss meine Bot-Rolle über die Partnerrollen schieben. Der automatische Abgleich versucht es später erneut.'
        );
    }
}

/** Sucht den Fahrer erst in der Fahrerliste, sonst über die angegebene SpedV-ID. */
async function resolveDriver(interaction, givenName, partners, users) {
    const listed = users.find(user => norm(user.userName) === norm(givenName));
    if (listed) return { driver: listed };

    const givenId = interaction.options.getString('spedv-id')?.trim();

    if (!givenId) {
        const visible = new Set(users.map(u => u.spedition.id));
        const silent = partners.filter(p => !visible.has(p.id));
        if (silent.length) {
            logger.warn(
                `Partner: Keine Fahrer abrufbar für: ${silent.map(p => `${p.shortName ?? p.name} (${p.id})`).join(', ')}`
            );
        }
        return {
            error:
                'Ich finde diesen Namen bei keiner unserer Partnerspeditionen. Prüfe die Schreibweise.\n' +
                (silent.length
                    ? `Von ${silent.map(p => p.shortName ?? p.name ?? p.id).join(', ')} kann SpedV aktuell keine Fahrerliste liefern. ` +
                    'Gib in diesem Fall zusätzlich deine **SpedV-ID** bei `spedv-id` an.'
                    : 'Ist deine Spedition erst kürzlich Partner geworden, versuche es in ein paar Minuten erneut.'),
        };
    }

    if (!/^\d{1,12}$/.test(givenId)) {
        return { error: 'Die SpedV-ID darf nur aus Ziffern bestehen.' };
    }

    let profile;
    try {
        profile = await fetchPartnerProfile(givenId);
    } catch (error) {
        logger.error('Partner: Profilabfrage fehlgeschlagen', error);
        return { error: 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.' };
    }

    if (!profile || norm(profile.userName) !== norm(givenName)) {
        return { error: 'Name und SpedV-ID passen nicht zusammen. Prüfe beides.' };
    }
    if (profile.inSped === false || !partners.some(p => p.id === profile.spedition.id)) {
        return { error: 'Dieses Konto gehört zu keiner unserer Partnerspeditionen.' };
    }

    return {
        driver: { id: profile.id, userName: profile.userName, spedition: profile.spedition },
    };
}

async function handleLink(interaction) {
    const userId = interaction.user.id;

    if (!process.env.SPEDV_API_KEY || !process.env.SPEDV_SPEDITION_ID) {
        logger.warn('Partner: SPEDV_API_KEY oder SPEDV_SPEDITION_ID fehlt in der .env');
        return fail(interaction, 'Das Partner-Modul ist noch nicht fertig eingerichtet. Bitte melde dich beim Team.');
    }

    const last = lastUse.get(userId);
    if (last && Date.now() - last < COOLDOWN_MS) {
        return fail(interaction, 'Bitte warte ein paar Sekunden, bevor du den Befehl erneut nutzt.');
    }
    lastUse.set(userId, Date.now());

    const givenName = interaction.options.getString('spedv-name', true).trim();
    if (!givenName) return fail(interaction, 'Bitte gib deinen SpedV-Namen an.');

    if (getSpedvNamesByDiscordId(userId).length > 0) {
        return fail(
            interaction,
            'Du bist bereits als HKC-Fahrer verknüpft. Partnerrollen sind für Fahrer anderer Speditionen.'
        );
    }

    let partners;
    let users;
    try {
        partners = await fetchAcceptedPartners();
        users = partners.length ? await fetchPartnerUsers(partners.map(p => p.id)) : [];
    } catch (error) {
        logger.error('Partner: SpedV-Abfrage fehlgeschlagen', error);
        return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
    }

    const resolved = await resolveDriver(interaction, givenName, partners, users);
    if (resolved.error) return fail(interaction, resolved.error);
    const { driver } = resolved;

    const partner = partners.find(p => p.id === driver.spedition.id);
    if (!partner) {
        return fail(interaction, 'Die Partnerschaft deiner Spedition konnte nicht bestätigt werden.');
    }

    const existing = getPartnerLinkByDiscordId(userId);
    if (existing && existing.spedvUserId !== driver.id) {
        return fail(
            interaction,
            'Du bist bereits mit einem anderen Partner-Konto verknüpft. Nutze zuerst /partner entknuepfen.'
        );
    }

    const owner = getPartnerLinkBySpedvUserId(driver.id);
    if (owner && owner.discordId !== userId) {
        return fail(interaction, 'Dieses SpedV-Konto ist bereits mit einem anderen Discord-Konto verknüpft.');
    }

    // Bereits verifiziert: nur Rolle abgleichen
    if (existing) return grantAndReply(interaction, partner, driver);

    const pending = getPending(userId);
    const matches =
        pending &&
        String(pending.spedvUserId) === driver.id &&
        norm(pending.spedvName) === norm(driver.userName);

    if (!matches) {
        clearPending(userId);
        const created = createPending(userId, driver.userName, driver.id);
        return interaction.editReply({
            embeds: [createEmbed(
                'info',
                '🔐 Kurze Bestätigung nötig',
                'Damit niemand deinen Namen missbraucht, bestätige bitte dein SpedV-Profil:\n\n' +
                `1. Trage diesen Code in SpedV im Profil unter **Über mich** ein:\n**\`${created.code}\`**\n` +
                '2. Speichere das Profil.\n' +
                `3. Führe danach erneut **/partner link** mit dem Namen **${driver.userName}**` +
                `${interaction.options.getString('spedv-id') ? ' und derselben SpedV-ID' : ''} aus.\n\n` +
                `Der Code ist ${TTL_MS / 60_000} Minuten gültig. Nach der Bestätigung kannst du ihn wieder löschen.`
            )],
        });
    }

    let aboutMe;
    try {
        aboutMe = await fetchAboutMe(driver.id);
    } catch (error) {
        logger.error('Partner: Profil konnte nicht gelesen werden', error);
        return fail(interaction, 'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.');
    }

    if (!codeInText(aboutMe, pending.code)) {
        return fail(
            interaction,
            'Ich finde den Code noch nicht in deinem Profil.\n' +
            `Trage **\`${pending.code}\`** unter **Über mich** ein, speichere und führe **/partner link** erneut aus.`
        );
    }

    clearPending(userId);

    try {
        setPartnerLink({
            discordId: userId,
            spedvName: driver.userName,
            spedvUserId: driver.id,
            speditionId: driver.spedition.id,
        });
    } catch (error) {
        if (error instanceof PartnerLinkError) return fail(interaction, error.message);
        throw error;
    }

    return grantAndReply(interaction, partner, driver);
}

async function handleUnlink(interaction) {
    const link = getPartnerLinkByDiscordId(interaction.user.id);
    if (!link) return fail(interaction, 'Du hast keine Partner-Verknüpfung.');

    const registry = readRegistry(interaction.guild.id);
    const roleIds = Object.values(registry)
        .map(entry => entry.roleId)
        .filter(roleId => roleId && interaction.member.roles.cache.has(roleId));

    try {
        if (roleIds.length) {
            await interaction.member.roles.remove(roleIds, 'Partner-Verknüpfung aufgehoben');
        }
    } catch (error) {
        logger.error('Partner: Rollen konnten nicht entfernt werden', error);
        return fail(interaction, 'Ich konnte deine Partnerrolle nicht entfernen. Die Verknüpfung bleibt bestehen. Bitte melde dich beim Team.');
    }

    removePartnerLink(interaction.user.id);
    return interaction.editReply({
        embeds: [createEmbed('success', 'Verknüpfung aufgehoben', 'Deine Partner-Verknüpfung und die Rolle wurden entfernt.')],
    });
}

async function handleList(interaction) {
    if (!isAdmin(interaction)) {
        return fail(interaction, 'Nur Administratoren dürfen die Partnerübersicht sehen.');
    }

    let partners;
    try {
        partners = await fetchAcceptedPartners();
    } catch (error) {
        logger.error('Partner: Übersicht fehlgeschlagen', error);
        return fail(interaction, 'SpedV ist gerade nicht erreichbar.');
    }

    const registry = readRegistry(interaction.guild.id);
    const links = listPartnerLinks();
    const activeIds = new Set(partners.map(p => p.id));

    const active = partners.map(partner => {
        const entry = registry[partner.id];
        const count = links.filter(link => link?.speditionId === partner.id).length;
        const role = entry?.roleId ? `<@&${entry.roleId}>` : 'noch keine Rolle (kommt beim nächsten Abgleich)';
        return `• **${partner.shortName ?? '-'}** ${partner.name ?? ''} (ID ${partner.id}) → ${role}, ${count} verknüpft`;
    });

    const ended = Object.entries(registry)
        .filter(([id]) => !activeIds.has(id))
        .map(([id, entry]) =>
            `• ${entry.shortName ?? entry.name ?? id} (ID ${id}) → ${entry.state === 'ended' ? 'beendet' : 'wird geprüft'}`
        );

    const text = [
        '**Aktive Partner**',
        active.length ? active.join('\n') : 'Keine angenommenen Partnerschaften.',
        ...(ended.length ? ['', '**Nicht mehr aktiv**', ...ended] : []),
    ].join('\n');

    return interaction.editReply({ embeds: [createEmbed('info', '🤝 Partnerspeditionen', text)] });
}

async function handleCheck(interaction) {
    if (!isAdmin(interaction)) {
        return fail(interaction, 'Nur Administratoren dürfen den Abgleich starten.');
    }

    const summary = await syncPartners(interaction.client);
    if (summary.skipped) {
        return interaction.editReply({
            embeds: [createEmbed('warning', 'Abgleich nicht ausgeführt', summary.skipped)],
        });
    }

    return interaction.editReply({
        embeds: [createEmbed(
            'success',
            '🤝 Partner-Abgleich fertig',
            `Partner: **${summary.partners}**\nRollen erstellt: **${summary.created}**\n` +
            `Rollen vergeben: **${summary.assigned}**\nRollen entzogen: **${summary.removed}**\n` +
            `Partnerschaften beendet: **${summary.ended}**\nVerknüpfungen entfernt: **${summary.unlinked}**`
        )],
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('partner')
        .setDescription('Rollen für Fahrer unserer Partnerspeditionen')
        .addSubcommand(sub =>
            sub
                .setName('link')
                .setDescription('Verknüpfe dein SpedV-Konto einer Partnerspedition mit Discord')
                .addStringOption(option =>
                    option
                        .setName('spedv-name')
                        .setDescription('Dein exakter SpedV-Name')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('spedv-id')
                        .setDescription('Deine SpedV-ID (nur nötig, wenn dein Name nicht gefunden wird)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('entknuepfen').setDescription('Hebe deine Partner-Verknüpfung auf')
        )
        .addSubcommand(sub =>
            sub.setName('liste').setDescription('Zeigt alle Partnerspeditionen (Administratoren)')
        )
        .addSubcommand(sub =>
            sub.setName('pruefen').setDescription('Startet den Partner-Abgleich sofort (Administratoren)')
        ),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'ets')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das ETS2/ATS-Modul ist auf diesem Server deaktiviert!')],
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        if (sub === 'link') return handleLink(interaction);
        if (sub === 'entknuepfen') return handleUnlink(interaction);
        if (sub === 'liste') return handleList(interaction);
        if (sub === 'pruefen') return handleCheck(interaction);

        return fail(interaction, 'Dieser Partner-Befehl ist nicht bekannt.');
    },
};
