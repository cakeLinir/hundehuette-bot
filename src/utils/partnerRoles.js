'use strict';

const fs = require('node:fs');
const path = require('node:path');
const writeFileAtomic = require('write-file-atomic');
const logger = require('./logger');
const { createEmbed } = require('./embedBuilder');
const { getGuildSettings, setGuildSettings } = require('./settingsManager');
const { isModuleEnabled } = require('./moduleManager');
const { fetchAcceptedPartners, fetchPartnerUsers } = require('./spedvPartners');

// Erst nach so vielen aufeinanderfolgenden Abgleichen ohne Nachweis wird etwas entzogen.
const MISSING_RUNS_BEFORE_REMOVAL = 2;
const ROLE_COLOR = 0x607d8b;
const MAX_ROLE_NAME_LENGTH = 100;

const dataDir = path.join(__dirname, '..', '..', 'data');
const linksPath = path.resolve(
    process.env.ETS_PARTNER_LINKS_PATH || path.join(dataDir, 'etsPartnerLinks.json')
);

let syncRunning = false;

/** Fehler mit Text, der dem Nutzer direkt angezeigt werden darf. */
class PartnerLinkError extends Error { }

/* ------------------------------------------------------------------ */
/* Verknüpfungen (Discord <-> SpedV-Konto einer Partnerspedition)      */
/* ------------------------------------------------------------------ */

