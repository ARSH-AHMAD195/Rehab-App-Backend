# Start here: running the Auth API on your computer

Follow these steps in order. Each one says what you should see when it worked.

## 1. What you need installed

| Tool | Check it works |
|---|---|
| Node.js 20 or newer | `node --version` |
| Docker Desktop (running) | `docker --version` |
| Postman (optional, for testing by hand) | open the app |

## 2. Firebase settings

You need three things from the Firebase console (project **rehab-app-development**). Ask the
team if you don't have access.

1. **Service account key:** Project settings → Service accounts → **Generate new private key**.
   Save the file in `auth-api/` as `firebase-service-account.json`. It is git-ignored; never
   commit or share it.
2. **Web API key:** Project settings → General → **Web API key**.
3. **Email/Password sign-in:** Authentication → Sign-in method → **Email/Password** must be enabled.

## 3. Create your `.env`

In the `auth-api/` folder, copy `.env.example` to `.env`, then fill in:

```
FIREBASE_PROJECT_ID=rehab-app-development
FIREBASE_WEB_API_KEY=<the Web API key from step 2>
FIREBASE_TEST_PASSWORD=<a password of your choice, for test logins>
```

`.env` is git-ignored. Never commit it.

## 4. Start the database

If Health Monitoring's database is already running (`docker ps` shows `ffs-health-mongo`), skip
this step: both APIs share it. Otherwise, in `auth-api/`:

```
docker compose up -d
```

## 5. Install and start

```
npm install
npm run seed:dev-users
npm run start:dev
```

`seed:dev-users` prints five test logins. When the server is ready you will see
`Auth API listening on :3001`. Open `http://localhost:3001/api/docs` to see every endpoint.

## 6. Test it

**Automated tests** (no Firebase or Docker needed):

```
npm test
```

You should see `Tests: 74 passed`.

**Postman:** see [postman/README.md](postman/README.md). One run of the collection should show
**74 assertions, 0 failed**.

## Test logins

All use the password you set as `FIREBASE_TEST_PASSWORD`:

| Role | Email |
|---|---|
| Admin | `admin@ffs-health.test` |
| Doctor | `doctor.meera@ffs-health.test` |
| Doctor 2 | `doctor.arjun@ffs-health.test` |
| Patient | `patient.rajesh@ffs-health.test` |
| Patient 2 | `patient.anita@ffs-health.test` |

The same logins work on the Health Monitoring API.

## For a real deployment: the first admin

Don't use `seed:dev-users` in production. Create the first real admin once with:

```
npm run create-admin -- --email admin@hospital.org --name "Full Name"
```

They get an email to set their password. After that, they register doctors and other admins in
the app.
