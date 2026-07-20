import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.SIM
      ? ['test/sim/**/*.test.ts']
      : ['test/unit/**/*.test.ts', 'test/property/**/*.test.ts'],
    testTimeout: process.env.SIM ? 300_000 : 10_000,
  },
});
