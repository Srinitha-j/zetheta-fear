# Final QA Checklist

## Security
- [ ] Private repository confirmed
- [ ] No secrets in git history
- [ ] `.env` not committed
- [ ] Auth rate limiting active
- [ ] Login lockout active
- [ ] Challenge admin/owner permissions enforced

## Auth & Session
- [ ] Register/login works with strong password policy
- [ ] Access token refresh works
- [ ] Logout revokes refresh family
- [ ] Password reset flow works (dev scaffold)

## Core Product
- [ ] Sentiment latest endpoint works
- [ ] Sentiment history endpoint works
- [ ] Challenge CRUD works
- [ ] Prediction submission/scoring works
- [ ] Leaderboard updates from scored predictions
- [ ] WebSocket stream publishes sentiment updates

## Reliability
- [ ] `npm test` passes
- [ ] `npm run test:coverage` passes
- [ ] Coverage >= 70%

## Documentation & Handover
- [ ] API reference updated
- [ ] Architecture doc updated
- [ ] Deployment/rollback runbook complete
- [ ] DB migration plan documented
- [ ] Day 15 handover items complete
