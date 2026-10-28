const RANKS = require('../config/ranks');
const POSITIONS = require('../config/positions');
const { getGuildSettings } = require('./settingsManager');

const norm = value =>
    String(value ?? '').trim().toLocaleLowerCase('de-DE');

/** Findet einen Fahrerrang anhand seines SpedV-Namens. */
function findRank(spedvName) {
    return RANKS.find(
        rank => norm(rank.spedv) === norm(spedvName)
    ) ?? null;
}

/** Index innerhalb der Fahrerrangliste; -1 bei unbekanntem Rang. */
function rankIndex(spedvName) {
    return RANKS.findIndex(
        rank => norm(rank.spedv) === norm(spedvName)
    );
}

/** Erkennt, ob der SpedV-Name einer konfigurierten Funktionsstelle entspricht. */
function findPosition(spedvName) {
    return POSITIONS.find(position =>
        norm(position.role) === norm(spedvName) ||
        norm(position.name) === norm(spedvName)
    ) ?? null;
}

/** Discord-Rollen-ID eines Fahrerrangs. */
function getRankRoleId(guildId, rank) {
    if (!rank) return null;

    const saved = getGuildSettings(guildId).etsRankRoles ?? {};
    return saved[rank.key] || process.env[rank.env] || null;
}

/** Discord-Rollen-ID einer Funktionsstelle. */
function getPositionRoleId(guildId, position) {
    if (!position) return null;

    const saved = getGuildSettings(guildId).etsPositionRoles ?? {};
    return saved[position.key] || process.env[position.env] || null;
}

/** Nur die Rollen der vier Fahrerränge, nicht die Funktionsstellen. */
function allRankRoleIds(guildId) {
    return [...new Set(
        RANKS.map(rank => getRankRoleId(guildId, rank)).filter(Boolean)
    )];
}

/** Rollen-IDs aller konfigurierten Funktionsstellen. */
function allPositionRoleIds(guildId) {
    return [...new Set(
        POSITIONS.map(position => getPositionRoleId(guildId, position)).filter(Boolean)
    )];
}

module.exports = {
    findRank,
    rankIndex,
    getRankRoleId,
    allRankRoleIds,
    findPosition,
    getPositionRoleId,
    allPositionRoleIds,
};