import { feature, applyFilters } from './navigation';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const screenshots = 'scratch/academic-ui-results/previews';

test('Khoa checks mail connectivity without sending messages and sees the server IP restriction', async ({ browser }) => {
  const { page, context, errors } = await session(browser, 'admin');
  const providerRequests: string[] = []; const historyRequests:string[]=[];
  try {
    await context.route('**/api/admin/notifications?*', route => { historyRequests.push(route.request().url()); return route.fulfill({ json: { items: [], total: 0, page: 1, limit: 25, totalPages: 1 } }); });
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
    expect(providerRequests).toEqual(['GET', 'GET']); expect(historyRequests).toHaveLength(1); expect(errors).toEqual([]);
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
    await applyFilters(page, {'Lớp học phần': c.id});
    await page.getByLabel('Tìm sinh viên', { exact: true }).fill('24020001');
    await applyFilters(page, {'Trạng thái':'active'});
    await expect(page.getByRole('columnheader', { name: 'Liên hệ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nhập danh sách Dự án', exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Import danh sách', exact: true }).click();
    await expect(page.locator('input[type=file]').first()).toBeVisible();
    await feature(page, 'reports');
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('classId')).toBe(c.id);
    await expect(page.getByLabel('Tìm sinh viên', { exact: true })).toHaveValue('24020001');
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).has('status')).toBe(false);
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
    await context.route(/\/api\/admin\/reports\/final(?:\?.*)?$/,  route => route.fulfill({ json: [
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
  const { page, context, classes, errors, token } = await session(browser, 'admin');
  const calls:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('reviewer'))calls.push(r.url());});
  try {
    await page.goto('/#/classes'); await expect(page.getByRole('heading', { name: /Trang chủ|Học kỳ và nhóm môn/ })).toBeVisible();
    await page.getByRole('button', { name: 'Quản lý học kỳ / nhóm môn' }).click();
    await page.getByLabel('Năm bắt đầu').fill('2028'); await page.getByRole('button', { name: 'Tạo học kỳ', exact: true }).click();
    await expect(page.getByLabel('Học kỳ', { exact: true }).first()).toHaveValue('2028-2029-1');
    await page.getByRole('button', { name: 'Tạo lớp nháp', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Thực tập', exact: true })).toBeVisible();
    const target = classes.find(c => c.courseCode === 'INT3132'); await page.goto(`/#/classes/${target.id}`);
    await feature(page, 'assignments'); const trigger=page.getByRole('button',{name:'Phân công GV nhận xét',exact:true});await expect(trigger).toBeVisible();expect(calls).toEqual([]);
    const auth={Authorization:`Bearer ${token}`};const reviewers=async()=>{const r=await context.request.get(`http://127.0.0.1:4318/api/campaigns/${target.campaignId}/enrollments`,{headers:auth});return(await r.json()).items.flatMap(e=>e.assignments.filter(a=>a.role==='reviewer')).length;};
    const before=await reviewers();await trigger.click();await expect(page.getByText('Cùng bộ môn').first()).toBeVisible();expect(calls).toHaveLength(1);expect(await reviewers()).toBe(before);
    await page.screenshot({animations:'disabled',path:`${screenshots}/manual-reviewer-preview-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});expect((await page.getByRole('dialog',{name:'Phân công GV nhận xét'}).boundingBox())!.width).toBeLessThanOrEqual(390);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:'disabled',path:`${screenshots}/manual-reviewer-preview-mobile.png`,fullPage:true});await page.setViewportSize({width:1440,height:1000});
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(await reviewers()).toBe(before);await expect(trigger).toBeFocused();
    await trigger.click();await expect(page.getByText('Cùng bộ môn').first()).toBeVisible();expect(calls).toHaveLength(2);await page.getByRole('button',{name:'Xác nhận phân công',exact:true}).click();
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
    await page.goto('/#/classes'); await expect(page.getByRole('heading', { name: /Trang chủ|Học kỳ và nhóm môn/ })).toBeVisible();
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
    await feature(sv.page,'questions'); await sv.page.getByLabel('Câu hỏi mới', { exact: true }).fill('Slides cần quyền truy cập thế nào?'); await sv.page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click(); await expect(sv.page.getByText('Đang chờ Khoa trả lời.', { exact: true })).toBeVisible();
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
    await page.goto(`/#/campaigns/${a.campaignId}?tab=students`); await expect(page.getByTestId('campaign-chrome')).not.toContainText('8 lớp');
    await expect(page.getByRole('button', { name: 'Sinh viên An', exact: true })).toHaveCount(2);
    await applyFilters(page, {'Lớp học phần': a.id}); await expect(page.getByRole('button', { name: 'Sinh viên An', exact: true })).toHaveCount(1);
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

test('project topic becomes pending, adviser approves or edits, and changed submitted work requires resubmission on desktop/mobile', async ({ browser }) => {
  const sv = await session(browser, 'student'); const gv = await session(browser, 'lecturer');
  const c = sv.classes.find(c => c.courseCode === 'INT3131');
  try {
    await sv.page.goto(`/#/classes/${c.id}`);
    await sv.page.getByRole('textbox', { name: 'Tên đề tài Dự án', exact: true }).fill('Đề tài chờ duyệt từ sinh viên');
    await sv.page.getByRole('button', { name: 'Gửi GVHD duyệt', exact: true }).click();
    await expect(sv.page.getByRole('region', { name: 'Đề tài Dự án' })).toContainText('Pending');
    await expect(sv.page.locator('input[name=pdf]')).toBeDisabled();
    await sv.page.screenshot({ animations: 'disabled', path: `${screenshots}/topic-student-pending-desktop.png`, fullPage: true });
    await gv.page.goto(`/#/classes/${c.id}`);
    await applyFilters(gv.page, {'Trạng thái đề tài':'pending'});
    await gv.page.getByRole('button', { name: 'Sinh viên An', exact: true }).click();
    await gv.page.getByRole('button', { name: 'Duyệt đề tài', exact: true }).click();
    await expect(gv.page.getByRole('region', { name: 'Đề tài Dự án' })).toContainText('Đã duyệt');
    await gv.page.getByRole('button', { name: 'Sửa và duyệt', exact: true }).click();
    await gv.page.getByRole('textbox', { name: 'Tên đề tài Dự án', exact: true }).fill('Đề tài đã được GVHD điều chỉnh');
    await gv.page.getByRole('button', { name: 'Lưu và duyệt', exact: true }).click();
    await expect(gv.page.getByRole('region', { name: 'Đề tài Dự án' })).toContainText('Đã duyệt');
    await gv.page.setViewportSize({ width: 390, height: 844 });
    await gv.page.screenshot({ animations: 'disabled', path: `${screenshots}/topic-adviser-approved-mobile.png`, fullPage: true });
    expect(await gv.page.getByRole('dialog').evaluate(el => el.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
    await sv.page.reload(); await expect(sv.page.locator('input[name=pdf]')).toBeEnabled();
    await expect(sv.page.getByRole('textbox', { name: 'Tên đề tài Dự án', exact: true })).toHaveValue('Đề tài đã được GVHD điều chỉnh');
    await sv.page.locator('input[name=pdf]').setInputFiles({ name: 'topic-approved.pdf', mimeType: 'application/pdf', buffer: pdf() });
    await sv.page.getByRole('textbox', { name: 'Link Google Drive slide', exact: true }).fill('https://docs.google.com/presentation/d/topic-slide/edit');
    await sv.page.getByRole('textbox', { name: 'Link Google Drive video demo', exact: true }).fill('https://drive.google.com/file/d/topic-demo/view');
    await sv.page.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }).click();
    await expect(sv.page.getByText('Đã nộp bộ bài', { exact: true })).toBeVisible();
    await sv.page.getByRole('textbox', { name: 'Tên đề tài Dự án', exact: true }).fill('Đề tài đổi sau nộp');
    await sv.page.getByRole('button', { name: 'Gửi GVHD duyệt', exact: true }).click();
    await expect(sv.page.getByRole('region', { name: 'Đề tài Dự án' })).toContainText('Cần nộp lại theo đề tài mới');
    await expect(sv.page.locator('input[name=pdf]')).toBeDisabled();
    await gv.page.getByRole('button', { name: 'Đóng hồ sơ', exact: true }).click();
    await gv.page.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await gv.page.getByRole('button', { name: 'Sinh viên An', exact: true }).click();
    await gv.page.getByRole('button', { name: 'Duyệt đề tài', exact: true }).click();
    await sv.page.reload();
    await expect(sv.page.locator('input[name=pdf]')).toBeEnabled();
    await sv.page.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }).click();
    await expect(sv.page.getByRole('region', { name: 'Đề tài Dự án' })).not.toContainText('Cần nộp lại');
    await sv.page.setViewportSize({ width: 390, height: 844 });
    await sv.page.screenshot({ animations: 'disabled', path: `${screenshots}/topic-student-resubmitted-mobile.png`, fullPage: true });
    expect(await sv.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(sv.errors).toEqual([]); expect(gv.errors).toEqual([]);
  } finally { await sv.context.close(); await gv.context.close(); }
});

test('functions load on demand, revisit with ETag, debounce searches and export without refreshing the group', async ({ browser }) => {
  const {page,context,classes,errors}=await session(browser,'admin'); const c=classes.find(c=>c.courseCode==='INT3132');
  const calls:{url:string;tag?:string;status?:number}[]=[];
  page.on('request',r=>{if(r.url().includes('/api/'))calls.push({url:r.url(),tag:r.headers()['if-none-match']});});
  const listResponses:number[]=[];page.on('response',r=>{if(r.url().includes(`/campaigns/${c.campaignId}/enrollments`))listResponses.push(r.status());});
  try {
    await page.goto(`/#/campaigns/${c.campaignId}`);await expect(page.getByRole('heading',{name:'Tổng quan Quản trị'})).toBeVisible();
    expect(calls.some(r=>/\/enrollments|\/submissions|chat-context|\/questions|import/.test(r.url))).toBe(false);
    await page.getByRole('region',{name:'Chức năng quản lý'}).getByRole('button',{name:/^Kế hoạch/}).click();
    await expect(page.getByRole('heading',{name:'Cài đặt Kế hoạch',exact:true})).toBeVisible();
    await feature(page,'settings');await expect(page.getByRole('heading',{name:'Thiết lập',exact:true})).toBeVisible();
    expect(calls.some(r=>/\/enrollments|\/submissions|chat-context|\/questions|import/.test(r.url))).toBe(false);
    await feature(page,'students');await expect(page.getByRole('button',{name:'Sinh viên An',exact:true})).toHaveCount(2);
    expect(listResponses).toEqual([200]);const first=calls.find(r=>r.url.includes('/enrollments?'))!;expect(new URL(first.url).searchParams.get('projection')).toBe('students');
    await feature(page,'plan');await expect(page.getByRole('heading',{name:'Kế hoạch và hướng dẫn',exact:true})).toBeVisible();await feature(page,'students');await expect.poll(()=>listResponses.length).toBe(2);expect(listResponses[1]).toBe(304);
    const beforeSearch=calls.filter(r=>r.url.includes('/enrollments?')).length;
    await page.getByLabel('Tìm sinh viên',{exact:true}).fill('2402');await page.getByLabel('Tìm sinh viên',{exact:true}).fill('24020001');
    await expect.poll(()=>calls.filter(r=>r.url.includes('/enrollments?')).length).toBe(beforeSearch+1);
    expect(new URL(calls.filter(r=>r.url.includes('/enrollments?')).at(-1)!.url).searchParams.get('q')).toBe('24020001');
    const beforeExport=calls.length;const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Xuất XLSX theo bộ lọc',exact:true}).click();await downloaded;
    expect(calls.slice(beforeExport).filter(r=>r.url.includes('/api/campaigns/')).every(r=>r.url.includes('/exports/'))).toBe(true);
    const beforeReload=calls.length;await page.getByRole('button',{name:'Tải lại',exact:true}).click();await expect.poll(()=>calls.slice(beforeReload).some(r=>r.url.includes('/enrollments?'))).toBe(true);
    expect(calls.slice(beforeReload).filter(r=>r.url.includes('/enrollments?')).every(r=>!r.tag)).toBe(true);
    const beforeF5=calls.length;await page.reload();await expect(page.getByRole('columnheader',{name:'Liên hệ'})).toBeVisible();
    await expect.poll(()=>calls.slice(beforeF5).some(r=>r.url.includes('/enrollments?'))).toBe(true);
    expect(calls.slice(beforeF5).filter(r=>r.url.includes('/enrollments?')).every(r=>!r.tag)).toBe(true);expect(errors).toEqual([]);
  } finally {await context.close();}
});

test('legacy pagination exports every filtered result and does not load campaign enrollments',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'admin');const c=classes.find(c=>c.legacy);
  const source=Array.from({length:127},(_,i)=>({user_id:9000+i,student_id:String(22029000+i),student_name:`Sinh viên đối soát ${i}`,email:`22029${i}@vnu.edu.vn`,class_name:'K67',course_code:'Thực tập Doanh nghiệp INT4002',report_status:'missing'}));
  const sizes:number[]=[];const academicCalls:string[]=[];
  await context.route(/\/api\/admin\/reports\/final(?:\?.*)?$/,route=>{const q=new URL(route.request().url()).searchParams;const page=Number(q.get('page')||1),limit=Number(q.get('limit')||25);sizes.push(limit);return route.fulfill({json:{items:source.slice((page-1)*limit,page*limit),total:127,studentCount:127,page,limit,totalPages:Math.ceil(127/limit),summary:{report_missing:127}}});});
  page.on('request',r=>{if(r.url().includes('/enrollments'))academicCalls.push(r.url());});
  try{
    await page.goto(`/#/campaigns/${c.campaignId}?tab=reports`);await expect(page.getByRole('cell').filter({hasText:'Sinh viên đối soát'})).toHaveCount(25);expect(sizes).toEqual([25]);expect(academicCalls).toEqual([]);
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:/^Xuất XLSX/}).click();const file=await pending;
    const wb=XLSX.read(await readFile((await file.path())!),{type:'buffer'});expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])).toHaveLength(127);expect(sizes).toEqual([25,100,100]);expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('a successful save invalidates the active function in another browser tab',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'admin');const p=classes.find(c=>c.courseCode==='INT3132').campaignId;const editor=await context.newPage();
  try{
    await page.goto(`/#/campaigns/${p}?tab=plan`);await expect(page.getByRole('heading',{name:'Kế hoạch và hướng dẫn',exact:true})).toBeVisible();
    await editor.goto(`/#/campaigns/${p}?tab=settings`);await editor.getByRole('textbox',{name:'Kế hoạch (Markdown)',exact:true}).fill('Kế hoạch đồng bộ giữa hai tab nghiệm thu');
    await editor.getByRole('button',{name:'Lưu thiết lập nhóm môn',exact:true}).click();
    await expect(page.getByText('Kế hoạch đồng bộ giữa hai tab nghiệm thu',{exact:true})).toBeVisible();expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('original admin cards and dedicated content editors remain functional inside their campaign',async({browser})=>{
  const {page,context,classes,token,errors}=await session(browser,'admin');const legacy=classes.find(c=>c.legacy),project=classes.find(c=>c.courseCode==='INT3132');
  const calls:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});page.on('dialog',dialog=>dialog.accept());
  await context.route('**/api/admin/dashboard-stats',r=>r.fulfill({json:{registeredCount:899,confirmedCount:669,reportCount:644,gradedCount:675}}));
  const auth={Authorization:`Bearer ${token}`};
  try{
    const before=await(await context.request.get(`http://127.0.0.1:4318/api/campaigns/${project.campaignId}`,{headers:auth})).json();
    await page.goto(`/#/campaigns/${legacy.campaignId}`);const cards=page.getByRole('region',{name:'Chức năng quản lý'});
    for(const name of ['Quản lý Đăng ký','Quản lý Sinh viên','Quản lý Giảng viên','Quản lý Doanh nghiệp','Phân công GVHD','Báo cáo thực tập','Bảng điểm thực tập','CSDL Thẩm định','Thông báo & Email','Cài đặt hệ thống','Kế hoạch triển khai','Quy định thực tập','Hướng dẫn GV','Cài đặt FAQ','Quản trị viên'])await expect(cards.getByRole('button',{name,exact:true})).toBeVisible();
    await expect(page.getByText('Số SV xác nhận',{exact:true})).toBeVisible();await page.screenshot({animations:'disabled',path:`${screenshots}/original-legacy-admin-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({animations:'disabled',path:`${screenshots}/original-legacy-admin-mobile.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});
    await cards.getByRole('button',{name:'Kế hoạch triển khai',exact:true}).click();await expect(page.getByRole('heading',{name:'Cài đặt Kế hoạch'})).toBeVisible();await expect(page.getByText('Xem trước',{exact:true})).toBeVisible();
    const value='Kế hoạch kiểm tra riêng cho Thực tập, giữ giao diện soạn Word và Markdown';await page.locator('textarea').fill(value);await page.getByRole('button',{name:'Lưu kế hoạch',exact:true}).click();
    await expect.poll(async()=>{const r=await context.request.get(`http://127.0.0.1:4318/api/campaigns/${legacy.campaignId}`,{headers:auth});return(await r.json()).campaign.settings.plan;}).toBe(value);
    const after=await(await context.request.get(`http://127.0.0.1:4318/api/campaigns/${project.campaignId}`,{headers:auth})).json();expect(after.campaign.settings.plan).toBe(before.campaign.settings.plan);
    await feature(page,'faq-editor');await expect(page.getByRole('tab',{name:'FAQ Giảng viên',exact:true})).toBeVisible();await page.getByRole('tab',{name:'FAQ Giảng viên',exact:true}).click();await expect(page.locator('textarea')).toBeVisible();
    await feature(page,'guide-editor');await expect(page.getByRole('button',{name:'Lưu hướng dẫn',exact:true})).toBeVisible();await expect(page.locator('input[type=file]')).toHaveCount(1);
    expect(calls.some(url=>/\/enrollments|\/submissions|chat-context/.test(url))).toBe(false);expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('legacy lecturer PDF viewer preserves its cached PDF and rechecks access before reuse',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'lecturer');const c=classes.find(c=>c.legacy);let views=0,denied=false;const conditions:(string|undefined)[]=[];
  await context.route(/\/api\/lecturer\/students(?:\?.*)?$/,r=>r.fulfill({json:[{user_id:300,assignment_id:300,lecturer_id:1,advisor_role:'primary',student_id:'23029901',student_name:'Sinh viên PDF Thực tập',email:'23029901@vnu.edu.vn',course_code:'INT4002',report_status:'submitted',report_filename:'bao-cao-legacy.pdf',report_file_size:100}]}));
  await context.route('**/api/lecturer/grades/300',r=>r.fulfill({json:null}));
  await context.route('**/api/settings/campaign',r=>r.fulfill({json:{}}));
  await context.route('**/api/reports/final/300/view',r=>{views++;conditions.push(r.request().headers()['if-none-match']);if(denied)return r.fulfill({status:403,json:{error:'Quyền xem đã thay đổi'}});return r.request().headers()['if-none-match']==='"legacy-test"'?r.fulfill({status:304,headers:{ETag:'"legacy-test"'}}):r.fulfill({status:200,body:pdf(),contentType:'application/pdf',headers:{ETag:'"legacy-test"'}});});
  try{
    await page.goto(`/#/campaigns/${c.campaignId}?tab=students`);await page.getByRole('button',{name:'Xem & Chấm',exact:true}).click();await expect(page.locator('iframe')).toBeVisible();const old=await page.locator('iframe').getAttribute('src');await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Xem & Chấm',exact:true}).click();await expect(page.locator('iframe')).toBeVisible();expect(await page.locator('iframe').getAttribute('src')).toBe(old);expect(views).toBeGreaterThanOrEqual(2);expect(conditions.at(-1)).toBe('"legacy-test"');await page.keyboard.press('Escape');
    denied=true;await page.getByRole('button',{name:'Xem & Chấm',exact:true}).click();await expect(page.getByText('Quyền xem đã thay đổi',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('returning to a visible question screen revalidates its content without loading records',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'student');const p=classes.find(c=>c.courseCode==='INT3132').campaignId;const statuses:number[]=[];let records=0;
  page.on('response',r=>{if(r.url().endsWith(`/campaigns/${p}/questions`))statuses.push(r.status());});page.on('request',r=>{if(r.url().includes('/enrollments'))records++;});
  try{
    await page.goto(`/#/campaigns/${p}?tab=questions`);await expect.poll(()=>statuses.length).toBe(1);expect(statuses[0]).toBe(200);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});expect(statuses).toEqual([200]);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>statuses.length).toBe(2);expect(statuses[1]).toBe(304);expect(records).toBe(0);expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('compact chrome preserves all role navigation without loading records when menus open',async({browser})=>{
  for(const role of ['admin','lecturer','student'] as const){
    const {page,context,classes,errors}=await session(browser,role);const p=classes.find(c=>c.courseCode==='INT3132').campaignId;const calls:string[]=[];
    page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});
    try{
      await page.goto(`/#/campaigns/${p}?tab=plan`);await expect(page.getByRole('heading',{name:'Kế hoạch và hướng dẫn',exact:true})).toBeVisible();
      const chrome=page.getByTestId('campaign-chrome');expect((await chrome.boundingBox())!.height).toBeLessThanOrEqual(88);
      await expect(chrome).not.toContainText('Đang hoạt động');await expect(chrome).not.toContainText('lần học');await expect(page.getByTestId('campaign-list-toolbar')).toHaveCount(0);
      await page.getByRole('button',{name:'Thêm chức năng',exact:true}).click();await expect(page.getByRole('dialog',{name:'Chức năng',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Thêm chức năng'})).toBeFocused();
      const before=calls.length;await page.getByRole('button',{name:'Chọn học kỳ và nhóm môn'}).click();await expect(page.getByRole('dialog',{name:'Học kỳ và nhóm môn'}).getByLabel('Học kỳ',{exact:true})).toBeVisible();
      expect(calls.slice(before).filter(url=>url.includes('/api/campaigns/'))).toEqual([]);expect(calls.some(url=>/\/enrollments|\/submissions|chat-context/.test(url))).toBe(false);await page.keyboard.press('Escape');
      await feature(page,'students');await expect(page.getByRole('heading',{name:role==='admin'?'Sinh viên':role==='lecturer'?'Sinh viên phụ trách':'Hồ sơ và bài nộp',exact:true})).toBeVisible();
      if(role!=='student')await expect(page.getByRole('columnheader',{name:'Sinh viên',exact:true})).toBeVisible();
      await page.screenshot({path:`${screenshots}/compact-${role}-desktop.png`,fullPage:true});
      await page.setViewportSize({width:390,height:844});const nav=page.getByRole('navigation',{name:'Chức năng nhóm môn'});
      await expect(nav.locator('[data-campaign-tab]')).toHaveCount(2);expect((await nav.boundingBox())!.height).toBe(36);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await feature(page,'plan');await expect(nav.getByRole('button',{name:'Thêm chức năng'})).toHaveAttribute('aria-current','page');await expect(page.getByTestId('campaign-list-toolbar')).toHaveCount(0);
      await page.screenshot({path:`${screenshots}/compact-${role}-mobile.png`,fullPage:true});expect(errors).toEqual([]);
    }finally{await context.close();}
  }
});

test('filter drafts make no requests; apply is atomic, cancel discards, and clear retains search',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'admin');const c=classes.find(c=>c.courseCode==='INT3132');const calls:string[]=[];
  page.on('request',r=>{if(r.url().includes('/enrollments?'))calls.push(r.url());});
  const dialog=page.getByRole('dialog',{name:'Bộ lọc danh sách'}),button=page.getByRole('button',{name:/^Bộ lọc/});
  try{
    await page.goto(`/#/campaigns/${c.campaignId}?tab=students&q=24020001&page=2`);await expect(page.getByText('Không có hồ sơ trong bộ lọc.',{exact:true})).toBeVisible();const before=calls.length;
    await button.click();await dialog.getByLabel('Học phần',{exact:true}).selectOption(c.courseCode);await dialog.getByLabel('Lớp học phần',{exact:true}).selectOption(c.id);await expect(dialog.getByLabel('Lớp học phần',{exact:true})).toHaveValue(c.id);expect(calls).toHaveLength(before);
    await dialog.getByRole('button',{name:'Hủy',exact:true}).click();await expect(button).toHaveAccessibleName('Bộ lọc');expect(page.url()).toContain('page=2');
    await button.click();await expect(dialog.getByLabel('Lớp học phần',{exact:true})).toHaveValue('');await dialog.getByLabel('Lớp học phần',{exact:true}).selectOption(c.id);await page.keyboard.press('Escape');await expect(button).toBeFocused();expect(calls).toHaveLength(before);
    await applyFilters(page,{'Học phần':c.courseCode,'Lớp học phần':c.id,'Trạng thái đề tài':'approved'});
    await expect(page.getByRole('button',{name:'Sinh viên An',exact:true})).toHaveCount(1);await expect(button).toHaveAccessibleName('Bộ lọc (3)');await expect.poll(()=>calls.length).toBe(before+1);expect(page.url()).not.toContain('page=');
    const applied=new URL(calls.at(-1)!);expect(applied.searchParams.get('courseCode')).toBe(c.courseCode);expect(applied.searchParams.get('classId')).toBe(c.id);expect(applied.searchParams.get('q')).toBe('24020001');
    const beforeClear=calls.length;await page.getByLabel('Tìm sinh viên',{exact:true}).fill('2402000');await expect(page).toHaveURL(new RegExp('classId='+c.id));await expect(page.getByLabel('Tìm sinh viên',{exact:true})).toHaveValue('2402000');
    await button.click();await dialog.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();await expect(button).toHaveAccessibleName('Bộ lọc');await expect(page.getByLabel('Tìm sinh viên',{exact:true})).toHaveValue('2402000');await expect(page).not.toHaveURL(/classId=/);await expect.poll(()=>calls.length).toBe(beforeClear+1);expect(new URL(calls.at(-1)!).searchParams.get('q')).toBe('2402000');
    await page.setViewportSize({width:320,height:740});await button.click();const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);expect(box.y+box.height).toBeGreaterThan(700);await expect(dialog).toHaveAttribute('aria-modal','true');
    await dialog.getByRole('button',{name:'Áp dụng',exact:true}).focus();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Đóng bộ lọc danh sách'})).toBeFocused();await page.keyboard.press('Escape');expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('switching group clears filters while keeping an eligible teaching view',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'admin');const project=classes.find(c=>c.courseCode==='INT3132'),legacy=classes.find(c=>c.legacy);const calls:string[]=[];
  await context.route(/\/api\/lecturer\/students(?:\?.*)?$/,r=>r.fulfill({json:[]}));page.on('request',r=>{if(r.url().includes('/enrollments?'))calls.push(r.url());});
  try{
    await page.goto(`/#/campaigns/${project.campaignId}?tab=students&view=lecturer&q=Bình&courseCode=INT3132&topicStatus=approved`);await expect(page.getByRole('heading',{name:'Sinh viên phụ trách',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Bộ lọc (2)',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sinh viên Bình',exact:true})).toHaveCount(1);const before=calls.length;
    await page.getByRole('button',{name:'Chọn học kỳ và nhóm môn'}).click();const dialog=page.getByRole('dialog',{name:'Học kỳ và nhóm môn'});await dialog.getByLabel('Học kỳ',{exact:true}).selectOption(legacy.semesterId);expect(calls).toHaveLength(before);await dialog.getByRole('button',{name:'Thực tập',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${legacy.campaignId}\\?tab=students&view=lecturer$`));await expect(page.getByRole('button',{name:'Bộ lọc',exact:true})).toBeVisible();await expect(page.getByLabel('Tìm sinh viên',{exact:true})).toHaveValue('');await expect(page.getByRole('dialog')).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('legacy reports share one title and toolbar, preserve adviser filters and URL pagination',async({browser})=>{
  const {page,context,classes,errors}=await session(browser,'admin');const c=classes.find(c=>c.legacy);const requests:URL[]=[];
  await context.route(/\/api\/admin\/reports\/final(?:\?.*)?$/,r=>{
    const q=new URL(r.request().url()).searchParams;requests.push(new URL(r.request().url()));const page=Number(q.get('page')||1),limit=Number(q.get('limit')||25);
    return r.fulfill({json:{items:Array.from({length:25},(_,i)=>({user_id:500+i,student_id:String(23025000+i),student_name:`Sinh viên lọc ${i}`,course_code:'INT4002',report_status:'missing',primary_advisors:'TS. Alpha'})),total:75,studentCount:75,page,limit,totalPages:3,summary:{report_missing:75,advisorOptions:JSON.stringify(['TS. Alpha','TS. Beta'])}}});
  });
  try{
    await page.goto(`/#/campaigns/${c.campaignId}?tab=reports&page=2`);await expect(page.locator('tbody tr')).toHaveCount(25);expect(page.url()).toContain('page=2');expect(requests).toHaveLength(1);expect(requests[0].searchParams.get('page')).toBe('2');
    await expect(page.locator('main h1')).toHaveCount(1);await expect(page.getByRole('button',{name:/^Xuất XLSX/})).toHaveCount(1);await expect(page.locator('main input:not([type=checkbox])')).toHaveCount(1);
    await applyFilters(page,{'Học phần':'INT4002','GVHD chính':'TS. Alpha','Trạng thái báo cáo':'missing'});await expect(page.getByRole('button',{name:'Bộ lọc (3)',exact:true})).toBeVisible();await expect.poll(()=>requests.length).toBe(2);
    expect(requests[1].searchParams.get('advisor')).toBe('TS. Alpha');expect(requests[1].searchParams.get('status')).toBe('missing');expect(requests[1].searchParams.get('courseCode')).toBe('INT4002');expect(requests[1].searchParams.get('page')).toBe('1');
    await page.screenshot({path:`${screenshots}/compact-legacy-reports.png`,fullPage:true});expect(errors).toEqual([]);
  }finally{await context.close();}
});
