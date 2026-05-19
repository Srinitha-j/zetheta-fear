# System Architecture (MVP)

## Core services
- Data ingestion: fetch market/news/social data every N seconds
- Sentiment engine: normalize components to 0-100 and compute weighted score
- Game service: challenge lifecycle, predictions, points
- Realtime gateway: WebSocket stream to clients
- API service: REST endpoints for dashboard + game actions

## Data model (minimum)
- users(id, created_at, username, password_salt, password_digest)
- sentiment_snapshots(id, score, label, contrarian_signal, news, social, volatility, generated_at, source, source_error)
- challenges(id, created_at, updated_at, name, type, active, created_by_user_id, created_by_username)
- predictions(id, created_at, updated_at, user_id, username, challenge_id, predicted_score, predicted_label, status, actual_score, actual_label, points, scored_at)
- refresh_tokens(id, user_id, token_hash, family_id, issued_at, expires_at, revoked_at)
- password_reset_tokens(id, user_id, token_hash, issued_at, expires_at, consumed_at)
- leaderboard is computed on read from scored predictions (no cache table in current MVP)

## Scoring bands
- 0-24: Extreme Fear
- 25-44: Fear
- 45-55: Neutral
- 56-75: Greed
- 76-100: Extreme Greed

## Contrarian rules
- Extreme fear: accumulation watch
- Extreme greed: risk reduction watch
- Neutral/fear/greed: monitor trend continuation
