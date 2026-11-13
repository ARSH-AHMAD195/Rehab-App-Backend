# Fit for Surgery — Auth & User Management API

Node.js implementation of **Auth & User Management API reference v1.0 (15 Oct 2026)**, in
[`docs/Auth_API_Reference_v1.0.pdf`](../docs/Auth_API_Reference_v1.0.pdf).
NestJS 11 + Mongoose 8 + MongoDB, Firebase Authentication, Swagger at `/api/docs`.

It covers the nine SRS items under User Authentication & User Management, and owns the `users`
collection that Health Monitoring reads. All 18 endpoints from v1.0 are implemented.

New here? Follow [START_HERE.md](START_HERE.md) step by step.

---

## Run it

```bash
cp .env.example .env            # then fill in the Firebase section
docker compose up -d            # MongoDB 7 replica set - skip if Health Monitoring's is running
npm install
npm run create-admin -- --email you@example.com --name "Your Name"   # first admin only
npm run start:dev
```

- API: `http://localhost:3001/api/v1` (port 3001, so it runs next to Health Monitoring on 3000)
- Swagger: `http://localhost:3001/api/docs`, when `SWAGGER_ENABLED=true`. Off by default: the page
  is outside the auth guard, so enable it only for local development.

**Same database as Health Monitoring.** Both APIs use `ffs_health` and its `users` collection, so
a patient registered here can log vitals there, and a doctor link set here gives access there.

### Tests

```bash
npm test          # 74 end-to-end tests against a throwaway in-memory replica set
npm run typecheck
```

The tests replace Firebase with a fake (`test/helpers/test-app.ts`), so they need no Firebase
project. Everything else — guards, validation, transactions, audit — is the production wiring.

---

## The 28 endpoints

| Method | Route | Role | Source |
|---|---|---|---|
| GET | `/auth/me` | any (even unverified) | `src/me/me.controller.ts` |
| GET | `/users/me/profile` | any | ″ |
| PATCH | `/users/me/profile` | any | ″ |
| POST | `/admins` | admin | `src/doctors/admins.controller.ts` |
| POST | `/doctors` | admin | `src/doctors/doctors.controller.ts` |
| GET | `/doctors` | admin | ″ |
| GET | `/doctors/:doctorId` | admin | ″ |
| PATCH | `/doctors/:doctorId` | admin | ″ |
| POST | `/patients` | doctor, admin | `src/patients/patients.controller.ts` |
| GET | `/patients` | doctor, admin | ″ |
| GET | `/patients/:patientId` | doctor, admin | ″ |
| PATCH | `/patients/:patientId` | doctor, admin | ″ |
| PUT | `/patients/:patientId/doctors` | admin | ″ |
| POST | `/users/:userId/invitations` | admin, doctor | `src/registration/invitations.controller.ts` |
| GET | `/patients/me/medical-profile` | patient | `src/medical-profiles/medical-profiles.controller.ts` |
| PATCH | `/patients/me/medical-profile` | patient | ″ |
| GET | `/patients/:patientId/medical-profile` | doctor | ″ |
| PATCH | `/patients/:patientId/medical-profile` | doctor | ″ |
| POST | `/auth/login-code/request` | no sign-in | `src/login-codes/login-codes.controller.ts` |
| POST | `/auth/login-code/verify` | no sign-in | ″ |
| GET | `/doctor/login-code-requests` | doctor, admin | ″ |
| POST | `/patients/:patientId/login-code` | doctor, admin | ″ |
| GET | `/investigation-tests` | doctor, admin | `src/investigations/investigations.controller.ts` |
| POST | `/patients/:patientId/investigations` | doctor | ″ |
| GET | `/patients/:patientId/investigations` | doctor | ″ |
| POST | `/patients/:patientId/investigations/:resultId/retract` | doctor | ″ |
| GET | `/admin/investigation-ranges` | admin | ″ |
| PUT | `/admin/investigation-ranges` | admin | ″ |

Email login and Forgot Password have no routes: the app does them with the Firebase SDK. Patient
login with a doctor-issued code is below (section 7).

## Collections

| Collection | Holds |
|---|---|
| `users` | Every user: role, name, email, phone, active; `timeZone` and `doctorIds` for patients; `specialization` for doctors |
| `medicalProfiles` | One per patient, kept apart from `users` so admin screens never load medical data |
| `loginCodes` | One per patient: their open code request and/or the hash of their current login code. Deletes itself when done |
| `investigations` | One row per test result (patient, test, date, values or WNL). Never edited or deleted; wrong ones are retracted |
| `investigationRanges` | Approved normal ranges, one per test field. Empty until the clinical team supplies them |
| `auditLogs` | Shared with Health Monitoring; this module writes 15 actions |

