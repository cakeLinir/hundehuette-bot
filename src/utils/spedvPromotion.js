const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');
const logger = require('./logger');
const RANKS = require('../config/ranks');
const { createEmbed } = require('./embedBuilder');
const { fetchStats } = require('./spedvApi');
const { rankIndex, getRankRoleId } = require('./rankRoles');

const dataDir = path.join(__dirname, '..', '..', 'data');
const statePath = path.join(dataDir, 'etsRanks.json');
const linksPath = path.join(dataDir, 'etsLinks.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const norm = v => String(v ?? '').trim().toLowerCase();
let warnedNoChannel = false;

/** null = noch kein Stand (erster Lauf). */
function loadState() {
    try {
        const s = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        return { drivers: s.drivers ?? {}, proposed: s.proposed ?? {} };
    } catch {
        return null;
    }
}

function saveState(state) {
    writeFileAtomic.sync(statePath, JSON.stringify(state, null, 2));
}

function readLinks() {
    try {
        return JSON.parse(fs.readFileSync(linksPath, 'utf-8'));
    } catch {
        return {};
    }
}

/** Versteht "11.10.2026 18:13:11" und ISO-Datumsangaben. */
function parseDate(value) {
    if (!value) return null;
    const m = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
    const date = m
        ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
        : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

const daysSince = date => Math.floor((Date.now() - date.getTime()) / 86_400_000);

function buildPromotion(driver, fromRank, toRank, discordId) {
    const who = discordId ? `<@${discordId}>` : `**${driver.userName}**`;
    return createEmbed(
        'success',
        '🎉 Beförderung!',
        `${who} wurde befördert!\n\n**${fromRank}** ➜ **${toRank}**\n\nGlückwunsch und weiterhin gute Fahrt! 🚚`
    );
}

/** Empfehlungen für die Leitung: nur bei Rängen mit Kriterien, jeweils einmal pro Rang. */
async function proposeCandidates(guild, active, next) {
    const channelId = process.env.ETS_LEADER_CHANNEL_ID;
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
        logger.warn('Promotion: Leitungs-Channel nicht gefunden oder kein Textkanal');
        return;
    }

    const leaderRank = RANKS.find(r => r.leader);
    const leaderRoleId = getRankRoleId(guild.id, leaderRank);

    for (const driver of active) {
        const id = String(driver.id);
        if (next.proposed[id]) continue;

        const idx = rankIndex(driver.rank?.name);
        const current = RANKS[idx];
        const target = RANKS[idx + 1];
        const criteria = current?.promotion;
        if (!criteria || !target) continue;

        const joined = parseDate(driver.joinDate);
        if (!joined) continue;

        const days = daysSince(joined);
        if (days < criteria.minDays) continue; // günstige Prüfung zuerst, spart API-Aufrufe

        let km;
        try {
            ({ km } = await fetchStats(driver.id));
        } catch (err) {
            logger.error(`Promotion: Statistik für ${driver.userName} nicht lesbar`, err);
            continue;
        }
        if (km < criteria.minKm) continue;

        try {
            await channel.send({
                content: leaderRoleId ? `<@&${leaderRoleId}>` : undefined,
                allowedMentions: { roles: leaderRoleId ? [leaderRoleId] : [] },
                embeds: [createEmbed(
                    'info',
                    '📋 Beförderungsempfehlung',
                    `**${driver.userName}** erfüllt die Kriterien für **${target.spedv}**.\n\n` +
                    `• Zeit in der Spedition: **${days} Tage** (min. ${criteria.minDays})\n` +
                    `• Gefahrene Kilometer: **${Math.round(km).toLocaleString('de-DE')} km** (min. ${criteria.minKm.toLocaleString('de-DE')})\n\n` +
                    `Bitte prüfen und bei Zustimmung in **SpedV** befördern. Die Discord-Rolle folgt automatisch.`
                )],
            });
            next.proposed[id] = target.spedv;
            logger.info(`Promotion: Empfehlung für ${driver.userName} -> ${target.spedv}`);
        } catch (err) {
            logger.error(`Promotion: Empfehlung für ${driver.userName} fehlgeschlagen`, err);
        }
    }
}

/**
 * Erkennt Beförderungen anhand von Rangwechseln in SpedV und verkündet sie.
 * @param {import('discord.js').Guild} guild
 * @param {Array} users normalisierte Fahrerliste aus spedvApi.fetchUsers()
 */
async function checkPromotions(guild, users) {
    const channelId = process.env.ETS_PROMOTION_CHANNEL_ID;
    if (!channelId) {
        if (!warnedNoChannel) {
            logger.warn('Promotion: ETS_PROMOTION_CHANNEL_ID fehlt in der .env, Beförderungsmodul ist aus');
            warnedNoChannel = true;
        }
        return;
    }

    const active = users.filter(u => u.inSped !== false && u.id != null);
    const snapshot = () => Object.fromEntries(
        active.map(u => [String(u.id), { name: u.userName, rank: u.rank?.name ?? null }])
    );

    const state = loadState();

    // Erster Lauf: nur merken, nichts verkünden
    if (!state) {
        saveState({ drivers: snapshot(), proposed: {} });
        logger.info(`Promotion: Stand von ${active.length} Fahrer(n) gemerkt`);
        return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
        logger.warn('Promotion: Channel nicht gefunden oder kein Textkanal');
        return; // Stand nicht speichern, damit nichts verloren geht
    }

    const links = readLinks();
    const next = { drivers: {}, proposed: {} };

    // Empfehlungen nur für noch aktive Fahrer behalten
    for (const u of active) {
        const id = String(u.id);
        if (state.proposed[id]) next.proposed[id] = state.proposed[id];
    }

    for (const driver of active) {
        const id = String(driver.id);
        const rankName = driver.rank?.name ?? null;
        const prev = state.drivers[id];
        let handled = true;

        if (prev?.rank && rankName && norm(prev.rank) !== norm(rankName)) {
            delete next.proposed[id]; // neuer Rang -> neue Empfehlungsrunde
            const from = rankIndex(prev.rank);
            const to = rankIndex(rankName);

            if (from !== -1 && to > from) {
                try {
                    const discordId = links[norm(driver.userName)] ?? null;
                    await channel.send({
                        embeds: [buildPromotion(driver, prev.rank, rankName, discordId)],
                        allowedMentions: { users: discordId ? [discordId] : [] },
                    });
                    logger.info(`Promotion: ${driver.userName} ${prev.rank} -> ${rankName} verkündet`);
                } catch (err) {
                    handled = false; // alten Stand behalten, beim nächsten Lauf erneut versuchen
                    logger.error(`Promotion: Verkünden für ${driver.userName} fehlgeschlagen`, err);
                }
            } else {
                logger.info(`Promotion: ${driver.userName} ${prev.rank} -> ${rankName} (nicht verkündet)`);
            }
        }

        next.drivers[id] = handled ? { name: driver.userName, rank: rankName } : prev;
    }

    await proposeCandidates(guild, active, next);
    saveState(next);
}

module.exports = { checkPromotions };
