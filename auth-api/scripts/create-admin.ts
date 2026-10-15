/**
 * Creates the FIRST admin (v1.0 Onboarding). Every later admin is registered
 * through POST /admins by an existing admin.
 *
 *   npm run create-admin -- --email admin@hospital.org --name "Priya Menon"
 *
 * Uses the app's own registration flow, so the Firebase account, profile,
 * audit record and set-password email are exactly as for any other admin.
 * Refuses when an active admin already exists, unless --force is given.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { ROLES } from '../src/common/constants';
import { RegistrationService } from '../src/registration/registration.service';
import { User } from '../src/users/user.schema';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email');
  const name = arg('name');
  if (!email || !name) {
    throw new Error('Usage: npm run create-admin -- --email <email> --name "<full name>" [--force]');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users = app.get<Model<User>>(getModelToken(User.name));
    const existing = await users.countDocuments({ role: ROLES.ADMIN, active: true });
    if (existing && !process.argv.includes('--force')) {
      throw new Error(
        `${existing} active admin(s) already exist. Ask one of them to use POST /admins, or pass --force.`,
      );
    }

    const { user, invitation } = await app
      .get(RegistrationService)
      .register({ role: ROLES.ADMIN, name, email }, null);

    console.log(`Admin created: ${user.name} <${user.email}> (id ${String(user._id)})`);
    console.log(
      invitation === 'SENT'
        ? 'A set-password email was sent. Open it, choose a password, then log in.'
        : 'The set-password email could NOT be sent. Check FIREBASE_WEB_API_KEY, then resend it with POST /users/:userId/invitations.',
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
