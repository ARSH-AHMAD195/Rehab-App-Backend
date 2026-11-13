# Fit for Surgery — Health Monitoring API

Node.js implementation of **Health Monitoring API reference v1.1 (13 Oct 2026)**.
NestJS 11 + Mongoose 8 + MongoDB, Firebase ID tokens, Swagger at `/api/docs`.

One editable health log per patient per day, with a status for each reading and for the day.
All 13 endpoints from v1.1 are implemented.

---

## Run it

```bash
cp .env.example .env            # then fill in the Firebase section
docker compose up -d            # MongoDB 7 as a single-node replica set
npm install
npm run seed                    # 13 parameters + a doctor, admin and two patients
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- How the API behaves (errors, paging, dates, rate limits, retries, versions, audit):
  [docs/API_BEHAVIOUR.md](docs/API_BEHAVIOUR.md)
- Swagger: `http://localhost:3000/api/docs`, when `SWAGGER_ENABLED=true`. Off by default: the page
  is outside the auth guard, so enable it only for local development.

**The replica set is not optional.** v1.1's save flow writes the daily log, its status, alerts,
audit entries and outbox events in one transaction, and MongoDB only supports multi-document
transactions on a replica set. `docker-compose.yml` initiates `rs0` on first boot.

**Firebase is required to boot.** Auth is Firebase-only, as chosen for this build: set either
`GOOGLE_APPLICATION_CREDENTIALS` (path to the service account JSON) or
`FIREBASE_SERVICE_ACCOUNT_JSON` (the JSON itself). The app fails at startup with a clear message
rather than at the first request. Tests do not need it — they override the token verifier.

### Tests

```bash
npm test          # 118 tests: 5 unit suites + 6 e2e suites
npm run test:unit # validator, status counting, value comparison, day/timezone
npm run test:e2e  # the 13 routes end to end, against a throwaway replica set
npm run typecheck
```

The e2e suites share **one** in-memory single-node replica set, started once per run by
`test/helpers/global-setup.ts`, with a separate database per suite. It needs roughly 200 MB of
free disk for mongod's journal and data files — mongod aborts with a bare `fassert()` when it
cannot preallocate them, so the setup catches that and prints the real reason. To run against the
docker instance instead, set `TEST_MONGODB_URI`. The unit suites need no database and run either
way.

---

## The 13 endpoints

| Method | Route | Role | Source |
|---|---|---|---|
| GET | `/vital-types` | any | `src/vital-types/vital-types.controller.ts` |
| GET | `/me/vitals/today` | patient | `src/daily-logs/me-vitals.controller.ts` |
| PUT | `/me/vitals/today` | patient | ″ |
| GET | `/me/vitals/logs` | patient | ″ |
| GET | `/me/vitals/trends` | patient | ″ |
| GET | `/doctor/patients/:patientId/vitals/today` | doctor | `src/daily-logs/doctor-vitals.controller.ts` |
| GET | `/doctor/patients/:patientId/vitals/logs` | doctor | ″ |
| GET | `/doctor/patients/:patientId/vitals/trends` | doctor | ″ |
| GET | `/doctor/alerts` | doctor | `src/alerts/doctor-alerts.controller.ts` |
| PATCH | `/doctor/alerts/:alertId` | doctor | ″ |
| GET | `/admin/alert-thresholds` | admin | `src/admin/admin.controller.ts` |
| PUT | `/admin/alert-thresholds/:type` | admin | ″ |
| PUT | `/admin/vital-types/:type` | admin | ″ |

There are no POST or DELETE routes for readings, per v1.1: a day's log is created on its first
save and is never deleted.

## Collections

| Collection | Holds |
|---|---|
| `dailyLogs` | one document per patient per day: readings, when each was logged, the day's status |
| `vitalTypes` | each parameter's unit, valid range and version |
| `alertThresholds` | alert limits, global or per patient, append-only with versions |
| `vitalAlerts` | raised alerts, open or acknowledged |
| `auditLogs` | every value change, doctor view, acknowledgement and admin change |
| `outboxEvents` | events queued in the save transaction, published after it commits |
| `users` | **owned by the Auth module** — see below |

## Where the v1.1 rules live

