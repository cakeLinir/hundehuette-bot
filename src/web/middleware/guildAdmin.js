const ADMINISTRATOR = 0x8n;

/** Prüft anhand der Session-Serverliste, ob der Nutzer Admin oder Owner ist. */
function isGuildAdmin(guild) {
  if (!guild) return false;
  if (guild.owner === true) return true;
  try {
    return (BigInt(guild.permissions) & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

/** Schützt alle Routen mit :id. Nutzer muss Admin dieses Servers sein. */
function guildAdmin(req, res, next) {
  const guilds = req.session?.guilds;
  if (!Array.isArray(guilds)) return res.status(401).json({ error: 'Nicht eingeloggt' });

  const guild = guilds.find(g => g.id === req.params.id);
  if (!isGuildAdmin(guild)) {
    return res.status(403).json({ error: 'Kein Admin-Zugriff auf diesen Server' });
  }
  next();
}

module.exports = guildAdmin;
module.exports.isGuildAdmin = isGuildAdmin;
