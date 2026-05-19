# DB Migration Plan (SQLite -> Postgres/MySQL)

## Current
- Runtime DB: SQLite (`node:sqlite`)
- Schema is created in `backend/src/storage.js` at startup.

## Target
- Postgres (preferred) or MySQL in production.

## Steps
1. Introduce migration tool (`knex`, `sequelize`, `prisma`, or `drizzle`).
2. Extract schema definitions from runtime SQL into versioned migration files.
3. Add migration scripts:
- `npm run db:migrate`
- `npm run db:rollback`
4. Add adapter/repository layer to isolate SQL-dialect differences.
5. Add data migration script for core tables:
- users
- challenges
- predictions
- sentiment_snapshots
- gameplay_events
- refresh_tokens
- password_reset_tokens
6. Validate on staging:
- auth login/refresh/logout
- challenge CRUD
- prediction scoring + leaderboard
7. Cutover with backup/restore plan and rollback checkpoint.

## Required Decisions
- UUID strategy (DB-native vs app-generated IDs)
- Timestamp timezone standard (UTC)
- Index strategy for leaderboard and token tables
- Retention policy for `auth` and reset-token tables
