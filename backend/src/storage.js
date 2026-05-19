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
      role TEXT NOT NULL DEFAULT 'member',
      password_salt TEXT NOT NULL,
      password_digest TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id TEXT,
      created_by_username TEXT
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      predicted_score INTEGER NOT NULL,
      predicted_label TEXT,
      status TEXT NOT NULL,
      actual_score INTEGER,
      actual_label TEXT,
      points INTEGER,
      scored_at TEXT
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      family_id TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_prediction_unique
    ON predictions(user_id, challenge_id)
    WHERE status = 'pending';
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
    INSERT INTO users (id, created_at, username, role, password_salt, password_digest)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const currentUsers = Number(conn.prepare('SELECT COUNT(1) AS c FROM users').get().c);
  const role = user.role ? String(user.role) : (currentUsers === 0 ? 'admin' : 'member');
  stmt.run(
    `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    new Date().toISOString(),
    String(user.username),
    role,
    String(user.passwordSalt),
    String(user.passwordDigest)
  );
}

function findUserByUsername(username) {
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT id, created_at, username, role, password_salt, password_digest
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
    role: row.role || 'member',
    passwordSalt: row.password_salt,
    passwordDigest: row.password_digest
  };
}

function findUserById(id) {
  const conn = getDb();
  const row = conn.prepare(`
    SELECT id, created_at, username, role, password_salt, password_digest
    FROM users
    WHERE id = ?
    LIMIT 1
  `).get(id);
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    username: row.username,
    role: row.role || 'member',
    passwordSalt: row.password_salt,
    passwordDigest: row.password_digest
  };
}

function updateUserPassword(userId, passwordSalt, passwordDigest) {
  const conn = getDb();
  const res = conn.prepare(`
    UPDATE users
    SET password_salt = ?, password_digest = ?
    WHERE id = ?
  `).run(String(passwordSalt), String(passwordDigest), String(userId));
  return Number(res.changes || 0) > 0;
}

function listChallenges(activeOnly = false) {
  const conn = getDb();
  const sql = activeOnly
    ? `
      SELECT id, created_at, updated_at, name, type, active, created_by_user_id, created_by_username
      FROM challenges
      WHERE active = 1
      ORDER BY created_at DESC
    `
    : `
      SELECT id, created_at, updated_at, name, type, active, created_by_user_id, created_by_username
      FROM challenges
      ORDER BY created_at DESC
    `;
  return conn.prepare(sql).all().map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    type: row.type,
    active: Boolean(row.active),
    createdByUserId: row.created_by_user_id,
    createdByUsername: row.created_by_username
  }));
}

function createChallenge(challenge) {
  const conn = getDb();
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO challenges (id, created_at, updated_at, name, type, active, created_by_user_id, created_by_username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    now,
    now,
    String(challenge.name),
    String(challenge.type),
    challenge.active ? 1 : 0,
    challenge.createdByUserId ? String(challenge.createdByUserId) : null,
    challenge.createdByUsername ? String(challenge.createdByUsername) : null
  );
  return id;
}

function updateChallenge(id, patch) {
  const conn = getDb();
  const existing = conn.prepare(`
    SELECT id, name, type, active FROM challenges WHERE id = ? LIMIT 1
  `).get(id);
  if (!existing) return false;
  const name = patch.name != null ? String(patch.name) : existing.name;
  const type = patch.type != null ? String(patch.type) : existing.type;
  const active = patch.active != null ? (patch.active ? 1 : 0) : existing.active;
  conn.prepare(`
    UPDATE challenges
    SET name = ?, type = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(name, type, active, new Date().toISOString(), id);
  return true;
}

function getChallengeById(id) {
  const conn = getDb();
  const row = conn.prepare(`
    SELECT id, created_at, updated_at, name, type, active, created_by_user_id, created_by_username
    FROM challenges
    WHERE id = ?
    LIMIT 1
  `).get(id);
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    type: row.type,
    active: Boolean(row.active),
    createdByUserId: row.created_by_user_id,
    createdByUsername: row.created_by_username
  };
}

function deleteChallenge(id) {
  const conn = getDb();
  const res = conn.prepare('DELETE FROM challenges WHERE id = ?').run(id);
  return Number(res.changes || 0) > 0;
}

function createPrediction(prediction) {
  const conn = getDb();
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO predictions
    (id, created_at, updated_at, user_id, username, challenge_id, predicted_score, predicted_label, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    now,
    now,
    String(prediction.userId),
    String(prediction.username),
    String(prediction.challengeId),
    Number(prediction.predictedScore),
    prediction.predictedLabel ? String(prediction.predictedLabel) : null,
    'pending'
  );
  return id;
}

function hasPendingPrediction(userId, challengeId) {
  const conn = getDb();
  const row = conn.prepare(`
    SELECT id
    FROM predictions
    WHERE user_id = ? AND challenge_id = ? AND status = 'pending'
    LIMIT 1
  `).get(String(userId), String(challengeId));
  return Boolean(row);
}

