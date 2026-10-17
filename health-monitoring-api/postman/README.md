# Testing the Health Monitoring API with Postman

The collection covers all 13 endpoints as patient, doctor and admin, plus 16 error cases.
Every request checks its own result, so one Collection Runner run tells you whether the API works.

| File | What it is |
|---|---|
| `Health_Monitoring_API.postman_collection.json` | 37 requests in 5 folders, with automatic checks |
| `Health_Monitoring_Local.postman_environment.json` | Server URL, test logins, and the values the requests pass along |

## One-time setup

**1. Firebase project** (Firebase console):
- Authentication → Sign-in method → enable **Email/Password**.
- Project settings → Service accounts → **Generate new private key**. Save it in `health-monitoring-api/` as `firebase-service-account.json`. This file is git-ignored; never commit or share it.
- Project settings → General → copy the **Web API key**. Postman needs it.

**2. Server config.** In `health-monitoring-api/`, copy `.env.example` to `.env` and set `FIREBASE_PROJECT_ID`.

**3. Database, demo data and test logins.** Start Docker Desktop, then run in `health-monitoring-api/`:

```
docker compose up -d
npm install
npm run seed
npx ts-node scripts/create-firebase-test-users.ts
```

The last command creates the four Firebase test users that match the seeded patients, doctor and admin, and prints their password.

**4. Start the API:**

```
npm run start:dev
```

It runs at `http://localhost:3000/api/v1`. Swagger docs are at `http://localhost:3000/api/docs`.

**5. Postman:**
1. Click **Import** and choose both JSON files.
2. Select the environment **Health Monitoring - Local** (top right).
3. Fill in `firebaseApiKey` (step 1) and `testPassword` (printed in step 3).

## Running the tests

Right-click the collection → **Run collection** → **Run**. The folders run in order:

| Folder | What it checks |
|---|---|
| 0. Login | Gets a Firebase token for patient, doctor and admin. Tokens last 1 hour; run this folder again after that |
| 1. Admin setup | Sets alert limits (pain above 6, BP systolic above 140) and edits a parameter |
| 2. Patient | Loads the form, saves today's readings, gets a pain alert, retries safely, reads logs and trends |
| 3. Doctor | Finds the alert, views the patient's log and trends, acknowledges the alert |
| 4. Error cases | No/bad token (401), wrong role (403), unlinked patient (404), wrong day (409), invalid values (400), double acknowledgement (409) |

**Expected result: every check passes.** The collection can be run again the same day.

## Good to know

- The alert limits set in folder 1 are **placeholders for testing**. Real limits are still pending the clinical team.
- Dates use the patient's time zone, Asia/Kolkata, so "today" can differ from your clock near midnight.
- Rate limits are not in the collection: hitting them would block the rest of the run. They are covered by the automated tests (`npm test`).
- A failed request shows the API's error in the response body. Include its `code` and `requestId` when you report a problem.
