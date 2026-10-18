# Health Monitoring API — start here

Backend for the **Health Monitoring** module of Fit for Surgery. Patients log 13 daily health readings, doctors see logs, trends and alerts, and admins set alert limits.

- Built with NestJS, MongoDB and Firebase login, following `docs/Health_Monitoring_API_Reference_v1.1.pdf`.
- Status: **all 13 endpoints done and tested.** 118 automated tests pass, and the Postman collection passes 113 of 113 checks.

Setup takes about 15 minutes the first time.

---

## 1. Install these first

| Tool | Version | Get it from |
|---|---|---|
| Node.js | 20 or newer (tested on 22) | nodejs.org (LTS) |
| Docker Desktop | any recent | docker.com/products/docker-desktop |
| Postman | any recent, signed in with a free account | postman.com/downloads |

To check Node.js, run `node -v` in a terminal.

## 2. Get Firebase access

The API uses the Firebase project **`rehab-app-development`** for login.

1. Ask Shubham to add your Google account to the Firebase project.
2. Open console.firebase.google.com → **rehab-app-development** → **Settings → Service accounts** → **Generate new private key** → **Generate key**.
3. Rename the downloaded file to exactly **`firebase-service-account.json`** and put it in this folder, next to `package.json`.
   - Windows hides file extensions, so check it isn't saved as `firebase-service-account.json.json`.
   - **Never share this file or upload it anywhere.** It gives full control of the Firebase project.

The four test logins (patient, second patient, doctor, admin) already exist in this Firebase project, so you don't need to create them.

## 3. Set up and start the API

Open a terminal **in this folder** and run:

```
copy .env.example .env
```

Open `.env` and set:

```
FIREBASE_PROJECT_ID=rehab-app-development
SWAGGER_ENABLED=true
```

`SWAGGER_ENABLED=true` turns on the API docs page. It is only for your own computer: the page has no login, so it stays off on real servers.

Start **Docker Desktop** and wait until it says "Engine running". Then run:

```
npm install
docker compose up -d
npm run seed
npm run start:dev
```

| Command | What it does |
|---|---|
| `npm install` | Downloads the libraries (once, a few minutes) |
| `docker compose up -d` | Starts the MongoDB database |
| `npm run seed` | Adds the 13 parameters and the demo patient, doctor and admin |
| `npm run start:dev` | Starts the API. Leave this terminal open |

**Check it works:** open **http://localhost:3000/api/docs** in your browser. You should see the Swagger page listing all 13 endpoints.

## 4. Test with Postman

1. In Postman, click **Import** (top left) and choose both files in the `postman` folder:
   - `Health_Monitoring_API.postman_collection.json`
   - `Health_Monitoring_Local.postman_environment.json`
2. At the **top right**, change **No environment** to **Health Monitoring - Local**. The Firebase key and test password are already filled in.
3. In **Collections**, hover over **Health Monitoring API v1.1** → **⋯** → **Run collection**. Check that Environment says **Health Monitoring - Local**, then click **Run**.

**Expected result: Passed 113, Failed 0.**

| Folder | What it tests |
|---|---|
| 0. Login | Signs in as patient, doctor and admin through Firebase |
| 1. Admin setup | Sets alert limits (pain above 6, BP systolic above 140) |
| 2. Patient | Saves today's readings, gets a pain alert, reads logs and trends |
| 3. Doctor | Sees the alert, views the patient, acknowledges the alert |
| 4. Error cases | 16 checks: 401, 403, 404, 409 and 400 errors |

To try one request on its own, click it and press **Send**. Run the **0. Login** folder first: login tokens expire after 1 hour.

The test logins all use the password you set as `FIREBASE_TEST_PASSWORD` in `.env` (ask the team for the shared one; it is not kept in the repo):

| Role | Email |
|---|---|
| Patient | `patient.rajesh@ffs-health.test` |
| Patient 2 | `patient.anita@ffs-health.test` |
| Doctor | `doctor.meera@ffs-health.test` |
| Admin | `admin@ffs-health.test` |

## 5. Automated tests (optional)

```
npm test
```

This runs 118 tests. It needs neither Firebase nor Docker, but it does need about 200 MB of free disk space.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `Firebase credentials missing` when starting | `firebase-service-account.json` is missing, misnamed (`.json.json`), or not next to `package.json` |
| `MongoServerSelectionError` or `ECONNREFUSED 27017` | Docker Desktop isn't running. Start it, then run `docker compose up -d` |
| `EADDRINUSE` / port 3000 already in use | The API is already running in another terminal. Close that one |
| Postman login requests return **400** | No environment selected at the top right, or the Firebase Web API key is wrong |
| Postman requests return **401** after a while | The token expired. Run the **0. Login** folder again |
| Postman shows "No response" | The API isn't running. Run `npm run start:dev` |

## Stopping and starting again

- **Stop:** press **Ctrl + C** in the API terminal. To also stop the database, run `docker compose down`. Your data is kept.
- **Start again later:** open Docker Desktop, then run `docker compose up -d` and `npm run start:dev`.

## Good to know

- Alert limits in the tests (pain above 6, pulse 50–110) are **placeholders**. Real limits are waiting on the clinical team.
- Events for the Timeline and Notifications modules are only printed to the console for now, until those modules exist.
- One error code was added during building, on 14 Oct: **`409 CONCURRENT_UPDATE`**. It means the record was changed by someone else at the same moment; retry the request. It is in the Errors table of the API reference.
- More technical detail is in `README.md`. Postman details are in `postman/README.md`.
