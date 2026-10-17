/**
 * Demo data for local work and the Week 3 demo in the architecture plan.
 *
 * Creates the 13 parameters (idempotent), one doctor, one admin and two
 * patients linked to that doctor, and - only if asked - a couple of alert
 * limits. v1.1 says the system ships with NO global limits until the clinical
 * team signs them off, so the limits are behind a flag and clearly marked as
 * placeholders.
 *
 *   npm run seed                  # parameters + users
 *   npm run seed -- --thresholds  # also two placeholder limits
 *
 * The `users` collection belongs to the Auth module. Delete this part of the
 * seed once that module exists.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import mongoose, { mongo } from 'mongoose';
import { VITAL_TYPE_DEFAULTS } from '../src/vital-types/vital-type.defaults';

loadEnv();

const SEED_FIREBASE_UIDS = {
  doctor: 'seed-doctor-uid',
  admin: 'seed-admin-uid',
  patientA: 'seed-patient-a-uid',
  patientB: 'seed-patient-b-uid',
};

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env first.');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle');

  // --- the 13 parameters -----------------------------------------------
  await db.collection('vitalTypes').bulkWrite(
    VITAL_TYPE_DEFAULTS.map((seed) => ({
      updateOne: {
        filter: { type: seed.type },
        update: { $setOnInsert: { ...seed, version: 1, createdAt: new Date(), updatedAt: new Date() } },
        upsert: true,
      },
    })),
  );
  console.log(`vitalTypes: ${VITAL_TYPE_DEFAULTS.length} parameters present`);

  // --- users (Auth module's collection) --------------------------------
  const users = db.collection('users');
  await users.createIndex({ firebaseUid: 1 }, { unique: true });

  const doctorId = await upsertUser(users, {
    firebaseUid: SEED_FIREBASE_UIDS.doctor,
    role: 'DOCTOR',
    name: 'Dr Meera Nair',
  });
  await upsertUser(users, {
    firebaseUid: SEED_FIREBASE_UIDS.admin,
    role: 'ADMIN',
    name: 'Platform Admin',
  });
  const patientA = await upsertUser(users, {
    firebaseUid: SEED_FIREBASE_UIDS.patientA,
    role: 'PATIENT',
    name: 'Rajesh Iyer',
    timeZone: 'Asia/Kolkata',
    doctorIds: [doctorId],
  });
  await upsertUser(users, {
    firebaseUid: SEED_FIREBASE_UIDS.patientB,
    role: 'PATIENT',
    name: 'Anita Shah',
    timeZone: 'Asia/Kolkata',
    doctorIds: [doctorId],
  });
  console.log('users: 1 doctor, 1 admin, 2 patients linked to the doctor');

  // --- optional placeholder alert limits -------------------------------
  if (process.argv.includes('--thresholds')) {
    const thresholds = db.collection('alertThresholds');
    for (const rule of [
      { type: 'PAIN', field: null, low: null, high: 6, severity: 'MEDIUM' },
      { type: 'PULSE', field: null, low: 50, high: 110, severity: 'MEDIUM' },
    ]) {
      await thresholds.updateOne(
        { type: rule.type, field: rule.field, patientId: null, isCurrent: true },
        {
          $setOnInsert: {
            ...rule,
            patientId: null,
            version: 1,
            effectiveFrom: new Date(),
            isCurrent: true,
            updatedBy: doctorId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
    console.warn(
      'alertThresholds: inserted PLACEHOLDER limits (pain above 6, pulse 50-110). ' +
        'v1.1 Open questions: these are not clinically approved. Do not demo them as real limits.',
    );
  }

  console.log(`\nPatient A id: ${patientA.toString()} (uid ${SEED_FIREBASE_UIDS.patientA})`);
  console.log('Set these firebaseUid values on your Firebase test users to sign in as them.');

  await mongoose.disconnect();
}

async function upsertUser(
  users: mongo.Collection,
  user: Record<string, unknown>,
): Promise<mongo.ObjectId> {
  await users.updateOne(
    { firebaseUid: user.firebaseUid },
    { $set: { active: true, ...user }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  const stored = await users.findOne({ firebaseUid: user.firebaseUid });
  return stored!._id;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
