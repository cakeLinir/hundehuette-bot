const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { isModuleEnabled } = require('./moduleManager');
const { fetchUsers, findDriver, isRankAllowed } = require('./spedvApi');
const { checkNewDrivers } = require('./spedvWelcome');
const { checkPromotions } = require('./spedvPromotion');
const { findRank, getRankRoleId, allRankRoleIds } = require('./rankRoles');

const linksPath = path.join(__dirname, '..', '..', 'data', 'etsLinks.json');

function readLinks() {
    try {
        return JSON.parse(fs.readFileSync(linksPath, 'utf-8'));
    } catch {
        return {};
    }
}

/** Alle Rollen, die der Bot verwalten darf. Alles andere bleibt unangetastet. */
function managedRoleIds(guildId) {
    return [process.env.ETS_ROLE_ID, ...allRankRoleIds(guildId)].filter(Boolean);
}

/** Rollen, die ein Fahrer aktuell haben soll. Ohne gültigen Rang: keine. */
function targetRoleIds(driver, guildId) {
    if (!driver) {
        return {
            skip: true,
            reason: 'Kein passender SpedV-Datensatz gefunden',
        };
    }

    // Ein ausdrücklich inaktiver Fahrer verliert die verwalteten Rollen.
    if (driver.inSped === false) {
        return { skip: false, roleIds: [] };
    }

    const rankName = driver.rank?.name;
    const rank = findRank(rankName);

    if (!rank) {
        return {
            skip: true,
            reason: `Unbekannter SpedV-Rang: "${rankName ?? '(leer)'}"`,
        };
    }

    if (!isRankAllowed(driver)) {
        return {
            skip: true,
            reason: `Rang "${rankName}" fehlt in ETS_ALLOWED_RANKS`,
        };
    }

    const rankRoleId = getRankRoleId(guildId, rank);

    if (!rankRoleId) {
        return {
            skip: true,
            reason: `Keine Discord-Rollen-ID für Rang "${rankName}" konfiguriert`,
        };
    }

    if (!process.env.ETS_ROLE_ID) {
        return {
            skip: true,
            reason: 'ETS_ROLE_ID ist nicht konfiguriert',
        };
    }

    return {
        skip: false,
        roleIds: [...new Set([
            process.env.ETS_ROLE_ID,
            rankRoleId,
        ])],
    };
}
/** Gleicht die Rollen eines Members mit dem SpedV-Stand ab. driver = null entzieht alles. */
async function applyRoles(member, driver, reason) {
    const guildId = member.guild.id;
    const result = targetRoleIds(driver, guildId);

    // Bei unklarer Konfiguration keinerlei Rollen verändern.
    if (result.skip) {
        return {
            added: 0,
            removed: 0,
            skipped: true,
            reason: result.reason,
        };
    }

    const target = new Set(result.roleIds);
    const toAdd = [...target].filter(
        id => !member.roles.cache.has(id)
    );
    const toRemove = managedRoleIds(guildId).filter(
        id => !target.has(id) && member.roles.cache.has(id)
    );

    // Zuerst hinzufügen: Schlägt dies fehl, bleiben alte Rollen erhalten.
    if (toAdd.length) {
        await member.roles.add(toAdd, reason);
    }

    if (toRemove.length) {
        await member.roles.remove(toRemove, reason);
    }

    return {
        added: toAdd.length,
        removed: toRemove.length,
        skipped: false,
    };
}

async function runSync(client) {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild || !isModuleEnabled(guild.id, 'ets')) return;
    if (!process.env.SPEDV_API_KEY || !process.env.ETS_ROLE_ID) return;

    let users;
    try {
        users = await fetchUsers();
    } catch (err) {
        logger.error('RoleSync: abgebrochen (SpedV nicht erreichbar)', err);
        return;
    }
    if (!users.length) {
        logger.warn('RoleSync: leere Mitgliederliste, abgebrochen (Schutz vor Massen-Entzug)');
        return;
    }

    // Zusatzmodule: Fehler hier dürfen den Rollen-Sync nicht stoppen
    await checkNewDrivers(guild, users).catch(err => logger.error('Welcome: Unerwarteter Fehler', err));
    await checkPromotions(guild, users).catch(err => logger.error('Promotion: Unerwarteter Fehler', err));

    let changes = 0;
    for (const [spedvName, discordId] of Object.entries(readLinks())) {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;

        try {
            const driver = findDriver( users, [spedvName], { includeInactive: true } );
            if (!driver) { logger.warn( `RoleSync: Kein SpedV-Datensatz für "${spedvName}" ` + `(Discord ${discordId}); Rollen unverändert gelassen` );
                continue; }
            const result = await applyRoles( member, driver, 'SpedV-Rollen-Sync' );
            if (result.skipped) { logger.warn( `RoleSync: ${spedvName}: ${result.reason}; ` + 'Rollen unverändert gelassen' ); continue; }
            changes += result.added + result.removed;
        } catch (err) {
            logger.error(`RoleSync: Fehler bei ${spedvName}`, err);
        }
    }

    logger.info(`RoleSync: ${changes} Rollenänderung(en)`);
}

function startRoleSync(client) {
    const minutes = Number(process.env.ROLE_SYNC_MINUTES) || 10;
    const safeRun = () => runSync(client).catch(err => logger.error('RoleSync: Unerwarteter Fehler', err));

    setTimeout(safeRun, 15_000);
    setInterval(safeRun, minutes * 60_000);
    logger.info(`RoleSync: aktiv (alle ${minutes} Min.)`);
}

module.exports = { applyRoles, runSync, startRoleSync };
