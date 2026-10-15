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
- Swagger: `http://localhost:3001/api/docs`

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

## The 18 endpoints

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

Login and Forgot Password have no routes: the app does them with the Firebase SDK.

## Collections

| Collection | Holds |
|---|---|
| `users` | Every user: role, name, email, phone, active; `timeZone` and `doctorIds` for patients; `specialization` for doctors |
| `medicalProfiles` | One per patient, kept apart from `users` so admin screens never load medical data |
| `auditLogs` | Shared with Health Monitoring; this module writes 8 actions |

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

### 5. Health Monitoring compatibility
`users` keeps every field Health Monitoring reads (`firebaseUid`, `role`, `name`, `timeZone`,
`doctorIds`, `active`) with the same meaning. Once both modules are merged, Health Monitoring's
`users.service.ts` placeholder can be pointed at this collection as-is, and its
`scripts/seed.ts` users replaced by `npm run seed:dev-users` here.

### 6. Development logins
`npm run seed:dev-users` creates five verified test logins (admin, two doctors, two patients)
with the password in `FIREBASE_TEST_PASSWORD`. They use the same uids as Health Monitoring's test
users, so one login works on both APIs. **Never run it against production.**
