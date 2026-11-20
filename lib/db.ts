import postgres from 'postgres';
const url = process.env.DATABASE_URL;
if (!url) console.warn('DATABASE_URL is not configured. Add it to .env.local.');
export const sql = postgres(url || 'postgres://invalid:invalid@localhost/invalid', {
  ssl: 'require', max: 10, idle_timeout: 20, connect_timeout: 15,
  transform: { undefined: null }
});
