import { feature, applyFilters } from './navigation';
import { test, expect } from '@playwright/test';
import { mkdir,readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

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
      await expect(page.getByRole('heading', { name: role === 'admin' ? 'Tổng quan Quản trị' : role === 'lecturer' ? 'Danh sách sinh viên' : 'Hồ sơ và bài nộp', exact: true })).toBeVisible();
      if (role === 'admin') {
        await expect(page.getByText('Số lần học', {exact:true})).toBeVisible();
        await page.getByRole('region', { name: 'Chức năng quản lý' }).getByRole('button', { name: 'Danh sách sinh viên',exact:true }).click();
        await expect(page.getByRole('columnheader', { name: 'Điểm GVHD — 60%' })).toBeVisible();
        await applyFilters(page, {'Lớp học phần': {label:'INT3132 1'}});
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

test('project topic approval works on a prepared private copy without changing the original source', async ({ browser }) => {
  const base = process.env.ACADEMIC_ACCEPTANCE_BASE;
  test.skip(!base, 'Requires an explicitly prepared local copy.');
  const origin = new URL(base!); expect(origin.protocol).toBe('http:'); expect(['127.0.0.1','localhost']).toContain(origin.hostname);
  const email = process.env.ACADEMIC_ACCEPTANCE_STUDENT!; expect(email).toBeTruthy();
  const contexts = [];
  const login = async (email?: string) => {
    const context = await browser.newContext({ viewport: {width:1440,height:1000} }); contexts.push(context);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin.origin || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto(`${origin.origin}/__local_staging/login${email ? '?email='+encodeURIComponent(email):''}`);
    await expect(page.getByRole('heading',{name:'Học kỳ và nhóm môn'})).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('token'));
    return {context,page,headers:{Authorization:`Bearer ${token}`}};
  };
  try {
    const sv=await login(email); const admin=await login(); const campaign='2026-2027-1:project';
    const list=await (await sv.context.request.get(`${origin.origin}/api/campaigns/${campaign}/enrollments`,{headers:sv.headers})).json();
    const e=list.items.find(e=>e.courseCode==='INT3131'); expect(e).toBeTruthy();
    const meta=await (await admin.context.request.get(`${origin.origin}/api/campaigns/${campaign}`,{headers:admin.headers})).json();
    const primary=meta.lecturers.find(l=>l.id===e.assignments.find(a=>a.role==='primary').lecturerId); expect(primary).toBeTruthy();
    const gv=await login(primary.email);
    const path=`/#/campaigns/${campaign}?tab=students&enrollmentId=${e.id}`;
    await sv.page.goto(origin.origin+path);
    await sv.page.getByRole('textbox',{name:'Tên đề tài Dự án',exact:true}).fill(`Đề tài nghiệm thu riêng trên bản sao local ${Date.now()}`);
    await sv.page.getByRole('button',{name:'Gửi GVHD duyệt',exact:true}).click();
    await expect(sv.page.getByRole('region',{name:'Đề tài Dự án'})).toContainText('Pending');
    await gv.page.goto(origin.origin+path);
    const row=gv.page.locator('#project-row-'+e.id);await row.getByRole('button',{name:'Duyệt đề tài',exact:true}).click();await gv.page.getByRole('button',{name:'Lưu thay đổi (1)',exact:true}).click();await expect(row.getByText('Đã duyệt',{exact:true})).toBeVisible();
    await sv.page.reload(); await expect(sv.page.getByRole('region',{name:'Đề tài Dự án'})).toContainText('Đã duyệt');
    const after=await (await sv.context.request.get(`${origin.origin}/api/campaigns/${campaign}/enrollments`,{headers:sv.headers})).json();
    expect(after.items.find(x=>x.courseCode==='INT3132').topic).toBe(list.items.find(x=>x.courseCode==='INT3132').topic);
    expect(after.items.find(x=>x.id===e.id)).not.toHaveProperty('evaluations');
    await sv.page.screenshot({animations:'disabled',path:'scratch/academic-ui-results/private-local-copy/topic-approved.png',fullPage:true});
  } finally { for (const context of contexts) await context.close(); }
});


test('legacy reports export all pages and assigned legacy students remain available on the private copy',async({browser})=>{
  const base=process.env.ACADEMIC_ACCEPTANCE_BASE;test.skip(!base,'Requires a prepared private local copy.');
  const origin=new URL(base!);expect(origin.protocol).toBe('http:');expect(['127.0.0.1','localhost']).toContain(origin.hostname);
  const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===origin.origin||/^(blob|data):/.test(r.request().url())?r.continue():r.abort());
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(origin.origin+'/__local_staging/login');await expect(page.getByRole('heading',{name:'Học kỳ và nhóm môn'})).toBeVisible();
    const token=await page.evaluate(()=>localStorage.getItem('token'));const headers={Authorization:`Bearer ${token}`};
    const response=await context.request.get(origin.origin+'/api/admin/reports/final?pagination=1&limit=25',{headers});const records=await response.json();expect(records.total).toBeGreaterThan(25);
    await page.goto(origin.origin+'/#/campaigns/2025-2026-summer:internship?tab=reports');await expect(page.locator('tbody tr')).toHaveCount(25);
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:/^Xuất XLSX/}).click();const download=await pending;
    const wb=XLSX.read(await readFile((await download.path())!),{type:'buffer'});expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])).toHaveLength(records.total);
    await page.goto(origin.origin+'/__local_staging/login?email='+encodeURIComponent(process.env.ACADEMIC_ACCEPTANCE_LECTURER!));await expect(page.getByRole('heading',{name:'Học kỳ và nhóm môn'})).toBeVisible();
    await page.goto(origin.origin+'/#/campaigns/2025-2026-summer:internship?tab=students');await expect(page.locator('tbody tr').first()).toBeVisible();expect(await page.locator('tbody tr').count()).toBeLessThanOrEqual(25);
    await feature(page,'chat');await expect(page.locator('textarea[placeholder="Nhập tin nhắn..."]')).toBeVisible();expect(page.url()).toContain('campaigns/2025-2026-summer:internship');
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('legacy assignment subviews retain their own operations without expanding the common heading',async({browser})=>{
  const base=process.env.ACADEMIC_ACCEPTANCE_BASE;test.skip(!base,'Requires a prepared private local copy.');
  const origin=new URL(base!);expect(origin.protocol).toBe('http:');expect(['127.0.0.1','localhost']).toContain(origin.hostname);
  const context=await browser.newContext({viewport:{width:768,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin.origin||/^(blob|data):/.test(r.request().url())?r.continue():r.abort());
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(origin.origin+'/__local_staging/login');await expect(page.getByRole('heading',{name:'Học kỳ và nhóm môn'})).toBeVisible();
    for(const view of ['assignments','requests','quotas']){
      await page.setViewportSize({width:768,height:1000});await page.goto(origin.origin+'/#/campaigns/2025-2026-summer:internship?tab=assignments&view='+view);
      await expect(page.getByRole('tab',{name:/Chỉ tiêu & Quota/})).toBeVisible();await expect(page.locator('main h1')).toHaveCount(1);expect((await page.getByTestId('campaign-chrome').boundingBox())!.height).toBeLessThanOrEqual(88);
      await expect(page.getByTestId('campaign-list-toolbar')).toHaveCount(view==='quotas'?0:1);
      if(view==='assignments')for(const name of ['Tự phân công','Đồng bộ dữ liệu cũ','Xuất XLSX'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
      await page.setViewportSize({width:320,height:740});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
