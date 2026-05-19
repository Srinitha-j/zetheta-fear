# API Reference

Base URL: `http://localhost:8080`

Auth:
- Protected endpoints require header: `Authorization: Bearer <jwt>`
- Obtain JWT via `POST /api/auth/login`
- Auth endpoints are protected by IP rate limits and temporary lockout on repeated failed logins

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
- `password`: 8-128 chars and must include lowercase, uppercase, number, symbol

Response `201`:
```json
{ "ok": true }
```

Rate limit response `429`:
```json
{
  "error": "too many registration attempts",
  "retryAfter": 42
}
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
  "token": "<access_jwt>",
  "accessToken": "<access_jwt>",
  "refreshToken": "<refresh_token>",
  "expiresIn": 900,
  "refreshExpiresIn": 604800,
  "user": {
    "id": "1730000000000-ab12cd",
    "username": "player1",
    "role": "member"
  }
}
```

Lockout/rate-limit response `429`:
```json
{
  "error": "account temporarily locked due to failed logins",
  "retryAfter": 58
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

### `POST /api/auth/refresh`
Rotate refresh token and issue a new access token pair.

Request body:
```json
{
  "refreshToken": "<refresh_token>"
}
```

### `POST /api/auth/logout`
Revoke refresh-token family.

Request body:
```json
{
  "refreshToken": "<refresh_token>"
}
```

### `POST /api/auth/password/forgot`
Password reset request scaffold.

Request body:
```json
{
  "username": "player1"
}
```

### `POST /api/auth/password/reset`
Reset password using token from forgot flow.

Request body:
```json
{
  "token": "<reset_token>",
  "newPassword": "Newpass#123"
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
Create a challenge (admin only).

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
Allowed for challenge creator or admin.

Response `200`:
```json
{ "ok": true }
```

### `DELETE /api/challenges/:id` (Protected)
Delete a challenge.
Allowed for challenge creator or admin.

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
- `403` role/permission denied
- `409` duplicate pending prediction for same user/challenge
- `404` resource or route not found
- `429` rate limited or temporary lockout (`retryAfter` in seconds)

## Security/Runtime Env

- `AUTH_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `AUTH_RATE_LIMIT_MAX` (default `20`)
- `LOGIN_FAIL_THRESHOLD` (default `5`)
- `LOGIN_LOCK_MS` (default `300000`)
- `ACCESS_TOKEN_TTL_SECONDS` (default `900`)
- `REFRESH_TOKEN_TTL_SECONDS` (default `604800`)
- `PASSWORD_RESET_TTL_SECONDS` (default `1800`)
- `ENABLE_DEV_PASSWORD_RESET` (default `1`)
