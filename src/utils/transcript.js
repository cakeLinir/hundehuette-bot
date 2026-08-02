const { AttachmentBuilder } = require('discord.js');

/**
 * Erstellt ein Transcript eines Ticket-Kanals als HTML-Datei
 * @param {TextChannel} channel - Der Ticket-Kanal
 */
async function createTranscript(channel) {
    // Alle Nachrichten aus dem Kanal holen (max. 100 pro Abfrage)
    let alleNachrichten = [];
    let letzteId = null;

    while (true) {
        const options = { limit: 100 };
        if (letzteId) options.before = letzteId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        alleNachrichten = alleNachrichten.concat(Array.from(batch.values()));
        letzteId = batch.last().id;

        if (batch.size < 100) break;
    }

    // Chronologisch sortieren (älteste zuerst)
    alleNachrichten.reverse();

    // HTML generieren
    const nachrichtenHtml = alleNachrichten.map(msg => {
        const zeit = new Date(msg.createdTimestamp).toLocaleString('de-DE');
        const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 64 });

        return `
            <div class="message">
                <img class="avatar" src="${avatar}" />
                <div class="content">
                    <div class="header">
                        <span class="username">${escapeHtml(msg.author.tag)}</span>
                        <span class="timestamp">${zeit}</span>
                    </div>
                    <div class="text">${escapeHtml(msg.content) || '<i>[Kein Text]</i>'}</div>
                    ${msg.attachments.size > 0
                ? `<div class="attachments">📎 ${msg.attachments.size} Anhang/Anhänge</div>`
                : ''
            }
                </div>
            </div>
        `;
    }).join('\n');

    const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Ticket Transcript — ${escapeHtml(channel.name)}</title>
    <style>
        body {
            background: #313338;
            color: #dbdee1;
            font-family: 'Segoe UI', Arial, sans-serif;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            border-bottom: 2px solid #4e5058;
            padding-bottom: 10px;
        }
        .message {
            display: flex;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid #3f4147;
        }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
        }
        .header {
            display: flex;
            gap: 8px;
            align-items: baseline;
        }
        .username {
            font-weight: 600;
            color: #f2f3f5;
        }
        .timestamp {
            font-size: 12px;
            color: #949ba4;
        }
        .text {
            margin-top: 4px;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .attachments {
            margin-top: 4px;
            font-size: 12px;
            color: #949ba4;
        }
    </style>
</head>
<body>
    <h1>🎫 Ticket Transcript — ${escapeHtml(channel.name)}</h1>
    <p>Erstellt am ${new Date().toLocaleString('de-DE')} • ${alleNachrichten.length} Nachrichten</p>
    ${nachrichtenHtml}
</body>
</html>
    `;

    const buffer = Buffer.from(html, 'utf-8');
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.html` });
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { createTranscript };
