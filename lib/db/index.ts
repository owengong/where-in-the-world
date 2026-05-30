import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

// Single Postgres client, reused across hot-reloads in dev so `next dev`
// doesn't exhaust connections. postgres.js connects lazily (on first query),
// so importing this without a DATABASE_URL is safe — handy for `next build`.
const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    '[db] DATABASE_URL is not set — queries will fail. Add a Neon connection string to .env',
  );
}

const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };

const client =
  globalForDb.__pg ??
  postgres(url ?? 'postgres://localhost:5432/where_in_the_world', {
    max: 1, // small pool: solo app + serverless. Use Neon's pooled URL in prod.
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__pg = client;

export const db = drizzle(client, { schema });
export { schema };
