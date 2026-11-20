import { loadEnvConfig } from '@next/env';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';

// Standalone Node scripts do not automatically load Next.js environment files.
// Load .env.local (and the other supported .env files) before reading DATABASE_URL.
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is missing. Add it to .env.local in the project root.');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require', max: 1 });
try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
  console.log('SplitMate database schema created successfully.');
} catch (error) {
  console.error('Database setup failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
