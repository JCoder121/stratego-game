import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.SIM
      ? ['test/sim/**/*.test.ts']
      : ['test/unit/**/*.test.ts', 'test/property/**/*.test.ts', 'test/conformance/**/*.test.ts', 'test/e2e/**/*.test.ts', 'test/server/**/*.test.ts', 'test/web/**/*.test.ts'],
    testTimeout: process.env.SIM ? 300_000 : 10_000,
  },
});
