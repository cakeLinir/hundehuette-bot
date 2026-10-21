
const { PermissionFlagsBits } = require('discord.js');

const POSITIONS = require('../config/positions');
const RANKS = require('../config/ranks');
const { getGuildSettings } = require('./settingsManager');
const { getRankRoleId } = require('./rankRoles');

/**
 * Ermittelt die Discord-Rollen-ID einer Funktionsstelle.
 * Priorität: Serverkonfiguration, danach .env-Fallback.
 */
function getPositionRoleId(guildId, position) {
    if (!position) return null;

    const settings = getGuildSettings(guildId);
    return settings.etsPositionRoles?.[position.key]
        || process.env[position.env]
        || null;
}

/**
 * Prüft, ob ein Mitglied den erforderlichen Fahrerrang besitzt.
 * Unbekannte Ränge oder nicht konfigurierte Rangrollen führen
 * bewusst zu keiner automatischen Freigabe.
 */
function meetsMinimumRank(member, guildId, minRankKey) {
    if (!member || !guildId || !minRankKey) return false;

    const requiredIndex = RANKS.findIndex(rank => rank.key === minRankKey);
    if (requiredIndex < 0) return false;

    return RANKS.some((rank, index) => {
        if (index < requiredIndex) return false;

        const roleId = getRankRoleId(guildId, rank);
        return Boolean(roleId && member.roles.cache.has(roleId));
    });
}

/**
 * Prüft, ob ein Mitglied Bewerbungen für eine Stelle prüfen darf.
 *
 * Globale Prüfer:
 * - Discord-Administratoren
 * - Geschäftsführung
 *
 * Stellenbezogene Prüfer:
 * - Rollen aus reviewerPositionKeys
 * - zusätzlich konfigurierbare Discord-Rollen unter
 *   guildSettings.positionApplicationReviewers[positionKey]
 */
function canReviewApplication(member, guildId, positionKey) {
    if (!member || !guildId || !positionKey) return false;

    // Discord-Administratorrecht, nicht bloß einzelne Moderationsrechte.
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    const settings = getGuildSettings(guildId);
    const management = POSITIONS.find(
        position => position.key === 'geschaeftsfuehrer'
    );

    const managementRoleId = getPositionRoleId(guildId, management);

    if (managementRoleId && member.roles.cache.has(managementRoleId)) {
        return true;
    }

    const position = POSITIONS.find(item => item.key === positionKey);
    if (!position) return false;

    const reviewerPositionKeys = position.reviewerPositionKeys ?? [];

    const hasReviewerPosition = reviewerPositionKeys.some(key => {
        const reviewerPosition = POSITIONS.find(item => item.key === key);
        const roleId = getPositionRoleId(guildId, reviewerPosition);

        return Boolean(roleId && member.roles.cache.has(roleId));
    });

    if (hasReviewerPosition) return true;

    const extraReviewerRoleIds =
        settings.positionApplicationReviewers?.[positionKey] ?? [];

    return extraReviewerRoleIds.some(roleId =>
        member.roles.cache.has(roleId)
    );
}

module.exports = {
    getPositionRoleId,
    meetsMinimumRank,
    canReviewApplication,
};
