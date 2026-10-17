module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '(src/.*\\.spec\\.ts|test/.*\\.e2e-spec\\.ts)$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  // One in-memory replica set for the whole run, instead of one per suite.
  globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
  testTimeout: 60000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
};
