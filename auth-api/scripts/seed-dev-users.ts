/**
 * DEVELOPMENT ONLY. Creates (or updates) test logins for Postman and local
 * testing: one admin, two doctors and two patients, already email-verified,
 * all with the password in FIREBASE_TEST_PASSWORD.
 *
 *   npm run seed:dev-users
 *
 * The uids and emails match Health Monitoring's test users
 * (health-monitoring-api/scripts/create-firebase-test-users.ts), so the same
 * logins work against both APIs, which share the `users` collection.
 *
 * Never run against production: it sets known passwords.
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import * as admin from 'firebase-admin';
import mongoose, { Types } from 'mongoose';

loadEnv();

interface DevUser {
  uid: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'DOCTOR' | 'PATIENT';
  doctors?: string[];
  specialization?: string;
}

const DEV_USERS: DevUser[] = [
  { uid: 'seed-admin-uid', email: 'admin@ffs-health.test', name: 'Platform Admin', role: 'ADMIN' },
  { uid: 'seed-doctor-uid', email: 'doctor.meera@ffs-health.test', name: 'Dr Meera Nair', role: 'DOCTOR', specialization: 'Surgical oncology' },
  { uid: 'seed-doctor-b-uid', email: 'doctor.arjun@ffs-health.test', name: 'Dr Arjun Rao', role: 'DOCTOR', specialization: 'Anaesthesia' },
  { uid: 'seed-patient-a-uid', email: 'patient.rajesh@ffs-health.test', name: 'Rajesh Iyer', role: 'PATIENT', doctors: ['seed-doctor-uid'] },
  { uid: 'seed-patient-b-uid', email: 'patient.anita@ffs-health.test', name: 'Anita Shah', role: 'PATIENT', doctors: ['seed-doctor-uid'] },
];

function credential(): admin.credential.Credential {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) return admin.credential.cert(JSON.parse(inline) as admin.ServiceAccount);
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return admin.credential.cert(JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount);
  throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON in .env (see .env.example).');
}

async function main(): Promise<void> {
  const password = process.env.FIREBASE_TEST_PASSWORD;
  if (!password) throw new Error('Set FIREBASE_TEST_PASSWORD in .env (see .env.example).');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI in .env (see .env.example).');

  admin.initializeApp({ credential: credential(), projectId: process.env.FIREBASE_PROJECT_ID || undefined });
  const auth = admin.auth();
  await mongoose.connect(uri);
  const users = mongoose.connection.collection('users');

  const idByUid = new Map<string, Types.ObjectId>();
  // Doctors and the admin first, so patients can be linked to doctor ids.
  const ordered = [...DEV_USERS].sort((a, b) => Number(a.role === 'PATIENT') - Number(b.role === 'PATIENT'));

  for (const user of ordered) {
    const exists = await auth.getUser(user.uid).then(() => true, () => false);
    const account = { email: user.email, password, displayName: user.name, emailVerified: true, disabled: false };
    if (exists) await auth.updateUser(user.uid, account);
    else await auth.createUser({ uid: user.uid, ...account });

    const doctorIds = (user.doctors ?? []).map((uid) => idByUid.get(uid)!);
    const result = await users.findOneAndUpdate(
      { firebaseUid: user.uid },
      {
        $set: {
          role: user.role,
          name: user.name,
          email: user.email,
          active: true,
          emailVerified: true,
          ...(user.role === 'PATIENT' ? { timeZone: 'Asia/Kolkata', doctorIds } : { doctorIds: [] }),
          ...(user.role === 'DOCTOR' ? { specialization: user.specialization ?? null } : {}),
          updatedAt: new Date(),
        },
        $setOnInsert: { phone: null, createdBy: null, createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    );
    idByUid.set(user.uid, result!._id as Types.ObjectId);
    console.log(`${exists ? 'updated' : 'created'}  ${user.role.padEnd(7)}  ${user.email}  id ${String(result!._id)}`);
  }

  console.log(`\nAll five log in with FIREBASE_TEST_PASSWORD. Put it in Postman as testPassword.`);
  await mongoose.disconnect();
}

void main().catch(async (error: unknown) => {
  console.error((error as Error).message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
