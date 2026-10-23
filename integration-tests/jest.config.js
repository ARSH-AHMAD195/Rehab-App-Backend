const path = require('path');

/**
 * Runs both APIs in one test process. This folder has no node_modules of its
 * own: the test tools come from health-monitoring-api, and each API is booted
 * with its own NestJS copy (see journey.e2e-spec.ts).
 */
const hm = path.resolve(__dirname, '../health-monitoring-api');

module.exports = {
  rootDir: __dirname,
  testRegex: '\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    // Full compile, so decorator metadata knows each field's real type (Mongoose
    // needs it), but no type errors reported: from this folder TypeScript can't
    // find every package, and each API runs its own `npm run typecheck`.
    '^.+\\.ts$': [
      require.resolve('ts-jest', { paths: [hm] }),
      { tsconfig: path.join(__dirname, 'tsconfig.json'), diagnostics: false },
    ],
  },
  modulePaths: [path.join(hm, 'node_modules')],
  testEnvironment: 'node',
  testTimeout: 120000,
};
