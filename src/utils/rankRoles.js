const RANKS = require('../config/ranks');
const { getGuildSettings } = require('./settingsManager');

const norm = v => String(v ?? '').trim().toLowerCase();

/** Rang-Definition zu einem SpedV-Rangnamen (oder null). */
function findRank(spedvName) {
  return RANKS.find(r => norm(r.spedv) === norm(spedvName)) ?? null;
}

/** Position im Rang-System (0 = niedrigster), -1 wenn unbekannt. */
function rankIndex(spedvName) {
  return RANKS.findIndex(r => norm(r.spedv) === norm(spedvName));
}

/** Discord-Rollen-ID eines Rangs: erst Server-Settings (/ets-rollen), dann .env als Fallback. */
function getRankRoleId(guildId, rank) {
  if (!rank) return null;
  const saved = getGuildSettings(guildId).etsRankRoles ?? {};
  return saved[rank.key] || process.env[rank.env] || null;
}

function allRankRoleIds(guildId) {
  return RANKS.map(r => getRankRoleId(guildId, r)).filter(Boolean);
}

module.exports = { findRank, rankIndex, getRankRoleId, allRankRoleIds };
