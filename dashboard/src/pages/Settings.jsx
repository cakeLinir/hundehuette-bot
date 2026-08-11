import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const s = {
    page: { minHeight: '100vh', padding: '2rem', maxWidth: '1200px', margin: '0 auto' },
    header: { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--stroke)' },
    back: { padding: '8px 14px', background: 'var(--panel)', border: '1px solid var(--stroke)', borderRadius: 'var(--radius-sm)', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.875rem' },
    title: { fontSize: '1.4rem', fontWeight: '800', color: 'var(--text)' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '1rem' },
    card: { background: 'var(--panel)', borderRadius: 'var(--radius)', padding: '1.5rem', border: '1px solid var(--stroke)', boxShadow: '0 18px 40px var(--shadow)' },
    cardTitle: { fontSize: '0.95rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' },
    label: { display: 'block', fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.3rem', marginTop: '0.9rem' },
    select: { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--stroke)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: '0.875rem', boxSizing: 'border-box' },
    input: { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--stroke)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: '0.875rem', boxSizing: 'border-box' },
    toggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid var(--stroke)' },
    toggleLabel: { fontSize: '0.875rem', color: 'var(--text)' },
    toggleBtn: (on) => ({ width: '44px', height: '24px', borderRadius: '12px', background: on ? 'linear-gradient(135deg, rgba(74,163,255,0.95), rgba(124,198,255,0.85))' : 'rgba(255,255,255,0.08)', border: '1px solid var(--stroke)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }),
    toggleDot: (on) => ({ position: 'absolute', top: '3px', left: on ? '23px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: on ? '#07101c' : 'rgba(255,255,255,0.5)', transition: 'left 0.2s' }),
    tag: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(74,163,255,0.12)', border: '1px solid rgba(74,163,255,0.25)', borderRadius: '8px', padding: '3px 8px', fontSize: '0.8rem', margin: '2px', color: 'var(--primary-2)' },
    tagRemove: { cursor: 'pointer', color: 'var(--muted)', fontWeight: 'bold', fontSize: '0.9rem' },
    wordInput: { display: 'flex', gap: '0.5rem', marginTop: '0.75rem' },
    addBtn: { padding: '9px 14px', background: 'linear-gradient(135deg, rgba(74,163,255,0.95), rgba(124,198,255,0.85))', color: '#07101c', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: '800', fontSize: '0.875rem' },
    saveBar: { position: 'fixed', bottom: '1.5rem', right: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' },
    saveBtn: { padding: '10px 24px', background: 'linear-gradient(135deg, rgba(74,163,255,0.95), rgba(124,198,255,0.85))', color: '#07101c', border: '1px solid rgba(124,198,255,0.40)', borderRadius: '14px', fontSize: '0.95rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 8px 24px rgba(74,163,255,0.25)' },
    savedMsg: { color: '#53e89b', fontSize: '0.875rem' },
};

function Toggle({ value, onChange }) {
    return (
        <button style={s.toggleBtn(value)} onClick={() => onChange(!value)}>
            <div style={s.toggleDot(value)} />
        </button>
    );
}

function ChannelSelect({ channels, value, onChange, type = 0 }) {
    const filtered = type === 4 ? channels.filter(c => c.type === 4) : channels.filter(c => c.type === 0);
    return (
        <select style={s.select} value={value || ''} onChange={e => onChange(e.target.value || null)}>
            <option value="">— Nicht gesetzt —</option>
            {filtered.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
    );
}

function RoleSelect({ roles, value, onChange }) {
    return (
        <select style={s.select} value={value || ''} onChange={e => onChange(e.target.value || null)}>
            <option value="">— Keine Rolle —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
    );
}

export default function Settings() {
    const { guildId } = useParams();
    const navigate = useNavigate();
    const [settings, setSettings] = useState(null);
    const [channels, setChannels] = useState([]);
    const [roles, setRoles] = useState([]);
    const [saved, setSaved] = useState(false);
    const [newWord, setNewWord] = useState('');
    const [modules, setModules] = useState(null);
    const [newRollenBtn, setNewRollenBtn] = useState({ roleId: '', label: '', emoji: '' });
    const [newCmd, setNewCmd] = useState({ name: '', titel: '', inhalt: '', farbe: 'info' });



    useEffect(() => {
        Promise.all([
            axios.get(`/api/guild/${guildId}/settings`),
            axios.get(`/api/guild/${guildId}/channels`),
            axios.get(`/api/guild/${guildId}/roles`),
            axios.get(`/api/guild/${guildId}/modules`),
        ])
            .then(([s, c, r, m]) => { setSettings(s.data); setChannels(c.data); setRoles(r.data); setModules(m.data); })
            .catch(() => navigate('/'));
    }, [guildId]);

    const set = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));
    const setAutomod = (key, value) => setSettings(prev => ({
        ...prev, automod: { ...(prev.automod ?? {}), [key]: value }
    }));

    const addWord = () => {
        const w = newWord.trim().toLowerCase();
        if (!w) return;
        const words = settings.automod?.bannedWords ?? [];
        if (!words.includes(w)) setAutomod('bannedWords', [...words, w]);
        setNewWord('');
    };

    const toggleModule = (key, value) => {
        setModules(prev => ({ ...prev, [key]: value }));
        axios.post(`/api/guild/${guildId}/modules`, { moduleName: key, enabled: value });
    };

    const removeWord = (w) => setAutomod('bannedWords', (settings.automod?.bannedWords ?? []).filter(x => x !== w));

    const save = () => {
        axios.post(`/api/guild/${guildId}/settings`, settings)
            .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2500); });
    };

    if (!settings) return <div style={{ color: 'var(--muted)', padding: '2rem' }}>Lade...</div>;

    const automod = settings.automod ?? {};


    return (
        <div style={s.page}>
            <div style={s.header}>
                <button style={s.back} onClick={() => navigate('/dashboard')}>← Zurück</button>
                <span style={s.title}>⚙️ Server Einstellungen</span>
            </div>

            <div style={s.grid}>
                {modules && (
                    <div style={s.card}>
                        <div style={s.cardTitle}>🧩 Module</div>
                        {[
                            { key: 'welcome', label: '👋 Willkommen', desc: 'Begrüßt neue Mitglieder' },
                            { key: 'roles', label: '🎮 Rollen', desc: 'Rollen-Vergabe via Buttons' },
                            { key: 'tickets', label: '🎫 Tickets', desc: 'Support Ticket System' },
                            { key: 'feedback', label: '📬 Feedback', desc: 'Feedback System' },
                            { key: 'automod', label: '🛡️ Auto Mod', desc: 'Nachrichten-Moderation' },
                            { key: 'announcements', label: '📢 Ankündigungen', desc: 'Community Ankündigungen' },
                            { key: 'moderation', label: '🔨 Moderation', desc: 'Kick, Ban & Clear' },
                        ].map(({ key, label, desc }) => (
                            <div key={key} style={s.toggle}>
                                <div>
                                    <div style={s.toggleLabel}>{label}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{desc}</div>
                                </div>
                                <Toggle value={modules[key] ?? false} onChange={v => toggleModule(key, v)} />
                            </div>
                        ))}
                    </div>
                )}

                <div style={s.card}>
                    <div style={s.cardTitle}>📢 Kanäle</div>
                    <label style={s.label}>Willkommens-Kanal</label>
                    <ChannelSelect channels={channels} value={settings.welcomeChannelId} onChange={v => set('welcomeChannelId', v)} />
                    <label style={s.label}>Feedback-Kanal</label>
                    <ChannelSelect channels={channels} value={settings.feedbackChannelId} onChange={v => set('feedbackChannelId', v)} />
                    <label style={s.label}>Transcript-Kanal</label>
                    <ChannelSelect channels={channels} value={settings.transcriptChannelId} onChange={v => set('transcriptChannelId', v)} />
                    <label style={s.label}>Ticket-Kategorie</label>
                    <ChannelSelect channels={channels} value={settings.ticketCategoryId} onChange={v => set('ticketCategoryId', v)} type={4} />
                </div>

                <div style={s.card}>
                    <div style={s.cardTitle}>🟣 Twitch</div>
                    <label style={s.label}>Twitch Benutzername</label>
                    <input style={s.input} placeholder="z.B. hundekuchenlive" value={settings.twitchChannel || ''} onChange={e => set('twitchChannel', e.target.value)} />
                    <label style={s.label}>Benachrichtigungs-Kanal</label>
                    <ChannelSelect channels={channels} value={settings.twitchNotifyChannelId} onChange={v => set('twitchNotifyChannelId', v)} />
                    <label style={s.label}>Ping-Rolle (optional)</label>
                    <RoleSelect roles={roles} value={settings.twitchNotifyRoleId} onChange={v => set('twitchNotifyRoleId', v)} />
                </div>

                <div style={s.card}>
                    <div style={s.cardTitle}>🛡️ Auto Moderation</div>
                    <div style={s.toggle}>
                        <span style={s.toggleLabel}>Aktiviert</span>
                        <Toggle value={automod.enabled ?? false} onChange={v => setAutomod('enabled', v)} />
                    </div>
                    <div style={s.toggle}>
                        <span style={s.toggleLabel}>Link-Filter</span>
                        <Toggle value={automod.linkFilter ?? false} onChange={v => setAutomod('linkFilter', v)} />
                    </div>
                    <div style={{ ...s.toggle, borderBottom: 'none' }}>
                        <span style={s.toggleLabel}>Spam-Filter</span>
                        <Toggle value={automod.spamFilter ?? false} onChange={v => setAutomod('spamFilter', v)} />
                    </div>
                    <label style={s.label}>Log-Kanal</label>
                    <ChannelSelect channels={channels} value={automod.logChannelId} onChange={v => setAutomod('logChannelId', v)} />
                    <label style={s.label}>Verbotene Wörter</label>
                    <div style={{ marginTop: '0.3rem' }}>
                        {(automod.bannedWords ?? []).map(w => (
                            <span key={w} style={s.tag}>
                                {w} <span style={s.tagRemove} onClick={() => removeWord(w)}>✕</span>
                            </span>
                        ))}
                    </div>
                    <div style={s.wordInput}>
                        <input style={{ ...s.input, marginTop: 0 }} placeholder="Wort hinzufügen..." value={newWord} onChange={e => setNewWord(e.target.value)} onKeyDown={e => e.key === 'Enter' && addWord()} />
                        <button style={s.addBtn} onClick={addWord}>+</button>
                    </div>
                </div>

                <div style={s.card}>
                    <div style={s.cardTitle}>🌐 Sprache</div>
                    <label style={s.label}>Bot-Sprache</label>
                    <select style={s.select} value={settings.language || 'de'} onChange={e => set('language', e.target.value)}>
                        <option value="de">🇩🇪 Deutsch</option>
                        <option value="en">🇬🇧 English</option>
                    </select>
                </div>

                <div style={s.card}>
                    <div style={s.cardTitle}>🎮 Rollen-Buttons</div>

                    {(settings.rollenButtons ?? []).length === 0 && (
                        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Noch keine Buttons konfiguriert.</p>
                    )}

                    {(settings.rollenButtons ?? []).map((btn, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--stroke)' }}>
                            <div>
                                <span style={{ fontSize: '0.875rem' }}>{btn.emoji ?? '▫️'} {btn.label}</span>
                                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                                    {roles.find(r => r.id === btn.roleId)?.name ?? btn.roleId}
                                </div>
                            </div>
                            <button
                                onClick={() => set('rollenButtons', settings.rollenButtons.filter((_, j) => j !== i))}
                                style={{ background: 'rgba(255,100,100,0.1)', border: '1px solid rgba(255,100,100,0.2)', color: '#ff7070', borderRadius: '8px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                                Entfernen
                            </button>
                        </div>
                    ))}

                    {/* Neuen Button hinzufügen */}
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={s.label}>Rolle</label>
                        <RoleSelect roles={roles} value={newRollenBtn.roleId} onChange={v => setNewRollenBtn(p => ({ ...p, roleId: v }))} />
                        <label style={s.label}>Label</label>
                        <input style={s.input} placeholder="z.B. GTA RP" value={newRollenBtn.label} onChange={e => setNewRollenBtn(p => ({ ...p, label: e.target.value }))} />
                        <label style={s.label}>Emoji (optional)</label>
                        <input style={s.input} placeholder="z.B. 🎮" value={newRollenBtn.emoji} onChange={e => setNewRollenBtn(p => ({ ...p, emoji: e.target.value }))} />
                        <button style={{ ...s.addBtn, marginTop: '0.5rem', width: '100%' }} onClick={() => {
                            if (!newRollenBtn.roleId || !newRollenBtn.label) return;
                            set('rollenButtons', [...(settings.rollenButtons ?? []), { ...newRollenBtn }]);
                            setNewRollenBtn({ roleId: '', label: '', emoji: '' });
                        }}>
                            + Button hinzufügen
                        </button>
                    </div>
                </div>
                {/* Verify */}
                <div style={s.card}>
                    <div style={s.cardTitle}>🔐 Verifizierung</div>

                    <div style={{ ...s.toggle, borderBottom: 'none' }}>
                        <span style={s.toggleLabel}>Aktiviert</span>
                        <Toggle value={settings.verifyEnabled ?? false} onChange={v => set('verifyEnabled', v)} />
                    </div>

                    <label style={s.label}>Verify-Rolle</label>
                    <RoleSelect roles={roles} value={settings.verifyRoleId} onChange={v => set('verifyRoleId', v)} />

                    <label style={s.label}>Verify-Kanal</label>
                    <ChannelSelect channels={channels} value={settings.verifyChannelId} onChange={v => set('verifyChannelId', v)} />

                    <label style={s.label}>Log-Kanal (optional)</label>
                    <ChannelSelect channels={channels} value={settings.verifyLogChannelId} onChange={v => set('verifyLogChannelId', v)} />

                    <button
                        style={{ ...s.addBtn, marginTop: '1rem', width: '100%' }}
                        onClick={() => {
                            if (!settings.verifyChannelId) return alert('Bitte zuerst einen Verify-Kanal setzen und speichern.');
                            axios.post(`/api/guild/${guildId}/verify/post`)
                                .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2000); })
                                .catch(e => alert('Fehler: ' + e.response?.data?.error));
                        }}
                    >
                        📨 Verify-Nachricht posten
                    </button>
                </div>
                {/* Custom Commands */}
                <div style={s.card}>
                    <div style={s.cardTitle}>
                        ⚙️ Custom Commands
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: '400' }}>
                            {Object.keys(settings.customCommands ?? {}).length}/25
                        </span>
                    </div>

                    {Object.keys(settings.customCommands ?? {}).length === 0 && (
                        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Noch keine Commands erstellt.</p>
                    )}

                    {Object.entries(settings.customCommands ?? {}).map(([name, cmd]) => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--stroke)' }}>
                            <div>
                                <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>`{name}`</span>
                                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{cmd.titel}</div>
                            </div>
                            <button
                                onClick={() => {
                                    const updated = { ...settings.customCommands };
                                    delete updated[name];
                                    set('customCommands', updated);
                                }}
                                style={{ background: 'rgba(255,100,100,0.1)', border: '1px solid rgba(255,100,100,0.2)', color: '#ff7070', borderRadius: '8px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                                Löschen
                            </button>
                        </div>
                    ))}

                    {/* Neuen Command erstellen */}
                    {Object.keys(settings.customCommands ?? {}).length < 25 && (
                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={s.label}>Name</label>
                            <input style={s.input} placeholder="z.B. socials" value={newCmd.name} onChange={e => setNewCmd(p => ({ ...p, name: e.target.value.toLowerCase().replace(/\s+/g, '-') }))} />
                            <label style={s.label}>Titel</label>
                            <input style={s.input} placeholder="Embed-Titel" value={newCmd.titel} onChange={e => setNewCmd(p => ({ ...p, titel: e.target.value }))} />
                            <label style={s.label}>Inhalt</label>
                            <textarea style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} placeholder="Embed-Inhalt" value={newCmd.inhalt} onChange={e => setNewCmd(p => ({ ...p, inhalt: e.target.value }))} />
                            <label style={s.label}>Farbe</label>
                            <select style={s.select} value={newCmd.farbe} onChange={e => setNewCmd(p => ({ ...p, farbe: e.target.value }))}>
                                <option value="info">🔵 Blau</option>
                                <option value="success">🟢 Grün</option>
                                <option value="warning">🟡 Orange</option>
                                <option value="error">🔴 Rot</option>
                                <option value="default">⚫ Grau</option>
                            </select>
                            <button
                                style={{ ...s.addBtn, marginTop: '0.5rem', width: '100%' }}
                                onClick={() => {
                                    if (!newCmd.name || !newCmd.titel || !newCmd.inhalt) return;
                                    const updated = { ...(settings.customCommands ?? {}), [newCmd.name]: { titel: newCmd.titel, inhalt: newCmd.inhalt, farbe: newCmd.farbe } };
                                    set('customCommands', updated);
                                    setNewCmd({ name: '', titel: '', inhalt: '', farbe: 'info' });
                                }}
                            >
                                + Command erstellen
                            </button>
                        </div>
                    )}
                </div>



            </div>

            <div style={s.saveBar}>
                {saved && <span style={s.savedMsg}>✅ Gespeichert!</span>}
                <button style={s.saveBtn} onClick={save}>Speichern</button>
            </div>
        </div>
    );
}
