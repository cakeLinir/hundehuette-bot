const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const COLORS = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    white: '\x1b[37m',
};

/**
 * Gibt Datum + Uhrzeit zurück, z. B. "15.10.2026 16:23:23" (immer Europe/Berlin)
 */
function timestamp() {
    return new Date()
        .toLocaleString('de-DE', {
            timeZone: 'Europe/Berlin',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
        .replace(',', '');
}

/**
 * Formatiert eine Log-Zeile
 * @param {string} level - Log-Level z.B. 'INFO'
 * @param {string} color - Farbe des Levels
 * @param {string} msg - Die Nachricht
 * @param {'log'|'error'} stream - Ausgabekanal (error -> PM2 error.log)
 */
function log(level, color, msg, stream = 'log') {
    const time = `${COLORS.gray}[${timestamp()}]${RESET}`;
    const tag = `${BOLD}${color}[${level}]${RESET}`;
    console[stream](`${time} ${tag} ${msg}`);
}

const logger = {
    /**
     * Allgemeine Info-Nachricht
     */
    info(msg) {
        log('INFO', COLORS.cyan, msg);
    },

    /**
     * Erfolg / positive Aktion
     */
    success(msg) {
        log('OK', COLORS.green, msg);
    },

    /**
     * Warnung — nichts ist kaputt aber es sollte beachtet werden
     */
    warn(msg) {
        log('WARN', COLORS.yellow, msg);
    },

    /**
     * Fehler — Kopfzeile UND Stacktrace gehen in den Error-Log, beide mit Zeitstempel
     */
    error(msg, err = null) {
        log('ERR', COLORS.red, msg, 'error');
        if (err) console.error(`${COLORS.red}${err.stack ?? err}${RESET}`);
    },

    /**
     * Bot-Start Banner
     */
    banner(client) {
        const line = '━'.repeat(40);
        console.log(`\n${COLORS.cyan}${BOLD}${line}${RESET}`);
        console.log(`${COLORS.cyan}${BOLD}  🐾  Hundehütte ist online!${RESET}`);
        console.log(`${COLORS.cyan}${line}${RESET}`);
        console.log(`${COLORS.white}  👤  Eingeloggt als : ${BOLD}${client.user.tag}${RESET}`);
        console.log(`${COLORS.white}  🌐  Server         : ${BOLD}${client.guilds.cache.size}${RESET}`);
        console.log(`${COLORS.white}  📡  Latenz         : ${BOLD}${Math.round(client.ws.ping)}ms${RESET}`);
        console.log(`${COLORS.white}  🤖  Node.js        : ${BOLD}${process.version}${RESET}`);
        console.log(`${COLORS.cyan}${BOLD}${line}${RESET}\n`);
    },

    /**
     * Modul / Event / Command geladen
     */
    loaded(type, name) {
        log('LOAD', COLORS.blue, `${type} geladen: ${BOLD}${name}${RESET}`);
    },

    /**
     * Moderation Aktion geloggt
     */
    modAction(action, target, moderator, reason) {
        log('MOD', COLORS.yellow,
            `${BOLD}${action}${RESET} | Ziel: ${BOLD}${target}${RESET} | Mod: ${moderator} | Grund: ${reason}`
        );
    },

    /**
     * Auto Mod Aktion geloggt
     */
    automod(type, user, channel) {
        log('AUTOMOD', COLORS.yellow,
            `${BOLD}${type}${RESET} | Nutzer: ${BOLD}${user}${RESET} | Kanal: ${channel}`
        );
    },

    /**
     * Ticket Aktion geloggt
     */
    ticket(action, user) {
        log('TICKET', COLORS.cyan,
            `${BOLD}${action}${RESET} | Nutzer: ${BOLD}${user}${RESET}`
        );
    },
};

module.exports = logger;
