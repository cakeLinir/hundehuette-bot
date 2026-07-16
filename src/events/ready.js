const logger = require('../utils/logger');
module.exports = {
    name: 'ready',
    once: true,

    execute(client) {
        logger.banner(client);

        client.user.setPresence({
            activities: [{ name: '🐾 hundekuchenlive | /help' }],
            status: 'online',
        });
    }
}