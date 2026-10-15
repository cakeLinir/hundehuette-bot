const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { isModuleEnabled } = require('./moduleManager');
const { fetchUsers, findDriver, isRankAllowed } = require('./spedvApi');
const { checkNewDrivers } = require('./spedvWelcome');

const linksPath = path.join(__dirname, '..', '..', 'data', 'etsLinks.json');

// SpedV-Rangname -> Name der .env-Variable mit der Discord-Rollen-ID
const RANK_ROLES = [
    { rank: 'fahrer auf probe', env: 'ROLE_PROBEFAHRER' },
    { rank: 'fahrer', env: 'ROLE_FAHRER' },
    { rank: 'werkstattleiter', env: 'ROLE_WERKSTATTLEITER' },
    { rank: 'geschäftsführer', env: 'ROLE_GESCHAEFTSFUEHRER' },
];

const norm = v => String(v ?? '').trim().toLowerCase();

function readLinks() {
    try {
        return JSON.parse(fs.readFileSync(linksPath, 'utf-8'));
    } catch {
        return {};
    }
}

function rankRoleId(rankName) {
    const entry = RANK_ROLES.find(r => r.rank === norm(rankName));
    return entry ? process.env[entry.env] || null : null;
}

/** Alle Rollen, die der Bot verwalten darf. Alles andere bleibt unangetastet. */
function managedRoleIds() {
    return [process.env.ETS_ROLE_ID, ...RANK_ROLES.map(r => process.env[r.env])].filter(Boolean);
}

/** Rollen, die ein Fahrer aktuell haben soll. Ohne gültigen Rang: keine. */
function targetRoleIds(driver) {
    if (!driver || !isRankAllowed(driver)) return [];
    return [process.env.ETS_ROLE_ID, rankRoleId(driver.rank?.name)].filter(Boolean);
}

/** Gleicht die Rollen eines Members mit dem SpedV-Stand ab. driver = null entzieht alles. */
async function applyRoles(member, driver, reason) {
    const target = new Set(targetRoleIds(driver));
    const toAdd = [...target].filter(id => !member.roles.cache.has(id));
    const toRemove = managedRoleIds().filter(id => !target.has(id) && member.roles.cache.has(id));

    if (toAdd.length) await member.roles.add(toAdd, reason);
    if (toRemove.length) await member.roles.remove(toRemove, reason);

    return { added: toAdd.length, removed: toRemove.length };
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

    // Neue Fahrer begrüßen (Fehler hier dürfen den Rollen-Sync nicht stoppen)
    await checkNewDrivers(guild, users).catch(err => logger.error('Welcome: Unerwarteter Fehler', err));

    let changes = 0;
    for (const [spedvName, discordId] of Object.entries(readLinks())) {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;

        try {
            const driver = findDriver(users, [spedvName]);
            const { added, removed } = await applyRoles(member, driver, 'SpedV-Rollen-Sync');
            changes += added + removed;
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
