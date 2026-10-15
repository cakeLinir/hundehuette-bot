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
        // 1. Erst alles prüfen: bei einem Fehler bleibt bei Discord alles unverändert
        const commands = loadCommandData();

        // 2. Alte Guild-Commands entfernen (verhindert doppelte Befehle)
        console.log('\n🧹 Entferne alte Guild-Commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: [] }
        );

        // 3. Globale Commands überschreiben
        console.log(`🔄 Registriere ${commands.length} Slash-Befehl(e)...`);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

        console.log('✅ Slash-Befehle erfolgreich registriert!');

        // Command-Dateien können Timer oder Server starten: Prozess explizit beenden
        process.exit(0);
    } catch (error) {
        console.error('❌ Fehler:', error.message);
        process.exit(1);
    }
})();
