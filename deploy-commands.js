require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

function loadCommandData() {
    const commands = [];
    const commandsPath = path.join(__dirname, 'src', 'commands');

    for (const category of fs.readdirSync(commandsPath)) {
        const categoryPath = path.join(commandsPath, category);
        if (!fs.statSync(categoryPath).isDirectory()) continue;

        const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
        console.log(`📁 Kategorie "${category}": ${files.length} Datei(en)`);

        for (const file of files) {
            try {
                const command = require(path.join(categoryPath, file));
                if (command.data) {
                    commands.push(command.data.toJSON());
                    console.log(`  ✅ ${command.data.name}`);
                }
            } catch (error) {
                throw new Error(`${category}/${file} konnte nicht geladen werden: ${error.message}`);
            }
        }
    }

    return commands;
}

(async () => {
    try {
        // 1. Alle Befehle laden und prüfen, bevor Discord geändert wird.
        const commands = loadCommandData();

        // 2. Globale Commands zuerst registrieren.
        // Bei einem Fehler bleiben vorhandene Guild-Commands unangetastet.
        console.log(`Registriere ${commands.length} globale Slash-Befehl(e)...`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        // 3. Nur Guild-Commands entfernen, die jetzt global registriert sind.
        // Andere Guild-spezifische Commands bleiben erhalten.
        console.log('Prüfe vorhandene Guild-Commands...');

        const globalNames = new Set(commands.map(command => command.name));

        const guildRoute = Routes.applicationGuildCommands(
            process.env.CLIENT_ID,
            process.env.GUILD_ID
        );

        const existingGuildCommands = await rest.get(guildRoute);

        const preservedGuildCommands = existingGuildCommands.filter(
            command => !globalNames.has(command.name)
        );

        const removedNames = existingGuildCommands
            .filter(command => globalNames.has(command.name))
            .map(command => command.name);

        console.log(`Erhaltene Guild-Commands: ${preservedGuildCommands.length}`);
        console.log(`Entfernte doppelte Guild-Commands: ${removedNames.length}`);

        if (removedNames.length > 0) {
            console.log(`Bereinigung: ${removedNames.join(', ')}`);
        }

        if (removedNames.length > 0) {
            await rest.put(guildRoute, { body: preservedGuildCommands });
        }
        console.log('✅ Slash-Befehle erfolgreich registriert!');

        // Command-Dateien können Timer oder Server starten: Prozess explizit beenden
        process.exit(0);
    } catch (error) {
        console.error('❌ Fehler:', error.message);
        process.exit(1);
    }
})();
