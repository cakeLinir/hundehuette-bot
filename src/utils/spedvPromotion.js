
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
 * Reguläre Fahrerränge in aufsteigender Reihenfolge.
 * Diese Reihenfolge gilt ausschließlich für Beförderungen
 * und Degradierungen innerhalb der Fahrer-Laufbahn.
 */
const DRIVER_RANKS = RANKS.filter(
    rank => rank.category === 'driver' || rank.promotion
);

/**
 * Vollständige Ranghierarchie, vom höchsten zum niedrigsten Rang.
 * Wird für die Einordnung der Rangstufen und die Protokollierung
 * verwendet. Funktionswechsel werden separat angekündigt.
 */
const ALL_RANKS_HIGH_TO_LOW = [
    'Geschäftsführer',
    'Stv. Geschäftsführer',
    'Betriebsleiter',
    'Dispositionsleiter',
    'Buchhaltungsleiter',
    'Fuhrparkmanagement',
    'Ausbildungsleiter',
    'Personalmanager',
    'Event-Konvoimanager',
    'Konvoileiter',
    'Buchhaltung',
    'Ausbilder',
    'Disponent',
    'Konvoibegleiter',
    'Senior Fahrer',
    'Fahrer',
    'Junior Fahrer',
    'Fahrer auf Probe',
];

/**
 * Bekannte Schreibweisen aus SpedV und der Bot-Konfiguration.
 * Die eigentlichen Rangnamen in den Ankündigungen bleiben erhalten.
 */
const RANK_ALIASES = new Map([
    ['stellvertretender geschäftsführer', 'Stv. Geschäftsführer'],
    ['stellv. geschäftsführer', 'Stv. Geschäftsführer'],
    ['stv geschäftsführer', 'Stv. Geschäftsführer'],
    ['event- und konvoimanager', 'Event-Konvoimanager'],
    ['event und konvoimanager', 'Event-Konvoimanager'],
    ['konvoi-leiter', 'Konvoileiter'],
    ['konvoi-begleiter', 'Konvoibegleiter'],
]);

let warnedNoChannel = false;

function normalizedRankName(rankName) {
    const value = norm(rankName);
    return norm(RANK_ALIASES.get(value) ?? value);
}

function canonicalRankName(rankName) {
    const normalized = normalizedRankName(rankName);

    return ALL_RANKS_HIGH_TO_LOW.find(
        rank => normalizedRankName(rank) === normalized
    ) ?? null;
}

function allRankIndex(rankName) {
    const canonical = canonicalRankName(rankName);

    if (!canonical) return -1;

    return ALL_RANKS_HIGH_TO_LOW.findIndex(
        rank => normalizedRankName(rank) === normalizedRankName(canonical)
    );
}

/**
 * Liefert den Index eines regulären Fahrerrangs.
 * -1 bedeutet, dass es kein regulärer Fahrerrang ist.
 */
function driverRankIndex(rankName) {
    return DRIVER_RANKS.findIndex(
        rank => normalizedRankName(rank.spedv) === normalizedRankName(rankName)
    );
}

function isDriverRank(rankName) {
    return driverRankIndex(rankName) !== -1;
}

/**
 * Lädt den gespeicherten Rangverlauf.
 * Ein fehlender oder ungültiger Stand wird als erster Lauf behandelt.
 */
