import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import discordLogo from '../assets/Discord-Symbol-Black.svg';

export default function Login() {
    const navigate = useNavigate();
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        axios.get('/auth/me').then(() => navigate('/dashboard')).catch(() => setChecking(false));
    }, []);

    if (checking) return null;

    return (
        <div style={s.page}>
            <div style={s.card}>
                <img src="https://hundekuchenlive.de/assets/img/favicon.png" style={s.logo} alt="logo" />
                <h1 style={s.title}>Hundehütte Dashboard</h1>
                <p style={s.sub}>Verwalte deinen Discord-Server direkt im Browser.</p>
                <a href="/auth/login" style={s.btn}>
                    <img src={discordLogo} width="20" height="20" alt="Discord" />
                    Mit Discord anmelden
                </a>
            </div>
            <footer style={{ position: 'fixed', bottom: '1rem', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                <a href="/terms" style={{ color: 'var(--muted)' }}>Nutzungsbedingungen</a>
                <a href="/privacy" style={{ color: 'var(--muted)' }}>Datenschutz</a>
            </footer>
        </div>
    );
}

const s = {
    page: { width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    card: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', background: 'var(--panel)', border: '1px solid var(--stroke)', borderRadius: 'var(--radius)', padding: '3rem 4rem', backdropFilter: 'blur(12px)', boxShadow: '0 18px 40px var(--shadow)', textAlign: 'center', maxWidth: '420px', width: '90%' },
    logo: { width: '56px', height: '56px', borderRadius: '12px', border: '1px solid var(--stroke)' },
    title: { fontSize: '1.8rem', fontWeight: '800', color: 'var(--text)', letterSpacing: '-0.3px' },
    sub: { color: 'var(--muted)', fontSize: '0.95rem', maxWidth: '280px' },
    btn: { marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 22px', background: 'linear-gradient(135deg, rgba(74,163,255,0.95), rgba(124,198,255,0.85))', border: '1px solid rgba(124,198,255,0.40)', color: '#07101c', borderRadius: '14px', fontWeight: '800', fontSize: '0.95rem' },
};
