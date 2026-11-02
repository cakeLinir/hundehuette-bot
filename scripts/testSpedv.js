require('dotenv').config();
const { fetchUsers, fetchDiscordUid } = require('../src/utils/spedvApi');

(async () => {
  const users = await fetchUsers();
  console.log(`Fahrer gefunden: ${users.length}`);
  for (const u of users) {
    console.log(`- ${u.userName} | Rang: ${u.rank.name} | inSped=${u.inSped} | SpedID=${u.spedition.id}`);
  }

  if (users[0]) {
    const uid = await fetchDiscordUid(users[0].id);
    console.log(`Discord-ID für ${users[0].userName}: ${uid ? 'vorhanden' : 'NICHT vorhanden'}`);
  }
})().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
