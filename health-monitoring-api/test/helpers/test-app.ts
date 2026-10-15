import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { json } from 'express';
import { AppModule } from '../../src/app.module';
import { MAX_BODY_SIZE, ROLES, Role } from '../../src/common/constants';
import { validationExceptionFactory } from '../../src/common/validation-exception.factory';
import { TOKEN_VERIFIER, TokenVerifier } from '../../src/auth/token-verifier';
import { UnauthenticatedException } from '../../src/common/api.exception';

/**
 * Boots the real AppModule with two things swapped out:
 *
 *  - the Firebase verifier, so the 13 routes can be exercised without a
 *    Firebase project. The bearer token in tests IS the firebaseUid.
 *  - the database, pointed at a throwaway replica set.
 *
 * Everything else - guards, filter, transactions, outbox, audit - is the
 * production wiring.
 */
export interface TestUser {
  id: string;
  uid: string;
  role: Role;
  name: string;
  timeZone?: string;
  doctorIds?: string[];
}

export interface TestContext {
  app: INestApplication;
  connection: Connection;
  /** Bearer value for a seeded user. */
  token(user: TestUser): string;
  createUser(user: Omit<TestUser, 'id'>): Promise<TestUser>;
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

export interface ProviderOverride {
  token: unknown;
  value: unknown;
}

export async function createTestApp(overrides: ProviderOverride[] = []): Promise<TestContext> {
  const { uri, stop } = await startDatabase();

  process.env.MONGODB_URI = uri;
  process.env.DEFAULT_TIME_ZONE = process.env.DEFAULT_TIME_ZONE ?? 'Asia/Kolkata';
  process.env.SWAGGER_ENABLED = 'false';
  // The publisher is driven explicitly in tests that care about events.
  process.env.OUTBOX_PUBLISHER_DISABLED = 'true';

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TOKEN_VERIFIER)
    .useClass(StubTokenVerifier);

  for (const override of overrides) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }
  const moduleRef = await builder.compile();

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
        active: true,
      });
      return { ...user, id: id.toString() };
    },
    async reset() {
      // Parameters are left in place: they are reference data the app seeds on
      // boot, not per-test state.
      for (const name of ['users', 'dailyLogs', 'vitalAlerts', 'alertThresholds', 'auditLogs', 'outboxEvents']) {
        await connection.collection(name).deleteMany({});
      }
    },
    async close() {
      await app.close();
      await stop();
    },
  };
}

/**
 * A replica set is required for the save transaction. In order of preference:
 *
 *  1. TEST_MONGODB_URI - a real instance, e.g. the docker-compose one;
 *  2. SHARED_TEST_MONGO_URI - the one in-memory replica set that
 *     test/helpers/global-setup.ts starts for the whole run;
 *  3. a replica set of this suite's own, for running a spec file directly
 *     without the jest global setup.
 *
 * Each suite gets its own database either way, so suites never see each
 * other's documents.
 */
async function startDatabase(): Promise<{ uri: string; stop: () => Promise<void> }> {
  const database = `ffs_health_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const configured = process.env.TEST_MONGODB_URI;
  if (configured) return { uri: withDatabase(configured, database), stop: async () => undefined };

  const shared = process.env.SHARED_TEST_MONGO_URI;
  // The shared server is stopped by global-teardown, not by the suite.
  if (shared) return { uri: withDatabase(shared, database), stop: async () => undefined };

  // globalSetup tried and failed - usually a full disk, since mongod aborts
  // with a bare fassert() when it cannot preallocate its journal. Say so here,
  // where the suite that needs a database is the one failing.
  const setupError = process.env.SHARED_TEST_MONGO_ERROR;
  if (setupError) {
    throw new Error(
      'No test database. The in-memory MongoDB replica set could not start.\n' +
        'If the cause below is "No space left on device", free disk space (~200 MB needed for ' +
        'the journal and data files) and retry, or point TEST_MONGODB_URI at a running replica ' +
        'set such as the docker-compose one.\n' +
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

export const ROLE = ROLES;
