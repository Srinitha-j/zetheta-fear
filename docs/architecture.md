# System Architecture (MVP)

## Core services
- Data ingestion: fetch market/news/social data every N seconds
- Sentiment engine: normalize components to 0-100 and compute weighted score
- Game service: challenge lifecycle, predictions, points
- Realtime gateway: WebSocket stream to clients
- API service: REST endpoints for dashboard + game actions

## Data model (minimum)
- users(id, email, password_hash, created_at)
- sentiment_snapshots(id, score, label, news, social, volatility, created_at)
- challenges(id, type, prompt, open_at, close_at, status)
- predictions(id, user_id, challenge_id, guess, points, created_at)
- leaderboard_cache(user_id, score, rank, updated_at)

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
