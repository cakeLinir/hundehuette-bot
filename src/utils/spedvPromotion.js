const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');
const logger = require('./logger');
const RANKS = require('../config/ranks');
const { createEmbed } = require('./embedBuilder');
const { fetchStats } = require('./spedvApi');
const { getRankRoleId } = require('./rankRoles');

const dataDir = path.join(__dirname, '..', '..', 'data');
const statePath = path.join(dataDir, 'etsRanks.json');
const linksPath = path.join(dataDir, 'etsLinks.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const norm = value => String(value ?? '').trim().toLowerCase();

/**
 * Ausschließlich reguläre Fahrerränge für die Beförderungskette.
 *
 * Neue Leitungs- und Funktionsränge aus ranks.js werden dadurch
 * nicht automatisch zu Beförderungsstufen.
 *
 * Der Fallback auf promotion ermöglicht die Verwendung älterer
 * Rangdefinitionen ohne category-Eigenschaft.
 */
const DRIVER_RANKS = RANKS.filter(
    rank => rank.category === 'driver' || rank.promotion
);

let warnedNoChannel = false;

/**
 * Liefert den Index eines regulären Fahrerrangs.
 * -1 bedeutet: unbekannter Rang oder Leitungs-/Funktionsrang.
 */
function driverRankIndex(rankName) {
    return DRIVER_RANKS.findIndex(
        rank => norm(rank.spedv) === norm(rankName)
    );
}

/**
 * Lädt den gespeicherten Rangverlauf.
 * null bedeutet, dass noch kein gültiger Stand existiert.
 */
function loadState() {
    try {
        const state = JSON.parse(
            fs.readFileSync(statePath, 'utf-8')
        );

        if (
            !state ||
            typeof state !== 'object' ||
            Array.isArray(state)
        ) {
            return null;
        }

        return {
            drivers: state.drivers ?? {},
            proposed: state.proposed ?? {},
        };
    } catch {
        return null;
    }
}

/**
 * Speichert den Rangverlauf atomar.
 */
function saveState(state) {
    writeFileAtomic.sync(
        statePath,
        JSON.stringify(state, null, 2)
    );
}

/**
 * Lädt die Discord-Verknüpfungen der Fahrer.
 */
function readLinks() {
    try {
        const links = JSON.parse(
            fs.readFileSync(linksPath, 'utf-8')
        );

        return links && typeof links === 'object'
            ? links
            : {};
    } catch {
        return {};
    }
}

/**
 * Unterstützt deutsche Datumsangaben wie
 * "11.10.2026 18:13:11" sowie ISO-Datumsangaben.
 */
function parseDate(value) {
    if (!value) return null;

    const input = String(value);

    const match = input.match(
        /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/
    );

    let date;

    if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        const hour = Number(match[4] ?? 0);
        const minute = Number(match[5] ?? 0);
        const second = Number(match[6] ?? 0);

        date = new Date(
            year,
            month - 1,
            day,
            hour,
            minute,
            second
        );

        // Ungültige Kalenderdaten nicht stillschweigend umwandeln.
        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second
        ) {
            return null;
        }
    } else {
        date = new Date(value);
    }

    return Number.isNaN(date.getTime()) ? null : date;
}

const daysSince = date =>
    Math.floor((Date.now() - date.getTime()) / 86_400_000);

/**
 * Erstellt die Ankündigung einer regulären Fahrerbeförderung.
 */
function buildPromotion(driver, fromRank, toRank, discordId) {
    const who = discordId
        ? `<@${discordId}>`
        : `**${driver.userName}**`;

    return createEmbed(
        'success',
        '🎉 Beförderung!',
        `${who} wurde befördert!\n\n` +
        `**${fromRank}** ➜ **${toRank}**\n\n` +
        'Glückwunsch und weiterhin gute Fahrt! 🚚'
    );
}

/**
 * Prüft Beförderungsempfehlungen für aktive Fahrer.
 *
 * Ausschließlich die vier regulären Fahrerränge werden
 * berücksichtigt. Leitungs- und Funktionsränge werden ignoriert.
 */
