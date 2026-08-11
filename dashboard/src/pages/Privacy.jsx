import { useNavigate } from 'react-router-dom';

export default function Privacy() {
    const navigate = useNavigate();
    return (
        <div style={s.page}>
            <div style={s.header}>
                <button style={s.back} onClick={() => navigate(-1)}>← Zurück</button>
                <span style={s.title}>🔒 Datenschutzerklärung</span>
            </div>
            <div style={s.card}>
                <p style={s.meta}>Letzte Aktualisierung: August 2026 · Betreiber: hundekuchenlive</p>

                <Section title="1. Verantwortlicher">
                    <b>hundekuchenlive</b><br />
                    Kontakt: <a href="https://discord.gg/WfTbuyhXcJ" style={s.link}>hundekuchenlive Community</a>
                </Section>

                <Section title="2. Welche Daten werden verarbeitet?">
                    <SubSection title="2.1 Server-Konfigurationsdaten">
                        <Table rows={[
                            ['Server-ID (Guild ID)', 'Zuordnung der Einstellungen'],
                            ['Kanal-IDs', 'Willkommens-, Feedback-, Log-Kanäle'],
                            ['Rollen-IDs', 'Rollen-Vergabe System'],
                            ['Kategorie-IDs', 'Ticket-Kategorien'],
                            ['Konfigurationseinstellungen', 'Sprache, aktive Module'],
                            ['Verbotene Wörter', 'Auto-Moderation'],
                            ['Custom Commands', 'Benutzerdefinierte Befehle'],
                        ]} />
                    </SubSection>
                    <SubSection title="2.2 Ticket-Daten">
                        <Table rows={[
                            ['Discord Kanal-ID des Tickets', 'Verwaltung offener Tickets'],
                            ['Discord User-ID des Erstellers', 'Verhinderung doppelter Tickets'],
                            ['Erstellungszeitpunkt', 'Nachvollziehbarkeit'],
                        ]} />
                        Der Inhalt von Ticket-Gesprächen wird <b>nicht</b> gespeichert.
                    </SubSection>
                    <SubSection title="2.3 Feedback-Daten">
                        <Table rows={[
                            ['Feedback-Text', 'Weiterleitung an das Server-Team'],
                            ['Kategorie', 'Sortierung'],
                            ['Discord Username (nicht-anonym)', 'Identifikation des Absenders'],
                            ['Zeitstempel', 'Nachvollziehbarkeit'],
                        ]} />
                        Bei <b>anonymem Feedback</b> wird kein Username gespeichert.
                    </SubSection>
                    <SubSection title="2.4 Temporäre Sitzungsdaten (Bot)">
                        Während der Nutzung des Feedback-Formulars werden temporäre Daten im Arbeitsspeicher gehalten und nach Abschluss automatisch gelöscht.
                    </SubSection>
                    <SubSection title="2.5 Moderationsaktionen">
                        Kick, Ban und Clear werden in der Bot-Konsole protokolliert (Discord Tag, Moderator, Grund, Zeitstempel). Diese Logs werden nicht dauerhaft gespeichert.
                    </SubSection>
                    <SubSection title="2.6 Dashboard-Sitzungsdaten">
                        Bei der Anmeldung am Web-Dashboard (<a href="https://bot.hundekuchenlive.de" style={s.link}>bot.hundekuchenlive.de</a>) via Discord OAuth2 werden folgende Daten verarbeitet:
                        <Table rows={[
                            ['Discord User-ID, Username, Avatar', 'Anzeige im Dashboard'],
                            ['E-Mail-Adresse', 'OAuth2 Identifikation'],
                            ['Server-Mitgliedschaften', 'Anzeige verwaltbarer Server'],
                            ['Session-Cookie', 'Authentifizierung (24 Stunden)'],
                        ]} />
                        Diese Daten werden ausschließlich im serverseitigen Session-Speicher gehalten und <b>nicht</b> dauerhaft gespeichert. Nach 24 Stunden oder beim Abmelden wird die Session automatisch gelöscht.
                    </SubSection>
                </Section>

                <Section title="3. Wo werden die Daten gespeichert?">
                    Alle dauerhaft gespeicherten Daten werden in einer JSON-Datei (<code style={s.code}>guildSettings.json</code>) auf dem Bot-Server gespeichert. Der Server befindet sich in der Europäischen Union. Der Quellcode ist in einem öffentlichen GitHub-Repository verfügbar. Es werden keine Daten bei Drittanbietern gespeichert.
                </Section>

                <Section title="4. Rechtsgrundlage der Verarbeitung">
                    <ul style={s.list}>
                        <li><b>Art. 6 Abs. 1 lit. b DSGVO</b> — Verarbeitung zur Vertragserfüllung (Bereitstellung der Bot-Funktionen)</li>
                        <li><b>Art. 6 Abs. 1 lit. f DSGVO</b> — Berechtigtes Interesse am ordnungsgemäßen Betrieb</li>
                    </ul>
                </Section>

                <Section title="5. Datenweitergabe an Dritte">
                    Daten werden <b>nicht</b> an Dritte weitergegeben, verkauft oder vermietet. Ausnahme: gesetzliche Verpflichtung. Die Discord-Plattform verarbeitet Daten gemäß ihrer eigenen <a href="https://discord.com/privacy" style={s.link}>Datenschutzrichtlinie</a>.
                </Section>

                <Section title="6. Speicherdauer">
                    <Table rows={[
                        ['Server-Konfiguration', 'Bis zur Entfernung des Bots vom Server'],
                        ['Ticket-Daten', 'Bis das Ticket geschlossen wird'],
                        ['Dashboard Session', '24 Stunden oder bis zum Abmelden'],
                        ['Temporäre Sitzungsdaten', 'Bis zum Abschluss des jeweiligen Vorgangs'],
                    ]} />
                </Section>

                <Section title="7. Deine Rechte (DSGVO)">
                    <ul style={s.list}>
                        <li><b>Art. 15</b> — Auskunftsrecht</li>
                        <li><b>Art. 16</b> — Berichtigungsrecht</li>
                        <li><b>Art. 17</b> — Löschungsrecht</li>
                        <li><b>Art. 18</b> — Einschränkungsrecht</li>
                        <li><b>Art. 21</b> — Widerspruchsrecht</li>
                    </ul>
                    Kontakt: <a href="https://discord.gg/WfTbuyhXcJ" style={s.link}>hundekuchenlive Community</a>
                </Section>

                <Section title="8. Datensicherheit">
                    <ul style={s.list}>
                        <li>Der Bot-Server ist durch Zugangsdaten gesichert</li>
                        <li>Sensible Daten (Token, API-Keys) werden in Umgebungsvariablen gespeichert</li>
                        <li>Dashboard-Kommunikation erfolgt verschlüsselt über HTTPS</li>
                    </ul>
                </Section>

                <Section title="9. Minderjährige">
                    Der Bot richtet sich nicht an Kinder unter 13 Jahren. Gemäß Discord-Nutzungsbedingungen müssen alle Nutzer mindestens 13 Jahre alt sein.
                </Section>

                <Section title="10. Änderungen dieser Datenschutzerklärung">
                    Wir behalten uns vor, diese Datenschutzerklärung bei Änderungen der Bot-Funktionen oder rechtlichen Anforderungen anzupassen.
                </Section>

                <Section title="11. Beschwerderecht">
                    Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. In Deutschland ist dies der jeweilige Landesdatenschutzbeauftragte.
                </Section>

                <Section title="12. Kontakt">
                    <a href="https://discord.hundekuchenlive.de/" style={s.link}>hundekuchenlive Community</a>
                </Section>
            </div>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--primary-2)', marginBottom: '0.5rem' }}>{title}</h2>
            <div style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.7' }}>{children}</div>
        </div>
    );
}

