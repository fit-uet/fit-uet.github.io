import { defineConfig } from '@playwright/test';

const previewOrigin = `http://127.0.0.1:${process.env.ACADEMIC_PREVIEW_PORT || 4318}`;

export default defineConfig({
  testDir: './tests/academic-ui', fullyParallel: false, workers: 1,
  outputDir: 'scratch/academic-ui-results', reporter: 'list',
  use: { baseURL: previewOrigin, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx scripts/academic-preview.ts', url: previewOrigin + '/__academic_preview/session', reuseExistingServer: false, timeout: 60_000 },
});
