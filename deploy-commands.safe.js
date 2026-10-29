require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const APPLY = process.argv.includes('--apply');
const REMOVE_GUILD_CONFLICTS = process.argv.includes('--remove-conflicting-guild-commands');

function requireEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Pflichtvariable ${name} fehlt in der .env.`);
    return value;
}

function loadCommandData() {
    const commands = [];
    const seen = new Map();
    const commandsPath = path.join(__dirname, 'src', 'commands');

    if (!fs.existsSync(commandsPath)) {
        throw new Error(`Commands-Verzeichnis nicht gefunden: ${commandsPath}`);
    }

    for (const category of fs.readdirSync(commandsPath).sort()) {
        const categoryPath = path.join(commandsPath, category);
        if (!fs.statSync(categoryPath).isDirectory()) continue;

        const files = fs.readdirSync(categoryPath)
            .filter(file => file.endsWith('.js'))
            .sort();

        console.log(`Kategorie "${category}": ${files.length} Datei(en)`);

        for (const file of files) {
            const fullPath = path.join(categoryPath, file);
            let command;

            try {
                // Lädt nur Command-Module. Die Module sollten beim require keine
                // Netzwerkverbindungen, Timer oder Server starten.
                command = require(fullPath);
            } catch (error) {
                throw new Error(`${category}/${file} konnte nicht geladen werden: ${error.message}`);
            }

            if (!command?.data || typeof command.data.toJSON !== 'function') {
                console.log(`  - ${file}: keine Slash-Command-Definition, übersprungen`);
                continue;
            }

            const json = command.data.toJSON();
            if (!json.name || typeof json.name !== 'string') {
                throw new Error(`${category}/${file}: Command hat keinen gültigen Namen.`);
            }

            if (seen.has(json.name)) {
                throw new Error(
                    `Doppelter Slash-Command-Name "${json.name}" in ` +
                    `${seen.get(json.name)} und ${category}/${file}.`
                );
            }

            // Discord akzeptiert nur globale Command-Definitionen, keine Laufzeitfunktionen.
            JSON.stringify(json);
            seen.set(json.name, `${category}/${file}`);
            commands.push(json);
            console.log(`  + /${json.name}`);
        }
    }

    if (commands.length === 0) {
        throw new Error('Keine Slash-Commands gefunden; Registrierung abgebrochen.');
    }

    return commands;
}

function summarize(label, commands) {
    console.log(`\n${label} (${commands.length})`);
    for (const command of [...commands].sort((a, b) => a.name.localeCompare(b.name))) {
        const subcommands = (command.options || [])
            .filter(option => option.type === 1 || option.type === 2)
            .map(option => option.name);
        console.log(`  /${command.name}${subcommands.length ? `  [${subcommands.join(', ')}]` : ''}`);
    }
}

async function askForConfirmation(question) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
        const answer = await rl.question(`${question} Tippe exakt JA zum Fortfahren: `);
        return answer.trim() === 'JA';
    } finally {
        rl.close();
    }
}

(async () => {
    try {
        const token = requireEnv('TOKEN');
        const clientId = requireEnv('CLIENT_ID');
        const guildId = requireEnv('GUILD_ID');
        const commands = loadCommandData();

        summarize('Lokale Soll-Befehle', commands);

        if (!APPLY) {
            console.log('\nVORSCHAU: Es wurde nichts an Discord gesendet.');
            console.log('Für den API-Abgleich und die bestätigungspflichtige Registrierung:');
            console.log('  node .\\deploy-commands.safe.js --apply');
            console.log('Bei bewusst gewünschter Entfernung kollidierender Guild-Commands zusätzlich:');
            console.log('  node .\\deploy-commands.safe.js --apply --remove-conflicting-guild-commands');
            process.exitCode = 0;
            return;
        }

        const rest = new REST({ version: '10' }).setToken(token);

        // Nur lesen, bevor eine Änderung erfolgt.
        const [currentGlobal, currentGuild] = await Promise.all([
            rest.get(Routes.applicationCommands(clientId)),
            rest.get(Routes.applicationGuildCommands(clientId, guildId)),
        ]);

        summarize('Derzeit registrierte globale Befehle', currentGlobal);
        summarize('Derzeit registrierte Guild-Befehle', currentGuild);

        const desiredNames = new Set(commands.map(command => command.name));
        const currentGlobalNames = new Set(currentGlobal.map(command => command.name));
        const guildConflicts = currentGuild.filter(command => desiredNames.has(command.name));
        const globalToAdd = commands.filter(command => !currentGlobalNames.has(command.name));
        const globalToRemove = currentGlobal.filter(command => !desiredNames.has(command.name));

        console.log('\nÄnderungsvorschau:');
        console.log(`  Globale Befehle insgesamt nach Registrierung: ${commands.length}`);
        console.log(`  Globale Namen neu/aktualisiert: ${commands.length}`);
        console.log(`  Bisherige globale Namen, die aus der Soll-Liste entfallen: ${globalToRemove.length}`);
        console.log(`  Guild-Commands mit Namenskonflikt: ${guildConflicts.length}`);

        if (globalToRemove.length) {
            console.log('  Globale Befehle, die durch die vollständige Soll-Liste entfallen:');
            for (const command of globalToRemove) console.log(`    - /${command.name}`);
        }
        if (guildConflicts.length) {
            console.log('  Kollidierende Guild-Commands:');
            for (const command of guildConflicts) console.log(`    - /${command.name} (ID ${command.id})`);
        }

        if (guildConflicts.length && !REMOVE_GUILD_CONFLICTS) {
            throw new Error(
                'Guild-Commands kollidieren mit den globalen Soll-Befehlen. ' +
                'Es wurde nichts geändert. Prüfe die Liste. Nur wenn du diese Guild-Commands ' +
                'gezielt entfernen willst, starte mit --remove-conflicting-guild-commands.'
            );
        }

        const warning = [
            'ACHTUNG: Die globale PUT-Registrierung ersetzt die vollständige globale Befehlsliste.',
            `Soll-Liste: ${commands.length} Commands; derzeit global: ${currentGlobal.length}.`,
            `Globale Commands außerhalb der Soll-Liste: ${globalToRemove.length}.`,
            `Guild-Commands, die nach globaler Registrierung kollidieren würden: ${guildConflicts.length}.`,
            REMOVE_GUILD_CONFLICTS
                ? 'Nach erfolgreicher globaler Registrierung werden die oben angezeigten kollidierenden Guild-Commands entfernt.'
                : 'Guild-Commands werden nicht verändert.',
        ].join('\n');

        console.log(`\n${warning}\n`);
        const confirmed = await askForConfirmation('Discord jetzt ändern?');
        if (!confirmed) {
            console.log('Abgebrochen. Es wurde nichts geändert.');
            return;
        }

        // Globale Registrierung erst nach lokaler Validierung, API-Leseprüfung und Bestätigung.
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Globale Slash-Commands erfolgreich registriert.');

        // Guild-Befehle nur dann anfassen, wenn die explizite Zusatzoption gesetzt wurde.
        if (REMOVE_GUILD_CONFLICTS && guildConflicts.length) {
            const conflictIds = new Set(guildConflicts.map(command => command.id));
            const remainingGuild = currentGuild.filter(command => !conflictIds.has(command.id));
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: remainingGuild }
            );
            console.log(`Kollidierende Guild-Commands entfernt; ${remainingGuild.length} Guild-Command(s) erhalten.`);
        } else {
            console.log('Guild-Commands unverändert gelassen.');
        }

        console.log('Registrierung abgeschlossen.');
    } catch (error) {
        console.error(`FEHLER: ${error.message}`);
        if (error?.rawError?.message) console.error(`Discord: ${error.rawError.message}`);
        process.exitCode = 1;
    }
})();
