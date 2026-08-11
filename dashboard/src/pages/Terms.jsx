import { useNavigate } from 'react-router-dom';

export default function Terms() {
    const navigate = useNavigate();
    return (
        <div style={s.page}>
            <div style={s.header}>
                <button style={s.back} onClick={() => navigate(-1)}>← Zurück</button>
                <span style={s.title}>📋 Nutzungsbedingungen</span>
            </div>
            <div style={s.card}>
                <p style={s.meta}>Letzte Aktualisierung: Juli 2026 · Betreiber: hundekuchenlive</p>

                <Section title="1. Geltungsbereich">
                    Diese Nutzungsbedingungen gelten für die Nutzung des Discord-Bots <b>Hundehütte</b>, entwickelt und betrieben von <b>hundekuchenlive</b>. Durch die Einladung des Bots auf einen Discord-Server oder die Nutzung seiner Funktionen stimmst du diesen Nutzungsbedingungen zu.
                </Section>

                <Section title="2. Beschreibung des Dienstes">
                    Der Hundehütte Bot bietet folgende Funktionen:
                    <ul style={s.list}>
                        <li>Willkommensnachrichten — Automatische Begrüßung neuer Servermitglieder</li>
                        <li>Rollen-Vergabe — Automatische Zuweisung von Rollen via Buttons</li>
                        <li>Ticket-System — Erstellung privater Support-Kanäle</li>
                        <li>Feedback-System — Übermittlung von Feedback an das Server-Team</li>
                        <li>Automatische Moderation — Filterung von Nachrichten nach konfigurierten Regeln</li>
                        <li>Ankündigungen — Veröffentlichung formatierter Ankündigungen</li>
                        <li>Moderationsbefehle — Kick, Ban und Nachrichtenverwaltung</li>
                        <li>Custom Commands — Benutzerdefinierte Slash-Befehle pro Server</li>
                        <li>Web-Dashboard — Serverkonfiguration über bot.hundekuchenlive.de</li>
                        <li>Mehrsprachigkeit — Deutsch und Englisch</li>
                    </ul>
                </Section>

                <Section title="3. Voraussetzungen zur Nutzung">
                    <ul style={s.list}>
                        <li>Du musst die <a href="https://discord.com/terms" style={s.link}>Discord Nutzungsbedingungen</a> einhalten.</li>
                        <li>Du musst mindestens 13 Jahre alt sein (gemäß Discord-Richtlinien).</li>
                        <li>Server-Administratoren sind verantwortlich für die regelkonforme Konfiguration des Bots.</li>
                    </ul>
                </Section>

                <Section title="4. Erlaubte Nutzung">
                    Der Bot darf ausschließlich genutzt werden für:
                    <ul style={s.list}>
                        <li>Verwaltung und Organisation von Discord-Servern</li>
                        <li>Community-Management und Mitgliederkommunikation</li>
                        <li>Moderationsaufgaben im Rahmen der Discord-Richtlinien</li>
                    </ul>
                </Section>

                <Section title="5. Verbotene Nutzung">
                    Es ist ausdrücklich untersagt, den Bot zu nutzen für:
                    <ul style={s.list}>
                        <li>Illegale Aktivitäten jeglicher Art</li>
                        <li>Belästigung, Bedrohung oder Diskriminierung von Nutzern</li>
                        <li>Spam oder automatisierte Massenaktionen</li>
                        <li>Umgehung von Discord-Sicherheitsmechanismen</li>
                        <li>Verbreitung von Malware oder schädlichen Inhalten</li>
                        <li>Verletzung von Urheberrechten oder geistigen Eigentumsrechten</li>
                    </ul>
                </Section>

                <Section title="6. Verfügbarkeit">
                    Wir bemühen uns um eine hohe Verfügbarkeit des Bots, können jedoch keine ununterbrochene Verfügbarkeit garantieren. Wartungsarbeiten, technische Störungen oder externe Einflüsse können die Verfügbarkeit vorübergehend einschränken. Ein Rechtsanspruch auf Verfügbarkeit besteht nicht.
                </Section>

                <Section title="7. Haftungsbeschränkung">
                    Der Betreiber haftet nicht für Schäden durch Fehlfunktionen des Bots, Datenverluste durch technische Probleme, Handlungen von Server-Administratoren oder Nutzern sowie Ausfälle der Discord-Plattform.
                </Section>

                <Section title="8. Änderungen der Nutzungsbedingungen">
                    Wir behalten uns vor, diese Nutzungsbedingungen jederzeit zu ändern. Wesentliche Änderungen werden über den offiziellen hundekuchenlive Discord-Server kommuniziert. Die fortgesetzte Nutzung gilt als Zustimmung.
                </Section>

                <Section title="9. Kündigung / Entfernung">
                    Server-Administratoren können den Bot jederzeit entfernen. Der Betreiber behält sich vor, den Bot bei Verstößen ohne Vorankündigung vom jeweiligen Server zu entfernen.
                </Section>

                <Section title="10. Geltendes Recht">
                    Es gilt das Recht der Bundesrepublik Deutschland.
                </Section>

                <Section title="11. Kontakt">
                    Bei Fragen wende dich über den offiziellen Discord-Server an das Team:{' '}
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

const s = {
    page: { minHeight: '100vh', padding: '2rem', maxWidth: '860px', margin: '0 auto' },
    header: { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--stroke)' },
    back: { padding: '8px 14px', background: 'var(--panel)', border: '1px solid var(--stroke)', borderRadius: 'var(--radius-sm)', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.875rem' },
    title: { fontSize: '1.4rem', fontWeight: '800', color: 'var(--text)' },
    card: { background: 'var(--panel)', borderRadius: 'var(--radius)', padding: '2rem', border: '1px solid var(--stroke)', boxShadow: '0 18px 40px var(--shadow)' },
    meta: { fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--stroke)' },
    list: { paddingLeft: '1.25rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
    link: { color: 'var(--primary-2)', textDecoration: 'underline' },
};