async function proposeCandidates(guild, active, next) {
    const channelId = process.env.ETS_LEADER_CHANNEL_ID;

    if (!channelId) return;

    const channel = await guild.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel?.isTextBased()) {
        logger.warn(
            'Promotion: Leitungs-Channel nicht gefunden oder kein Textkanal'
        );
        return;
    }

    // Nur ein ausdrücklich als leader markierter Fahrerrang darf
    // hier als Ping-Ziel dienen. Funktionsränge sind ausgeschlossen.
    const leaderRank = DRIVER_RANKS.find(rank => rank.leader);
    const leaderRoleId = leaderRank
        ? getRankRoleId(guild.id, leaderRank)
        : null;

    for (const driver of active) {
        const id = String(driver.id);

        if (next.proposed[id]) continue;

        const index = driverRankIndex(driver.rank?.name);

        // Unbekannte Ränge und Funktionsränge überspringen.
        if (index === -1) continue;

        const current = DRIVER_RANKS[index];
        const target = DRIVER_RANKS[index + 1];
        const criteria = current?.promotion;

        // Kein Folgerang oder keine Beförderungskriterien.
        if (!criteria || !target) continue;

        const joined = parseDate(driver.joinDate);

        if (!joined) {
            logger.warn(
                `Promotion: Ungültiges Beitrittsdatum für ${driver.userName}`
            );
            continue;
        }

        const days = daysSince(joined);

        if (days < criteria.minDays) continue;

        let km;

        try {
            const stats = await fetchStats(driver.id);
            km = Number(stats?.km);
        } catch (err) {
            logger.error(
                `Promotion: Statistik für ${driver.userName} nicht lesbar`,
                err
            );
            continue;
        }

        if (!Number.isFinite(km) || km < 0) {
            logger.warn(
                `Promotion: Ungültiger Kilometerstand für ${driver.userName}`
            );
            continue;
        }

        if (km < criteria.minKm) continue;

        try {
            await channel.send({
                content: leaderRoleId
                    ? `<@&${leaderRoleId}>`
                    : undefined,

                allowedMentions: {
                    roles: leaderRoleId ? [leaderRoleId] : [],
                },

                embeds: [
                    createEmbed(
                        'info',
                        '📋 Beförderungsempfehlung',
                        `**${driver.userName}** erfüllt die Kriterien ` +
                        `für **${target.spedv}**.\n\n` +
                        `• Zeit in der Spedition: **${days} Tage** ` +
                        `(min. ${criteria.minDays})\n` +
                        `• Gefahrene Kilometer: **${Math.round(km).toLocaleString('de-DE')} km** ` +
                        `(min. ${criteria.minKm.toLocaleString('de-DE')})\n\n` +
                        'Bitte prüfen und bei Zustimmung in **SpedV** ' +
                        'befördern. Die Discord-Rolle folgt automatisch.'
                    ),
                ],
            });

            next.proposed[id] = target.spedv;

            logger.info(
                `Promotion: Empfehlung für ${driver.userName} -> ${target.spedv}`
            );
        } catch (err) {
            logger.error(
                `Promotion: Empfehlung für ${driver.userName} fehlgeschlagen`,
                err
            );
        }
    }
}

/**
 * Erkennt Rangwechsel in SpedV und verkündet ausschließlich
 * Beförderungen innerhalb der regulären Fahrer-Rangfolge.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Array} users Normalisierte Fahrerliste aus fetchUsers().
 */
async function checkPromotions(guild, users) {
    const channelId = process.env.ETS_PROMOTION_CHANNEL_ID;

    if (!channelId) {
        if (!warnedNoChannel) {
            logger.warn(
                'Promotion: ETS_PROMOTION_CHANNEL_ID fehlt in der .env, ' +
                'Beförderungsmodul ist aus'
            );

            warnedNoChannel = true;
        }

        return;
    }

    const active = users.filter(
        user => user.inSped !== false && user.id != null
    );

    const snapshot = () => Object.fromEntries(
        active.map(user => [
            String(user.id),
            {
                name: user.userName,
                rank: user.rank?.name ?? null,
            },
        ])
    );

    const state = loadState();

    // Erster Lauf: aktuellen Stand merken, nichts verkünden.
    if (!state) {
        saveState({
            drivers: snapshot(),
            proposed: {},
        });

        logger.info(
            `Promotion: Stand von ${active.length} Fahrer(n) gemerkt`
        );

        return;
    }

    const channel = await guild.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel?.isTextBased()) {
        logger.warn(
            'Promotion: Channel nicht gefunden oder kein Textkanal'
        );

        // Alten Stand behalten, damit nichts verloren geht.
        return;
    }

    const links = readLinks();

    const next = {
        drivers: {},
        proposed: {},
    };

    // Empfehlungen nur für weiterhin aktive Fahrer übernehmen.
    for (const user of active) {
        const id = String(user.id);

        if (state.proposed[id]) {
            next.proposed[id] = state.proposed[id];
        }
    }

    for (const driver of active) {
        const id = String(driver.id);
        const rankName = driver.rank?.name ?? null;
        const previous = state.drivers[id];

        let handled = true;

        if (
            previous?.rank &&
            rankName &&
            norm(previous.rank) !== norm(rankName)
        ) {
            // Ein Rangwechsel beendet die bisherige Empfehlungsrunde.
            delete next.proposed[id];

            const fromIndex = driverRankIndex(previous.rank);
            const toIndex = driverRankIndex(rankName);

            // Nur Wechsel zwischen bekannten Fahrerrängen können
            // eine reguläre Beförderungsankündigung auslösen.
            if (
                fromIndex !== -1 &&
                toIndex !== -1 &&
                toIndex > fromIndex
            ) {
                try {
                    const discordId =
                        links[norm(driver.userName)] ?? null;

                    await channel.send({
                        embeds: [
                            buildPromotion(
                                driver,
                                previous.rank,
                                rankName,
                                discordId
                            ),
                        ],

                        allowedMentions: {
                            users: discordId ? [discordId] : [],
                        },
                    });

                    logger.info(
                        `Promotion: ${driver.userName} ` +
                        `${previous.rank} -> ${rankName} verkündet`
                    );
                } catch (err) {
                    // Alten Stand behalten, damit der nächste Lauf
                    // die fehlgeschlagene Ankündigung erneut versucht.
                    handled = false;

                    logger.error(
                        `Promotion: Verkünden für ${driver.userName} fehlgeschlagen`,
                        err
                    );
                }
            } else {
                logger.info(
                    `Promotion: ${driver.userName} ` +
                    `${previous.rank} -> ${rankName} ` +
                    '(keine reguläre Fahrerbeförderung)'
                );
            }
        }

        next.drivers[id] = handled
            ? {
                name: driver.userName,
                rank: rankName,
            }
            : previous;
    }

    await proposeCandidates(guild, active, next);

    saveState(next);
}

module.exports = {
    checkPromotions,
};