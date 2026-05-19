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
      WS_INTERVAL_MS: '999999',
      AUTH_RATE_LIMIT_WINDOW_MS: '60000',
      AUTH_RATE_LIMIT_MAX: '20',
      LOGIN_FAIL_THRESHOLD: '3',
      LOGIN_LOCK_MS: '60000'
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
  const admin = await registerAndLogin('admin_u', 'Adminpass#123');
  assert.equal(admin.user.role, 'admin');

  const member = await registerAndLogin('member_u', 'Memberpass#123');
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
    body: JSON.stringify({ username: 'admin_u', password: 'Adminpass#123' })
  });
  const member = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'member_u', password: 'Memberpass#123' })
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
    body: JSON.stringify({ username: 'admin_u', password: 'Adminpass#123' })
  });
  const member = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'member_u', password: 'Memberpass#123' })
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
    body: JSON.stringify({ username: 'member_u', password: 'Memberpass#123' })
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

test('login lockout triggers after repeated failures', async () => {
  const username = `lock_user_${Date.now()}`;
  const password = 'Correctpass#123';
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '10.99.0.1'
    },
    body: JSON.stringify({ username, password })
  });
  assert.equal(reg.res.status, 201);

  for (let i = 0; i < 3; i += 1) {
    const bad = await api('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '10.99.0.1'
      },
      body: JSON.stringify({ username, password: 'wrongpass' })
    });
    assert.equal(bad.res.status, 401);
  }

  const locked = await api('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '10.99.0.1'
    },
    body: JSON.stringify({ username, password })
  });
  assert.equal(locked.res.status, 429);
  assert.match(String(locked.body.error || ''), /locked/i);
});

test('login rate limiting returns 429 after threshold', async () => {
  const username = `rate_user_${Date.now()}`;
  const password = 'Ratepass#123';
  const ip = '10.88.0.1';
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password })
  });
  assert.equal(reg.res.status, 201);

  let saw429 = false;
  for (let i = 0; i < 25; i += 1) {
    const res = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ username, password: 'stillwrong' })
    });
    if (res.res.status === 429) {
      saw429 = true;
      break;
    }
  }
  assert.equal(saw429, true);
});

test('auth config exposes dev reset feature flag', async () => {
  const cfg = await api('/api/auth/config');
  assert.equal(cfg.res.status, 200);
  assert.equal(typeof cfg.body.features.devAuthResetEnabled, 'boolean');
  assert.equal(cfg.body.features.devAuthResetEnabled, true);
});

test('dev reset guards: admin allowed, member denied', async () => {
  const admin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_u', password: 'Adminpass#123' })
  });
  const member = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'member_u', password: 'Memberpass#123' })
  });

  const denied = await api('/api/auth/dev/reset-guards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${member.body.token}`
    },
    body: JSON.stringify({ username: 'member_u' })
  });
  assert.equal(denied.res.status, 403);

  const allowed = await api('/api/auth/dev/reset-guards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.body.token}`
    },
    body: JSON.stringify({ username: 'member_u' })
  });
  assert.equal(allowed.res.status, 200);
  assert.equal(allowed.body.ok, true);
});

test('dev reset guards endpoint is disabled when flag is off', async () => {
  const localPort = 19500 + Math.floor(Math.random() * 1000);
  const localBase = `http://127.0.0.1:${localPort}`;
  const localDb = path.join(__dirname, '..', 'data-test', `api-test-disabled-${Date.now()}.db`);
  const localProc = spawn(process.execPath, ['backend/src/server.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      PORT: String(localPort),
      DATABASE_URL: `sqlite:///${localDb}`,
      SENTIMENT_REFRESH_MS: '999999',
      WS_INTERVAL_MS: '999999',
      ENABLE_DEV_AUTH_RESET: '0'
    },
    stdio: 'ignore'
  });

  async function localWait() {
    for (let i = 0; i < 50; i += 1) {
      try {
        const res = await fetch(`${localBase}/api/health`);
        if (res.ok) return;
      } catch (_err) {}
      await sleep(100);
    }
    throw new Error('Local disabled server did not start');
  }
  async function localApi(pathname, options = {}) {
    const res = await fetch(`${localBase}${pathname}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  try {
    await localWait();
    const uname = `admin_disabled_${Date.now()}`;
    const pass = 'Pass#12345';
    const reg = await localApi('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: pass })
    });
    assert.equal(reg.res.status, 201);
    const login = await localApi('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: pass })
    });
    const token = login.body.token;
    assert.ok(token);

    const cfg = await localApi('/api/auth/config');
    assert.equal(cfg.res.status, 200);
    assert.equal(cfg.body.features.devAuthResetEnabled, false);

    const reset = await localApi('/api/auth/dev/reset-guards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ username: 'x' })
    });
    assert.equal(reset.res.status, 404);
  } finally {
    if (!localProc.killed) localProc.kill('SIGTERM');
  }
});

test('refresh token rotates access and refresh tokens', async () => {
  const username = `refresh_user_${Date.now()}`;
  const password = 'Refreshpass#123';
  await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.res.status, 200);
  assert.ok(login.body.refreshToken);

  const refresh = await api('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: login.body.refreshToken })
  });
  assert.equal(refresh.res.status, 200);
  assert.ok(refresh.body.token);
  assert.ok(refresh.body.refreshToken);
  assert.notEqual(refresh.body.refreshToken, login.body.refreshToken);

  const replayOld = await api('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: login.body.refreshToken })
  });
  assert.equal(replayOld.res.status, 401);
});

test('logout revokes refresh token family', async () => {
  const username = `logout_user_${Date.now()}`;
  const password = 'Logoutpass#123';
  await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.res.status, 200);

  const logout = await api('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: login.body.refreshToken })
  });
  assert.equal(logout.res.status, 200);

  const refreshAfterLogout = await api('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: login.body.refreshToken })
  });
  assert.equal(refreshAfterLogout.res.status, 401);
});

test('password policy rejects weak password on register', async () => {
  const weak = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `weak_user_${Date.now()}`, password: 'weakpass' })
  });
  assert.equal(weak.res.status, 400);
  assert.match(String(weak.body.error || ''), /uppercase|number|symbol|lowercase|at least/i);
});

test('password reset scaffold: forgot issues token in dev and reset updates password', async () => {
  const username = `reset_user_${Date.now()}`;
  const oldPass = 'Oldpass#123';
  const newPass = 'Newpass#456';
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: oldPass })
  });
  assert.equal(reg.res.status, 201);

  const forgot = await api('/api/auth/password/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  assert.equal(forgot.res.status, 200);
  assert.ok(forgot.body.devResetToken);

  const reset = await api('/api/auth/password/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: forgot.body.devResetToken, newPassword: newPass })
  });
  assert.equal(reset.res.status, 200);

  const oldLogin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: oldPass })
  });
  assert.equal(oldLogin.res.status, 401);

  const newLogin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: newPass })
  });
  assert.equal(newLogin.res.status, 200);
});
