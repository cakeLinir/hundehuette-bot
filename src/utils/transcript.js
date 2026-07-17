const { AttachmentBuilder } = require('discord.js');

/**
 * Erstellt ein Transcript aller Nachrichten eines Ticket-Kanals
 * @param {TextChannel} channel
 * @returns {AttachmentBuilder}
 */
async function createTranscript(channel) {
    let allMessages = [];
    let lastId = null;

    // Discord erlaubt max. 100 Nachrichten pro Abruf — wir holen alles in Schleifen
    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        allMessages = allMessages.concat(Array.from(batch.values()));
        lastId = batch.last().id;

        if (batch.size < 100) break;
    }

    // Chronologisch sortieren (älteste zuerst)
    allMessages.reverse();

    const zeilen = allMessages.map(msg => {
        const zeit = msg.createdAt.toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

        let inhalt = msg.content || '[Kein Textinhalt]';

        if (msg.embeds.length > 0) {
            inhalt += ` [${msg.embeds.length} Embed(s)]`;
        }
        if (msg.attachments.size > 0) {
            const links = msg.attachments.map(a => a.url).join(', ');
            inhalt += ` [Anhang: ${links}]`;
        }

        return `[${zeit}] ${msg.author.tag}: ${inhalt}`;
    });

    const header = [
        `Transcript — #${channel.name}`,
        `Erstellt am: ${new Date().toLocaleString('de-DE')}`,
        `Nachrichten: ${allMessages.length}`,
        '─'.repeat(60),
        '',
    ].join('\n');

    const inhalt = header + zeilen.join('\n');
    const buffer = Buffer.from(inhalt, 'utf-8');

    return new AttachmentBuilder(buffer, {
        name: `transcript-${channel.name}.txt`,
    });
}

module.exports = { createTranscript };
