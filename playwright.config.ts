import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests in a real browser against a real server and database.
 *
 * `npm run test:e2e` starts the server itself (port 3100, the local test
 * database), seeds a staff account and today's menu, and drives the staff
 * interface: log in, create a customer, type a call through the real dialog
 * engine, watch the order appear on the dashboard without a reload.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  // One server, one database: projects and files run one after another.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    locale: 'de-DE',
    // A pre-installed Chromium (e.g. PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium) instead of a download.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // A tablet at the counter: touch, 1024 px wide, Chromium (no WebKit download needed).
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npx tsx src/server/index.ts',
    url: 'http://127.0.0.1:3100/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test', PORT: '3100', HOST: '127.0.0.1', PUBLIC_URL: 'http://127.0.0.1:3100',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/senior_lunch_test',
      SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-1234', TWILIO_AUTH_TOKEN: 'e2e-twilio-token', LUNCH_HANDOFF_NUMBER: '+493012345678', LOG_LEVEL: 'warn', LOGIN_RATE_LIMIT: '1000',
    },
  },
});
