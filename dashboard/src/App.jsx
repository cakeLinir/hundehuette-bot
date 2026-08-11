import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import GuildSelect from './pages/GuildSelect';
import Settings from './pages/Settings';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<GuildSelect />} />
        <Route path="/dashboard/:guildId" element={<Settings />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </BrowserRouter>
  );
}
