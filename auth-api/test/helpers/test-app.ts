import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { json } from 'express';
import { AppModule } from '../../src/app.module';
import { Role } from '../../src/common/constants';
import { validationExceptionFactory } from '../../src/common/validation-exception.factory';
import { EmailAlreadyExistsException, UnauthenticatedException } from '../../src/common/api.exception';
import { IDENTITY_PROVIDER, IdentityProvider, VerifiedToken } from '../../src/identity/identity-provider';

/**
 * Stands in for Firebase. The bearer token in tests IS the uid.
 *
 * Accounts created through the API start unverified, like real ones; tests
 * call `verifyEmail(uid)` to play the user clicking their emailed link.
 */
export class FakeIdentityProvider implements IdentityProvider {
  accounts = new Map<string, { email: string | null; emailVerified: boolean; disabled: boolean }>();
  sentEmails: string[] = [];
  deleted: string[] = [];
  failEmails = false;
  private next = 1;

  async verifyToken(idToken: string): Promise<VerifiedToken> {
    const account = this.accounts.get(idToken);
    if (!account || account.disabled) throw new UnauthenticatedException();
    return { uid: idToken, email: account.email, emailVerified: account.emailVerified };
  }

  async createAccount(input: { email: string; name: string }): Promise<{ uid: string }> {
    if ([...this.accounts.values()].some((a) => a.email === input.email)) throw new EmailAlreadyExistsException();
    const uid = `fb-${this.next++}`;
    this.accounts.set(uid, { email: input.email, emailVerified: false, disabled: false });
    return { uid };
  }

  async deleteAccount(uid: string): Promise<void> {
    this.accounts.delete(uid);
    this.deleted.push(uid);
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    const account = this.accounts.get(uid);
    if (account) account.disabled = disabled;
  }

  async sendSetPasswordEmail(email: string): Promise<void> {
    if (this.failEmails) throw new Error('mailer down');
    this.sentEmails.push(email);
  }

  verifyEmail(uid: string): void {
    this.accounts.get(uid)!.emailVerified = true;
  }

  reset(): void {
    this.accounts.clear();
    this.sentEmails = [];
    this.deleted = [];
    this.failEmails = false;
    this.next = 1;
  }
}

export interface TestUser {
  id: string;
  uid: string;
  role: Role;
  name: string;
  email: string;
}

export interface SeedUser {
  role: Role;
  name: string;
  email?: string;
  doctorIds?: string[];
  active?: boolean;
  emailVerified?: boolean;
  timeZone?: string;
}

export interface TestContext {
  app: INestApplication;
  connection: Connection;
  identity: FakeIdentityProvider;
  /** `Authorization` header value for a user. */
  auth(user: { uid: string }): string;
  /** Inserts a profile and its (fake) Firebase account directly. */
  seed(user: SeedUser): Promise<TestUser>;
  /** Finds the uid of a user registered through the API. */
  uidOf(userId: string): Promise<string>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

let seeded = 0;

export async function createTestApp(): Promise<TestContext> {
  const { uri, stop } = await startDatabase();

  process.env.MONGODB_URI = uri;
  process.env.SWAGGER_ENABLED = 'false';

  const identity = new FakeIdentityProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDENTITY_PROVIDER)
    .useValue(identity)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.use(json({ limit: '16kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  // Unique indexes must exist before the race and duplicate tests run.
  for (const model of Object.values(connection.models)) await model.syncIndexes();

  return {
    app,
    connection,
    identity,
    auth: (user) => `Bearer ${user.uid}`,
    async seed(user) {
      seeded += 1;
      const id = new Types.ObjectId();
      const uid = `seed-${seeded}`;
      const email = (user.email ?? `${user.role.toLowerCase()}${seeded}@test.example`).toLowerCase();
      await connection.collection('users').insertOne({
        _id: id,
        firebaseUid: uid,
        role: user.role,
        name: user.name,
        email,
        phone: null,
        ...(user.role === 'PATIENT'
          ? {
              timeZone: user.timeZone ?? 'Asia/Kolkata',
              doctorIds: (user.doctorIds ?? []).map((d) => new Types.ObjectId(d)),
            }
          : { doctorIds: [] }),
        specialization: null,
        active: user.active ?? true,
        emailVerified: user.emailVerified ?? true,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      identity.accounts.set(uid, {
        email,
        emailVerified: user.emailVerified ?? true,
        disabled: user.active === false,
      });
      return { id: id.toString(), uid, role: user.role, name: user.name, email };
    },
    async uidOf(userId) {
      const doc = await connection.collection('users').findOne({ _id: new Types.ObjectId(userId) });
      return doc!.firebaseUid as string;
    },
    async reset() {
      for (const name of ['users', 'medicalProfiles', 'auditLogs']) {
        await connection.collection(name).deleteMany({});
      }
      identity.reset();
    },
    async close() {
      await app.close();
      await stop();
    },
  };
}

/** Same database strategy as Health Monitoring: TEST_MONGODB_URI, else the shared in-memory replica set. */
async function startDatabase(): Promise<{ uri: string; stop: () => Promise<void> }> {
  const database = `ffs_auth_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const configured = process.env.TEST_MONGODB_URI;
  if (configured) return { uri: withDatabase(configured, database), stop: async () => undefined };

  const shared = process.env.SHARED_TEST_MONGO_URI;
  if (shared) return { uri: withDatabase(shared, database), stop: async () => undefined };

  const setupError = process.env.SHARED_TEST_MONGO_ERROR;
  if (setupError) {
    throw new Error(
      'No test database. The in-memory MongoDB replica set could not start ' +
        '(~200 MB free disk is needed), or set TEST_MONGODB_URI.\n' +
        `Underlying error: ${setupError}`,
    );
  }

  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return { uri: server.getUri(database), stop: async () => void (await server.stop()) };
}

function withDatabase(uri: string, database: string): string {
  const [base, query] = uri.split('?');
  const host = base.slice(0, base.lastIndexOf('/') + 1);
  return `${host}${database}${query ? `?${query}` : ''}`;
}
