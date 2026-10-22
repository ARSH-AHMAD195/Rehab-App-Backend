import type { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Stops the shared replica set and removes its data directory. */
module.exports = async function globalTeardown(): Promise<void> {
  const replSet = (globalThis as { __MONGO_REPL_SET__?: MongoMemoryReplSet }).__MONGO_REPL_SET__;
  await replSet?.stop();
};
