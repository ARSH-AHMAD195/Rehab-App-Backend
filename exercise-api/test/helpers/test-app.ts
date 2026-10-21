import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { json } from 'express';
import { AppModule } from '../../src/app.module';
import { MAX_BODY_SIZE, Role } from '../../src/common/constants';
import { validationExceptionFactory } from '../../src/common/validation-exception.factory';
import { TOKEN_VERIFIER, TokenVerifier } from '../../src/auth/token-verifier';
import { UnauthenticatedException } from '../../src/common/api.exception';
import { CategoriesService } from '../../src/categories/categories.service';

/**
 * Boots the real AppModule with two things swapped out, as in Health Monitoring:
 *
 *  - the Firebase verifier. The bearer token in tests IS the firebaseUid.
 *  - the database, pointed at a throwaway replica set.
 *
 * Everything else - guards, filter, transactions, audit - is the production
 * wiring.
 */
export interface TestUser {
  id: string;
  uid: string;
  role: Role;
  name: string;
  timeZone?: string;
  doctorIds?: string[];
  active?: boolean;
}

export interface TestContext {
  app: INestApplication;
  connection: Connection;
  /** Bearer value for a seeded user. */
  token(user: TestUser): string;
  createUser(user: Omit<TestUser, 'id'>): Promise<TestUser>;
  /** Empties every collection and puts the four default categories back. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Resolves the bearer token to a uid, standing in for verifyIdToken. */
class StubTokenVerifier implements TokenVerifier {
  async verify(idToken: string): Promise<{ uid: string }> {
    if (!idToken || idToken === 'invalid') throw new UnauthenticatedException();
    return { uid: idToken };
  }
}

export async function createTestApp(): Promise<TestContext> {
  const { uri, stop } = await startDatabase();

  process.env.MONGODB_URI = uri;
  process.env.DEFAULT_TIME_ZONE = process.env.DEFAULT_TIME_ZONE ?? 'Asia/Kolkata';
  process.env.SWAGGER_ENABLED = 'false';
  // Events stay in the outbox, where tests can look at them.
  process.env.OUTBOX_PUBLISHER_DISABLED = 'true';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TOKEN_VERIFIER)
    .useClass(StubTokenVerifier)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.use(json({ limit: MAX_BODY_SIZE }));
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

  return {
    app,
    connection,
    token: (user) => user.uid,
    async createUser(user) {
      const id = new Types.ObjectId();
      await connection.collection('users').insertOne({
        _id: id,
        firebaseUid: user.uid,
        role: user.role,
        name: user.name,
        timeZone: user.timeZone ?? 'Asia/Kolkata',
        doctorIds: (user.doctorIds ?? []).map((value) => new Types.ObjectId(value)),
        active: user.active ?? true,
      });
      return { ...user, id: id.toString() };
    },
    async reset() {
      for (const name of [
        'users',
        'exerciseCategories',
        'exercises',
        'exercisePlans',
        'exerciseCompletions',
        'exerciseIdempotencyKeys',
        'auditLogs',
        'exerciseOutboxEvents',
      ]) {
        await connection.collection(name).deleteMany({});
      }
      await app.get(CategoriesService).seedMissing();
    },
    async close() {
      await app.close();
      await stop();
    },
  };
}

/**
 * A replica set is required for transactions. In order of preference:
 *
 *  1. TEST_MONGODB_URI - a real instance, e.g. the docker-compose one;
 *  2. SHARED_TEST_MONGO_URI - the one in-memory replica set that
 *     test/helpers/global-setup.ts starts for the whole run;
 *  3. a replica set of this suite's own, for running a spec file directly.
 *
 * Each suite gets its own database either way.
 */
async function startDatabase(): Promise<{ uri: string; stop: () => Promise<void> }> {
  const database = `ffs_exercise_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const configured = process.env.TEST_MONGODB_URI;
  if (configured) return { uri: withDatabase(configured, database), stop: async () => undefined };

  const shared = process.env.SHARED_TEST_MONGO_URI;
  if (shared) return { uri: withDatabase(shared, database), stop: async () => undefined };

  const setupError = process.env.SHARED_TEST_MONGO_ERROR;
  if (setupError) {
    throw new Error(
      'No test database. The in-memory MongoDB replica set could not start.\n' +
        'If the cause below is "No space left on device", free disk space and retry, or point ' +
        'TEST_MONGODB_URI at a running replica set such as the docker-compose one.\n' +
        `Underlying error: ${setupError}`,
    );
  }

  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const server = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  return {
    uri: server.getUri(database),
    stop: async () => {
      await server.stop();
    },
  };
}

/** Swaps the database name in a connection string, keeping its options. */
function withDatabase(uri: string, database: string): string {
  const [base, query] = uri.split('?');
  const host = base.slice(0, base.lastIndexOf('/') + 1);
  return `${host}${database}${query ? `?${query}` : ''}`;
}
