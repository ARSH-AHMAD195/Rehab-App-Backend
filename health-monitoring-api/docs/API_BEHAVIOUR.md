# Health Monitoring API — how it behaves

This page explains the rules every endpoint follows: errors, paging, dates, rate
limits, retries, versions and the audit log. It matches the code on this branch.

For every field of every request and response, use **Swagger** (`/api/docs`, with
`SWAGGER_ENABLED=true`). It is generated from the code, so it is always exact.

---

## 1. Endpoints

All paths start with `/api/v1`. Every request needs `Authorization: Bearer <Firebase ID token>`.

| Who | Method and path | What it does |
|---|---|---|
| Anyone signed in | `GET /vital-types` | The 13 parameters with their units and allowed ranges |
| Patient | `GET /me/vitals/today` | Today's log, with a status for each reading and for the day |
| Patient | `PUT /me/vitals/today` | Save some or all of today's readings |
| Patient | `GET /me/vitals/logs` | Past days, newest first (paged) |
| Patient | `GET /me/vitals/trends` | One value per day for one parameter, for a chart |
| Doctor | `GET /doctor/patients/:patientId/vitals/today` | Same as the patient's, for a linked patient |
| Doctor | `GET /doctor/patients/:patientId/vitals/logs` | Same as the patient's, for a linked patient |
| Doctor | `GET /doctor/patients/:patientId/vitals/trends` | Same as the patient's, for a linked patient |
| Doctor | `GET /doctor/alerts` | Alerts across the doctor's patients (paged) |
| Doctor | `PATCH /doctor/alerts/:alertId` | Acknowledge an alert, with an optional note |
| Admin | `GET /admin/alert-thresholds` | Current alert limits (paged) |
| Admin | `PUT /admin/alert-thresholds/:type` | Set a limit, globally or for one patient |
| Admin | `PUT /admin/vital-types/:type` | Change a parameter's unit, range or form settings |

The patient id for `/me/...` always comes from the token, never from the request.
A doctor asking about a patient who isn't linked to them gets the same **404** as
for a patient who doesn't exist, so they can't tell the two apart.

## 2. Saving today's readings (`PUT /me/vitals/today`)

```json
{ "date": "2026-10-09", "readings": { "PULSE": { "num": 76 }, "BP": { "systolic": 128, "diastolic": 82 } } }
```

- Send **only the fields that changed**. Fields you leave out stay as they are; `null` clears one.
- `date` is the day the form was opened for. If it is no longer the patient's today
  (midnight passed), the save is refused with `409 DAY_CHANGED` and nothing is saved.
- Value shapes: `{ "num": n }` for numbers and scales, `{ "systolic", "diastolic" }` for BP,
  `{ "text": "..." }` for NUTRITION. Ranges come from `GET /vital-types`.
- At most 13 readings per save; request body at most 16 KB.
- The response is the whole day's log plus any `alerts` this save raised.

### Retries

- **Saving the same values again changes nothing.** The time each value was logged
  stays the same, and no audit entry, alert or event is created. This also holds
  when two identical saves arrive at the same moment.
- **For retries after a timeout, send an `Idempotency-Key` header**: a unique id per
  save attempt (for example a UUID), and the same id on every retry of that attempt.
  - A retry with the same key gets **the first answer back** and saves nothing, even
    if the log changed in between.
  - The same key while the first request is still running: `409 IDEMPOTENCY_KEY_IN_USE`. Retry shortly.
  - The same key with a different body: `422 IDEMPOTENCY_KEY_REUSED` (a bug in the app).
  - A request that failed (for example a value out of range) does not use up its key.
  - Keys are kept per patient for 24 hours. Format: 1–255 visible ASCII characters.
  - The header is optional.

## 3. Errors