function addRefreshToken(entry) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, issued_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(
    String(entry.id),
    String(entry.userId),
    String(entry.tokenHash),
    String(entry.familyId),
    String(entry.issuedAt),
    String(entry.expiresAt)
  );
}

function findActiveRefreshTokenByHash(tokenHash) {
  const conn = getDb();
  const row = conn.prepare(`
    SELECT id, user_id, token_hash, family_id, issued_at, expires_at, revoked_at
    FROM refresh_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).get(String(tokenHash));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    familyId: row.family_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

function revokeRefreshTokenById(id) {
  const conn = getDb();
  conn.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), String(id));
}

function revokeRefreshTokenFamily(familyId) {
  const conn = getDb();
  conn.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE family_id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), String(familyId));
}

function addPasswordResetToken(entry) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, issued_at, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    String(entry.id),
    String(entry.userId),
    String(entry.tokenHash),
    String(entry.issuedAt),
    String(entry.expiresAt)
  );
}

function findActivePasswordResetTokenByHash(tokenHash) {
  const conn = getDb();
  const row = conn.prepare(`
    SELECT id, user_id, token_hash, issued_at, expires_at, consumed_at
    FROM password_reset_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).get(String(tokenHash));
  if (!row) return null;
  if (row.consumed_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at
  };
}

function consumePasswordResetToken(id) {
  const conn = getDb();
  const res = conn.prepare(`
    UPDATE password_reset_tokens
    SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL
  `).run(new Date().toISOString(), String(id));
  return Number(res.changes || 0) > 0;
}

function listPredictionsByUser(userId, limit = 100) {
  const conn = getDb();
  return conn.prepare(`
    SELECT id, created_at, updated_at, user_id, username, challenge_id, predicted_score, predicted_label, status, actual_score, actual_label, points, scored_at
    FROM predictions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, Math.max(1, limit)).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id,
    username: row.username,
    challengeId: row.challenge_id,
    predictedScore: row.predicted_score,
    predictedLabel: row.predicted_label,
    status: row.status,
    actualScore: row.actual_score,
    actualLabel: row.actual_label,
    points: row.points,
    scoredAt: row.scored_at
  }));
}

function scorePendingPredictions(actualScore, actualLabel) {
  const conn = getDb();
  const pending = conn.prepare(`
    SELECT id, predicted_score, predicted_label
    FROM predictions
    WHERE status = 'pending'
  `).all();
  const update = conn.prepare(`
    UPDATE predictions
    SET status = 'scored',
        actual_score = ?,
        actual_label = ?,
        points = ?,
        scored_at = ?,
        updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  for (const row of pending) {
    const diff = Math.abs(Number(row.predicted_score) - Number(actualScore));
    const base = Math.max(0, 100 - diff * 2);
    const bonus = row.predicted_label && actualLabel && String(row.predicted_label) === String(actualLabel) ? 10 : 0;
    const points = Math.min(100, base + bonus);
    update.run(Number(actualScore), actualLabel ? String(actualLabel) : null, points, now, now, row.id);
  }
  return pending.length;
}

function getLeaderboard(limit = 100) {
  const conn = getDb();
  return conn.prepare(`
    SELECT username, COALESCE(SUM(points), 0) AS score
    FROM predictions
    WHERE status = 'scored'
    GROUP BY user_id, username
    ORDER BY score DESC, username ASC
    LIMIT ?
  `).all(Math.max(1, limit)).map((row) => ({
    user: row.username,
    score: Number(row.score)
  }));
}

function seedChallengesIfEmpty(defaults) {
  const conn = getDb();
  const existing = Number(conn.prepare('SELECT COUNT(1) AS c FROM challenges').get().c);
  if (existing > 0) return;
  for (const ch of defaults) {
    createChallenge({
      name: ch.name,
      type: ch.type,
      active: ch.active !== false,
      createdByUserId: null,
      createdByUsername: 'system'
    });
  }
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
      INSERT INTO users (id, created_at, username, role, password_salt, password_digest)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const u of users) {
      if (!u.username || !u.passwordSalt || !u.passwordDigest) continue;
      ins.run(
        String(u.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        String(u.createdAt || new Date().toISOString()),
        String(u.username),
        String(u.role || 'member'),
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
  findUserByUsername,
  findUserById,
  updateUserPassword,
  listChallenges,
  getChallengeById,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  createPrediction,
  hasPendingPrediction,
  addRefreshToken,
  findActiveRefreshTokenByHash,
  revokeRefreshTokenById,
  revokeRefreshTokenFamily,
  addPasswordResetToken,
  findActivePasswordResetTokenByHash,
  consumePasswordResetToken,
  listPredictionsByUser,
  scorePendingPredictions,
  getLeaderboard,
  seedChallengesIfEmpty
};
