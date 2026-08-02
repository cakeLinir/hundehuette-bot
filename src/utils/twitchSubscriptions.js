const axios = require('axios');
const logger = require('../utils/logger');
const { getAppToken } = require('../server/twitchEvents');

/**
 * EventSub Subscription erstellen
 */
async function subscribeToStreamEvents(twitchUserId) {
    const token = await getAppToken();

    for (const type of ['stream.online', 'stream.offline']) {
        try {
            await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
                type,
                version: '1',
                condition: { broadcaster_user_id: twitchUserId },
                transport: {
                    method: 'webhook',
                    callback: `${process.env.BOT_URL}/webhook/twitch`,
                    secret: process.env.TWITCH_WEBHOOK_SECRET,
                }
            }, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                }
            });

            logger.success(`EventSub subscribed: ${type} für User ${twitchUserId}`);
        } catch (error) {
            if (error.response?.data?.message?.includes('already exists')) {
                logger.info(`EventSub existiert bereits: ${type}`);
            } else {
                logger.error(`Fehler bei EventSub Subscription: ${type}`, error);
            }
        }
    }
}

module.exports = { subscribeToStreamEvents };
