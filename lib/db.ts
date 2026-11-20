import postgres from 'postgres';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required. Add it to .env.local or configure it in the deployment environment.');
export const sql = postgres(url, {
  ssl: 'require', max: 10, idle_timeout: 20, connect_timeout: 15,
  transform: { undefined: null }
});
