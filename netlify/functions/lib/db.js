const { Pool } = require('pg');
let pool;
function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada no Netlify.');
  if (!pool) pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });
  return pool;
}
module.exports = { db };
