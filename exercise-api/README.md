# Exercise API

The exercise part of Fit for Surgery: the exercise library, each patient's plan, the daily
checklist and completions. What it does and every endpoint: [docs/EXERCISE_API_REFERENCE.md](docs/EXERCISE_API_REFERENCE.md).

It's built the same way as `health-monitoring-api` (same login, roles, error format, audit log
and test setup) and uses the same database. It reads `users` (owned by `auth-api`) and never
writes it.

## Built so far

- Exercise categories (the four from the SRS are added on first start)
- The exercise library, with a YouTube link per exercise. The clinic's videos are Unlisted;
  when an admin saves a link, YouTube is asked whether it will play in the app
- Plans: a doctor assigns a plan to a linked patient; every change is kept as a version; the
  patient sees their plan and only the exercises in it

- Today's checklist: the patient ticks exercises off (safe to retry, can't over-count),
  can undo a tick the same day, and sees their history; the doctor sees any day and the history

- Compliance for doctors: planned against done, per day and per exercise (the percentage
  waits for the client's formula)

- **Incentive spirometry** (client change request, Nov 2026, section 6.2): added to the library
  on first start, under Breathing, with `code: "INCENTIVE_SPIROMETRY"` and `recordsVolume: true`.
  Name only; the clinic adds the steps, video and Hindi text like any other edit, and later starts
  never overwrite them. The doctor sets the volume to reach in the plan (`target.volumeMl`); the
  patient sends the volume reached with each tick (`details.volumeMl`, whole mL, 0-5000, which is
  the usual spirometer scale and only a typing-mistake check). Both are refused on exercises
  without `recordsVolume`. An admin can set `recordsVolume` on another exercise too.

- **Hindi** (section 6.3): every exercise has `hi: { name, description, instructions }` and every
  category has `nameHi`. Empty until the clinic supplies the text; the app shows the English for
  any part left empty, and picks the language from the patient's `preferredLanguage` (Auth API).
  Sending `hi` replaces the whole Hindi part; `hi: null` removes it.

A journey test that runs this API with Auth and Health Monitoring on one database is in
`integration-tests/` at the top of the repo. Still waiting on the client: reference, section 9.

## Run it

1. Start MongoDB with `docker compose up -d` in `health-monitoring-api/` (all three APIs share it).
2. `cp .env.example .env` and fill in the Firebase service account (same as the other APIs)
   and `YOUTUBE_API_KEY` (a Google Cloud API key with the YouTube Data API v3 enabled).
3. `npm install`
4. `npm run start:dev` → http://localhost:3002/api/v1

## Test it

```
npm test            # everything (starts an in-memory MongoDB, no setup needed)
npm run typecheck
```
