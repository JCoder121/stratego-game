import { defineConfig } from '@playwright/test';

// e2e smoke config (Task 12). Boots the real server (build:web + tsx src/server/main.ts) via
// Playwright's webServer — no mocking, this exercises the actual ws protocol end to end. Timeouts
// are generous because `npm run serve` includes a full `vite build` before the server even starts
// listening, and CI/first-run machines can be slow to install/launch chromium.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // both specs create real rooms against one shared server instance
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run serve',
    port: 3000,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
