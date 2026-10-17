import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Set when the shared server could not start, so suites can explain why. */
export const DB_UNAVAILABLE_ENV = 'SHARED_TEST_MONGO_ERROR';

/**
 * Starts ONE in-memory replica set for the whole run. Each suite then uses its
 * own database on it (see test-app.ts).
 *
 * Per-suite servers cost a WiredTiger data directory each - six of them is
 * ~200 MB of scratch and six mongod startups. One server keeps the disk
 * footprint and the run time down, and a replica set is still required for the
 * save transaction.
 *
 * Skipped when TEST_MONGODB_URI points at a real instance. A failure here is
 * recorded rather than thrown: the unit suites need no database and must still
 * run.
 */
module.exports = async function globalSetup(): Promise<void> {
  if (process.env.TEST_MONGODB_URI) return;

  try {
    const replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
        // --oplogSize is in MB. Left to itself mongod sizes the oplog from
        // free disk space; this suite writes a few hundred documents, so 16 MB
        // is ample and keeps the scratch directory small.
        args: ['--oplogSize', '16'],
      },
    });

    // Picked up by test/helpers/test-app.ts in every worker.
    process.env.SHARED_TEST_MONGO_URI = replSet.getUri();
    // Handed to globalTeardown, which runs in this same process.
    (globalThis as { __MONGO_REPL_SET__?: MongoMemoryReplSet }).__MONGO_REPL_SET__ = replSet;
  } catch (error) {
    process.env[DB_UNAVAILABLE_ENV] = (error as Error).message;
    console.warn(
      '\n[globalSetup] No test database: the in-memory MongoDB replica set did not start. ' +
        'Unit suites will still run; e2e suites will fail with the reason.\n',
    );
  }
};