function SubSection({ title, children }) {
    return (
        <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--text)', marginBottom: '0.4rem' }}>{title}</h3>
            {children}
        </div>
    );
}

function Table({ rows }) {
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0.5rem 0', fontSize: '0.85rem' }}>
            <thead>
                <tr>
                    <th style={th}>Datenkategorie</th>
                    <th style={th}>Zweck</th>
                </tr>
            </thead>
            <tbody>
                {rows.map(([a, b], i) => (
                    <tr key={i}>
                        <td style={td}>{a}</td>
                        <td style={td}>{b}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

const th = { padding: '6px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--stroke)', textAlign: 'left', color: 'var(--text)', fontWeight: '700' };
const td = { padding: '6px 10px', border: '1px solid var(--stroke)', color: 'var(--muted)', verticalAlign: 'top' };

const s = {
    page: { minHeight: '100vh', padding: '2rem', maxWidth: '860px', margin: '0 auto' },
    header: { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--stroke)' },
    back: { padding: '8px 14px', background: 'var(--panel)', border: '1px solid var(--stroke)', borderRadius: 'var(--radius-sm)', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.875rem' },
    title: { fontSize: '1.4rem', fontWeight: '800', color: 'var(--text)' },
    card: { background: 'var(--panel)', borderRadius: 'var(--radius)', padding: '2rem', border: '1px solid var(--stroke)', boxShadow: '0 18px 40px var(--shadow)' },
    meta: { fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--stroke)' },
    list: { paddingLeft: '1.25rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
    link: { color: 'var(--primary-2)', textDecoration: 'underline' },
    code: { background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.85rem' },
};
