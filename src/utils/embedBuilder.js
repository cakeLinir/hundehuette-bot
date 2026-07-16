const { EmbedBuilder } = require('discord.js');

const COLORS = {
    success: 0x00FF99, // Grün
    error: 0xFF0000,   // Rot
    info: 0x0099FF,    // Discord Blau
    warning: 0xFFAA00, // Orange
    default: 0x2B2D31, // Dunkelgrau
};

const FOOTER = {
    text: 'Hundehütte • hundekuchenlive',
};

/**
 * Erstellt ein einfaches Embed mit Titel und Beschreibung.
 * @param {string} type - 'success', 'error', 'info', 'warning' oder 'default'
 * @param {string} title - Der Titel des Embeds
 * @param {string} description - Die Beschreibung des Embeds
 */
function createEmbed(type, title, description) {
    return new EmbedBuilder()
        .setColor(COLORS[type] || COLORS.default)
        .setTitle(title)
        .setDescription(description)
        .setFooter(FOOTER)
        .setTimestamp();
}

/** 
 * Erstellt ein Embed mit mehreren Feldern.
 * @param {string} type - 'success', 'error', 'info', 'warning' oder 'default'
 * @param {string} title - Der Titel des Embeds
 * @param {Array} fields - Array aus { name, value, inline } Objekten
*/
function createFieldEmbed(type, title, fields = []) {
    return new EmbedBuilder()
        .setColor(COLORS[type] || COLORS.default)
        .setTitle(title)
        .addFields(fields)
        .setFooter(FOOTER)
        .setTimestamp();
}

/**
 * Erstellt ein Willkommens-Embed speziell für neue Mitglieder.
 * @param {GuildMember} member - Das neue Mitglied
 */
function createWelcomeEmbed(member) {
    return new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🐾 Ein neues Mitglied betritt das Territorium von Hundekuchenlive HQ!')
        .setDescription(
            `Willkommen ${member}, schön dass du da bist!\n\r` +
            `Schau dir bitte die <#1171118480091795507> an und Hol dir deine Rollen in <#1523565940430737498>!\n\r` +
            `Wir freuen uns auf dich!`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: '👤 Mitglied', value: member.user.tag, inline: true },
            { name: '📅 Beigetreten', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
            { name: '👥 Servermitglieder', value: `${member.guild.memberCount}`, inline: true }
        )
        .setFooter(FOOTER)
        .setTimestamp();
}

/**
 * Erstellt ein Fehler-Embed (Kurz & knapp)
 * @param {string} message - Die Fehlermeldung
 */
function createErrorEmbed(message) {
    return createEmbed('error', '❌ Fehler', message);
}

/**
 * Erstellt ein Erfolgs-Embed (kurz & knapp)
 * @param {string} message - Die Erfolgsmeldung
 */
function createSuccessEmbed(message) {
    return createEmbed('success', '✅ Erfolg', message);
}

module.exports = {
    createEmbed,
    createFieldEmbed,
    createWelcomeEmbed,
    createErrorEmbed,
    createSuccessEmbed,
    COLORS,
    FOOTER,
};