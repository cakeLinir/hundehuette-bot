require('dotenv').config();

const { createSpedvV1Client } = require('../src/utils/speedBillingSpedvV1');

(async () => {
    const client = createSpedvV1Client();
    const tasks = await client.fetchTasks();

    console.log('Aufträge gesamt:', tasks.length);

    for (const [index, task] of tasks.slice(0, 3).entries()) {
        console.log(`\nAuftrag ${index + 1}`);
        console.log('Felder:', Object.keys(task));

        const dateFields = Object.entries(task)
            .filter(([key]) => /date|time|end|start|complete|finish|settle/i.test(key));

        console.log('Mögliche Datumsfelder:', dateFields);
        console.log('Statusfeld:', task.state);
    }
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

