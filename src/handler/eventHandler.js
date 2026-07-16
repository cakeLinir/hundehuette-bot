const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

function loadEvents(client) {
    const eventsPath = path.join(__dirname, '..', 'events');
    const eventFiles = fs
        .readdirSync(eventsPath)
        .filter(file => file.endsWith('.js'));

    let loaded  = 0;
    let skipped = 0;

    for (const file of eventFiles) {
        try {
            const event = require(path.join(eventsPath, file));

            if (!event.name || !event.execute) {
                logger.warn(`${file} fehlt "name" oder "execute" — übersprungen`);
                skipped++;
                continue;
            }

            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }

            logger.loaded('Event', event.name);
            loaded++;
        } catch (error) {
            logger.error(`Fehler beim Laden von ${file}`, error);
            skipped++;
        }
    }

    logger.success(`${loaded} Event(s) geladen${skipped > 0 ? `, ${skipped} übersprungen` : ''}`);
}

module.exports = { loadEvents };