Every error has the same shape:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "error": "Bad Request",
  "message": "Validation failed",
  "requestId": "4f1c…",
  "details": [{ "field": "readings.PULSE.num", "code": "OUT_OF_RANGE", "issue": "must be between 30 and 220" }]
}
```

`code` and `details[].code` are stable: the app may branch on them. `message` and
`issue` are for people and may change. Server errors never include internal details.

| Status | `code` | When | What the app should do |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | A field is missing, the wrong shape or out of range | Show `details[]` next to the fields |
| 401 | `UNAUTHENTICATED` | Token missing, invalid or expired, or the user is deactivated | Sign in again |
| 403 | `FORBIDDEN_ROLE` | The user's role can't use this route | Hide the feature |
| 404 | `NOT_FOUND` | Not found, or a patient not linked to this doctor | Show "not found" |
| 409 | `DAY_CHANGED` | The date sent is no longer the patient's today | Reload today's log |
| 409 | `ALERT_ALREADY_ACKNOWLEDGED` | Someone already acknowledged this alert | Refresh the alert |
| 409 | `CONCURRENT_UPDATE` * | Another save changed the same record at the same moment | Retry the same request |
| 409 | `IDEMPOTENCY_KEY_IN_USE` * | A request with this key is still running | Retry shortly with the same key |
| 422 | `IDEMPOTENCY_KEY_REUSED` * | The key was used for a different save | Fix the app: one key per save |
| 429 | `RATE_LIMITED` | Too many requests (see section 6) | Wait for `Retry-After` seconds |
| 500 | `INTERNAL` | Unexpected server error (logged with the request id) | Retry later; report the `requestId` |

\* Not in the v1.1 reference yet; these need rows in its Errors table.

`details[].code` values: `REQUIRED`, `UNKNOWN_TYPE`, `WRONG_SHAPE`, `OUT_OF_RANGE`,
`TOO_LONG`, `BP_SYSTOLIC_NOT_ABOVE_DIASTOLIC`, `EMPTY_READINGS`.

## 4. Paging

`GET /me/vitals/logs` (and the doctor version), `GET /doctor/alerts` and
`GET /admin/alert-thresholds` return pages:

```json
{ "data": [ … ], "nextCursor": "eyJrIjoi…" }
```

- `?limit=` sets the page size: default 20, maximum 100.
- To get the next page, send `?cursor=<nextCursor>` with the same filters. `nextCursor`
  is `null` on the last page.
- Treat the cursor as an opaque string: don't build or change it. A cursor that
  wasn't returned by the API is refused with `400 VALIDATION_FAILED`.
- Pages stay stable while new data arrives (no skipped or repeated rows).

| List | Order |
|---|---|
| Logs | Newest day first |
| Alerts | Newest first |
| Alert limits | Most recently changed first; current versions only |

## 5. Dates and time zones

- **"Today" is the current date in the patient's time zone** (from their profile),
  worked out by the server when the request arrives. If the profile has no zone, or
  one that isn't a real IANA zone (like `Asia/Kolkata`), `DEFAULT_TIME_ZONE` is used.
- Each day's log keeps the zone it was saved with, so changing a profile's zone only
  affects future days.
- Dates are sent and returned as `YYYY-MM-DD`, and must be real calendar dates
  (`2026-02-30` is refused with `400`).
- Times are returned in ISO 8601 with the patient's offset, e.g. `2026-10-09T07:05:00+05:30`.
- **Logs filter:** `?from=` and `?to=` are local dates, both included. Defaults: the
  last 30 days, ending today. `from` after `to` is refused with `400`.
- **Trends:** `?period=7d|30d|90d` (default `30d`) means the last 7, 30 or 90 local
  days, ending today, oldest first. Each day has one value, because each parameter
  is saved once per day; days with nothing logged are `null`, so the chart shows a
  gap. BP returns separate `systolic` and `diastolic` series. NUTRITION has no trend.

## 6. Rate limits

| Limit | Applies to |
|---|---|
| 30 requests per minute per user | `PUT /me/vitals/today` |
| 120 requests per minute per user | Every other route |
| 300 requests per minute per IP address | Every route, on top of the above |

Going over returns `429 RATE_LIMITED` with a `Retry-After` header (seconds).
These are starting values, to be tuned after testing.

## 7. Request id

Send an optional `X-Request-Id` header to trace a request. The server creates one
if it is missing and always returns it in the `X-Request-Id` response header, in
error bodies and in audit entries.

## 8. Versions

- **API:** the version is in the path (`/api/v1`). Changes that would break existing
  apps go to a new path (`/api/v2`); new optional fields and new error codes may be
  added to v1.
- **Parameters:** each of the 13 parameters has a `version` that goes up by one on
  every admin change. Each saved value remembers the version and unit it was saved
  under, so old values are never re-checked or re-labelled.
- **Alert limits:** every change creates a new version; old versions are kept. Each
  alert records the exact limit version it was checked against.
- **Events:** every event carries `schemaVersion` (currently 1).

## 9. Audit log

These actions are recorded in the `auditLogs` collection:

| Action | Recorded when |
|---|---|
| `VITALS_VALUE_CHANGED` | A patient's save changed at least one value |
| `PATIENT_VITALS_VIEWED` | A doctor viewed a patient's log or trends |
| `ALERT_ACKNOWLEDGED` | A doctor acknowledged an alert |
| `THRESHOLD_CHANGED` | An admin set or changed an alert limit |
| `VITAL_TYPE_CHANGED` | An admin changed a parameter |

Each entry records **who** (user id and role), **what** (the action, the route, and
the old and new values), **which patient** (when there is one), the **request id**
and **when**. A change and its audit entry are saved together: one is never saved
without the other.

The tests check the entries for admin changes (`test/admin.e2e-spec.ts`): who made
the change and the old and new values, for both alert limits and parameters.

## 10. Events

After a save commits, these events are queued: `vitals.log.updated`,
`vitals.alert.raised` (when an alert is created, and again only if its severity goes
up) and `vitals.alert.acknowledged`. Each has an `eventId` that receivers use to
ignore duplicates.

Queued events are retried with increasing delays and set aside after 24 hours of
failures. **Open item:** the sender currently only writes events to the server log;
where events should be delivered (a notification service, a message queue) still
has to be decided.
