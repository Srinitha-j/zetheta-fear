const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  initializeStorage,
  addSentimentSnapshot,
  getSentimentSnapshots,
  addGameplayEvent,
  getGameplayEvents,
  addUser,
  findUserByUsername
} = require('./storage');

const port = Number(process.env.PORT || 8080);
const wsInterval = Number(process.env.WS_INTERVAL_MS || 2000);
const sentimentRefreshMs = Number(process.env.SENTIMENT_REFRESH_MS || 30000);
const jwtSecret = process.env.JWT_SECRET || 'change_me';

const leaderboard = [
  { user: 'player1', score: 120 },
  { user: 'player2', score: 95 },
  { user: 'player3', score: 80 }
];

const challenges = [
  { id: 'c1', name: 'Contrarian Call', active: true },
  { id: 'c2', name: 'Volatility Sprint', active: true },
  { id: 'c3', name: 'News Reaction', active: false },
  { id: 'c4', name: 'Social Pulse', active: true },
  { id: 'c5', name: 'Cycle Detective', active: true }
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function calculateFearGreed({ news, social, volatility }) {
  const wNews = Number(process.env.SENTIMENT_NEWS_WEIGHT || 0.35);
  const wSocial = Number(process.env.SENTIMENT_SOCIAL_WEIGHT || 0.35);
  const wVol = Number(process.env.SENTIMENT_VOLATILITY_WEIGHT || 0.30);

  const sentiment = news * wNews + social * wSocial + (100 - volatility) * wVol;
  const score = clamp(Math.round(sentiment), 0, 100);

  let label = 'Neutral';
  if (score <= 24) label = 'Extreme Fear';
  else if (score <= 44) label = 'Fear';
  else if (score <= 55) label = 'Neutral';
  else if (score <= 75) label = 'Greed';
  else label = 'Extreme Greed';

  const contrarianSignal = score >= 76 ? 'Consider risk reduction' : score <= 24 ? 'Watch for accumulation zones' : 'Hold / observe';

  return {
    score,
    label,
    contrarianSignal,
    components: { news, social, volatility },
    generatedAt: new Date().toISOString()
  };
}

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

function scoreHeadlines(texts) {
  const positive = ['surge', 'rally', 'gain', 'bull', 'rise', 'approval', 'adoption', 'growth', 'high'];
  const negative = ['crash', 'drop', 'bear', 'hack', 'ban', 'fraud', 'loss', 'fall', 'lawsuit'];
  let score = 50;

  for (const title of texts) {
    const t = title.toLowerCase();
    for (const w of positive) {
      if (t.includes(w)) score += 2;
    }
    for (const w of negative) {
      if (t.includes(w)) score -= 2;
    }
  }

  return clamp(score, 0, 100);
}

function stdDev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
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
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const sig = crypto
    .createHmac('sha256', jwtSecret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [head, body, sig] = parts;
  const data = `${head}.${body}`;
  const expected = crypto
    .createHmac('sha256', jwtSecret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (sig !== expected) throw new Error('Invalid signature');
  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload.exp || Date.now() / 1000 >= payload.exp) throw new Error('Token expired');
  return payload;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, digest };
}

function verifyPassword(password, salt, digest) {
  const trial = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(trial, 'hex'), Buffer.from(digest, 'hex'));
}

function readAuthUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;
  const payload = verifyJwt(token);
  return { id: payload.sub, username: payload.username };
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
        iat: now,
        exp: now + 24 * 60 * 60
      });
      return sendJson(res, 200, { token, expiresIn: 24 * 60 * 60, user: { id: user.id, username: user.username } });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Bad request' });
    }
  }
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    try {
      const authUser = readAuthUser(req);
      if (!authUser) return sendJson(res, 401, { error: 'missing or invalid token' });
      return sendJson(res, 200, { user: authUser });
    } catch (_err) {
      return sendJson(res, 401, { error: 'missing or invalid token' });
    }
  }
  if (url.pathname === '/api/leaderboard') return sendJson(res, 200, { leaderboard });
  if (url.pathname === '/api/challenges') return sendJson(res, 200, { challenges });
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
addSentimentSnapshot({ ...latestSentiment, source: latestSource, sourceError: latestError });
refreshSentiment();
setInterval(refreshSentiment, sentimentRefreshMs);

server.listen(port, () => {
  console.log(`Fear-Greed starter running on http://localhost:${port}`);
});
