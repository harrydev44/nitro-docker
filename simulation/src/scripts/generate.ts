import 'dotenv/config';
import { ensureSimulationTables } from '../db-setup.js';
import { generateAllAgents } from '../agents/generator.js';
import { closePool } from '../db.js';

async function main() {
  console.log('=== Agent Generation Script ===');
  try {
    await ensureSimulationTables();
    await generateAllAgents();
    console.log('\nAgent generation complete!');
    console.log('Next step: run "npm run setup-world" to create rooms.');
  } catch (err) {
    console.error('Generation failed:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
