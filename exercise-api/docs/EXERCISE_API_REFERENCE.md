# Exercise API — reference (draft for review)

**Status:** draft, being built step by step (see section 10).
**Sources:** SRS sections *Exercise & Prehabilitation*, *Doctor Portal*, *Administration Portal*,
*Critical Role-Based Workflows* and *Key Business Rules*; routes from
`docs/Fit_for_Surgery_API_Reference.pdf` (sections C, D and J).

Items marked **⏳ Waiting for client** are built with a default that can be changed later
without breaking the app. Everything else follows directly from the SRS.

---

## 1. What this module does

A doctor gives each patient a personal exercise plan, picked from a library the clinical team
provides. Each day the patient sees a checklist of what's planned, watches the demonstration
video, and ticks each exercise off when done. The doctor sees the patient's history and how
well they are keeping up (compliance).

| Role | Can do |
|---|---|
| **Admin** | Manage exercise categories and the exercise library, including video links |
| **Doctor** | Assign or change a linked patient's plan; see their history and compliance |
| **Patient** | See their own plan and today's checklist; record completions; see their own history |

### Rules from the SRS

1. A patient only ever sees exercises **in their own current plan**. The library is never
   shown to patients ("Do not expose the full exercise library to patients as a substitute
   for doctor assignment").
2. Every completion is linked to **the right patient and the right assigned exercise**.
3. A doctor reaches only **patients linked to them**. Others look like they don't exist (404).
4. Exercise programmes come from the clinical team. We store them; we don't invent them.
5. Where the SRS doesn't define a rule, threshold or formula, it needs client confirmation
   before it's built (see section 9).

---

## 2. How it fits with the other two APIs

The same pattern as Auth and Health Monitoring:

- A separate NestJS app in `exercise-api/`, on **port 3002**, paths under `/api/v1`.
- **Same database** (`ffs_health`). It **reads** `users` for role, time zone, `doctorIds` and
  `active`, and never writes it. Auth stays the only owner of users.
- **Same login:** every request carries a Firebase token; the patient id always comes from
  the token, never from the request.
- **Same conventions** as Health Monitoring (see its `docs/API_BEHAVIOUR.md`): error format,
  pagination, request id, rate limits, `Idempotency-Key`, audit log and outbox events.

So a doctor link changed in Auth, or a deactivated account, works here immediately with no
extra code.

---

## 3. Data

| Collection | Holds | Written by |
|---|---|---|
| `exerciseCategories` | The categories. Starts with the 4 from the SRS | Admin |
| `exercises` | The library: name, category, instructions, video | Admin |
| `exercisePlans` | Each patient's plan. One current version; older versions kept | Doctor |
| `exerciseCompletions` | One record per "done" tick | Patient |
| `auditLogs` | Shared with the other APIs | This API |
| `exerciseOutboxEvents` | Events waiting to be sent. Same pattern as Health Monitoring's `outboxEvents`, but its own collection: each API's sender picks up everything in its collection, so sharing one would make each API send the other's events | This API |

### Category

```json
{ "id": "…", "code": "WALKING", "name": "Walking", "order": 1, "active": true }
```

Seeded: `WALKING`, `STRENGTH`, `BREATHING`, `STRETCHING` (the four named in the SRS).

### Exercise

```json
{
  "id": "6712…",
  "name": "Seated knee extension",
  "categoryId": "…",
  "description": "Strengthens the thigh muscles.",
  "instructions": ["Sit upright", "Straighten one knee slowly", "Hold for 3 seconds"],
  "category": "STRENGTH",
  "video": { "provider": "YOUTUBE", "videoId": "dQw4w9WgXcQ", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  "active": true,
  "createdAt": "2026-10-20T10:00:00+05:30",
  "updatedAt": "2026-10-20T10:00:00+05:30"
}
```

- `video` is optional (`null` until the client supplies the link). The admin sends
  `videoUrl`: any YouTube watch, share (youtu.be), embed or shorts link, or a bare video id
  (`null` removes the video). We store only the provider and id; the app plays it. Anything
  that isn't a YouTube video link is refused with `WRONG_SHAPE`. Checking that the video
  actually plays (exists, Unlisted or Public, embedding allowed) isn't built yet. ⏳ *Videos*
- Deleting an exercise **deactivates** it (`active: false`), so history and old plans never
  break. ⏳ *Deletion policy*

### Plan

```json
{
  "patientId": "…",
  "version": 3,
  "items": [
    {
      "itemId": "a1",
      "exercise": { "id": "…", "name": "Seated knee extension", "category": "STRENGTH", "video": { … } },
      "schedule": { "daysOfWeek": [1, 2, 3, 4, 5, 6, 7], "timesPerDay": 1 },
      "target": { "sets": 2, "reps": 10, "durationMin": null },
      "notes": "Stop if pain goes above 5"
    }
  ],
  "assignedBy": { "id": "…", "name": "Dr Meera Nair" },
  "updatedAt": "2026-10-20T10:00:00+05:30"
}
```

- **One current plan per patient.** Changing it creates a new `version`; old versions are
  kept, so history always shows what was planned on any day.
- `schedule`: days of the week (1 = Monday … 7 = Sunday) and how many times a day.
  ⏳ *Plan structure*
- `target` is optional and free-form (sets, reps, minutes). It's shown to the patient; it isn't
  checked. ⏳ *Plan structure*
- `itemId` is set by the server and stays the same across versions while the exercise stays
  in the plan, so completions remain linked.
- Each exercise appears at most once in a plan; `timesPerDay` says how often.
- `exercise` holds the library's details live, so a video added later reaches the patient
  straight away. If an admin deactivates an exercise that's already planned, it stays in the
  plan with `active: false` until the doctor changes the plan.
- A patient with no plan yet gets `version: 0`, an empty `items` list, and `assignedBy` and
  `updatedAt` as `null`.

### Completion

```json
{
  "id": "…",
  "patientId": "…",
  "itemId": "a1",
  "exerciseId": "…",
  "planVersion": 3,
  "date": "2026-10-20",
  "completedAt": "2026-10-20T08:15:00+05:30",
  "details": null
}
```

- `date` is the patient's local date, in their profile time zone (same rule as Health Monitoring).
- `details` is optional. ⏳ *What the patient records*

---

## 4. Endpoints

All paths start with `/api/v1`. Responses use the same error format and pagination as
Health Monitoring.

### Categories and library

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/exercise-categories` | All | List active categories (admin: `?includeInactive=true` for all) |
| POST | `/exercise-categories` | Admin | Add a category (`code`, `name`, optional `order`) |
| PATCH | `/exercise-categories/:categoryId` | Admin | Rename, reorder, deactivate, reactivate. The code can't change |
| DELETE | `/exercise-categories/:categoryId` | Admin | Deactivate (refused while active exercises use it) |
| GET | `/exercises` | All | Admin and doctor: the library, A to Z (filter by `category` code, `active=true\|false`, search `q`; paged). **Patient: only exercises in their current plan** |
| GET | `/exercises/:exerciseId` | All | One exercise, active or not. A patient gets 404 unless it's in their plan |
| POST | `/exercises` | Admin | Add an exercise (`name`, `categoryId`, optional `description`, `instructions`, `videoUrl`) |
| PATCH | `/exercises/:exerciseId` | Admin | Change it, including the video; `active: true` brings it back |
| DELETE | `/exercises/:exerciseId` | Admin | Deactivate it |

### Plans

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/patients/me/exercise-plan` | Patient | My current plan, with exercise details and videos included |
| GET | `/patients/:patientId/exercise-plan` | Linked doctor | A patient's current plan |
| PUT | `/patients/:patientId/exercise-plan` | Linked doctor | Assign or replace the plan |
| GET | `/patients/:patientId/exercise-plan/versions` | Linked doctor | Earlier versions *(proposed addition)* |

**PUT body**

```json
{
  "version": 2,
  "items": [
    { "exerciseId": "…", "schedule": { "daysOfWeek": [1,3,5], "timesPerDay": 1 }, "target": { "sets": 2, "reps": 10 }, "notes": null }
  ]
}
```

- `version` is the version the doctor last saw (0 for a first plan). If someone else changed
  the plan since, the save is refused with `409 CONCURRENT_UPDATE`, so two doctors can't
  overwrite each other.
- Every exercise must exist and be active (`UNKNOWN_ID` / `NOT_ALLOWED` on
  `items.<n>.exerciseId`), and appear only once (`ALREADY_EXISTS`).
- An empty `items` list clears the plan (as a new version).
- Saving the same items again creates no new version, audit record or event.
- A doctor's views of the plan and its versions are audited (`EXERCISE_PLAN_VIEWED`).

### Today's checklist *(proposed addition)*

The SRS asks for a *Daily Exercise Checklist*; the route list doesn't have one.

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/patients/me/exercise-checklist` | Patient | Today's planned exercises, and how many times each is done |
| GET | `/patients/:patientId/exercise-checklist?date=` | Linked doctor | The same, for one day |

```json
{
  "date": "2026-10-20",
  "items": [ { "itemId": "a1", "exercise": { … }, "timesPerDay": 1, "doneCount": 1, "status": "DONE" } ],
  "doneCount": 3,
  "plannedCount": 5
}
```

`status` is `NOT_YET`, `PARTLY_DONE` or `DONE`.

### Completions and history

| Method | Path | Who | What it does |
|---|---|---|---|
| POST | `/exercise-completions` | Patient | Record "I did this one" |
| DELETE | `/exercise-completions/:completionId` | Patient | Undo a tick, same day only ⏳ *Edit and undo policy* |
| GET | `/patients/me/exercise-completions` | Patient | My history (`from`, `to`, paged) |
| GET | `/patients/:patientId/exercise-completions` | Linked doctor | A patient's history |

**POST body**

```json
{ "itemId": "a1", "date": "2026-10-20", "details": null }
```

Checks, in order:
1. `itemId` is in the patient's **current** plan → otherwise `409 EXERCISE_NOT_IN_PLAN`.
2. `date` is the patient's today → otherwise `409 DAY_CHANGED` (same as Health Monitoring).
3. Not already done `timesPerDay` times today → otherwise `409 EXERCISE_ALREADY_DONE`.
   ⏳ *Extra completions*

Supports `Idempotency-Key`, so a retry after a timeout never counts twice.

### Compliance

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/patients/:patientId/exercise-compliance?from=&to=` | Linked doctor | How well the patient kept to the plan |

```json
{
  "from": "2026-10-14",
  "to": "2026-10-20",
  "planned": 35,
  "done": 28,
  "percentage": null,
  "byDay": [ { "date": "2026-10-20", "planned": 5, "done": 4 } ],
  "byExercise": [ { "itemId": "a1", "name": "Seated knee extension", "planned": 7, "done": 7 } ]
}
```

`planned` and `done` are counts. `percentage` stays `null` until the client agrees the
formula. ⏳ *Compliance formula*

---

## 5. Errors

Same format and codes as Health Monitoring, plus:

| Status | `code` | When |
|---|---|---|
| 409 | `EXERCISE_NOT_IN_PLAN` | A completion for an exercise that isn't in the patient's current plan |
| 409 | `EXERCISE_ALREADY_DONE` | Already done the planned number of times today |
| 400 | `VALIDATION_FAILED` with `details[].code = NOT_ALLOWED` | Using a deactivated exercise or category, or deactivating a category that's in use |
| 400 | `VALIDATION_FAILED` with `details[].code = UNKNOWN_ID` | An id that points at nothing, e.g. an unknown `categoryId` |
| 400 | `VALIDATION_FAILED` with `details[].code = ALREADY_EXISTS` | A category code that's already taken |

---

## 6. Audit log

| Action | When |
|---|---|
| `EXERCISE_PLAN_CHANGED` | A doctor assigns or changes a plan (old and new plan recorded) |
| `EXERCISE_PLAN_VIEWED` | A doctor views a patient's plan, checklist, history or compliance |
| `EXERCISE_LIBRARY_CHANGED` | An admin adds, changes or deactivates an exercise or category |

---

## 7. Events

Saved in the outbox in the same transaction as the change, for the timeline, notifications and
analytics modules to use later:

| Event | When |
|---|---|
| `exercise.plan.assigned` | A plan is assigned or changed. Lets the patient be told |
| `exercise.completed` | A patient ticks an exercise off. Feeds the patient timeline |

Delivery has the same open item as Health Monitoring: where events go is not decided yet.

---

## 8. Not in this module

These are in the SRS but belong to other modules. This API provides the data they need.

- **Reminders and missed-exercise alerts** (Notifications): need push notifications (FCM)
  and agreed rules.
- **Compliance analytics, weekly and monthly summaries** (Analytics and Reports).
- **Exercise completions on the patient timeline** (Timeline): uses `exercise.completed`.

---

## 9. Waiting for client

| Topic | Question | Default until answered |
|---|---|---|
| **Videos** | The SRS says *private* YouTube videos. Private videos only play for invited Google accounts, so they won't play for patients in the app; *Unlisted* plays for anyone with the link. Will the clinic upload its own videos as Unlisted, or use other channels' videos? | Store the YouTube id; the app plays it. No check yet that the video plays |
| **Plan structure** | How is a plan described: days of the week, times per day, sets, reps, minutes? Do plans have start and end dates or phases? | Days of week + times per day; optional sets / reps / minutes; no dates |
| **What the patient records** | Just "done", or also minutes, difficulty or pain? | Just "done"; `details` accepted but optional |
| **Compliance formula** | How is the compliance percentage worked out? | Counts only; percentage `null` |
| **Extra completions** | Can a patient do an exercise more often than planned, or on a day it isn't planned? | Refused beyond the planned number; only planned days |
| **Edit and undo** | Can a patient undo a tick? Fill in a past day? | Undo same day only; no past days |
| **Deletion policy** | Can exercises or categories be deleted for good? | Deactivate only |
| **Library content** | The exercises, instructions and videos | Provided by the clinical team |

---

## 10. Build order

1. Project setup, categories and the library (admin) — **done**
2. Plans (doctor assigns; patient and doctor view), and the patient's plan-only view of
   `/exercises` — **done**
3. Today's checklist, completions and history
4. Compliance counts
5. A journey test with Auth and Health Monitoring, on one database
