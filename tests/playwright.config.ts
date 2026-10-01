import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
