const logger = require('./logger');
const { getAccessToken } = require('./twitchApi');

async function subscribeToStreamEvents(twitchUserId) {
    const token = await getAccessToken();

    for (const type of ['stream.online', 'stream.offline']) {
        try {
            const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                method: 'POST',
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type,
                    version: '1',
                    condition: { broadcaster_user_id: twitchUserId },
                    transport: {
                        method: 'webhook',
                        callback: `${process.env.BOT_URL}/webhook/twitch`,
                        secret: process.env.TWITCH_WEBHOOK_SECRET,
                    },
                }),
            });

            const data = await res.json();
            if (data.error && !data.message?.includes('already exists')) {
                throw new Error(data.message);
            }
            logger.success(`EventSub subscribed: ${type} für User ${twitchUserId}`);
        } catch (error) {
            if (error.message?.includes('already exists')) {
                logger.info(`EventSub existiert bereits: ${type}`);
            } else {
                logger.error(`Fehler bei EventSub Subscription: ${type}`, error);
            }
        }
    }
}

module.exports = { subscribeToStreamEvents };