| v1.1 section | Code |
|---|---|
| Save flow (the 8 steps) | `src/daily-logs/daily-logs.service.ts` → `save()` |
| Duplicates and retries (idempotency) | `reading-value.ts` → `sameValue`, used to drop unchanged fields |
| Day and time zone | `src/time/day.service.ts` |
| Status (`filledCount`, `dayStatus`) | `src/daily-logs/log-status.ts` |
| Parameters table (13 params, ranges) | `src/vital-types/vital-type.defaults.ts` |
| Validation rules and `details[]` codes | `src/daily-logs/readings-validator.service.ts` |
| Alert lifecycle (raise, dedupe, escalate, acknowledge) | `src/alerts/alerts.service.ts` |
| Threshold versioning and resolution | `src/thresholds/thresholds.service.ts` |
| Events, envelope, retry schedule, dead letter | `src/outbox/` |
| Audit log (5 actions) | `src/audit/` |
| Rate limits + `Retry-After` | `src/common/throttler/scoped-throttler.guard.ts` |
| Single error shape | `src/common/filters/all-exceptions.filter.ts` |
| Request ID | `src/common/context/` |

---

## Things to know before building on this

### 1. `users` is a placeholder for the Auth module

The architecture plan says this module needs only the user id and role from Auth, but v1.1 also
needs the patient's **IANA time zone** (for "today") and the **patient–doctor link** (for
`PatientAccessGuard`). Both are read from a `users` collection this module never writes to.

When the Auth module ships: point `src/users/users.service.ts` at their collection and drop the
user part of `scripts/seed.ts`. The fields needed are `firebaseUid`, `role`, `name`, `timeZone`,
`doctorIds`, `active`.

Note that the Fit for Surgery API reference has no endpoint that creates or changes the
doctor–patient link, which this module's access rules depend on. That gap is worth closing in
that document.

### 2. Two additive fields in `GET /vital-types`

The v1.1 Parameters table marks pain, walking, steps, water and mood as whole numbers, and sleep
in 0.5 steps, but the `GET /vital-types` example has no field carrying that. Without it the form
can't render the right input and the server can't reject `7.3` hours of sleep. So each parameter
also returns, only when set:

- `integerOnly: true`
- `step: 0.5`

Both are additive — nothing in the documented response changed. If the frontend team would rather
encode it differently, this is the one place to change.

`MOOD` also returns `unit: "level"` alongside its `label`; the v1.1 example omits `unit` on that
one parameter while the parameters table gives it a unit.

### 3. One error code added to the contract

v1.1's Errors table has no code for "a concurrent write won the race, nothing was saved, send it
again". Two places need one:

- a lost optimistic-version check on `PUT /admin/vital-types/:type` (two admins saving at once);
- a duplicate-key clash on either unique index that survives the transaction retries.

Both now return **409 `CONCURRENT_UPDATE`**. Neither can use an existing code honestly: `404` says
the parameter does not exist, and `DAY_CHANGED` tells the app to reload today's log as though
midnight had passed. The row to add to the Errors table is:

| Status | code | When |
|---|---|---|
| 409 | `CONCURRENT_UPDATE` | A concurrent write changed the record. Nothing was saved; retry the request |

This line is already added to `Health_Monitoring_API_Reference_v1.1.html`; **the PDF needs
re-exporting** from it to match. Rename the code if you prefer another word for it — it is defined
once, in `src/common/constants.ts`.

### 4. Placeholder clinical values are not shipped

v1.1: *"The system ships with no global limits until they are signed off."* `npm run seed` inserts
**no** thresholds. `npm run seed -- --thresholds` adds the two placeholder limits from the document
(pain above 6, pulse 50–110) for demos only, and prints a warning. Until an admin enters limits,
no alerts are raised at all — that is the specified behaviour, not a bug.

Mood labels: only level 4 (`"Good"`) is agreed, so levels 1, 2, 3 and 5 return `label: null`
(`MOOD_LABELS` in `src/common/constants.ts`).

### 5. `dayStatus: COMPLETE` needs all 14 fields

Blood sugar is optional, and v1.1 leaves open whether a day can be COMPLETE at 12 of 14. This
implementation follows the Status table literally: COMPLETE means every field on the form is
filled. One line in `src/daily-logs/log-status.ts` changes it when the frontend team decides.

### 6. Rate limiting, in two layers

The three v1.1 limits need two guards, because the per-user limits need an identity and the
per-IP limit must not wait for one:

| Guard | Runs | Counts |
|---|---|---|
| `IpThrottlerGuard` | **before** the auth guard | 300/min per IP address |
| `UserThrottlerGuard` | after the auth guard | 120/min per user, 30/min on `PUT /me/vitals/today` |

So a flood of invalid tokens is rejected on the address alone and never reaches Firebase or the
`users` collection. Each guard ignores the other's named limit, so a request increments each
bucket exactly once. Both are in `src/common/throttler/scoped-throttler.guard.ts`, registered in
that order in `app.module.ts` — global guards run in registration order, which is what puts the
IP check first.

The counters are in-process (`@nestjs/throttler`'s memory storage), so limits are per instance.
Behind more than one instance, swap in the Redis storage to make them global.

### 7. The event transport is a stub

v1.1 fixes the envelope, the retry schedule (1s, 5s, 30s, then every 5 min for 24 hours) and
de-duplication by `eventId`, but not the broker. `LoggingEventPublisher` logs each event; swap that
one provider in `src/outbox/outbox.module.ts` for the real transport once Timeline and
Notifications agree on one. Everything else — the outbox write inside the transaction, claiming,
backoff, dead-lettering — is already in place and tested.

### 8. Past days are read-only

There is no route to edit or delete a past log, per v1.1's Reading lifecycle. Whether patients may
correct yesterday is an open question; it would be a new route, not a change to `PUT
/me/vitals/today`.

---

## Still open (from v1.1, Open questions)

These are the clinical and product answers the module is waiting on. None of them block the code:

1. Alert limits and severity per parameter — **clinical team**
2. Confirmation of the data-entry valid ranges — **clinical team**
3. Nutrition format: free text or fixed options (free text, 500 chars, for now) — **clinical/frontend**
4. Mood labels for levels 1, 2, 3, 5 — **frontend**
5. Can patients correct a previous day? (read-only for now) — **clinical team**
6. Should a day be COMPLETE without optional blood sugar? — **frontend**

## Hindi labels
Client change request, Nov 2026, section 6.3. Every parameter in `GET /vital-types` has a
`labelHi`, null until the clinic supplies it (the app then shows `label`). An admin sets it with
`PUT /admin/vital-types/:type { labelHi }`; like any other change it raises the version and is
audited. The diet chart already carries `{ en, hi }` labels (below). The app picks the language from
the patient's `preferredLanguage` (Auth API).

## Nutrition (diet chart and meal logging)
Client change request, Nov 2026, section 5. Code in `src/nutrition/`.

- **The chart:** the hospital's "High-calorie, High-protein Diet for Cancer Patients"
  (`diet-chart.ts`): 7 meal slots with times, "or" options and "+" add-ons with their quantities,
  and calories and protein **per slot**, as on the chart. Default target: 2206 kcal and 82.4 g
  protein. Labels are `{ en, hi }`; `hi` stays null until the client supplies translations.
- **Each patient's plan:** `GET /me/diet-plan`. Until a doctor changes it, it is the hospital chart
  (`version: 0`, nothing stored). `PATCH /doctor/patients/:patientId/diet-plan` (send `version`)
  changes targets, diet type or the slots and options; audited.
- **Logging:** `PUT /me/meals/today/:slot { date, optionCodes }` sets what was eaten in one slot
  (`[]` clears it). Only today (`409 DAY_CHANGED` otherwise); the same choice again changes nothing.
  One `mealLogs` document per patient per day stores each slot's values as logged, so a later
  plan change never rewrites past days.
- **Totals:** `GET /me/meals/today` gives each slot with its options ticked or not, the day's
  calories and protein, and `percent` of each target for the progress bar. `GET /me/meals` gives
  one row per day (default 7, at most 90). Doctors have the same under
  `/doctor/patients/:patientId/meals...`, audited.

Assumptions until the client answers (question 15): **a slot counts its full calories and protein
once anything in it is ticked**, because the chart gives values per slot only; add-ons don't add
extra; there is no "half eaten". To check with the dietitian: the breakfast row's option-to-quantity
mapping, and the daily total (the slots add up to 2207 kcal; the chart says 2206).

The "intake below 75% for 3 days" alert lives with the other care-team alerts in the Auth API,
which reads `mealLogs` read-only. Not yet: food and measure photos, meal reminders (best done as
local notifications on the phone).
