const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require('discord.js');

const POSITIONS = require('../config/positions');
const { getGuildSettings } = require('./settingsManager');
const {
    ACTIVE_STATUSES,
    listApplications,
    getApplication,
    createApplication,
    updateApplication,
} = require('./positionApplicationStore');
const {
    getPositionRoleId,
    meetsMinimumRank,
    canReviewApplication,
} = require('./positionApplicationPermissions');

const decisionLocks = new Set();

async function replyPrivate(interaction, content) {
    const payload = { content, flags: MessageFlags.Ephemeral };

    if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload);
    }

    return interaction.reply(payload);
}

function activeApplicationFor(guildId, userId) {
    return listApplications(guildId).find(application =>
        application.applicantId === userId &&
        ACTIVE_STATUSES.has(application.status)
    ) ?? null;
}

async function handlePositionSelect(interaction) {
    if (!interaction.customId.startsWith('stellenbewerbung:position')) {
        return false;
    }

    if (!interaction.inGuild()) {
        await replyPrivate(interaction, 'Bewerbungen sind nur auf einem Server möglich.');
        return true;
    }

    const positionKey = interaction.values[0];
    const position = POSITIONS.find(item => item.key === positionKey);

    if (!position) {
        await replyPrivate(interaction, 'Diese Funktionsstelle ist nicht mehr verfügbar.');
        return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member) {
        await replyPrivate(interaction, 'Dein Servermitglied konnte nicht geladen werden.');
        return true;
    }

    if (!meetsMinimumRank(member, interaction.guildId, position.minRank)) {
        await replyPrivate(
            interaction,
            `Für **${position.name}** benötigst du mindestens den Rang **${position.minRank}**.`
        );
        return true;
    }

    const existing = activeApplicationFor(interaction.guildId, interaction.user.id);

    if (existing) {
        const existingPosition = POSITIONS.find(item => item.key === existing.positionKey);
        await replyPrivate(
            interaction,
            `Du hast bereits eine aktive Bewerbung${existingPosition ? ` für **${existingPosition.name}**` : ''}. Warte bitte auf die Entscheidung.`
        );
        return true;
    }

    const modal = new ModalBuilder()
        .setCustomId(`stellenbewerbung:form:${position.key}`)
        .setTitle(`Bewerbung: ${position.name}`.slice(0, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('motivation')
                    .setLabel('Warum möchtest du diese Stelle?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(30)
                    .setMaxLength(1000)
                    .setPlaceholder('Beschreibe deine Motivation und Eignung.')
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('erfahrung')
                    .setLabel('Welche Erfahrung bringst du mit?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1000)
                    .setPlaceholder('Erfahrung, Kenntnisse und relevante Beispiele (optional).')
                    .setRequired(false)
            )
        );

    await interaction.showModal(modal);
    return true;
}

async function handlePositionModal(interaction) {
    if (!interaction.customId.startsWith('stellenbewerbung:form:')) {
        return false;
    }

    if (!interaction.inGuild()) {
        await replyPrivate(interaction, 'Bewerbungen sind nur auf einem Server möglich.');
        return true;
    }

    const positionKey = interaction.customId.slice('stellenbewerbung:form:'.length);
    const position = POSITIONS.find(item => item.key === positionKey);

    if (!position) {
        await replyPrivate(interaction, 'Diese Funktionsstelle ist nicht mehr verfügbar.');
        return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member || !meetsMinimumRank(member, interaction.guildId, position.minRank)) {
        await replyPrivate(
            interaction,
            'Dein Mitglied oder dein erforderlicher Fahrerrang konnte nicht bestätigt werden. Bitte prüfe deinen Rang und versuche es erneut.'
        );
        return true;
    }

    const settings = getGuildSettings(interaction.guildId);
    const reviewChannel = settings.positionApplicationReviewChannelId
        ? await interaction.guild.channels.fetch(settings.positionApplicationReviewChannelId).catch(() => null)
        : null;

    if (!reviewChannel || !reviewChannel.isTextBased() || !reviewChannel.isSendable()) {
        await replyPrivate(
            interaction,
            'Der interne Prüfungskanal ist nicht eingerichtet oder für den Bot nicht erreichbar. Bitte informiere die Administration.'
        );
        return true;
    }

    if (activeApplicationFor(interaction.guildId, interaction.user.id)) {
        await replyPrivate(
            interaction,
            'Du hast bereits eine aktive Bewerbung. Eine weitere Bewerbung ist erst nach Abschluss möglich.'
        );
        return true;
    }

    const answers = {
        motivation: interaction.fields.getTextInputValue('motivation').trim(),
        erfahrung: interaction.fields.getTextInputValue('erfahrung').trim(),
    };

    if (answers.motivation.length < 30) {
        await replyPrivate(interaction, 'Bitte beschreibe deine Motivation mit mindestens 30 Zeichen.');
        return true;
    }

    const result = createApplication(interaction.guildId, {
        applicantId: interaction.user.id,
        positionKey,
        answers,
    });

    if (!result.created) {
        await replyPrivate(
            interaction,
            'Du hast bereits eine aktive Bewerbung. Warte bitte auf die Entscheidung.'
        );
        return true;
    }

    const application = result.application;

    const embed = new EmbedBuilder()
        .setColor(position.color ?? 0x3498db)
        .setTitle(`Neue Bewerbung: ${position.name}`)
        .setDescription([
            `**Bewerber:** ${interaction.user} (\`${interaction.user.tag}\`)`,
            `**Mindest-Rang:** ${position.minRank}`,
            `**Bewerbungs-ID:** \`${application.id}\``,
            '',
            '**Motivation**',
            answers.motivation,
            '',
            '**Erfahrung**',
            answers.erfahrung || 'Keine Angaben',
        ].join('\n').slice(0, 4000))
        .setTimestamp(new Date(application.createdAt));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`stellenbewerbung:accept:${application.id}`)
            .setLabel('Annehmen')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`stellenbewerbung:reject:${application.id}`)
            .setLabel('Ablehnen')
            .setStyle(ButtonStyle.Danger)
    );

    try {
        await reviewChannel.send({
            embeds: [embed],
            components: [row],
        });
    } catch (error) {
        updateApplication(interaction.guildId, application.id, {
            status: 'withdrawn',
            reviewNote: 'Automatisch zurückgezogen: Prüfungskanal konnte nicht benachrichtigt werden.',
        });

        console.error('Bewerbung konnte nicht im Prüfungskanal veröffentlicht werden:', error);
        await replyPrivate(
            interaction,
            'Die Bewerbung konnte nicht an die interne Prüfung übermittelt werden. Bitte informiere die Administration.'
        );
        return true;
    }

    await replyPrivate(
        interaction,
        `Deine Bewerbung für **${position.name}** wurde übermittelt. Du wirst nach der internen Prüfung benachrichtigt.`
    );

    return true;
}

