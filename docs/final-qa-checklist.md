# Final QA Checklist

## Security
- [ ] Private repository confirmed
- [ ] No secrets in git history
- [x] `.env` not committed
- [x] Auth rate limiting active
- [x] Login lockout active
- [x] Challenge admin/owner permissions enforced

## Auth & Session
- [x] Register/login works with strong password policy
- [x] Access token refresh works
- [x] Logout revokes refresh family
- [x] Password reset flow works (dev scaffold)

## Core Product
- [x] Sentiment latest endpoint works
- [x] Sentiment history endpoint works
- [x] Challenge CRUD works
- [x] Prediction submission/scoring works
- [x] Leaderboard updates from scored predictions
- [ ] WebSocket stream publishes sentiment updates

## Reliability
- [x] `npm test` passes
- [x] `npm run test:coverage` passes
- [x] Coverage >= 70%

## Documentation & Handover
- [x] API reference updated
- [x] Architecture doc updated
- [x] Deployment/rollback runbook complete
- [x] DB migration plan documented
- [ ] Day 15 handover items complete
