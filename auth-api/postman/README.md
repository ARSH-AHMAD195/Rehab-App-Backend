# Testing the Auth API with Postman

The collection covers all 18 endpoints as admin, doctor and patient, plus 12 error cases.
Every request checks its own result, so one Collection Runner run tells you whether the API works.

| File | What it is |
|---|---|
| `Auth_API.postman_collection.json` | 39 requests in 7 folders, with automatic checks |
| `Auth_API_Local.postman_environment.json` | Server URL, test logins, and the values the requests pass along |

## Setup

1. Do steps 1–5 of [START_HERE.md](../START_HERE.md): the server should be running on port 3001,
   and `npm run seed:dev-users` should have created the test logins.
2. In Postman, click **Import** and choose both JSON files.
3. Select the environment **Auth API - Local** (top right).
4. Fill in `firebaseApiKey` (your Firebase Web API key) and `testPassword` (your
   `FIREBASE_TEST_PASSWORD`). These are left empty in the repo on purpose.

## Running the tests

Right-click the collection → **Run collection** → **Run**. The folders run in order:

| Folder | What it checks |
|---|---|
| 0. Login | Gets a Firebase token for admin, doctor and patient. Tokens last 1 hour; run it again after that |
| 1. Identity and own profile | `GET /auth/me`, view and edit own profile |
| 2. Admin: doctors and admins | List doctors, register a doctor and an admin, update a doctor |
| 3. Doctor: patients | Register a patient (linked to the doctor), list, search, update, resend the email |
| 4. Medical profile | Patient and doctor read and edit it, with version numbers |
| 5. Admin: links and deactivation | Link a second doctor, filter by doctor, deactivate the test patient and doctor |
| 6. Error cases | 401, 403 (wrong role, admin reading medical data), 404, duplicate email, stale version, sole-doctor deactivation |

**Expected result: 74 assertions, 0 failed.** The collection can be run again at any time.

## Good to know

- Each run **registers one doctor, one admin and one patient** with `@ffs-health.test` emails,
  which nobody receives. The doctor and patient are deactivated at the end of the run. They stay
  in the database as test data.
- "Deactivate a patient's only doctor → 409" checks that Dr Meera **can't** be deactivated. If
  that check ever fails, run `npm run seed:dev-users` to restore the test logins.