function loadLinks() {
    let raw;
    try {
        raw = fs.readFileSync(linksPath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw error;
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        // Nicht überschreiben: die Datei muss manuell geprüft werden.
        throw new Error(`etsPartnerLinks.json nicht lesbar (${error.message}).`);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('etsPartnerLinks.json muss ein JSON-Objekt enthalten.');
    }
    return data;
}

function saveLinks(links) {
    fs.mkdirSync(path.dirname(linksPath), { recursive: true });
    writeFileAtomic.sync(linksPath, JSON.stringify(links, null, 2), { encoding: 'utf8' });
}

function listPartnerLinks() {
    return Object.values(loadLinks());
}

function getPartnerLinkByDiscordId(discordId) {
    const id = String(discordId ?? '');
    return Object.values(loadLinks()).find(link => link?.discordId === id) ?? null;
}

function getPartnerLinkBySpedvUserId(spedvUserId) {
    return loadLinks()[String(spedvUserId ?? '')] ?? null;
}

function setPartnerLink({ discordId, spedvName, spedvUserId, speditionId }) {
    const cleanDiscordId = String(discordId ?? '').trim();
    const cleanName = String(spedvName ?? '').trim();
    const cleanUserId = String(spedvUserId ?? '').trim();
    const cleanSpeditionId = String(speditionId ?? '').trim();

    if (!/^\d{17,20}$/.test(cleanDiscordId)) throw new TypeError('Ungültige Discord-ID.');
    if (!cleanName) throw new TypeError('SpedV-Name fehlt.');
    if (!/^\d+$/.test(cleanUserId)) throw new TypeError('Ungültige SpedV-Nutzer-ID.');
    if (!/^\d+$/.test(cleanSpeditionId)) throw new TypeError('Ungültige Speditions-ID.');

    const links = loadLinks();

    const owner = links[cleanUserId];
    if (owner && owner.discordId !== cleanDiscordId) {
        throw new PartnerLinkError(
            'Dieses SpedV-Konto ist bereits mit einem anderen Discord-Konto verknüpft.'
        );
    }

    const other = Object.entries(links).find(
        ([id, link]) => link?.discordId === cleanDiscordId && id !== cleanUserId
    );
    if (other) {
        throw new PartnerLinkError(
            'Dein Discord-Konto ist bereits mit einem anderen Partner-Konto verknüpft. Hebe zuerst die Verknüpfung mit /partner entknuepfen auf.'
        );
    }

    links[cleanUserId] = {
        discordId: cleanDiscordId,
        spedvName: cleanName,
        spedvUserId: cleanUserId,
        speditionId: cleanSpeditionId,
        linkedAt: owner?.linkedAt ?? new Date().toISOString(),
        missingRuns: 0,
    };
    saveLinks(links);
    return links[cleanUserId];
}

function removePartnerLink(discordId) {
    const id = String(discordId ?? '');
    const links = loadLinks();
    const key = Object.keys(links).find(k => links[k]?.discordId === id);
    if (!key) return false;
    delete links[key];
    saveLinks(links);
    return true;
}

/* ------------------------------------------------------------------ */
/* Rollen-Register (Speditions-ID -> Discord-Rolle)                    */
/* ------------------------------------------------------------------ */

function readRegistry(guildId) {
    const stored = getGuildSettings(guildId).etsPartnerRoles ?? {};
    return Object.fromEntries(
        Object.entries(stored).map(([id, entry]) => [id, { ...entry }])
    );
}

function roleNameFor(partner) {
    const name = partner.shortName || partner.name || `Partner ${partner.id}`;
    return name.slice(0, MAX_ROLE_NAME_LENGTH);
}

/**
 * Stellt sicher, dass für die Partnerspedition genau eine Discord-Rolle existiert.
 * Rechte werden nie verändert, nur der Name wird bei geändertem Kürzel angepasst.
 * Erwartet, dass guild.roles.fetch() zuvor ausgeführt wurde.
 */
async function ensurePartnerRole(guild, partner, registry) {
    const desiredName = roleNameFor(partner);
    const entry = registry[partner.id];
    let role = entry?.roleId ? guild.roles.cache.get(entry.roleId) ?? null : null;
    let created = false;

    if (!role) {
        // Vorhandene Rolle nur übernehmen, wenn sie keinerlei Rechte hat.
        const candidate = guild.roles.cache.find(
            r => r.name === desiredName && !r.managed && r.id !== guild.id
        );
        if (candidate) {
            if (candidate.permissions.bitfield === 0n) {
                role = candidate;
            } else {
                logger.warn(
                    `Partner: Rolle "${desiredName}" existiert bereits mit Rechten und wird nicht übernommen. Es wird eine neue Rolle erstellt.`
                );
            }
        }
    }

    if (!role) {
        role = await guild.roles.create({
            name: desiredName,
            colors: { primaryColor: ROLE_COLOR },
            hoist: false,
            mentionable: false,
            permissions: [],
            reason: `Partnerspedition ${partner.name ?? desiredName} (ID ${partner.id})`,
        });
        created = true;
        logger.info(`Partner: Rolle "${role.name}" für Spedition ${partner.id} erstellt`);
    } else if (role.name !== desiredName) {
        await role.edit({
            name: desiredName,
            reason: `Kürzel der Partnerspedition ${partner.id} geändert`,
        });
        logger.info(`Partner: Rolle für Spedition ${partner.id} in "${desiredName}" umbenannt`);
    }

    registry[partner.id] = {
        roleId: role.id,
        shortName: partner.shortName,
        name: partner.name,
        state: 'active',
        missingRuns: 0,
        updatedAt: new Date().toISOString(),
    };

    return { role, created };
}

/** Vergibt einem verifizierten Partnerfahrer die Rolle seiner Spedition. */
async function grantPartnerRole(guild, member, partner) {
    if (syncRunning) {
        throw new PartnerLinkError(
            'Der Partner-Abgleich läuft gerade. Bitte versuche es in einer Minute erneut.'
        );
    }

    await guild.roles.fetch();
    const registry = readRegistry(guild.id);
    const { role, created } = await ensurePartnerRole(guild, partner, registry);
    setGuildSettings(guild.id, { etsPartnerRoles: registry });

    if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role.id, 'Partnerspedition verifiziert');
    }
    return { role, created };
}

/* ------------------------------------------------------------------ */
/* Abgleich                                                            */
/* ------------------------------------------------------------------ */

/** Mitglied | null (nicht mehr auf dem Server) | undefined (vorübergehender Fehler) */
async function fetchMember(guild, discordId) {
    try {
        return await guild.members.fetch(discordId);
    } catch (error) {
        return error.code === 10007 ? null : undefined;
    }
}

