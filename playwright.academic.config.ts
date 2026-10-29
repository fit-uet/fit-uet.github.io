import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/academic-ui', fullyParallel: false, workers: 1,
  outputDir: 'scratch/academic-ui-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4318', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx scripts/academic-preview.ts', url: 'http://127.0.0.1:4318/__academic_preview/session', reuseExistingServer: false, timeout: 60_000 },
});
