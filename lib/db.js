// lib/db.js — Neon Postgres singleton
const { neon } = require('@neondatabase/serverless');

let _db = null;

function getDb() {
  if (!_db) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    _db = neon(process.env.DATABASE_URL);
  }
  return _db;
}

async function ensureSchema() {
  const db = getDb();
  await db`
    CREATE TABLE IF NOT EXISTS scores (
      wallet      TEXT PRIMARY KEY,
      total_score INTEGER NOT NULL DEFAULT 0,
      breakdown   JSONB,
      scored_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS bonuses (
      id         SERIAL PRIMARY KEY,
      wallet     TEXT NOT NULL,
      pts        INTEGER NOT NULL DEFAULT 0,
      reason     TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id         SERIAL PRIMARY KEY,
      wallet     TEXT NOT NULL UNIQUE,
      tweet_url  TEXT,
      slot       INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

module.exports = { getDb, ensureSchema };
