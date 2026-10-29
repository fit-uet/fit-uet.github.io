import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const screenshots = 'scratch/academic-ui-results/previews';

test('Khoa checks mail connectivity without sending messages and sees the server IP restriction', async ({ browser }) => {
  const { page, context, errors } = await session(browser, 'admin');
  const providerRequests: string[] = [];
  try {
    await context.route('**/api/admin/notifications?*', route => route.fulfill({ json: { items: [], total: 0, page: 1, limit: 25, totalPages: 1 } }));
    await context.route('**/api/admin/notifications/stats', route => route.fulfill({ json: { provider: 'brevo', daily_cap: 250, sent_today: 0, remaining_today: 250, statuses: {} } }));
    let checks = 0;
    await context.route('**/api/admin/email/diagnostics', route => {
      providerRequests.push(route.request().method()); checks++;
      return route.fulfill({ json: checks === 1
        ? { provider: 'brevo', status: 'ip_blocked', checkedAt: '2026-10-29T04:00:00Z', message: 'Brevo chưa cho phép IP đi ra của máy chủ này.', blockedIp: '192.0.2.44', sender: 'sender@example.org' }
        : { provider: 'brevo', status: 'connected', checkedAt: '2026-10-29T04:01:00Z', message: 'Máy chủ đã kết nối Brevo thành công. Chưa gửi thư.' } });
    });
    page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/admin/')) providerRequests.push('unexpected-write'); });
    await page.goto('/#/system/notifications');
    await page.getByRole('button', { name: 'Kiểm tra kết nối email', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Brevo chưa cho phép IP');
    await expect(page.getByRole('status')).toContainText('192.0.2.44');
    await page.getByRole('button', { name: 'Kiểm tra kết nối email', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('đã kết nối Brevo thành công');
    await expect(page.getByText('IP máy chủ cần được cho phép:')).toHaveCount(0);
    expect(providerRequests).toEqual(['GET', 'GET']); expect(errors).toEqual([]);
  } finally { await context.close(); }
});
async function session(browser: Browser, role: 'admin' | 'student' | 'lecturer' | 'reviewer', mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  await context.route('**/*', route => { const url = new URL(route.request().url()); return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'blob:' || url.protocol === 'data:' ? route.continue() : route.abort(); });
  const response = await context.request.get(`http://127.0.0.1:4318/__academic_preview/session?role=${role}`); const data = await response.json();
  await context.addInitScript(data => { localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user)); }, data);
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const classes = (await (await context.request.get('http://127.0.0.1:4318/api/me/classes', { headers: { Authorization: `Bearer ${data.token}` } })).json()).classes;
  return { context, page, token: data.token, classes, errors };
}
async function feature(page: Page, tab: string) {
  await page.getByLabel('Chức năng', { exact: true }).selectOption(tab);
}
async function openReport(page: Page) {
  await feature(page, 'reports');
  await page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Sinh viên An', exact: true }) }).getByRole('button', { name: 'Xem báo cáo', exact: true }).click();
}
function pdf() {
  const stream = 'BT /F1 18 Tf 30 350 Td (Academic project report) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(output); output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test('restored overview opens dedicated screens, preserves scope and returns focus after closing a report', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'admin');
  const c = classes.find(c => c.courseCode === 'INT3132');
  try {
    await page.goto(`/#/campaigns/${c.campaignId}`);
    await expect(page.getByRole('heading', { name: 'Tổng quan Quản trị' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Chức năng quản lý' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import danh sách', exact: true })).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: `${screenshots}/restored-admin-overview.png`, fullPage: true });
    await page.getByRole('region', { name: 'Chức năng quản lý' }).getByRole('button', { name: /^Sinh viên/ }).click();
    await page.getByLabel('Lớp học phần', { exact: true }).selectOption(c.id);
    await page.getByLabel('Tìm sinh viên', { exact: true }).fill('24020001');
    await page.getByLabel('Trạng thái', { exact: true }).selectOption('active');
    await expect(page.getByRole('columnheader', { name: 'Liên hệ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nhập danh sách Dự án', exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Import danh sách', exact: true }).click();
    await expect(page.locator('input[type=file]').first()).toBeVisible();
    await feature(page, 'reports');
    await expect(page.getByLabel('Lớp học phần', { exact: true })).toHaveValue(c.id);
    await expect(page.getByLabel('Tìm sinh viên', { exact: true })).toHaveValue('24020001');
    await expect(page.getByLabel('Trạng thái', { exact: true })).toHaveValue('');
    await expect(page.getByRole('columnheader', { name: 'Tài liệu bổ sung' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Liên hệ' })).toHaveCount(0);
    const button = page.getByRole('button', { name: 'Xem báo cáo', exact: true }); await button.click();
    await expect(page.getByRole('dialog', { name: 'Báo cáo và đánh giá' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(button).toBeFocused();
    await feature(page, 'grades'); await expect(page.getByRole('columnheader', { name: 'GVHD (60%)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GVNX (40%)' })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `${screenshots}/restored-admin-grades.png`, fullPage: true });
    await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tổng quan Quản trị' })).toBeVisible();
    expect(new URL(page.url()).hash).toContain(`classId=${c.id}`); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('legacy report screens render once and honor canonical course, lecturer and search filters', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'admin');
  const c = classes.find(c => c.legacy && c.courseCode === 'INT4002');
  try {
    await context.route('**/api/admin/reports/final', route => route.fulfill({ json: [
      { user_id: 300, student_id: '23029901', student_name: 'Sinh viên TT Một', email: '23029901@vnu.edu.vn', course_code: 'Thực tập Doanh nghiệp INT4002', status: 'missing', primary_advisors: 'TS. Alpha' },
      { user_id: 301, student_id: '23029902', student_name: 'Sinh viên TT Hai', email: '23029902@vnu.edu.vn', course_code: 'Thực tập Chuyên ngành INT3508', status: 'missing', primary_advisors: 'TS. Beta' },
    ] }));
    await page.goto(`/#/campaigns/${c.campaignId}?tab=reports&courseCode=INT4002&lecturerId=1&q=23029901`);
    await expect(page.getByRole('cell').filter({ hasText: 'Sinh viên TT Một' })).toHaveCount(1);
    await expect(page.getByRole('cell').filter({ hasText: 'Sinh viên TT Hai' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Danh sách hồ sơ' })).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: `${screenshots}/restored-legacy-reports.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('an administrator who teaches can switch to assigned records and return to administration', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'admin');
  const p = classes.find(c => c.courseCode === 'INT3132').campaignId;
  try {
    await page.goto(`/#/campaigns/${p}`);
    await page.getByRole('link', { name: 'Trang Giảng viên', exact: true }).click();
    await expect(page).toHaveURL(/view=lecturer/);
    await expect(page.getByRole('heading', { name: 'Sinh viên phụ trách' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sinh viên Bình', exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Sinh viên An', exact: true })).toHaveCount(0);
    await feature(page, 'grades'); await expect(page).toHaveURL(/view=lecturer/);
    await page.getByRole('link', { name: 'Trang Quản trị', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tổng quan Quản trị' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('visual references and restored role pages fit desktop and mobile', async ({ browser }) => {
  for (const role of ['admin', 'lecturer', 'student'] as const) {
    const { page, context, classes, errors } = await session(browser, role);
    try {
      await context.route('**/api/admin/dashboard-stats', route => route.fulfill({ json: { registeredCount: 6, confirmedCount: 3, reportCount: 2, gradedCount: 1 } }));
      await context.route('**/api/lecturer/students', route => route.fulfill({ json: [] }));
      await context.route('**/api/lecturer/grades', route => route.fulfill({ json: [] }));
      await context.route('**/api/settings/campaign', route => route.fulfill({ json: {} }));
      await context.route('**/api/companies', route => route.fulfill({ json: [] }));
      await context.route('**/api/registrations/my', route => route.fulfill({ json: [] }));
      await context.route('**/api/internships/final/my', route => route.fulfill({ json: null }));
      const p = classes.find(c => c.courseCode === 'INT3132').campaignId;
      for (const mobile of [false, true]) {
        await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
        await page.goto(`/__academic_preview/baseline?role=${role}`); await expect(page.locator(role === 'student' ? 'h3' : 'h1').first()).toBeVisible();
        await page.screenshot({ animations: 'disabled', path: `${screenshots}/reference-726271c-${role}-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
        // The fixture baseline stores a legacy user for the old student page; restore the actual role session.
        const data = await (await context.request.get(`http://127.0.0.1:4318/__academic_preview/session?role=${role}`)).json();
        await page.evaluate(data => { localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user)); }, data);
        await page.goto(`/#/campaigns/${p}`);
        await expect(page.getByRole('heading', { name: role === 'admin' ? 'Tổng quan Quản trị' : role === 'lecturer' ? 'Sinh viên phụ trách' : 'Hồ sơ và bài nộp', exact: true })).toBeVisible();
        await page.screenshot({ animations: 'disabled', path: `${screenshots}/restored-${role}-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (role === 'lecturer' && mobile) {
          await feature(page, 'reports');
          await page.getByRole('button', { name: 'Xem báo cáo', exact: true }).first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          expect(await page.getByRole('dialog').evaluate(element => element.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
          await page.screenshot({ animations: 'disabled', path: `${screenshots}/restored-lecturer-mobile-review.png`, fullPage: true });
          await page.keyboard.press('Escape');
        }
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
});

test('admin creates semester/classes and previews balanced reviewers', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'admin');
  try {
    await page.goto('/#/classes'); await expect(page.getByRole('heading', { name: 'Học kỳ và nhóm môn' })).toBeVisible();
    await page.getByRole('button', { name: 'Quản lý học kỳ / nhóm môn' }).click();
    await page.getByLabel('Năm bắt đầu').fill('2028'); await page.getByRole('button', { name: 'Tạo học kỳ', exact: true }).click();
    await expect(page.getByLabel('Học kỳ', { exact: true }).first()).toHaveValue('2028-2029-1');
    await page.getByRole('button', { name: 'Tạo lớp nháp', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Thực tập', exact: true })).toBeVisible();
    const target = classes.find(c => c.courseCode === 'INT3132'); await page.goto(`/#/classes/${target.id}`);
    await feature(page, 'assignments'); await page.getByRole('button', { name: 'Xem trước phân công', exact: true }).click();
    await expect(page.getByText('Cùng bộ môn').first()).toBeVisible(); await page.getByRole('button', { name: 'Áp dụng phương án đã xem trước' }).click();
    await expect(page.getByText(/Đã phân công 6 sinh viên/)).toBeVisible();
    await mkdir(screenshots, { recursive: true }); await page.screenshot({ animations: 'disabled', path: `${screenshots}/reviewer-preview.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('student submits PDF/Drive bundle; two lecturers grade; student receives no numerical scores', async ({ browser }) => {
  const sessions: BrowserContext[] = [];
  try {
    const sv = await session(browser, 'student'); sessions.push(sv.context); const c = sv.classes.find(c => c.courseCode === 'INT3132');
    await sv.page.goto(`/#/classes/${c.id}`); await expect(sv.page.getByRole('heading', { name: 'Sinh viên An', exact: true })).toBeVisible();
    await sv.page.locator('input[name=pdf]').setInputFiles({ name: 'bao-cao.pdf', mimeType: 'application/pdf', buffer: pdf() });
    await sv.page.getByRole('textbox', { name: 'Link Google Drive slide', exact: true }).fill('https://docs.google.com/presentation/d/academic-slide/edit');
    await sv.page.getByRole('textbox', { name: 'Link Google Drive video demo', exact: true }).fill('https://drive.google.com/file/d/academic-demo/view');
    await sv.page.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }).click(); await expect(sv.page.getByText('Đã nộp bộ bài', { exact: true })).toBeVisible();
    for (const [role, score] of [['lecturer', '8'], ['reviewer', '8.5']] as const) {
      const gv = await session(browser, role); sessions.push(gv.context); await gv.page.goto(`/#/classes/${c.id}`); await openReport(gv.page);
      await gv.page.getByLabel('Điểm (0–10)', { exact: true }).fill(score); await gv.page.getByLabel('Nhận xét / lý do (bắt buộc khi điểm 0)', { exact: true }).fill('Đáp ứng yêu cầu của học phần.');
      await gv.page.getByRole('button', { name: 'Nộp / cập nhật điểm về Khoa', exact: true }).click(); await expect(gv.page.getByText('Đã lưu.', { exact: true })).toBeVisible();
      if (role === 'reviewer') { await expect(gv.page.getByText('8.2', { exact: true }).last()).toBeVisible(); await gv.page.screenshot({ animations: 'disabled', path: `${screenshots}/lecturer-grading.png`, fullPage: true }); }
      expect(gv.errors).toEqual([]);
    }
    await sv.page.getByRole('button', { name: 'Tải lại', exact: true }).click(); await expect(sv.page.getByText('Tổng kết:', { exact: false })).toHaveCount(0);
    const response = await sv.context.request.get(`http://127.0.0.1:4318/api/classes/${c.id}`, { headers: { Authorization: `Bearer ${sv.token}` } }); const body = await response.json();
    expect(body.enrollments[0]).not.toHaveProperty('evaluations'); expect(body.enrollments[0]).not.toHaveProperty('finalScore');
    await sv.page.screenshot({ animations: 'disabled', path: `${screenshots}/student-submission.png`, fullPage: true }); expect(sv.errors).toEqual([]);
  } finally { for (const context of sessions) await context.close(); }
});

test('admin locks and reopens a submission without mixing old and new evaluations', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'admin'); const c = classes.find(c => c.courseCode === 'INT3132');
  try {
    await page.goto(`/#/classes/${c.id}`); await openReport(page);
    await page.getByText('Khóa điểm / mở lại bài', { exact: true }).click(); await page.getByLabel('Lý do khóa / mở khóa', { exact: true }).fill('Đối soát bảng điểm');
    await page.getByRole('button', { name: 'Khóa điểm', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mở khóa điểm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Mở khóa điểm', exact: true }).click();
    await page.getByLabel('Lý do mở lại bài', { exact: true }).fill('Sinh viên cập nhật bản báo cáo'); await page.getByLabel('Hạn nộp lại (giờ Việt Nam)', { exact: true }).fill('2099-01-01T17:00');
    await page.getByRole('button', { name: 'Mở lại bài', exact: true }).click(); await expect(page.getByText('Chưa đủ điểm', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Phiên bản báo cáo' })).toContainText('Phiên bản 3'); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('mobile class navigation and submission form fit the viewport', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'student', true);
  try {
    await page.goto('/#/classes'); await expect(page.getByRole('heading', { name: 'Học kỳ và nhóm môn' })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `${screenshots}/mobile-classes.png`, fullPage: true });
    await page.goto(`/#/classes/${classes.find(c => c.courseCode === 'INT3131').id}`); await expect(page.getByRole('heading', { name: 'Sinh viên An', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: `${screenshots}/mobile-submission.png`, fullPage: true }); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('class chat attachments, retraction, questions and website notices work in the browser', async ({ browser }) => {
  const sv = await session(browser, 'student'); const admin = await session(browser, 'admin'); const c = sv.classes.find(c => c.courseCode === 'INT3132');
  try {
    await sv.page.goto(`/#/classes/${c.id}`); await sv.page.getByRole('button', { name: 'Trao đổi', exact: true }).click();
    await sv.page.getByLabel('Tin nhắn', { exact: true }).fill('Nhờ thầy xem tài liệu đính kèm.'); await sv.page.locator('input[name=file]').setInputFiles({ name: 'tai-lieu.pdf', mimeType: 'application/pdf', buffer: pdf() });
    await sv.page.getByRole('button', { name: 'Gửi', exact: true }).click(); const attachment = sv.page.getByRole('button', { name: /tai-lieu.pdf/ }); await expect(attachment).toBeVisible();
    const downloadEvent = sv.page.waitForEvent('download'); await attachment.click(); expect((await downloadEvent).suggestedFilename()).toBe('tai-lieu.pdf');
    await sv.page.getByRole('button', { name: 'Thu hồi', exact: true }).click(); await expect(sv.page.getByText('Tin nhắn đã được thu hồi.', { exact: true })).toBeVisible();
    await sv.page.getByRole('button', { name: 'Hỏi đáp', exact: true }).click(); await sv.page.getByLabel('Câu hỏi mới', { exact: true }).fill('Slides cần quyền truy cập thế nào?'); await sv.page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click(); await expect(sv.page.getByText('Đang chờ Khoa trả lời.', { exact: true })).toBeVisible();
    await admin.page.goto(`/#/classes/${c.id}`); await feature(admin.page, 'questions'); await admin.page.getByLabel('Câu trả lời', { exact: true }).fill('Cấp quyền xem cho GVHD và GVNX.'); await admin.page.getByRole('button', { name: 'Lưu câu trả lời', exact: true }).click(); await expect(admin.page.getByRole('paragraph').filter({ hasText: 'Cấp quyền xem cho GVHD và GVNX.' })).toBeVisible();
    await feature(admin.page, 'announcements'); await admin.page.getByLabel('Tiêu đề', { exact: true }).fill('Hướng dẫn quyền Drive'); await admin.page.getByLabel('Nội dung', { exact: true }).fill('Kiểm tra quyền truy cập trước khi nộp.'); await admin.page.getByRole('button', { name: 'Xem trước người nhận', exact: true }).click(); await expect(admin.page.getByText('Kiểm tra trước khi gửi · 3 người nhận', { exact: true })).toBeVisible(); await admin.page.getByRole('button', { name: 'Gửi thông báo', exact: true }).click(); await expect(admin.page.getByText('Đã tạo thông báo cho 3 người nhận.', { exact: true })).toBeVisible();
    expect(sv.errors).toEqual([]); expect(admin.errors).toEqual([]);
  } finally { await sv.context.close(); await admin.context.close(); }
});

test('campaign workspace manages eight classes and exports exactly the selected class', async ({ browser }) => {
  const { context, page, token, classes, errors } = await session(browser, 'admin'); const a = classes.find(c => c.courseCode === 'INT3132');
  const auth = { Authorization: `Bearer ${token}` };
  try {
    for (const courseCode of ['INT3132', 'INT3131']) for (const section of ['2', '3', '4']) {
      const r = await context.request.post('http://127.0.0.1:4318/api/admin/classes', { headers: auth, data: { semesterId: a.semesterId, courseCode, section } }); expect(r.status()).toBe(200);
    }
    await page.goto(`/#/campaigns/${a.campaignId}?tab=students`); await expect(page.getByText('8 lớp · 3 sinh viên · 6 lần học', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sinh viên An', exact: true })).toHaveCount(2);
    await page.getByLabel('Lớp học phần', { exact: true }).selectOption(a.id); await expect(page.getByRole('button', { name: 'Sinh viên An', exact: true })).toHaveCount(1);
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất XLSX theo bộ lọc', exact: true }).click();
    const file = await pending; const wb = XLSX.read(await readFile((await file.path())!), { type: 'buffer' }); const exported = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
    expect(exported).toHaveLength(3); expect(exported.every(r => r['Lớp học phần'] === a.code)).toBe(true);
    const meta = await (await context.request.get(`http://127.0.0.1:4318/api/campaigns/${a.campaignId}`, { headers: auth })).json();
    const changed = await context.request.put(`http://127.0.0.1:4318/api/admin/campaigns/${a.campaignId}/settings`, { headers: auth, data: { expectedRevision: meta.campaign.revision, settings: { plan: 'Kế hoạch chung tám lớp' } } }); expect(changed.status()).toBe(200);
    const b = classes.find(c => c.courseCode === 'INT3131'); const other = await (await context.request.get(`http://127.0.0.1:4318/api/classes/${b.id}`, { headers: auth })).json(); expect(other.class.settings.plan).toBe('Kế hoạch chung tám lớp');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('student selects two course records and adviser chat is shared across their classes', async ({ browser }) => {
  const sv = await session(browser, 'student'); const gv = await session(browser, 'lecturer'); const p = sv.classes.find(c => c.courseCode === 'INT3132').campaignId;
  try {
    await sv.page.goto(`/#/campaigns/${p}`); await expect(sv.page.getByRole('button', { name: /INT3132 · INT3132 1/ })).toBeVisible(); await expect(sv.page.getByRole('button', { name: /INT3131 · INT3131 1/ })).toBeVisible();
    await sv.page.getByRole('button', { name: /INT3131 · INT3131 1/ }).click(); await expect(sv.page.getByRole('heading', { name: 'Sinh viên An', exact: true })).toBeVisible();
    await sv.page.goto('/#/chat'); await expect(sv.page).toHaveURL(new RegExp(`/campaigns/${p}\\?tab=chat`)); await sv.page.getByLabel('Cuộc trò chuyện', { exact: true }).selectOption('group:1');
    await sv.page.getByLabel('Tin nhắn', { exact: true }).fill('Trao đổi chung cả hai lớp của thầy Alpha.'); await sv.page.getByRole('button', { name: 'Gửi', exact: true }).click(); await expect(sv.page.getByText('Trao đổi chung cả hai lớp của thầy Alpha.', { exact: true })).toBeVisible();
    const b = gv.classes.find(c => c.courseCode === 'INT3131'); await gv.page.goto(`/#/classes/${b.id}`); await feature(gv.page, 'chat'); await gv.page.getByLabel('Cuộc trò chuyện', { exact: true }).selectOption('group:1');
    await expect(gv.page.getByText('Trao đổi chung cả hai lớp của thầy Alpha.', { exact: true })).toBeVisible(); expect(sv.errors).toEqual([]); expect(gv.errors).toEqual([]);
  } finally { await sv.context.close(); await gv.context.close(); }
});

test('switching campaigns revokes PDF cache and checks permission again on return', async ({ browser }) => {
  const { page, context, classes, errors } = await session(browser, 'admin'); const c = classes.find(c => c.courseCode === 'INT3132');
  await context.addInitScript(() => { (window as any).__revoked = []; const revoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = value => { (window as any).__revoked.push(value); revoke(value); }; });
  const requests: number[] = []; page.on('response', r => { if (/\/submissions\/[^/]+\/view$/.test(r.url())) requests.push(r.status()); });
  try {
    await page.goto(`/#/classes/${c.id}`); await openReport(page);
    const viewer = page.locator('iframe[title="Báo cáo bao-cao.pdf"]'); await expect(viewer).toBeVisible(); const oldUrl = await viewer.getAttribute('src');
    await page.goto('/#/campaigns/2028-2029-1:internship'); await expect(page.getByRole('heading', { name: 'Tổng quan Quản trị', exact: true })).toBeVisible();
    expect(await page.evaluate(url => (window as any).__revoked.includes(url), oldUrl)).toBe(true);
    await page.goto(`/#/classes/${c.id}`); await openReport(page); await expect(viewer).toBeVisible();
    expect(await viewer.getAttribute('src')).not.toBe(oldUrl); expect(requests).toEqual([200, 200]); expect(errors).toEqual([]);
  } finally { await context.close(); }
});
