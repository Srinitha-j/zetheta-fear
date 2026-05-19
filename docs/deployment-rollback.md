# Deployment & Rollback Runbook

## Pre-deploy
- Set all required env vars from `.env.example`.
- Verify `npm test` and `npm run test:coverage` pass.
- Confirm no secrets are committed.

## Deploy
1. Install dependencies: `npm install`
2. Start service: `npm start`
3. Verify health: `GET /api/health`
4. Verify auth config: `GET /api/auth/config`
5. Smoke test protected flow: register -> login -> challenge list -> prediction submit

## Rollback
1. Stop current process.
2. Re-deploy previous known-good build/commit.
3. Restore DB backup if schema/data corruption is suspected.
4. Validate:
- `GET /api/health`
- Login works
- `GET /api/leaderboard`
- `GET /api/sentiment/latest`

## Backup & Restore (SQLite)
- Backup files before deploy:
  - `backend/data/app.db`
  - `backend/data/app.db-wal`
  - `backend/data/app.db-shm`
- Restore by replacing those files while service is stopped.

## Incident Notes
- If login issues spike, check auth logs (`[auth]` lines).
- If lockouts are too aggressive, tune:
  - `AUTH_RATE_LIMIT_MAX`
  - `LOGIN_FAIL_THRESHOLD`
  - `LOGIN_LOCK_MS`
