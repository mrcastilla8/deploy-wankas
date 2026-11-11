import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:9002',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_STORAGE_STATE ? { storageState: process.env.PLAYWRIGHT_STORAGE_STATE } : {}),
  },
  reporter: 'list',
  fullyParallel: false,
})
