const logger = require('../utils/logger');
module.exports = {
    name: 'clientReady',
    once: true,

    execute(client) {
        logger.banner(client);

        client.user.setPresence({
            activities: [{ name: '🐾 hundekuchenlive | /help' }],
            status: 'online',
        });
    }
}