async function handlePositionDecision(interaction) {
    const match = interaction.customId.match(/^stellenbewerbung:(accept|reject):([0-9a-f-]+)$/i);

    if (!match) {
        return false;
    }

    if (!interaction.inGuild()) {
        await replyPrivate(interaction, 'Diese Entscheidung ist nur auf dem Server möglich.');
        return true;
    }

    const [, decision, applicationId] = match;
    const lockKey = `${interaction.guildId}:${applicationId}`;

    if (decisionLocks.has(lockKey)) {
        await replyPrivate(interaction, 'Diese Bewerbung wird bereits bearbeitet.');
        return true;
    }

    decisionLocks.add(lockKey);

    let claimed = false;
    let roleGranted = false;
    let finalized = false;

    try {
        const application = getApplication(interaction.guildId, applicationId);

        if (!application) {
            await replyPrivate(interaction, 'Diese Bewerbung wurde nicht gefunden.');
            return true;
        }

        if (application.applicantId === interaction.user.id) {
            await replyPrivate(interaction, 'Du darfst deine eigene Bewerbung nicht prüfen.');
            return true;
        }

        if (!canReviewApplication(interaction.member, interaction.guildId, application.positionKey)) {
            await replyPrivate(interaction, 'Du bist nicht berechtigt, diese Bewerbung zu prüfen.');
            return true;
        }

        if (application.status !== 'pending') {
            await replyPrivate(
                interaction,
                `Diese Bewerbung kann nicht mehr entschieden werden. Aktueller Status: **${application.status}**.`
            );
            return true;
        }

        const position = POSITIONS.find(item => item.key === application.positionKey);

        if (!position) {
            await replyPrivate(interaction, 'Die Funktionsstelle dieser Bewerbung existiert nicht mehr.');
            return true;
        }

        const claim = updateApplication(interaction.guildId, applicationId, {
            status: 'reviewing',
            reviewerId: interaction.user.id,
        });

        if (!claim.updated) {
            await replyPrivate(interaction, 'Die Bewerbung wurde bereits von jemand anderem bearbeitet.');
            return true;
        }

        claimed = true;

        if (decision === 'accept') {
            const roleId = getPositionRoleId(interaction.guildId, position);

            if (!roleId) {
                const recovery = updateApplication(interaction.guildId, applicationId, {
                    status: 'pending',
                    reviewerId: null,
                    reviewNote: 'Annahme nicht möglich: Funktionsrolle ist nicht konfiguriert.',
                });

                // Recovery-Ergebnis wird im Antworttext ausgewertet.

                await replyPrivate(
                    interaction,
                    recovery.updated
                        ? `Die Rolle für **${position.name}** ist nicht konfiguriert. Bitte führe zuerst die Rollenverwaltung aus. Die Bewerbung bleibt offen.`
                        : `Die Rolle für **${position.name}** ist nicht konfiguriert. Außerdem konnte die Bewerbung nicht sicher wieder geöffnet werden. Bitte Status manuell prüfen.`
                );
                return true;
            }

            const applicant = await interaction.guild.members.fetch(application.applicantId).catch(() => null);

            if (!applicant) {
                const recovery = updateApplication(interaction.guildId, applicationId, {
                    status: 'pending',
                    reviewerId: null,
                    reviewNote: 'Bewerber ist nicht mehr Mitglied des Servers.',
                });

                // Recovery-Ergebnis wird im Antworttext ausgewertet.

                await replyPrivate(
                    interaction,
                    recovery.updated
                        ? 'Der Bewerber ist nicht mehr auf dem Server. Die Bewerbung bleibt offen.'
                        : 'Der Bewerber ist nicht mehr auf dem Server. Die Bewerbung konnte nicht sicher wieder geöffnet werden. Bitte Status manuell prüfen.'
                );
                return true;
            }

            if (!meetsMinimumRank(applicant, interaction.guildId, position.minRank)) {
                const recovery = updateApplication(interaction.guildId, applicationId, {
                    status: 'pending',
                    reviewerId: null,
                    reviewNote: 'Mindest-Rang bei der Entscheidung nicht mehr erfüllt.',
                });

                // Recovery-Ergebnis wird im Antworttext ausgewertet.

                await replyPrivate(
                    interaction,
                    recovery.updated
                        ? 'Der Bewerber erfüllt den erforderlichen Rang inzwischen nicht mehr. Die Bewerbung bleibt offen.'
                        : 'Der Bewerber erfüllt den erforderlichen Rang inzwischen nicht mehr. Die Bewerbung konnte nicht sicher wieder geöffnet werden. Bitte Status manuell prüfen.'
                );
                return true;
            }

            try {
                await applicant.roles.add(roleId, `Bewerbung für ${position.name} angenommen von ${interaction.user.tag}`);
            } catch (error) {
                const recovery = updateApplication(interaction.guildId, applicationId, {
                    status: 'pending',
                    reviewerId: null,
                    reviewNote: 'Rollenvergabe fehlgeschlagen; Annahme nicht abgeschlossen.',
                });

                // Recovery-Ergebnis wird im Antworttext ausgewertet.

                console.error('Funktionsrolle konnte nicht vergeben werden:', error);
                await replyPrivate(
                    interaction,
                    recovery.updated
                        ? 'Die Funktionsrolle konnte nicht vergeben werden. Prüfe die Bot-Rechte und Rollenreihenfolge. Die Bewerbung bleibt offen.'
                        : 'Die Funktionsrolle konnte nicht vergeben werden. Prüfe die Bot-Rechte und Rollenreihenfolge. Die Bewerbung konnte nicht sicher wieder geöffnet werden. Bitte Status manuell prüfen.'
                );
                return true;
            }

            roleGranted = true;
            const finalResult = updateApplication(interaction.guildId, applicationId, {
                status: 'accepted',
                reviewerId: interaction.user.id,
                reviewNote: `Angenommen von ${interaction.user.tag}. Rolle vergeben: ${roleId}`,
            });

            if (!finalResult.updated) {
                await replyPrivate(
                    interaction,
                    'Die Rolle wurde vergeben, aber der Bewerbungsstatus konnte nicht abgeschlossen werden. Bitte prüfe die Bewerbung manuell.'
                );
                return true;
            }

            finalized = true;
            await applicant.send(
                `Deine Bewerbung für **${position.name}** auf **${interaction.guild.name}** wurde angenommen. Du hast die Funktionsrolle erhalten.`
            ).catch(() => null);

            await interaction.message.edit({ components: [] }).catch(() => null);

            await replyPrivate(
                interaction,
                `Die Bewerbung für **${position.name}** wurde angenommen und die Rolle vergeben.`
            );

            return true;
        }

        const finalResult = updateApplication(interaction.guildId, applicationId, {
            status: 'rejected',
            reviewerId: interaction.user.id,
            reviewNote: `Abgelehnt von ${interaction.user.tag}.`,
        });

        if (!finalResult.updated) {
            const recovery = updateApplication(interaction.guildId, applicationId, {
                status: 'pending',
                reviewerId: null,
                reviewNote: 'Ablehnung konnte nicht abgeschlossen werden; Bewerbung wurde wieder geöffnet.',
            });

            if (recovery.updated) {
                await replyPrivate(
                    interaction,
                    'Die Ablehnung konnte nicht abgeschlossen werden. Die Bewerbung wurde wieder geöffnet und kann erneut geprüft werden.'
                );
            } else {
                await replyPrivate(
                    interaction,
                    'Die Ablehnung konnte nicht abgeschlossen werden. Die Bewerbung konnte nicht automatisch wieder geöffnet werden. Bitte prüfe den Status manuell.'
                );
            }

            return true;
        }

        finalized = true;
        const applicantUser = await interaction.client.users.fetch(application.applicantId).catch(() => null);

        if (applicantUser) {
            await applicantUser.send(
                `Deine Bewerbung für **${position.name}** auf **${interaction.guild.name}** wurde leider abgelehnt.`
            ).catch(() => null);
        }

        await interaction.message.edit({ components: [] }).catch(() => null);

        await replyPrivate(interaction, `Die Bewerbung für **${position.name}** wurde abgelehnt.`);
        return true;
    } catch (error) {
        console.error('Fehler bei der Bewerbungsentscheidung:', error);

        let recoverySucceeded = false;

        if (claimed && !finalized && !roleGranted) {
            try {
                const recovery = updateApplication(interaction.guildId, applicationId, {
                    status: 'pending',
                    reviewerId: null,
                    reviewNote: 'Automatische Wiederherstellung nach einem unerwarteten Entscheidungsfehler.',
                });

                recoverySucceeded = Boolean(recovery.updated);

                if (!recoverySucceeded) {
                    console.error(
                        `Bewerbung ${applicationId} konnte nicht automatisch auf pending zurückgesetzt werden.`
                    );
                }
            } catch (recoveryError) {
                console.error('Wiederherstellung der Bewerbung fehlgeschlagen:', recoveryError);
            }
        }

        let errorMessage =
            'Bei der Bearbeitung ist ein Fehler aufgetreten. Bitte prüfe das Bot-Log.';

        if (roleGranted && !finalized) {
            errorMessage =
                'Die Rolle wurde möglicherweise bereits vergeben, aber der Bewerbungsstatus konnte nicht sicher abgeschlossen werden. Bitte prüfe Rolle und Bewerbungsstatus manuell.';
        } else if (claimed && !finalized && recoverySucceeded) {
            errorMessage =
                'Die Bearbeitung ist fehlgeschlagen. Die Bewerbung wurde wieder geöffnet und kann erneut geprüft werden.';
        } else if (claimed && !finalized && !recoverySucceeded) {
            errorMessage =
                'Die Bearbeitung ist fehlgeschlagen und der Status konnte nicht automatisch wiederhergestellt werden. Bitte prüfe die Bewerbung im Speicher und im Bot-Log manuell.';
        }

        await replyPrivate(interaction, errorMessage).catch(() => null);
        return true;
    } finally {
        decisionLocks.delete(lockKey);
    }
}

module.exports = {
    handlePositionSelect,
    handlePositionModal,
    handlePositionDecision,
};
