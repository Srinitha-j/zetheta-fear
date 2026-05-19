const { spawn } = require('child_process');

const port = Number(process.env.SMOKE_TEST_PORT || 18080);
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectStatus(path, expected, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  if (res.status !== expected) {
    const txt = await res.text();
    throw new Error(`${path} expected ${expected}, got ${res.status}: ${txt}`);
  }
  return res;
}

async function waitForHealth(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch (_err) {}
    await sleep(300);
  }
  throw new Error('Server did not become healthy in time');
}

async function run() {
  const username = `smoke_user_${Date.now()}`;
  const password = 'Strongpass123!';

  await expectStatus('/api/health', 200);
  await expectStatus('/api/leaderboard', 200);
  await expectStatus('/api/challenges', 200);
  await expectStatus('/api/sentiment/latest', 200);
  await expectStatus('/api/sentiment/history?limit=5', 200);
  await expectStatus('/api/events?limit=5', 200);
  await expectStatus('/api/auth/register', 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const loginRes = await expectStatus('/api/auth/login', 200, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const login = await loginRes.json();
  if (!login.token) throw new Error('Login did not return token');

  await expectStatus('/api/auth/me', 200, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  await expectStatus('/api/events', 201, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${login.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'prediction_submitted',
      challengeId: 'c1',
      metadata: { guess: 'greed' }
    })
  });
  await expectStatus('/api/events', 401, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'prediction_submitted' })
  });

  console.log('Smoke test passed');
}

async function main() {
  const child = spawn(process.execPath, ['backend/src/server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  try {
    await waitForHealth();
    await run();
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
