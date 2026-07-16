const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

async function loadCommands(client) {
    const commandsPath = path.join(__dirname, '..', 'commands');
    const categories   = fs.readdirSync(commandsPath);

    let loaded = 0;
    let skipped = 0;

    for (const category of categories) {
        const categoryPath = path.join(commandsPath, category);

        if (!fs.statSync(categoryPath).isDirectory()) continue;

        const commandFiles = fs
            .readdirSync(categoryPath)
            .filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            try {
                const command = require(path.join(categoryPath, file));

                if (command.data && command.execute) {
                    client.commands.set(command.data.name, command);
                    logger.loaded('Command', command.data.name);
                    loaded++;
                } else {
                    logger.warn(`${file} fehlt "data" oder "execute" — übersprungen`);
                    skipped++;
                }
            } catch (error) {
                logger.error(`Fehler beim Laden von ${file}`, error);
                skipped++;
            }
        }
    }

    logger.success(`${loaded} Befehl(e) geladen${skipped > 0 ? `, ${skipped} übersprungen` : ''}`);
}

module.exports = { loadCommands };
