'use strict';

const UNKNOWN_MESSAGE = 10008; // Discord: Nachricht existiert nicht (mehr)

const isUnknownMessage = error => Number(error?.code ?? error?.rawError?.code) === UNKNOWN_MESSAGE;

/**
 * Bearbeitet eine früher gesendete Nachricht oder sendet sie neu
 * (wenn es sie noch nicht gibt, sie gelöscht wurde oder der Kanal gewechselt hat).
 * Ein Ping (content/allowedMentions) wird nur beim Neusenden mitgeschickt.
 */
async function upsertMessage({ channel, state, key, payload, content = null, allowedMentions = null }) {
    const stored = state.get(key);

    if (stored?.messageId && stored.channelId === channel.id) {
        try {
            const message = await channel.messages.fetch(stored.messageId);
            await message.edit(payload);
            return { action: 'edited', messageId: stored.messageId };
        } catch (error) {
            if (!isUnknownMessage(error)) throw error;
        }
    }

    const sent = await channel.send({
        ...payload,
        ...(content ? { content } : {}),
        ...(allowedMentions ? { allowedMentions } : {}),
    });
    state.set(key, { channelId: channel.id, messageId: sent.id });
    return { action: 'sent', messageId: sent.id };
}

/** Merkt sich Nachrichten-IDs und den letzten Lauf in den Servereinstellungen. */
function createSettingsState(guildId) {
    // Erst bei Gebrauch laden: das Modul legt beim Laden Dateien an
    const settings = () => require('../utils/settingsManager');

    return {
        get(key) {
            return settings().getGuildSettings(guildId).billingState?.[key] ?? null;
        },
        set(key, value) {
            const current = settings().getGuildSettings(guildId).billingState ?? {};
            settings().setGuildSettings(guildId, { billingState: { ...current, [key]: value } });
        },
    };
}

module.exports = { upsertMessage, createSettingsState, isUnknownMessage };
