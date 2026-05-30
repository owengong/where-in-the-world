import 'dotenv/config';
import postgres from 'postgres';

// Wipe all data (keeps the schema). Handy for re-seeding a clean state.
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`TRUNCATE person_place, people, places, raw_entries RESTART IDENTITY CASCADE`;
  await sql.end();
  console.log('Reset: all tables truncated.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Reset failed:', e);
  process.exit(1);
});
