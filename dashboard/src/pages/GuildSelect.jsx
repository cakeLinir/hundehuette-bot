import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function GuildSelect() {
    const [guilds, setGuilds] = useState([]);
    const [user, setUser] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        Promise.all([axios.get('/api/guilds'), axios.get('/auth/me')])
            .then(([g, u]) => { setGuilds(g.data); setUser(u.data.user); })
            .catch(() => navigate('/'));
    }, []);

    return (
        <div style={s.page}>
            <header style={s.header}>
                <div style={s.brand}>
                    <img src="https://hundekuchenlive.de/assets/img/favicon.png" style={s.brandImg} alt="" />
                    <span style={s.brandName}>hundekuchenlive</span>
                </div>
                {user && (
                    <div style={s.userArea}>
                        <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} style={s.avatar} alt="" />
                        <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{user.username}</span>
                        <a href="/auth/logout" style={s.logoutBtn}>Abmelden</a>
                        <a href="/terms" style={s.logoutBtn}>Nutzungsbedingungen</a>
                        <a href="/privacy" style={s.logoutBtn}>Datenschutz</a>
                    </div>
                )}
            </header>

            <div style={s.content}>
                <h2 style={s.title}>Server auswählen</h2>
                <p className="muted" style={{ marginBottom: '2rem', textAlign: 'center' }}>Wähle einen Server den du verwalten möchtest.</p>

                <div style={s.grid}>
                    {guilds.map(g => (
                        <div key={g.id} style={s.card} onClick={() => navigate(`/dashboard/${g.id}`)}>
                            {g.icon
                                ? <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`} style={s.icon} alt="" />
                                : <div style={s.iconFallback}>{g.name[0]}</div>
                            }
                            <span style={s.guildName}>{g.name}</span>
                            <span style={s.arrow}>Verwalten →</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

const s = {
    page: { minHeight: '100vh' },
    header: { position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(10px)', background: 'rgba(11,15,22,0.78)', borderBottom: '1px solid var(--stroke)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    brand: { display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '800' },
    brandImg: { width: '38px', height: '38px', borderRadius: '12px', border: '1px solid var(--stroke)', background: 'var(--panel)' },
    brandName: { fontSize: '1rem', letterSpacing: '0.3px' },
    userArea: { display: 'flex', alignItems: 'center', gap: '12px' },
    avatar: { width: '32px', height: '32px', borderRadius: '50%' },
    logoutBtn: { padding: '7px 14px', background: 'var(--panel)', border: '1px solid var(--stroke)', borderRadius: '12px', color: 'var(--muted)', fontSize: '0.85rem', cursor: 'pointer' },
    content: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem 2rem' },
    title: { fontSize: '1.8rem', fontWeight: '800', marginBottom: '0.5rem', textAlign: 'center' },
    grid: { display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', maxWidth: '860px' },
    card: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '1.5rem 1.25rem', background: 'var(--panel)', border: '1px solid var(--stroke)', borderRadius: 'var(--radius)', cursor: 'pointer', width: '160px', boxShadow: '0 18px 40px var(--shadow)', transition: 'border-color 0.2s, background 0.2s' },
    icon: { width: '68px', height: '68px', borderRadius: '50%' },
    iconFallback: { width: '68px', height: '68px', borderRadius: '50%', background: 'linear-gradient(135deg, rgba(74,163,255,0.3), rgba(124,198,255,0.2))', border: '1px solid var(--stroke)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', fontWeight: '800' },
    guildName: { fontSize: '0.875rem', fontWeight: '700', textAlign: 'center', lineHeight: 1.3, color: 'var(--text)' },
    arrow: { fontSize: '0.75rem', color: 'var(--primary)' },
};
