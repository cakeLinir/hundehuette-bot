const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');
const logger = require('./logger');
const { createEmbed } = require('./embedBuilder');

const dataDir = path.join(__dirname, '..', '..', 'data');
const statePath = path.join(dataDir, 'etsWelcomeSeen.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let warnedNoChannel = false;

/** Gibt null zurück, wenn es noch keinen Stand gibt (erster Lauf). */
function loadState() {
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    } catch {
        return null;
    }
}

/** Speichert id -> Name (der Name dient nur der Lesbarkeit der Datei). */
function saveState(drivers) {
    const state = {};
    for (const d of drivers) state[String(d.id)] = d.userName;
    writeFileAtomic.sync(statePath, JSON.stringify(state, null, 2));
}

function buildWelcome(driver) {
    const name = driver.userName;
    const rank = driver.rank?.name ?? 'Fahrer auf Probe';
    const rulesChannelId = process.env.ETS_RULES_CHANNEL_ID;

    const lines = [
        `Schön, dass du dabei bist, **${name}**!`,
        `Du startest als **${rank}**.`,
        '',
        '**So schaltest du deinen Discord-Bereich frei:**',
        `1. Nutze den Befehl **/ets link** und gib deinen SpedV-Namen **${name}** an.`,
        '2. Der Bot gibt dir einen Code. Trage ihn in SpedV im Profil unter **Über mich** ein und speichere.',
        `3. Führe **/ets link** mit demselben Namen (**${name}**) nochmal aus.`,
        '',
        'Danach bekommst du automatisch deine Rollen.',
    ];

    if (rulesChannelId) {
        lines.push('', `Bitte lies vorab unser Regelwerk: <#${rulesChannelId}>`);
    }

    lines.push('', 'Und denk dran: **Das echte Leben hat immer Vorfahrt.** Gute Fahrt! 🛣️');

    return createEmbed('info', '🚚 Willkommen in der Spedition!', lines.join('\n'));
}

/**
 * Begrüßt neue Fahrer der Spedition.
 * @param {import('discord.js').Guild} guild
 * @param {Array} users normalisierte Fahrerliste aus spedvApi.fetchUsers()
 */
async function checkNewDrivers(guild, users) {
    const channelId = process.env.ETS_WELCOME_CHANNEL_ID;

    if (!channelId) {
        if (!warnedNoChannel) {
            logger.warn('Welcome: ETS_WELCOME_CHANNEL_ID fehlt in der .env, Begrüßung ist aus');
            warnedNoChannel = true;
        }
        return;
    }

    const active = users.filter(u => u.inSped !== false && u.id != null);
    const known = loadState();

    // Erster Lauf: nur merken, niemanden begrüßen
    if (!known) {
        saveState(active);
        logger.info(`Welcome: ${active.length} Bestandsfahrer gemerkt`);
        return;
    }

    const fresh = active.filter(u => !(String(u.id) in known));
    const failed = new Set();

    if (fresh.length) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) {
            logger.warn('Welcome: Channel nicht gefunden oder kein Textkanal');
            return; // Stand nicht speichern, damit nichts verloren geht
        }

        for (const driver of fresh) {
            try {
                await channel.send({ embeds: [buildWelcome(driver)] });
                logger.info(`Welcome: ${driver.userName} begrüßt`);
            } catch (err) {
                failed.add(String(driver.id)); // beim nächsten Lauf erneut versuchen
                logger.error(`Welcome: Senden für ${driver.userName} fehlgeschlagen`, err);
            }
        }
    }

    // Aktuelle Fahrer speichern (ohne fehlgeschlagene). Ausgetretene fallen raus -> Rejoin wird begrüßt
    saveState(active.filter(u => !failed.has(String(u.id))));
}

module.exports = { checkNewDrivers };
