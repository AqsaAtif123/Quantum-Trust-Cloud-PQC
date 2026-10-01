// Loaded via jest.config.js `setupFiles` before any test file, so modules
// that import ../config/env.ts (which validates required vars at import
// time) don't crash the whole test run just for being imported — this
// mirrors the same dummy values used for local scratch-testing during
// development, never real secrets.
process.env.MONGO_URI ||= 'mongodb://localhost:27017/quantumtrust-test';
process.env.JWT_ACCESS_SECRET ||= 'test-jwt-access-secret-not-for-production-use';
process.env.JWT_REFRESH_SECRET ||= 'test-jwt-refresh-secret-not-for-production-use';
process.env.COOKIE_SECRET ||= 'test-cookie-secret-not-for-production-use-here';
process.env.STORAGE_ACCESS_KEY ||= 'test-access-key';
process.env.STORAGE_SECRET_KEY ||= 'test-secret-key';
