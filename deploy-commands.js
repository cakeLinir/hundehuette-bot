require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('🗑️  Lösche alle GLOBALEN Commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [] }
        );
        console.log('✅  Globale Commands gelöscht!');

        console.log('🗑️  Lösche alle GUILD Commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: [] }
        );
        console.log('✅  Guild Commands gelöscht!');

        // Commands laden
        const commands     = [];
        const commandsPath = path.join(__dirname, 'src', 'commands');
        const categories   = fs.readdirSync(commandsPath);

        console.log(`\n📂 Suche Commands in: ${commandsPath}`);

        for (const category of categories) {
            const categoryPath = path.join(commandsPath, category);
            if (!fs.statSync(categoryPath).isDirectory()) continue;

            const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
            console.log(`📁 Kategorie "${category}": ${files.length} Datei(en) gefunden`);

            for (const file of files) {
                const command = require(path.join(categoryPath, file));
                if (command.data) {
                    commands.push(command.data.toJSON());
                    console.log(`  ✅ Command geladen: ${command.data.name}`);
                }
            }
        }

        // Neu registrieren als Global Commands
        console.log(`\n🔄  Registriere ${commands.length} Slash-Befehl(e)...`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅  Slash-Befehle erfolgreich registriert!');

    } catch (error) {
        console.error('❌ Fehler:', error);
    }
})();
