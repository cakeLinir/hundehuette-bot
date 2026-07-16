require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { loadCommands } = require('./src/handler/commandHandler');
const { loadEvents } = require('./src/handler/eventHandler');
const logger = require('./src/utils/logger');

// Bot Client erstellen mit den benötigten Intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Collection für alle Slash-Befehle
client.commands = new Collection();

// Handler laden
loadCommands(client);
loadEvents(client);

// Verhinderung dass der bot bei unbehandelten Fehlern abstürzt
client.on('error', error => {
    logger.error('Client Fehler', error);
});

process.on('unhandledRejection', error => {
    logger.error('Unhandled Rejection', error);
});

// Bot einloggen
client.login(process.env.TOKEN);
