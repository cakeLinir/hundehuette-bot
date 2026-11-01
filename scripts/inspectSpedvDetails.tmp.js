require('dotenv').config();

const { createSpedvV1Client } = require('../src/utils/speedBillingSpedvV1');

(async () => {
    const client = createSpedvV1Client();
    const tasks = await client.fetchTasks();

    for (const task of tasks.slice(0, 3)) {
        const details = await client.fetchTaskDetails(task.id);

        console.log(`\nAuftrag ${task.id}`);
        console.log('Detailfelder:', Object.keys(details));

        const dateFields = Object.entries(details)
            .filter(([key]) => /date|time|end|start|complete|finish|settle/i.test(key));

        console.log('Zeit-/Datumsfelder:', dateFields);

        if (details.spedition) {
            console.log('Spedition-Felder:', Object.keys(details.spedition));
        }

        if (details.user) {
            console.log('Benutzer-Felder:', Object.keys(details.user));
        }
    }
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
