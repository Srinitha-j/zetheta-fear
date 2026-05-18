const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const testDbPath = path.join(__dirname, '..', 'data-test', `storage-test-${Date.now()}.db`);
process.env.DATABASE_URL = `sqlite:///${testDbPath}`;
process.env.SENTIMENT_HISTORY_LIMIT = '3';
process.env.GAMEPLAY_EVENTS_LIMIT = '3';

const {
  initializeStorage,
  addSentimentSnapshot,
  getSentimentSnapshots,
  addGameplayEvent,
  getGameplayEvents,
  addUser,
  findUserByUsername,
  createChallenge,
  listChallenges,
  updateChallenge,
  deleteChallenge,
  createPrediction,
  listPredictionsByUser,
  scorePendingPredictions,
  getLeaderboard,
  seedChallengesIfEmpty
} = require('../src/storage');

test('initializeStorage creates sqlite db and tables', () => {
  initializeStorage();
  assert.equal(fs.existsSync(testDbPath), true);
});

test('sentiment snapshots persist and enforce limit', () => {
  addSentimentSnapshot({
    score: 10,
    label: 'Fear',
    contrarianSignal: 'Hold / observe',
    components: { news: 10, social: 10, volatility: 80 },
    generatedAt: new Date().toISOString(),
    source: 'test',
    sourceError: null
  });
  addSentimentSnapshot({
    score: 20,
    label: 'Fear',
    contrarianSignal: 'Hold / observe',
    components: { news: 20, social: 20, volatility: 60 },
    generatedAt: new Date().toISOString(),
    source: 'test',
    sourceError: null
  });
  addSentimentSnapshot({
    score: 30,
    label: 'Neutral',
    contrarianSignal: 'Hold / observe',
    components: { news: 30, social: 30, volatility: 40 },
    generatedAt: new Date().toISOString(),
    source: 'test',
    sourceError: null
  });
  addSentimentSnapshot({
    score: 40,
    label: 'Neutral',
    contrarianSignal: 'Hold / observe',
    components: { news: 40, social: 40, volatility: 20 },
    generatedAt: new Date().toISOString(),
    source: 'test',
    sourceError: null
  });
  const rows = getSentimentSnapshots(10);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => typeof r.score === 'number'));
});

test('events persist with metadata and enforce limit', () => {
  addGameplayEvent({ type: 'e1', user: 'u1', userId: 'id1', metadata: { x: 1 } });
  addGameplayEvent({ type: 'e2', user: 'u2', userId: 'id2', metadata: { x: 2 } });
  addGameplayEvent({ type: 'e3', user: 'u3', userId: 'id3', metadata: { x: 3 } });
  addGameplayEvent({ type: 'e4', user: 'u4', userId: 'id4', metadata: { x: 4 } });
  const rows = getGameplayEvents(10);
  assert.equal(rows.length, 3);
  assert.ok(rows[0].metadata && typeof rows[0].metadata === 'object');
});

test('user insert and lookup are case-insensitive', () => {
  addUser({ username: 'Player_A', passwordSalt: 's', passwordDigest: 'd' });
  const user = findUserByUsername('player_a');
  assert.ok(user);
  assert.equal(user.username, 'Player_A');
});

test('challenge CRUD works and default seeding applies once', () => {
  seedChallengesIfEmpty([
    { name: 'Default One', type: 'contrarian', active: true }
  ]);
  const seeded = listChallenges(false);
  assert.ok(seeded.length >= 1);

  const challengeId = createChallenge({ name: 'My Challenge', type: 'volatility', active: true });
  let rows = listChallenges(false);
  assert.equal(rows.some((r) => r.id === challengeId), true);

  const updated = updateChallenge(challengeId, { name: 'Updated', active: false });
  assert.equal(updated, true);
  rows = listChallenges(false);
  const row = rows.find((r) => r.id === challengeId);
  assert.equal(row.name, 'Updated');
  assert.equal(row.active, false);

  const deleted = deleteChallenge(challengeId);
  assert.equal(deleted, true);
});

test('prediction create/list and scoring works', () => {
  const challengeId = createChallenge({ name: 'Scoring Challenge', type: 'news', active: true });
  createPrediction({
    userId: 'u-1',
    username: 'user1',
    challengeId,
    predictedScore: 72,
    predictedLabel: 'Greed'
  });
  const before = listPredictionsByUser('u-1', 10);
  assert.equal(before.length >= 1, true);
  assert.equal(before[0].status, 'pending');

  const scoredCount = scorePendingPredictions(70, 'Greed');
  assert.equal(scoredCount >= 1, true);
  const after = listPredictionsByUser('u-1', 10);
  assert.equal(after[0].status, 'scored');
  assert.equal(typeof after[0].points, 'number');
});

test('leaderboard aggregates scored prediction points', () => {
  const challengeId = createChallenge({ name: 'Leaderboard Challenge', type: 'macro', active: true });
  createPrediction({
    userId: 'u-2',
    username: 'user2',
    challengeId,
    predictedScore: 70,
    predictedLabel: 'Greed'
  });
  createPrediction({
    userId: 'u-3',
    username: 'user3',
    challengeId,
    predictedScore: 25,
    predictedLabel: 'Fear'
  });
  scorePendingPredictions(70, 'Greed');
  const rows = getLeaderboard(10);
  assert.equal(rows.length >= 2, true);
  assert.equal(rows.every((r) => typeof r.user === 'string' && typeof r.score === 'number'), true);
  assert.equal(rows[0].score >= rows[1].score, true);
});
