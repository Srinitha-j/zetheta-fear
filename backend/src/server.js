const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  clamp,
  calculateFearGreed,
  scoreHeadlines,
  stdDev,
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword
} = require('./core');
const {
  initializeStorage,
  addSentimentSnapshot,
  getSentimentSnapshots,
  addGameplayEvent,
  getGameplayEvents,
  addUser,
  findUserByUsername,
  findUserById,
  listChallenges,
  getChallengeById,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  createPrediction,
  hasPendingPrediction,
  listPredictionsByUser,
  scorePendingPredictions,
  getLeaderboard,
  seedChallengesIfEmpty
} = require('./storage');

const port = Number(process.env.PORT || 8080);
const wsInterval = Number(process.env.WS_INTERVAL_MS || 2000);
const sentimentRefreshMs = Number(process.env.SENTIMENT_REFRESH_MS || 30000);
const jwtSecret = process.env.JWT_SECRET || 'change_me';

const defaultChallenges = [
  { id: 'c1', name: 'Contrarian Call', type: 'contrarian', active: true },
  { id: 'c2', name: 'Volatility Sprint', type: 'volatility', active: true },
  { id: 'c3', name: 'News Reaction', type: 'news', active: true },
  { id: 'c4', name: 'Social Pulse', type: 'social', active: true },
  { id: 'c5', name: 'Cycle Detective', type: 'cycle', active: true },
  { id: 'c6', name: 'Macro Shock Watch', type: 'macro', active: true }
];

function getMockInput() {
  return {
    news: clamp(35 + Math.floor(Math.random() * 50), 0, 100),
    social: clamp(30 + Math.floor(Math.random() * 55), 0, 100),
    volatility: clamp(10 + Math.floor(Math.random() * 75), 0, 100)
  };
}

function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'fear-greed-meter/0.1' } }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout for ${url}`)));
  });
}

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'fear-greed-meter/0.1' } }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout for ${url}`)));
  });
}


async function fetchNewsSentiment() {
  const feed = await fetchText('https://www.coindesk.com/arc/outboundfeeds/rss/');
  const titles = [...feed.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)].map((x) => x[1]).slice(0, 25);
  if (!titles.length) throw new Error('No RSS titles found');
  return scoreHeadlines(titles);
}

async function fetchSocialSentiment() {
  const reddit = await fetchJson('https://www.reddit.com/r/CryptoCurrency/hot.json?limit=30');
  const posts = reddit && reddit.data && reddit.data.children ? reddit.data.children : [];
  const titles = posts.map((p) => p && p.data ? p.data.title : '').filter(Boolean);
  if (!titles.length) throw new Error('No Reddit posts found');
  return scoreHeadlines(titles);
}

async function fetchVolatilityScore() {
  const chart = await fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=hourly');
  const prices = (chart && chart.prices ? chart.prices : []).map((p) => p[1]);
  if (prices.length < 10) throw new Error('Insufficient price points');

  const returns = [];
  for (let i = 1; i < prices.length; i += 1) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const hourlyVolPct = stdDev(returns) * 100;

  return clamp(Math.round((hourlyVolPct / 5) * 100), 0, 100);
}

let latestSentiment = calculateFearGreed(getMockInput());
let latestSource = 'mock_bootstrap';
let latestError = null;

async function refreshSentiment() {
  try {
    const [news, social, volatility] = await Promise.all([
      fetchNewsSentiment(),
      fetchSocialSentiment(),
      fetchVolatilityScore()
    ]);
    latestSentiment = calculateFearGreed({ news, social, volatility });
    latestSource = 'live';
    latestError = null;
  } catch (err) {
    latestSentiment = calculateFearGreed(getMockInput());
    latestSource = 'mock_fallback';
    latestError = err && err.message ? err.message : String(err);
  }

  addSentimentSnapshot({
    ...latestSentiment,
    source: latestSource,
    sourceError: latestError
  });
  scorePendingPredictions(latestSentiment.score, latestSentiment.label);
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readAuthUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;
  const payload = verifyJwt(token, jwtSecret);
  return { id: payload.sub, username: payload.username, role: payload.role || 'member' };
}

