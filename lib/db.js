// Neon Postgres connection + schema bootstrap.
// Uses @neondatabase/serverless which speaks HTTP — no persistent TCP pool
// needed, perfect for serverless cold starts.

const { neon } = require('@neondatabase/serverless');

let sql;
function getDb() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// Create the waitlist table if it doesn't exist.
// Safe to call on every cold start — IF NOT EXISTS means it's a no-op after first run.
async function ensureSchema() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id          SERIAL PRIMARY KEY,
      x_user_id   TEXT NOT NULL UNIQUE,
      x_handle    TEXT NOT NULL,
      wallet      TEXT NOT NULL,
      followed    BOOLEAN NOT NULL DEFAULT FALSE,
      notifications BOOLEAN NOT NULL DEFAULT FALSE,
      liked       BOOLEAN NOT NULL DEFAULT FALSE,
      reposted    BOOLEAN NOT NULL DEFAULT FALSE,
      comment_era TEXT CHECK (comment_era IN ('I','II','III','IV')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

module.exports = { getDb, ensureSchema };
