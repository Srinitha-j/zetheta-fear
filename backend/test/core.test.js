const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clamp,
  calculateFearGreed,
  scoreHeadlines,
  stdDev,
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword
} = require('../src/core');

test('clamp bounds values correctly', () => {
  assert.equal(clamp(10, 0, 5), 5);
  assert.equal(clamp(-1, 0, 5), 0);
  assert.equal(clamp(3, 0, 5), 3);
});

test('calculateFearGreed maps score bands', () => {
  const fear = calculateFearGreed({ news: 0, social: 0, volatility: 100 });
  const neutral = calculateFearGreed({ news: 50, social: 50, volatility: 50 });
  const greed = calculateFearGreed({ news: 100, social: 100, volatility: 0 });
  assert.equal(fear.label, 'Extreme Fear');
  assert.equal(neutral.label, 'Neutral');
  assert.equal(greed.label, 'Extreme Greed');
});

test('scoreHeadlines reacts to positive/negative words', () => {
  const pos = scoreHeadlines(['Bitcoin rally and surge', 'adoption growth high']);
  const neg = scoreHeadlines(['market crash and fraud', 'hack and bear trend']);
  assert.ok(pos > 50);
  assert.ok(neg < 50);
});

test('stdDev handles empty and non-empty arrays', () => {
  assert.equal(stdDev([]), 0);
  assert.equal(Number(stdDev([1, 1, 1]).toFixed(6)), 0);
  assert.ok(stdDev([1, 2, 3]) > 0);
});

test('jwt sign/verify succeeds and rejects invalid or expired tokens', () => {
  const secret = 'test_secret';
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({ sub: 'u1', username: 'alice', exp: now + 3600 }, secret);
  const payload = verifyJwt(token, secret);
  assert.equal(payload.sub, 'u1');
  assert.equal(payload.username, 'alice');

  assert.throws(() => verifyJwt(`${token}x`, secret));
  const expired = signJwt({ sub: 'u1', username: 'alice', exp: now - 1 }, secret);
  assert.throws(() => verifyJwt(expired, secret));
});

test('password hash/verify works', () => {
  const { salt, digest } = hashPassword('strongpass123');
  assert.ok(salt);
  assert.ok(digest);
  assert.equal(verifyPassword('strongpass123', salt, digest), true);
  assert.equal(verifyPassword('wrong', salt, digest), false);
});
