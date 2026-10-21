// lib/db.js — SQLite singleton using better-sqlite3
// Install: npm install better-sqlite3
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'spread.db')

// Ensure data directory exists
const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

let _db = null

export function getDB() {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')   // faster concurrent reads
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  return _db
}

function initSchema(db) {
  db.exec(`
    -- Users (replaces supabase.auth)
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    UNIQUE NOT NULL,
      handle      TEXT    UNIQUE NOT NULL,
      password    TEXT    NOT NULL,        -- bcrypt hash
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- Projects
    CREATE TABLE IF NOT EXISTS projects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      description   TEXT,
      logo_url      TEXT,
      chain         TEXT    DEFAULT 'XRPL',
      status        TEXT    DEFAULT 'active',
      pool_xrp      REAL    DEFAULT 0,
      pool_tokens   TEXT,
      pool_nfts     INTEGER DEFAULT 0,
      creator_count INTEGER DEFAULT 0,
      end_date      TEXT,
      created_at    TEXT    DEFAULT (datetime('now'))
    );

    -- Creators (leaderboard entries per project)
    CREATE TABLE IF NOT EXISTS creators (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER REFERENCES projects(id),
      handle        TEXT    NOT NULL,
      email         TEXT,
      total_points  INTEGER DEFAULT 0,
      xrpl_wallet   TEXT,
      created_at    TEXT    DEFAULT (datetime('now')),
      UNIQUE(project_id, handle)
    );

    -- Submissions
    CREATE TABLE IF NOT EXISTS submissions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     INTEGER REFERENCES projects(id),
      handle         TEXT    NOT NULL,
      tweet_url      TEXT,
      image_url      TEXT,
      status         TEXT    DEFAULT 'pending',
      points_awarded INTEGER DEFAULT 0,
      tier           TEXT,
      likes          INTEGER DEFAULT 0,
      retweets       INTEGER DEFAULT 0,
      replies        INTEGER DEFAULT 0,
      bookmarks      INTEGER DEFAULT 0,
      impressions    INTEGER DEFAULT 0,
      created_at     TEXT    DEFAULT (datetime('now'))
    );

    -- Collaborations
    CREATE TABLE IF NOT EXISTS collaborations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project     TEXT,
      contact     TEXT,
      email       TEXT,
      message     TEXT,
      status      TEXT    DEFAULT 'pending',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- Leaderboard waitlist
    CREATE TABLE IF NOT EXISTS leaderboard_waitlist (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project     TEXT,
      contact     TEXT,
      email       TEXT,
      message     TEXT,
      status      TEXT    DEFAULT 'pending',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- Project messages / chat
    CREATE TABLE IF NOT EXISTS project_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER REFERENCES projects(id),
      sender      TEXT,
      message     TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
  `)
}
