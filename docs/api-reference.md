# API Reference

Base URL: `http://localhost:8080`

Auth:
- Protected endpoints require header: `Authorization: Bearer <jwt>`
- Obtain JWT via `POST /api/auth/login`

## Health

### `GET /api/health`
Returns service liveness and current data source mode.

Response `200`:
```json
{
  "ok": true,
  "at": "2026-05-14T10:00:00.000Z",
  "source": "live",
  "sourceError": null
}
```

## Authentication

### `POST /api/auth/register`
Create a user.

Request body:
```json
{
  "username": "player1",
  "password": "strongpass123"
}
```

Rules:
- `username`: 3-32 chars, `[a-zA-Z0-9_]`
- `password`: min 8 chars

Response `201`:
```json
{ "ok": true }
```

### `POST /api/auth/login`
Login and get JWT.

Request body:
```json
{
  "username": "player1",
  "password": "strongpass123"
}
```

Response `200`:
```json
{
  "token": "<jwt>",
  "expiresIn": 86400,
  "user": {
    "id": "1730000000000-ab12cd",
    "username": "player1"
  }
}
```

### `GET /api/auth/me`
Returns authenticated user from bearer token.

Response `200`:
```json
{
  "user": {
    "id": "1730000000000-ab12cd",
    "username": "player1"
  }
}
```

## Sentiment

### `GET /api/sentiment/latest`
Returns latest computed sentiment snapshot.

### `GET /api/sentiment/history?limit=100`
Returns latest sentiment snapshots.

Query params:
- `limit` (optional): `1..1000`

## Gameplay

### `GET /api/leaderboard`
Returns static leaderboard array.

### `GET /api/challenges`
Returns challenge list.

### `GET /api/events?limit=100`
Returns gameplay events.

Query params:
- `limit` (optional): `1..1000`

### `POST /api/events` (Protected)
Create gameplay event for authenticated user.

Request body:
```json
{
  "type": "prediction_submitted",
  "challengeId": "c1",
  "metadata": { "guess": "greed" }
}
```

Response `201`:
```json
{ "ok": true }
```

Errors:
- `400` invalid JSON or missing `type`
- `401` missing or invalid token
- `404` unknown route