## Where the v1.0 rules live

| v1.0 section | Code |
|---|---|
| Access rules (token, verified email, role) | `src/common/guards/` — registered in order in `app.module.ts` |
| Doctor sees only linked patients (404 otherwise) | `src/users/users.service.ts` → `getPatientFor` |
| Onboarding (account + profile + email, with clean-up) | `src/registration/registration.service.ts` |
| Invitations, 5 per user per hour | `src/registration/invitations.service.ts` |
| Profile edits and (de)activation | `src/users/accounts.service.ts` |
| Doctor can't be deactivated while sole doctor | `src/doctors/doctors.service.ts` → `assertNotSoleDoctor` |
| Medical profile, versioning, audited reads | `src/medical-profiles/medical-profiles.service.ts` |
| Firebase calls (the only place) | `src/identity/firebase-identity.provider.ts` |
| Rate limits + `Retry-After` | `src/common/throttler/scoped-throttler.guard.ts` |
| Single error shape | `src/common/filters/all-exceptions.filter.ts` |

---

## Things to know before building on this

### 1. Firebase is the only place passwords live
`src/identity/` is the only code that talks to Firebase. New accounts get a random password
nobody knows, and Firebase emails the user a link to set their own
(`accounts:sendOobCode`, `PASSWORD_RESET`). That needs `FIREBASE_WEB_API_KEY` and no mail server.
To send branded emails from the client's SMTP later, change only `sendSetPasswordEmail`.

### 2. Deactivation is immediate
Deactivating disables the Firebase account and revokes its sessions, and tokens are verified with
`checkRevoked`, so a deactivated user is locked out on their next request, not when their token
expires. Health Monitoring checks `users.active` too.

### 3. `emailVerified` in lists is a cached copy
Firebase owns it. The auth guard copies the value from each user's own token whenever they call
the API, so `GET /patients` can show it without one Firebase call per row.

### 4. Medical profile fields are a proposal
They are listed in the reference and need clinical confirmation. They live in
`src/medical-profiles/medical-profile.schema.ts` and `medical-profile.dto.ts`.

The doctor onboarding fields from the client's November 2026 change request are there too:
`onboardingWeightKg`, `chemotherapy`, `radiotherapy`, `lastChemoDate`, `chemoSchedule`, `anaemia`,
`conditions` (checkboxes: `HTN`, `DM`, `CKD`, `IHD`, `SMOKING`, `OTHER`) and `otherConditions`.
Hb, albumin and the nutrition score are not here yet: they arrive with investigations and triage.

The API also returns three read-only values, worked out on every read so they never go stale
(`src/medical-profiles/derived.ts`): `age` (from `dateOfBirth`), `bmi` (from `onboardingWeightKg`
and `heightCm`, 1 decimal) and `daysToSurgery` (from `plannedSurgeryDate`, in the patient's own
time zone; negative once surgery has passed). `GET /patients` shows each patient's
`plannedSurgeryDate` and `daysToSurgery`.

### 5. Health Monitoring compatibility
`users` keeps every field Health Monitoring reads (`firebaseUid`, `role`, `name`, `timeZone`,
`doctorIds`, `active`) with the same meaning. Once both modules are merged, Health Monitoring's
`users.service.ts` placeholder can be pointed at this collection as-is, and its
`scripts/seed.ts` users replaced by `npm run seed:dev-users` here.

### 6. Development logins
`npm run seed:dev-users` creates five verified test logins (admin, two doctors, two patients)
with the password in `FIREBASE_TEST_PASSWORD`. They use the same uids as Health Monitoring's test
users, so one login works on both APIs. **Never run it against production.**

### 7. Patient login with a code from their doctor (no SMS)
The client asked for mobile number + one-time code, but **not** sent by SMS: the code goes to the
patient's doctor, who passes it on (in person, by phone or by message).

1. Patient app: phone number → `POST /auth/login-code/request`. Always `202` with the same
   message, so the route can't be used to find out who is a patient. Optional: the doctor can
   also make a code without being asked.
2. Doctor app: `GET /doctor/login-code-requests` lists linked patients waiting (an admin sees
   all). `POST /patients/:patientId/login-code` returns a 6-digit code, once, to pass on. A new
   code replaces the old one.
3. Patient app: phone + code → `POST /auth/login-code/verify` → `{ customToken }`. Pass it to
   Firebase's `signInWithCustomToken`; from then on use normal ID tokens, as with email login.
   The patient stays signed in on that phone.

Rules: a code works once, for 10 minutes, for 5 tries (`LOGIN_CODE_TTL_MINUTES`,
`LOGIN_CODE_MAX_ATTEMPTS` - defaults until the client confirms). Only its hash is stored, and it is
never logged; request, issue and use are audited. Every failure is the same
`401 INVALID_LOGIN_CODE`. Both sign-in routes allow 10 calls per minute per IP address.

