import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Opt-in acceptance on a prepared private SQLite copy, never on a remote host.
test('restored role screens on a prepared local copy of production data', async ({ browser }) => {
  const base = process.env.ACADEMIC_ACCEPTANCE_BASE;
  test.skip(!base, 'Set ACADEMIC_ACCEPTANCE_BASE for the private local acceptance server.');
  const origin = new URL(base!);
  expect(origin.protocol).toBe('http:'); expect(['127.0.0.1', 'localhost']).toContain(origin.hostname);
  const lecturer = process.env.ACADEMIC_ACCEPTANCE_LECTURER, student = process.env.ACADEMIC_ACCEPTANCE_STUDENT;
  expect(lecturer).toBeTruthy(); expect(student).toBeTruthy();
  const directory = 'scratch/academic-ui-results/private-local-copy'; await mkdir(directory, { recursive: true });
  for (const [role, email] of [['admin', ''], ['lecturer', lecturer!], ['student', student!]] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin.origin || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${origin.origin}/__local_staging/login${email ? `?email=${encodeURIComponent(email)}` : ''}`);
      await expect(page.getByRole('heading', { name: 'Học kỳ và nhóm môn' })).toBeVisible();
      await page.goto(`${origin.origin}/#/campaigns/2026-2027-1:project`);
      await expect(page.getByRole('heading', { name: role === 'admin' ? 'Tổng quan Quản trị' : role === 'lecturer' ? 'Sinh viên phụ trách' : 'Hồ sơ và bài nộp', exact: true })).toBeVisible();
      if (role === 'admin') {
        await expect(page.getByText('8 lớp · 532 sinh viên · 535 lần học', { exact: true })).toBeVisible();
        await page.getByRole('region', { name: 'Chức năng quản lý' }).getByRole('button', { name: /^Bảng điểm/ }).click();
        await expect(page.getByRole('columnheader', { name: 'GVHD (60%)' })).toBeVisible();
        await page.getByLabel('Lớp học phần', { exact: true }).selectOption({ label: 'INT3132 1' });
        await expect(page.getByText('80 lần học · 80 sinh viên', { exact: true })).toBeVisible();
      }
      if (role === 'student') {
        await expect(page.getByRole('button', { name: /INT313[12] · INT313/ })).toHaveCount(2);
        await page.getByRole('button', { name: /INT3131 · INT3131/ }).click();
        await expect(page.locator('input[name=title]')).toBeVisible();
        await expect(page.getByText('Tổng kết:', { exact: false })).toHaveCount(0);
      }
      await page.screenshot({ animations: 'disabled', path: `${directory}/${role}.png`, fullPage: true });
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
});
