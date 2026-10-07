module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
  // @noble/post-quantum and @noble/hashes ship pure ESM with no CJS
  // build. Node's own `require()` can load them natively at app runtime
  // (proven — the app itself runs fine), but Jest's own module system
  // doesn't use that path, so these specific packages need an explicit
  // ESM->CJS transform just for the test run.
  transformIgnorePatterns: ['/node_modules/(?!(@noble)/)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
};