async function tryRemoveRole(member, roleId, reason) {
    try {
        await member.roles.remove(roleId, reason);
        return true;
    } catch (error) {
        logger.error(`Partner: Rolle ${roleId} konnte bei ${member.id} nicht entfernt werden`, error);
        return false;
    }
}

async function notifyLeaders(guild, title, text) {
    const channelId = process.env.ETS_LEADER_CHANNEL_ID;
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel
        .send({ embeds: [createEmbed('info', title, text)], allowedMentions: { parse: [] } })
        .catch(error => logger.error('Partner: Leitungs-Hinweis konnte nicht gesendet werden', error));
}

async function runSync(guild) {
    if (!guild || !isModuleEnabled(guild.id, 'ets')) {
        return { skipped: 'Modul deaktiviert oder Server nicht gefunden' };
    }
    if (!process.env.SPEDV_API_KEY || !process.env.SPEDV_SPEDITION_ID) {
        logger.warn('Partner: SPEDV_API_KEY oder SPEDV_SPEDITION_ID fehlt in der .env');
        return { skipped: 'Konfiguration unvollständig' };
    }

    let partners;
    let partnerUsers;
    try {
        partners = await fetchAcceptedPartners();
        partnerUsers = partners.length
            ? await fetchPartnerUsers(partners.map(p => p.id))
            : [];
    } catch (error) {
        // Bei jedem API-Problem bleibt alles unverändert.
        logger.error('Partner-Sync abgebrochen (SpedV nicht erreichbar)', error);
        return { skipped: 'SpedV nicht erreichbar' };
    }

    await guild.roles.fetch();

    const registry = readRegistry(guild.id);
    const links = loadLinks();
    let linksChanged = false;
    const activeIds = new Set(partners.map(p => p.id));
    const summary = { partners: partners.length, created: 0, ended: 0, assigned: 0, removed: 0, unlinked: 0 };

    // 1. Rollen der aktuellen Partner sicherstellen
    for (const partner of partners) {
        try {
            const { role, created } = await ensurePartnerRole(guild, partner, registry);
            if (created) {
                summary.created += 1;
                await notifyLeaders(
                    guild,
                    '🤝 Neue Partnerrolle',
                    `Für **${partner.name ?? partner.shortName}** (${partner.shortName ?? partner.id}) wurde die Rolle ${role} erstellt.\n` +
                    'Sie hat keine Rechte. Bitte weise ihr die gewünschten Channels und Voices zu.'
                );
            }
        } catch (error) {
            logger.error(`Partner: Rolle für Spedition ${partner.id} fehlgeschlagen`, error);
        }
    }

    // 2. Beendete Partnerschaften: erst nach mehreren Abgleichen handeln
    for (const [id, entry] of Object.entries(registry)) {
        if (activeIds.has(id) || entry.state === 'ended') continue;

        entry.missingRuns = Math.min((entry.missingRuns ?? 0) + 1, 99);
        if (entry.missingRuns < MISSING_RUNS_BEFORE_REMOVAL) continue;

        let allDone = true;
        for (const [spedvId, link] of Object.entries(links)) {
            if (link?.speditionId !== id) continue;

            const member = await fetchMember(guild, link.discordId);
            if (member === undefined) {
                allDone = false;
                continue;
            }
            if (member && entry.roleId && member.roles.cache.has(entry.roleId)) {
                if (!(await tryRemoveRole(member, entry.roleId, 'Partnerschaft beendet'))) {
                    allDone = false;
                    continue;
                }
                summary.removed += 1;
            }
            delete links[spedvId];
            linksChanged = true;
        }

        if (allDone) {
            entry.state = 'ended';
            entry.endedAt = new Date().toISOString();
            summary.ended += 1;
            logger.warn(`Partner: Partnerschaft mit Spedition ${id} (${entry.shortName ?? entry.name ?? '?'}) beendet`);
            await notifyLeaders(
                guild,
                '🤝 Partnerschaft beendet',
                `Die Partnerschaft mit **${entry.name ?? entry.shortName ?? id}** besteht laut SpedV nicht mehr.\n` +
                'Die Rolle wurde von den Mitgliedern genommen. Sie selbst bleibt zur manuellen Entscheidung bestehen.'
            );
        }
    }

    // 3. Verknüpfte Partnerfahrer abgleichen
    const usersById = new Map(partnerUsers.map(user => [user.id, user]));
    const canVerifyMembers = partnerUsers.length > 0; // Fail-safe gegen leere Listen

    for (const [spedvId, link] of Object.entries(links)) {
        if (!link) continue;
        const user = usersById.get(spedvId);

        if (!user) {
            // Beendete Partnerschaften sind in Schritt 2 erledigt
            if (!activeIds.has(link.speditionId) || !canVerifyMembers) continue;

            link.missingRuns = (link.missingRuns ?? 0) + 1;
            linksChanged = true;
            if (link.missingRuns < MISSING_RUNS_BEFORE_REMOVAL) continue;

            const member = await fetchMember(guild, link.discordId);
            if (member === undefined) continue;

            const roleId = registry[link.speditionId]?.roleId;
            if (member && roleId && member.roles.cache.has(roleId)) {
                if (!(await tryRemoveRole(member, roleId, 'Nicht mehr bei der Partnerspedition'))) continue;
                summary.removed += 1;
            }
            delete links[spedvId];
            summary.unlinked += 1;
            continue;
        }

        if (link.missingRuns) {
            link.missingRuns = 0;
            linksChanged = true;
        }
        if (link.speditionId !== user.spedition.id) {
            link.speditionId = user.spedition.id;
            linksChanged = true;
        }

        const member = await fetchMember(guild, link.discordId);
        if (member === undefined) continue;
        if (member === null) {
            // Nicht mehr auf dem Discord-Server: Verknüpfung entfernen (Datensparsamkeit)
            delete links[spedvId];
            linksChanged = true;
            summary.unlinked += 1;
            continue;
        }

        const targetRoleId = registry[user.spedition.id]?.roleId;
        if (!targetRoleId) continue;

        if (!member.roles.cache.has(targetRoleId)) {
            try {
                await member.roles.add(targetRoleId, 'Partnerspedition abgeglichen');
                summary.assigned += 1;
            } catch (error) {
                logger.error(`Partner: Rolle konnte ${link.discordId} nicht zugewiesen werden`, error);
                continue;
            }
        }

        // Wechsel zwischen Partnern: andere verwaltete Partnerrollen entfernen
        for (const other of Object.values(registry)) {
            if (other.roleId && other.roleId !== targetRoleId && member.roles.cache.has(other.roleId)) {
                if (await tryRemoveRole(member, other.roleId, 'Partnerspedition gewechselt')) {
                    summary.removed += 1;
                }
            }
        }
    }

    if (linksChanged) saveLinks(links);
    setGuildSettings(guild.id, { etsPartnerRoles: registry });

    return summary;
}

