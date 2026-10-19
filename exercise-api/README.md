# Exercise API

The exercise part of Fit for Surgery: the exercise library, each patient's plan, the daily
checklist and completions. What it does and every endpoint: [docs/EXERCISE_API_REFERENCE.md](docs/EXERCISE_API_REFERENCE.md).

It's built the same way as `health-monitoring-api` (same login, roles, error format, audit log
and test setup) and uses the same database. It reads `users` (owned by `auth-api`) and never
writes it.

## Built so far

- Exercise categories (the four from the SRS are added on first start)
- The exercise library, with a YouTube link per exercise

Plans, the checklist, completions and compliance come next (reference, section 10).

## Run it

1. Start MongoDB with `docker compose up -d` in `health-monitoring-api/` (all three APIs share it).
2. `cp .env.example .env` and fill in the Firebase service account (same as the other APIs).
3. `npm install`
4. `npm run start:dev` → http://localhost:3002/api/v1

## Test it

```
npm test            # everything (starts an in-memory MongoDB, no setup needed)
npm run typecheck
```
