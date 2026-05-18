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
Returns database-backed leaderboard aggregated from scored predictions.

Query params:
- `limit` (optional): `1..1000`

Response `200`:
```json
{
  "leaderboard": [
    { "user": "player1", "score": 186 },
    { "user": "player2", "score": 144 }
  ]
}
```

### `GET /api/challenges`
Returns challenge list.

Query params:
- `includeInactive` (optional): `1` to include inactive challenges

### `POST /api/challenges` (Protected)
Create a challenge.

Request body:
```json
{
  "name": "Macro Week Call",
  "type": "macro",
  "active": true
}
```

Response `201`:
```json
{ "ok": true, "id": "1730000000000-ab12cd" }
```

### `PATCH /api/challenges/:id` (Protected)
Update challenge fields (`name`, `type`, `active`).

Response `200`:
```json
{ "ok": true }
```

### `DELETE /api/challenges/:id` (Protected)
Delete a challenge.

Response `200`:
```json
{ "ok": true }
```

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

### `POST /api/predictions` (Protected)
Submit a prediction for an existing challenge.

Request body:
```json
{
  "challengeId": "1730000000000-ab12cd",
  "predictedScore": 68,
  "predictedLabel": "Greed"
}
```

Response `201`:
```json
{ "ok": true, "id": "1730000000100-cd34ef" }
```

### `GET /api/predictions?limit=100` (Protected)
Returns the authenticated user's predictions.

### `POST /api/predictions/score` (Protected)
Scores all pending predictions using latest sentiment snapshot.

Response `200`:
```json
{
  "ok": true,
  "scored": 4,
  "latest": {
    "score": 61,
    "label": "Greed",
    "contrarianSignal": "Hold / observe",
    "components": {
      "news": 63,
      "social": 57,
      "volatility": 28
    },
    "generatedAt": "2026-05-18T10:00:00.000Z"
  }
}
```

Errors:
- `400` invalid JSON or validation failure
- `401` missing or invalid token
- `404` resource or route not found
