/**
 * Creates (or updates) the Firebase Auth users that match the seeded profiles,
 * so Postman can sign in as each role.
 *
 * `npm run seed` stores users with fixed firebaseUid values. The Firebase
 * console cannot set a uid, so this script does it with the Admin SDK, using
 * the same credentials as the API (.env).
 *
 *   npx ts-node scripts/create-firebase-test-users.ts
 *
 * Password: FIREBASE_TEST_PASSWORD from .env (required - it is never kept in
 * the repo). These are test accounts only - never use real patient data with them.
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import * as admin from 'firebase-admin';

loadEnv();

// uids must match SEED_FIREBASE_UIDS in scripts/seed.ts; emails match the
// Postman environment (postman/Health_Monitoring_Local.postman_environment.json).
const TEST_USERS = [
  { uid: 'seed-patient-a-uid', email: 'patient.rajesh@ffs-health.test', displayName: 'Rajesh Iyer (patient)' },
  { uid: 'seed-patient-b-uid', email: 'patient.anita@ffs-health.test', displayName: 'Anita Shah (patient)' },
  { uid: 'seed-doctor-uid', email: 'doctor.meera@ffs-health.test', displayName: 'Dr Meera Nair (doctor)' },
  { uid: 'seed-admin-uid', email: 'admin@ffs-health.test', displayName: 'Platform Admin' },
];

function credential(): admin.credential.Credential {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) return admin.credential.cert(JSON.parse(inline) as admin.ServiceAccount);

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return admin.credential.cert(JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount);

  throw new Error(
    'Firebase credentials missing. Set GOOGLE_APPLICATION_CREDENTIALS or ' +
      'FIREBASE_SERVICE_ACCOUNT_JSON in .env (see .env.example).',
  );
}

async function main(): Promise<void> {
  admin.initializeApp({
    credential: credential(),
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
  });
  const auth = admin.auth();
  const password = process.env.FIREBASE_TEST_PASSWORD;
  if (!password) {
    throw new Error('Set FIREBASE_TEST_PASSWORD in .env (see .env.example).');
  }

  for (const user of TEST_USERS) {
    const exists = await auth.getUser(user.uid).then(
      () => true,
      () => false,
    );
    if (exists) {
      await auth.updateUser(user.uid, { email: user.email, password, displayName: user.displayName });
      console.log(`updated  ${user.uid}  ${user.email}`);
    } else {
      await auth.createUser({ ...user, password, emailVerified: true });
      console.log(`created  ${user.uid}  ${user.email}`);
    }
  }

  console.log(`\nPassword for all four: ${password}`);
  console.log('Put it in the Postman environment as testPassword.');
}

void main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