A code-login patient has no email to verify: `GET /auth/me` returns `loginMethod: "LOGIN_CODE"`
(so the app skips the "verify your email" screen), and all three APIs accept them. This only
holds for patients: only this API can make custom tokens, and it makes them only for patients.

Registration: a patient needs a phone number, an email or both. Phone only →
`invitation: "NOT_NEEDED"` and no email. A patient's phone number is unique among patients
(`409 PHONE_ALREADY_EXISTS`); doctors and admins may share one.

**Before deploying:** the unique index on patients' phone numbers can't be built if two patients
already share a number. Check with
`db.users.aggregate([{$match:{role:"PATIENT",phone:{$type:"string"}}},{$group:{_id:"$phone",n:{$sum:1}}},{$match:{n:{$gt:1}}}])`
and fix any it finds first.

### 8. Investigations (the PAC grid)
The doctor's Investigations menu follows the hospital's pre-anaesthesia check-up form, plus serum
albumin (needed for triage). The tests and their fields are in
`src/investigations/investigation-tests.ts`; `GET /investigation-tests` serves them to the app.
Blood group is not here: it is already on the medical profile.

- **One result = one test on one date.** Repeat tests are new results, so the history is always
  kept. `GET /patients/:patientId/investigations` returns every test with its results, newest test
  date first; the app shows the first 2-3 side by side for the trend.
- **WNL quick entry** (`wnl: true`, no values) for LFT, TFT, ECG and imaging. Imaging still names
  the study (e.g. "Chest X-ray").
- **Never edited or deleted.** A wrong result is retracted with a reason
  (`POST .../:resultId/retract`): kept, audited, and hidden from the grid unless
  `?includeRetracted=true`. The right value is entered as a new result.
- **Red flags only against approved ranges.** An admin enters the clinical team's normal ranges
  with `PUT /admin/investigation-ranges`; the list starts empty and nothing is flagged until a
  range exists. Results are checked against the range in force when they are read, so a newly
  approved range also flags older results. An abnormal ECG is always flagged.
- The `min`/`max` on each field only catch typing mistakes (Hb 110 instead of 11.0); they are
  not clinical limits.
- Doctors only (linked patients), like the medical profile. Reads and changes are audited, and a
  read that can't be audited fails.

Waiting on the client: the normal ranges (and whether they differ by age or sex), the eGFR formula
(creatinine is stored, eGFR is not worked out yet), and what "Free text medication assigned" means.
Hb, albumin, HbA1c and creatinine are marked `feedsTriage` for the triage work.

### 9. Triage tag (HIGH / MEDIUM / LOW)
From the client's table (change request, Nov 2026, section 3). The rules are a pure, separately
tested function in `src/triage/triage-rules.ts`; the numbers are a versioned setting.

- **Worked out on every read**, from the medical profile, the newest active investigation results
  (Hb, albumin, MUST, HbA1c, lab-reported eGFR on the creatinine result) and the newest pulse and
  BP in Health Monitoring's daily vitals (last 7 days, read-only). So it is never stale, whoever
  entered the value.
- `GET /patients/:patientId/triage` (doctor, audited): the tag, each reason with its value and
  date, and `missing` (what could not count). The patient list shows `triage: { tag, provisional,
  complete }` on every patient.
- **Missing data never raises the tag**; it is listed instead. Condition-specific values (HbA1c,
  eGFR, IHD status, BP medication, last chemo date) are only "missing" when that condition is ticked.
- **Provisional until confirmed.** Version 1 of the rules is the client's table, added on first
  start with `confirmed: false`, and every tag says `provisional: true`. Once the clinical team
  answers, an admin saves the confirmed numbers with `PUT /admin/triage-rules`; old versions are
  kept and the change is audited.

How the open boundaries were read (all changeable in the setting): age 60-70 Medium with 70
included, over 70 High; Hb 8 to under 11 Medium; albumin 3.0 to under 3.5 Medium; HbA1c 7-8.5
Medium with 8.5 included; eGFR 30 to under 60 Medium; pulse 90-100 Medium; BP High at 180
systolic OR 110 diastolic; quit smoking under 56 days ago Medium; MI/stent within 183 days High;
chemo within 28 days Medium. eGFR is taken as the lab reports it, not calculated.

New onboarding fields for triage: `smokingQuitDate`, `hypertensionOnMedication`, `ihdStatus`
(STABLE/SYMPTOMATIC), `lastMiOrStentDate`, `canClimbTwoFlights`. MUST and PG-SGA scores are
entered as dated investigations, so their history is kept.
