const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
const defaultDbPath = path.join(dataDir, 'app.db');
const sentimentFile = path.join(dataDir, 'sentiment_snapshots.json');
const eventsFile = path.join(dataDir, 'gameplay_events.json');
const usersFile = path.join(dataDir, 'users.json');
let db = null;

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readJsonArray(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }
}

function getDbPathFromEnv() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw.trim()) return defaultDbPath;
  if (raw.startsWith('sqlite://./')) {
    const rel = raw.slice('sqlite://./'.length);
    return path.join(__dirname, '..', '..', rel);
  }
  if (raw.startsWith('sqlite:///')) {
    return raw.slice('sqlite:///'.length);
  }
  if (raw.startsWith('sqlite://')) {
    return raw.slice('sqlite://'.length);
  }
  return defaultDbPath;
}

function getDb() {
  if (!db) throw new Error('Storage is not initialized');
  return db;
}

function initializeStorage() {
  ensureDataDir();
  const dbPath = getDbPathFromEnv();
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sentiment_snapshots (
      id TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      label TEXT NOT NULL,
      contrarian_signal TEXT NOT NULL,
      news INTEGER NOT NULL,
      social INTEGER NOT NULL,
      volatility INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      source TEXT NOT NULL,
      source_error TEXT
    );
    CREATE TABLE IF NOT EXISTS gameplay_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_id TEXT,
      challenge_id TEXT,
      metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_digest TEXT NOT NULL
    );
  `);

  migrateJsonIfNeeded();
}

function addSentimentSnapshot(snapshot) {
  const conn = getDb();
  const limit = Number(process.env.SENTIMENT_HISTORY_LIMIT || 2000);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const insert = conn.prepare(`
    INSERT INTO sentiment_snapshots
    (id, score, label, contrarian_signal, news, social, volatility, generated_at, source, source_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    id,
    Number(snapshot.score),
    String(snapshot.label),
    String(snapshot.contrarianSignal),
    Number(snapshot.components.news),
    Number(snapshot.components.social),
    Number(snapshot.components.volatility),
    String(snapshot.generatedAt),
    String(snapshot.source || 'unknown'),
    snapshot.sourceError ? String(snapshot.sourceError) : null
  );

  const deleteOverflow = conn.prepare(`
    DELETE FROM sentiment_snapshots
    WHERE id IN (
      SELECT id FROM sentiment_snapshots
      ORDER BY generated_at DESC
      LIMIT -1 OFFSET ?
    )
  `);
  deleteOverflow.run(Math.max(1, limit));
}

function getSentimentSnapshots(limit = 100) {
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT id, score, label, contrarian_signal, news, social, volatility, generated_at, source, source_error
    FROM sentiment_snapshots
    ORDER BY generated_at DESC
    LIMIT ?
  `);
  return stmt.all(Math.max(1, limit)).map((row) => ({
    id: row.id,
    score: row.score,
    label: row.label,
    contrarianSignal: row.contrarian_signal,
    components: {
      news: row.news,
      social: row.social,
      volatility: row.volatility
    },
    generatedAt: row.generated_at,
    source: row.source,
    sourceError: row.source_error
  }));
}

function addGameplayEvent(event) {
  const conn = getDb();
  const limit = Number(process.env.GAMEPLAY_EVENTS_LIMIT || 5000);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const insert = conn.prepare(`
    INSERT INTO gameplay_events (id, created_at, type, user_name, user_id, challenge_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    id,
    createdAt,
    String(event.type),
    String(event.user || 'anonymous'),
    event.userId ? String(event.userId) : null,
    event.challengeId ? String(event.challengeId) : null,
    event.metadata ? JSON.stringify(event.metadata) : null
  );

  const deleteOverflow = conn.prepare(`
    DELETE FROM gameplay_events
    WHERE id IN (
      SELECT id FROM gameplay_events
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
    )
  `);
  deleteOverflow.run(Math.max(1, limit));
}

function getGameplayEvents(limit = 100) {
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT id, created_at, type, user_name, user_id, challenge_id, metadata_json
    FROM gameplay_events
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(Math.max(1, limit)).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    type: row.type,
    user: row.user_name,
    userId: row.user_id,
    challengeId: row.challenge_id,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null
  }));
}

function addUser(user) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO users (id, created_at, username, password_salt, password_digest)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    new Date().toISOString(),
    String(user.username),
    String(user.passwordSalt),
    String(user.passwordDigest)
  );
}

function findUserByUsername(username) {
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT id, created_at, username, password_salt, password_digest
    FROM users
    WHERE lower(username) = lower(?)
    LIMIT 1
  `);
  const row = stmt.get(username);
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    username: row.username,
    passwordSalt: row.password_salt,
    passwordDigest: row.password_digest
  };
}

function migrateJsonIfNeeded() {
  const conn = getDb();
  const counts = {
    sentiments: Number(conn.prepare('SELECT COUNT(1) AS c FROM sentiment_snapshots').get().c),
    events: Number(conn.prepare('SELECT COUNT(1) AS c FROM gameplay_events').get().c),
    users: Number(conn.prepare('SELECT COUNT(1) AS c FROM users').get().c)
  };

  if (counts.sentiments === 0) {
    const snapshots = readJsonArray(sentimentFile);
    const ins = conn.prepare(`
      INSERT INTO sentiment_snapshots
      (id, score, label, contrarian_signal, news, social, volatility, generated_at, source, source_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of snapshots) {
      ins.run(
        String(s.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        Number(s.score || 0),
        String(s.label || 'Neutral'),
        String(s.contrarianSignal || 'Hold / observe'),
        Number(s.components && s.components.news ? s.components.news : 0),
        Number(s.components && s.components.social ? s.components.social : 0),
        Number(s.components && s.components.volatility ? s.components.volatility : 0),
        String(s.generatedAt || new Date().toISOString()),
        String(s.source || 'unknown'),
        s.sourceError ? String(s.sourceError) : null
      );
    }
  }

  if (counts.events === 0) {
    const events = readJsonArray(eventsFile);
    const ins = conn.prepare(`
      INSERT INTO gameplay_events (id, created_at, type, user_name, user_id, challenge_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of events) {
      ins.run(
        String(e.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        String(e.createdAt || new Date().toISOString()),
        String(e.type || 'unknown'),
        String(e.user || 'anonymous'),
        e.userId ? String(e.userId) : null,
        e.challengeId ? String(e.challengeId) : null,
        e.metadata ? JSON.stringify(e.metadata) : null
      );
    }
  }

  if (counts.users === 0) {
    const users = readJsonArray(usersFile);
    const ins = conn.prepare(`
      INSERT INTO users (id, created_at, username, password_salt, password_digest)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const u of users) {
      if (!u.username || !u.passwordSalt || !u.passwordDigest) continue;
      ins.run(
        String(u.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        String(u.createdAt || new Date().toISOString()),
        String(u.username),
        String(u.passwordSalt),
        String(u.passwordDigest)
      );
    }
  }
}

module.exports = {
  initializeStorage,
  addSentimentSnapshot,
  getSentimentSnapshots,
  addGameplayEvent,
  getGameplayEvents,
  addUser,
  findUserByUsername
};