async function syncPartners(client) {
    if (syncRunning) return { skipped: 'Abgleich läuft bereits' };
    syncRunning = true;
    try {
        return await runSync(client.guilds.cache.get(process.env.GUILD_ID));
    } finally {
        syncRunning = false;
    }
}

function startPartnerSync(client) {
    const minutes = Number(process.env.PARTNER_SYNC_MINUTES) || 15;

    const run = () =>
        syncPartners(client)
            .then(summary => {
                if (!summary || summary.skipped) return;
                logger.info(
                    `PartnerSync: ${summary.partners} Partner, ${summary.created} Rolle(n) erstellt, ` +
                    `${summary.assigned} vergeben, ${summary.removed} entzogen, ` +
                    `${summary.ended} beendet, ${summary.unlinked} Verknüpfung(en) entfernt`
                );
            })
            .catch(error => logger.error('PartnerSync: Unerwarteter Fehler', error));

    setTimeout(run, 30_000);
    setInterval(run, minutes * 60_000);
    logger.info(`PartnerSync: aktiv (alle ${minutes} Min.)`);
}

module.exports = {
    PartnerLinkError,
    listPartnerLinks,
    getPartnerLinkByDiscordId,
    getPartnerLinkBySpedvUserId,
    setPartnerLink,
    removePartnerLink,
    readRegistry,
    grantPartnerRole,
    syncPartners,
    startPartnerSync,
};
