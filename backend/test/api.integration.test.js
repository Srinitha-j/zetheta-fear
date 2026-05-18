const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const testDbPath = path.join(__dirname, '..', 'data-test', `api-test-${Date.now()}.db`);
const port = 18080 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

let serverProc = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (_err) {
      // keep waiting
    }
    await sleep(100);
  }
  throw new Error('Server did not start in time');
}

async function api(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function registerAndLogin(username, password) {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(reg.res.status, 201);

  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.res.status, 200);
  assert.ok(login.body.token);
  return login.body;
}

test.before(async () => {
  serverProc = spawn(process.execPath, ['backend/src/server.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: `sqlite:///${testDbPath}`,
      SENTIMENT_REFRESH_MS: '999999',
      WS_INTERVAL_MS: '999999'
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

test.after(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
  }
});

test('first user is admin, later user is member, /me includes role', async () => {
  const admin = await registerAndLogin('admin_u', 'adminpass123');
  assert.equal(admin.user.role, 'admin');

  const member = await registerAndLogin('member_u', 'memberpass123');
  assert.equal(member.user.role, 'member');

  const me = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${member.token}` }
  });
  assert.equal(me.res.status, 200);
  assert.equal(me.body.user.role, 'member');
});

test('only admin can create challenge', async () => {
  const admin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_u', password: 'adminpass123' })
  });
  const member = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'member_u', password: 'memberpass123' })
  });

  const forbidden = await api('/api/challenges', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${member.body.token}`
    },
    body: JSON.stringify({ name: 'Member Challenge', type: 'news', active: true })
  });
  assert.equal(forbidden.res.status, 403);

  const created = await api('/api/challenges', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.body.token}`
    },
    body: JSON.stringify({ name: 'Admin Challenge', type: 'news', active: true })
  });
  assert.equal(created.res.status, 201);
  assert.ok(created.body.id);
});

test('member cannot patch or delete admin challenge', async () => {
  const admin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_u', password: 'adminpass123' })
  });
  const member = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'member_u', password: 'memberpass123' })
  });

  const list = await api('/api/challenges?includeInactive=1');
  const target = list.body.challenges.find((c) => c.name === 'Admin Challenge');
  assert.ok(target);

  const patchForbidden = await api(`/api/challenges/${target.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${member.body.token}`
    },
    body: JSON.stringify({ name: 'Hacked Name' })
  });
  assert.equal(patchForbidden.res.status, 403);

  const delForbidden = await api(`/api/challenges/${target.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${member.body.token}` }
  });
  assert.equal(delForbidden.res.status, 403);

  const patchOk = await api(`/api/challenges/${target.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.body.token}`
    },
    body: JSON.stringify({ name: 'Admin Challenge Renamed' })
  });
  assert.equal(patchOk.res.status, 200);
});

test('duplicate pending prediction on same challenge is rejected', async () => {
  const member = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'member_u', password: 'memberpass123' })
  });
  const challenges = await api('/api/challenges');
  const challenge = challenges.body.challenges[0];
  assert.ok(challenge);

  const first = await api('/api/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${member.body.token}`
    },
    body: JSON.stringify({
      challengeId: challenge.id,
      predictedScore: 55,
      predictedLabel: 'Neutral'
    })
  });
  assert.equal(first.res.status, 201);

  const dup = await api('/api/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${member.body.token}`
    },
    body: JSON.stringify({
      challengeId: challenge.id,
      predictedScore: 58,
      predictedLabel: 'Greed'
    })
  });
  assert.equal(dup.res.status, 409);
});