function canManageChallenge(authUser, challenge) {
  return Boolean(authUser && challenge && (authUser.role === 'admin' || challenge.createdByUserId === authUser.id));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveFrontend(res) {
  const file = path.join(__dirname, '..', '..', 'frontend', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const challengeIdMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)$/);

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, at: new Date().toISOString(), source: latestSource, sourceError: latestError });
  }
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        return sendJson(res, 400, { error: 'username must be 3-32 chars [a-zA-Z0-9_]' });
      }
      if (password.length < 8) return sendJson(res, 400, { error: 'password must be at least 8 chars' });
      if (findUserByUsername(username)) return sendJson(res, 409, { error: 'username already exists' });

      const { salt, digest } = hashPassword(password);
      addUser({ username, passwordSalt: salt, passwordDigest: digest });
      return sendJson(res, 201, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const user = findUserByUsername(username);
      if (!user || !verifyPassword(password, user.passwordSalt, user.passwordDigest)) {
        return sendJson(res, 401, { error: 'invalid credentials' });
      }
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt({
        sub: user.id,
        username: user.username,
        role: user.role || 'member',
        iat: now,
        exp: now + 24 * 60 * 60
      }, jwtSecret);
      return sendJson(res, 200, { token, expiresIn: 24 * 60 * 60, user: { id: user.id, username: user.username, role: user.role || 'member' } });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    try {
      const authUser = readAuthUser(req);
      if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
      const fullUser = findUserById(authUser.id);
      return sendJson(res, 200, { user: fullUser ? { id: fullUser.id, username: fullUser.username, role: fullUser.role } : authUser });
    } catch (_err) {
      return sendJson(res, 401, { error: 'missing or invalid token' });
    }
  }
  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 1000);
    return sendJson(res, 200, { leaderboard: getLeaderboard(limit) });
  }
  if (url.pathname === '/api/challenges' && req.method === 'GET') {
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    return sendJson(res, 200, { challenges: listChallenges(!includeInactive) });
  }
  if (url.pathname === '/api/challenges' && req.method === 'POST') {
    try {
      const authUser = readAuthUser(req);
      if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
      if (authUser.role !== 'admin') return sendJson(res, 403, { error: 'admin role required' });
      const payload = await readJsonBody(req);
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const type = typeof payload.type === 'string' ? payload.type.trim() : '';
      if (!name || !type) return sendJson(res, 400, { error: 'name and type are required' });
      const id = createChallenge({
        name,
        type,
        active: payload.active !== false,
        createdByUserId: authUser.id,
        createdByUsername: authUser.username
      });
      return sendJson(res, 201, { ok: true, id });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (challengeIdMatch && req.method === 'PATCH') {
    try {
      const authUser = readAuthUser(req);
      if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
      const challenge = getChallengeById(challengeIdMatch[1]);
      if (!challenge) return sendJson(res, 404, { error: 'challenge not found' });
      if (!canManageChallenge(authUser, challenge)) return sendJson(res, 403, { error: 'not allowed to manage this challenge' });
      const payload = await readJsonBody(req);
      const ok = updateChallenge(challengeIdMatch[1], {
        name: typeof payload.name === 'string' ? payload.name.trim() : undefined,
        type: typeof payload.type === 'string' ? payload.type.trim() : undefined,
        active: typeof payload.active === 'boolean' ? payload.active : undefined
      });
      if (!ok) return sendJson(res, 404, { error: 'challenge not found' });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (challengeIdMatch && req.method === 'DELETE') {
    const authUser = readAuthUser(req);
    if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
    const challenge = getChallengeById(challengeIdMatch[1]);
    if (!challenge) return sendJson(res, 404, { error: 'challenge not found' });
    if (!canManageChallenge(authUser, challenge)) return sendJson(res, 403, { error: 'not allowed to manage this challenge' });
    const ok = deleteChallenge(challengeIdMatch[1]);
    if (!ok) return sendJson(res, 404, { error: 'challenge not found' });
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/sentiment/latest') return sendJson(res, 200, { ...latestSentiment, source: latestSource, sourceError: latestError });
  if (url.pathname === '/api/sentiment/history' && req.method === 'GET') {
    const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 1000);
    return sendJson(res, 200, { snapshots: getSentimentSnapshots(limit) });
  }
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 1000);
    return sendJson(res, 200, { events: getGameplayEvents(limit) });
  }
  if (url.pathname === '/api/events' && req.method === 'POST') {
    try {
      const authUser = readAuthUser(req);
      if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
      const payload = await readJsonBody(req);
      if (!payload || typeof payload.type !== 'string' || !payload.type.trim()) {
        return sendJson(res, 400, { error: 'type is required' });
      }
      addGameplayEvent({
        type: payload.type.trim(),
        user: authUser.username,
        userId: authUser.id,
        challengeId: typeof payload.challengeId === 'string' ? payload.challengeId : null,
        metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null
      });
      return sendJson(res, 201, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (url.pathname === '/api/predictions' && req.method === 'POST') {
    try {
      const authUser = readAuthUser(req);
      if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
      const payload = await readJsonBody(req);
      const challengeId = typeof payload.challengeId === 'string' ? payload.challengeId.trim() : '';
      const predictedScore = Number(payload.predictedScore);
      const predictedLabel = typeof payload.predictedLabel === 'string' ? payload.predictedLabel.trim() : null;
      if (!challengeId) return sendJson(res, 400, { error: 'challengeId is required' });
      if (!Number.isFinite(predictedScore) || predictedScore < 0 || predictedScore > 100) {
        return sendJson(res, 400, { error: 'predictedScore must be 0-100' });
      }
      const challengeExists = listChallenges(false).some((c) => c.id === challengeId);
      if (!challengeExists) return sendJson(res, 404, { error: 'challenge not found' });
      if (hasPendingPrediction(authUser.id, challengeId)) {
        return sendJson(res, 409, { error: 'pending prediction already exists for this challenge' });
      }

      const id = createPrediction({
        userId: authUser.id,
        username: authUser.username,
        challengeId,
        predictedScore: Math.round(predictedScore),
        predictedLabel
      });
      return sendJson(res, 201, { ok: true, id });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (url.pathname === '/api/predictions' && req.method === 'GET') {
    const authUser = readAuthUser(req);
    if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
    const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 1000);
    return sendJson(res, 200, { predictions: listPredictionsByUser(authUser.id, limit) });
  }
  if (url.pathname === '/api/predictions/score' && req.method === 'POST') {
    const authUser = readAuthUser(req);
    if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
    const scored = scorePendingPredictions(latestSentiment.score, latestSentiment.label);
    return sendJson(res, 200, { ok: true, scored, latest: latestSentiment });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function createAcceptValue(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(secWebSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
    .digest('base64');
}

function wsFrame(text) {
  const payload = Buffer.from(text);
  const frame = [0x81];
  if (payload.length < 126) {
    frame.push(payload.length);
    return Buffer.concat([Buffer.from(frame), payload]);
  }
  frame.push(126, (payload.length >> 8) & 255, payload.length & 255);
  return Buffer.concat([Buffer.from(frame), payload]);
}

const clients = new Set();
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    handleApi(req, res).catch((err) => {
      sendJson(res, 500, { error: 'Internal server error', details: err.message });
    });
    return;
  }
  if (req.url === '/' || req.url === '/index.html') return serveFrontend(res);
  sendJson(res, 404, { error: 'Not found' });
});

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${createAcceptValue(key)}`
  ];
  socket.write(headers.concat('\r\n').join('\r\n'));
  clients.add(socket);

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

setInterval(() => {
  const payload = JSON.stringify({
    type: 'sentiment',
    data: { ...latestSentiment, source: latestSource, sourceError: latestError }
  });
  const frame = wsFrame(payload);
  for (const c of clients) {
    if (!c.destroyed) c.write(frame);
  }
}, wsInterval);

initializeStorage();
seedChallengesIfEmpty(defaultChallenges);
addSentimentSnapshot({ ...latestSentiment, source: latestSource, sourceError: latestError });
refreshSentiment();
setInterval(refreshSentiment, sentimentRefreshMs);

server.listen(port, () => {
  console.log(`Fear-Greed starter running on http://localhost:${port}`);
});
