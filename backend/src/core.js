const crypto = require('crypto');

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

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [head, body, sig] = parts;
  const data = `${head}.${body}`;
  const expected = crypto
    .createHmac('sha256', secret)
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

module.exports = {
  clamp,
  calculateFearGreed,
  scoreHeadlines,
  stdDev,
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword
};
