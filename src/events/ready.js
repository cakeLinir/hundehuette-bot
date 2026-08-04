const logger = require('../utils/logger');

module.exports = {
    name: 'ready', // war: clientReady
    once: true,
    execute(client) {
        logger.banner(client);
        client.user.setPresence({
            activities: [{ name: '🐾 hundekuchenlive | /help' }],
            status: 'online',
        });
        logger.success(`Bot eingeloggt als ${client.user.tag}`);
    }
};
