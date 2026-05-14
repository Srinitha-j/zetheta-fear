# Fear & Greed Meter MVP Starter

This repo is a practical starter to complete the PDF task quickly with a working MVP baseline.

## What is already included
- Backend API server (`backend/src/server.js`)
- Sentiment score calculator using live sources with fallback
- WebSocket live updates (`/ws`)
- API endpoints:
  - `GET /api/health`
  - `GET /api/sentiment/latest`
  - `GET /api/sentiment/history?limit=100`
  - `GET /api/leaderboard`
  - `GET /api/challenges`
  - `GET /api/events?limit=100`
  - `POST /api/events`
- Frontend dashboard (`frontend/index.html`)
- Delivery docs mapped to day-wise goals

## Live data sources
- News signal: CoinDesk RSS headlines
- Social signal: Reddit `r/CryptoCurrency` hot posts
- Volatility signal: CoinGecko BTC hourly market chart

If any provider fails/rate-limits, service automatically returns `mock_fallback` source mode.

## Run locally
```bash
cp .env.example .env
npm start
```
Open `http://localhost:8080`.

## Mapping to PDF Must-Haves
- Playable mechanics: starter challenge loop scaffolded
- Sentiment scoring: weighted engine in `calculateFearGreed`
- Real-time updates: WebSocket broadcast every `WS_INTERVAL_MS`
- Leaderboard and challenges: API + UI placeholders live
- Documentation and checklist: `docs/`

## Next implementation priorities
1. Move file persistence to relational DB (Postgres/MySQL) with migrations.
2. Add authentication (JWT + user table).
3. Add prediction submission + scoring endpoints.
4. Add tests and coverage reporting.
5. Replace keyword NLP with model/API-based sentiment pipeline.