function loadState() {
    try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

        if (!state || typeof state !== 'object' || Array.isArray(state)) {
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
    writeFileAtomic.sync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Liest die Discord-Verknüpfungen aus data/etsLinks.json.
 */
function readLinks() {
    try {
        const links = JSON.parse(fs.readFileSync(linksPath, 'utf-8'));

        return links && typeof links === 'object' && !Array.isArray(links)
            ? links
            : {};
    } catch {
        return {};
    }
}

/**
 * Sucht die Discord-ID ohne Beachtung der Groß-/Kleinschreibung
 * des SpedV-Benutzernamens.
 */
function getDiscordId(links, userName) {
    const wanted = norm(userName);

    const entry = Object.entries(links).find(
        ([name]) => norm(name) === wanted
    );

    return entry?.[1] ? String(entry[1]) : null;
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
 * Erstellt eine Ankündigung für einen Fahrer-Rangaufstieg.
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
        'Glückwunsch zum nächsten Rang und weiterhin gute Fahrt!'
    );
}

/**
 * Erstellt eine Ankündigung für eine Degradierung.
 */
function buildDemotion(driver, fromRank, toRank, discordId) {
    const who = discordId
        ? `<@${discordId}>`
        : `**${driver.userName}**`;

    return createEmbed(
        'error',
        'Rangdegradierung',
        `${who} wurde zurückgestuft.\n\n` +
        `**${fromRank}** ➜ **${toRank}**\n\n` +
        'Der aktuelle SpedV-Rang wurde übernommen.'
    );
}

/**
 * Erstellt eine Ankündigung für die Entbindung von einer Funktion
 * und die anschließende Betrauung mit der neuen Funktion.
 *
 * Das ist keine automatische Fahrerbeförderung.
 */
function buildFunctionChange(driver, fromRank, toRank, discordId) {
    const who = discordId
        ? `<@${discordId}>`
        : `**${driver.userName}**`;

    const oldRank = canonicalRankName(fromRank) ?? fromRank;
    const newRank = canonicalRankName(toRank) ?? toRank;

    return createEmbed(
        'info',
        'Funktionswechsel und neue Betrauung',
        `${who} erhält eine neue Funktion beziehungsweise Rangzuordnung.\n\n` +
        `**Bisherige Funktion / bisheriger Rang:** ${oldRank}\n` +
        `**Neue Funktion / neuer Rang:** ${newRank}\n\n` +
        `Die bisherige Funktion **${oldRank}** wird beendet. ` +
        `Die neue Funktion **${newRank}** wird übernommen.\n\n` +
        'Maßgeblich ist der in SpedV hinterlegte Rang.'
    );
}

/**
 * Erstellt eine allgemeine Rangwechsel-Ankündigung, wenn mindestens
 * ein Rang unbekannt ist. Unbekannte Werte werden nicht als Aufstieg
 * oder Degradierung fehlinterpretiert.
 */
function buildUnknownRankChange(driver, fromRank, toRank, discordId) {
    const who = discordId
        ? `<@${discordId}>`
        : `**${driver.userName}**`;

    return createEmbed(
        'info',
        'Rangänderung in SpedV',
        `${who} hat eine Rangänderung erhalten.\n\n` +
        `**Vorher:** ${fromRank}\n` +
        `**Nachher:** ${toRank}\n\n` +
        'Die Änderung wurde erkannt, konnte aber nicht sicher als ' +
        'Beförderung, Degradierung oder Funktionswechsel eingeordnet werden. ' +
        'Bitte die Rangbezeichnungen und die Bot-Konfiguration prüfen.'
    );
}

/**
 * Versendet eine Rangwechsel-Ankündigung.
 * Erwähnt ausschließlich den verknüpften Discord-Benutzer.
 */
async function announceRankChange(channel, driver, previousRank, newRank, links) {
    const discordId = getDiscordId(links, driver.userName);

    const previousIsDriver = isDriverRank(previousRank);
    const newIsDriver = isDriverRank(newRank);

    let embed;

    if (previousIsDriver && newIsDriver) {
        const fromIndex = driverRankIndex(previousRank);
        const toIndex = driverRankIndex(newRank);

        if (toIndex > fromIndex) {
            embed = buildPromotion(
                driver,
                previousRank,
                newRank,
                discordId
            );
        } else if (toIndex < fromIndex) {
            embed = buildDemotion(
                driver,
                previousRank,
                newRank,
                discordId
            );
        } else {
            return;
        }
    } else if (
        canonicalRankName(previousRank) &&
        canonicalRankName(newRank)
    ) {
        // Sobald ein Funktionsrang beteiligt ist, wird die Änderung
        // als Funktionswechsel/neue Betrauung kommuniziert.
        embed = buildFunctionChange(
            driver,
            previousRank,
            newRank,
            discordId
        );
    } else {
        embed = buildUnknownRankChange(
            driver,
            previousRank,
            newRank,
            discordId
        );
    }

    await channel.send({
        embeds: [embed],
        allowedMentions: {
            users: discordId ? [discordId] : [],
            roles: [],
        },
    });
}

/**
 * Prüft Empfehlungen für reguläre Fahrerbeförderungen.
 *
 * Funktionsränge werden hier ausdrücklich nicht berücksichtigt.
 * Diese Empfehlungen lösen keine automatische Beförderung in SpedV aus.
 */
async function proposeCandidates(guild, active, next) {
    const channelId = process.env.ETS_LEADER_CHANNEL_ID;

    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel?.isTextBased()) {
        logger.warn(
            'Promotion: Leitungs-Channel nicht gefunden oder kein Textkanal'
        );
        return;
    }

    const leaderRank = DRIVER_RANKS.find(rank => rank.leader);
    const leaderRoleId = leaderRank
        ? getRankRoleId(guild.id, leaderRank)
        : null;

    for (const driver of active) {
        const id = String(driver.id);

        if (next.proposed[id]) continue;

        const index = driverRankIndex(driver.rank?.name);

        if (index === -1) continue;

        const current = DRIVER_RANKS[index];
        const target = DRIVER_RANKS[index + 1];
        const criteria = current?.promotion;

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
                content: leaderRoleId ? `<@&${leaderRoleId}>` : undefined,
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
                        'Bitte prüfen und bei Zustimmung in SpedV ' +
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
 * Erkennt Rangänderungen anhand des gespeicherten SpedV-Stands.
 *
 * Erster Lauf:
 * - speichert den aktuellen Stand
 * - erzeugt keine rückwirkenden Ankündigungen
 *
 * Folgeaufrufe:
 * - Fahrer-Rang höher: Beförderung
 * - Fahrer-Rang niedriger: Degradierung
 * - Funktionsrang beteiligt: Funktionswechsel / neue Betrauung
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

    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel?.isTextBased()) {
        logger.warn(
            'Promotion: Channel nicht gefunden oder kein Textkanal'
        );

        // Ohne erreichbaren Kanal keinen neuen Stand speichern:
        // Rangänderungen bleiben beim nächsten Lauf erkennbar.
        return;
    }

    const links = readLinks();

    const next = {
        drivers: {},
        proposed: {},
    };

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
            normalizedRankName(previous.rank) !== normalizedRankName(rankName)
        ) {
            // Bei jeder Rangänderung beginnt die Empfehlungsrunde neu.
            delete next.proposed[id];

            try {
                await announceRankChange(
                    channel,
                    driver,
                    previous.rank,
                    rankName,
                    links
                );

                logger.info(
                    `Promotion: Rangänderung für ${driver.userName}: ` +
                    `${previous.rank} -> ${rankName} verkündet`
                );
            } catch (err) {
                handled = false;

                logger.error(
                    `Promotion: Ankündigung für ${driver.userName} ` +
                    'fehlgeschlagen; erneuter Versuch beim nächsten Lauf',
                    err
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
