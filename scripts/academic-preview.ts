// Isolated, loopback-only UI fixture. It never initializes or connects to application DBs.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'academic-preview-only-local-tests';
process.env.EMAIL_PROVIDER = 'none';
process.env.VITE_API_BASE_URL = '';
for (const key of Object.keys(process.env)) if (key.startsWith('R2_')) delete process.env[key];

const { default: express } = await import('express');
const { default: jwt } = await import('jsonwebtoken');
const { randomUUID } = await import('node:crypto');
const { mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createServer: createHttpServer } = await import('node:http');
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const { default: tailwindcss } = await import('@tailwindcss/vite');
const { createAcademicFixture } = await import('../tests/academic/fixture');
const database = await import('../server/db');
const { snapshot, commit } = await import('../server/academic/store');
const { changeTopic, approveTopic } = await import('../server/academic/topics');
const { newEnrollment } = await import('../server/academic/domain');
const { createSemester, createClass, updateClass } = await import('../server/academic/service');
const { updateCampaign } = await import('../server/academic/campaigns');
const { academicRouter } = await import('../server/academic/routes');
const { legacyPreview, applyLegacy } = await import('../server/academic/legacy');
const projectRoot = process.cwd();
const storageRoot = await mkdtemp(join(tmpdir(), 'academic-preview-'));
const admin = { id: 1, email: 'admin@vnu.edu.vn', name: 'Khoa', role: 'admin' as const };
const client = await createAcademicFixture();
await database.db.executeMultiple("UPDATE users SET is_lecturer=1 WHERE id=1; INSERT INTO lecturers(id,name,email,work_unit) VALUES(99,'TS. Khoa','admin@vnu.edu.vn','Bộ môn C');");
await createSemester(admin, 2026, '1');
for (const code of ['INT3132', 'INT3131']) {
  const c = await createClass(admin, { semesterId: '2026-2027-1', courseCode: code, section: '1' });
  const parent = (await snapshot()).campaigns!.find(p => p.id === c.campaignId)!;
  if (parent.status !== 'active') await updateCampaign(admin, parent.id, { expectedRevision: parent.revision, status: 'active', settings: { plan: '# Kế hoạch Dự án\n\n1. Khai tên đề tài.\n2. Nộp PDF, slide và video demo.\n3. Theo dõi phản hồi của giảng viên.' } });
  const active = (await snapshot()).classes.find(x => x.id === c.id)!;
  const s = await snapshot();
  const enrollments = ['24020001', '24020002', '24020003'].map((id, i) => {
    const e = newEnrollment(active, { studentId: id, name: ['Sinh viên An', 'Sinh viên Bình', 'Sinh viên Chi'][i], className: 'QH-2024-I/CQ-I-CS1' });
    changeTopic(e, ['Ứng dụng quản lý học vụ', 'Hệ thống tìm kiếm tài liệu', 'Phân tích dữ liệu học tập'][i]);
    e.assignments = [{ id: randomUUID(), lecturerId: i + 1, role: 'primary', assignedAt: new Date().toISOString() }, ...(i === 1 ? [{ id: randomUUID(), lecturerId: 99, role: 'co' as const, assignedAt: new Date().toISOString() }] : [])]; approveTopic(s, active, e, { id: i + 2, role: 'lecturer', email: s.lecturers.find(l => l.id === i + 1)!.email, name: 'Fixture GVHD' }); return e;
  });
  await commit(s, admin.id, 'admin.fixture.seed', { enrollments, users: enrollments.map(e => ({ studentId: e.studentId, email: e.email, name: e.name, dob: '', className: e.className })) });
}
await database.db.executeMultiple(`INSERT INTO users(id,email,name,role,student_id,course_code,legacy_internship_access) VALUES
  (300,'23029901@vnu.edu.vn','Sinh viên TT Một','student','23029901','Thực tập Doanh nghiệp INT4002',1),
  (301,'23029902@vnu.edu.vn','Sinh viên TT Hai','student','23029902','Thực tập Chuyên ngành INT3508',1),
  (302,'23029903@vnu.edu.vn','Sinh viên chờ học phần','student','23029903',NULL,1);
  INSERT INTO advisor_assignments(id,user_id,lecturer_id,role) VALUES(300,300,1,'primary'),(301,301,2,'primary');`);
const legacyPlan = await legacyPreview(admin); await applyLegacy(admin, legacyPlan.id);
const app = express(); app.use(express.json());
// Visual references render the preserved pre-project pages only in this isolated fixture.
app.get('/__academic_preview/baseline', async (req, res) => {
  const role = ['student', 'lecturer'].includes(String(req.query.role)) ? String(req.query.role) : 'admin';
  const email = role === 'student' ? '23029901@vnu.edu.vn' : role === 'lecturer' ? 'alpha@vnu.edu.vn' : admin.email;
  const user = (await database.db.execute({ sql: 'SELECT * FROM users WHERE email=?', args: [email] })).rows[0];
  const component = role === 'student' ? 'Dashboard' : role === 'lecturer' ? 'LecturerHome' : 'AdminDashboard';
  const token = jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tham chiếu giao diện 726271c</title></head><body><div id="root"></div><script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {HashRouter} from 'react-router-dom';
    import {${component}} from '/src/features/${role}/pages/${component}.tsx';
    import '/src/index.css';
    const user=${JSON.stringify(user)};localStorage.setItem('user',JSON.stringify(user));
    createRoot(document.getElementById('root')).render(React.createElement(HashRouter,null,React.createElement('div',{className:'feature-page feature-page--${role} p-6'},React.createElement(${component},{user,token:${JSON.stringify(token)},setUser:()=>{},onAuthExpired:()=>{}}))));
  </script></body></html>`;
  res.type('html').send(await vite.transformIndexHtml(`/__academic_preview/baseline-${role}.html`, html));
});
app.get('/__academic_preview/login', async (req, res) => {
  const roles = { admin: 'admin@vnu.edu.vn', student: '24020001@vnu.edu.vn', lecturer: 'alpha@vnu.edu.vn', reviewer: 'beta@vnu.edu.vn' };
  const email = roles[String(req.query.role)] || roles.admin;
  const user = (await database.db.execute({ sql: 'SELECT * FROM users WHERE email=?', args: [email] })).rows[0];
  const token = jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Academic local fixture</title><script>localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});location.replace('/#/classes');</script>`);
});
app.get('/__academic_preview/session', async (req, res) => {
  const email = req.query.role === 'student' ? '24020001@vnu.edu.vn' : req.query.role === 'lecturer' ? 'alpha@vnu.edu.vn' : req.query.role === 'reviewer' ? 'beta@vnu.edu.vn' : 'admin@vnu.edu.vn';
  const user = (await database.db.execute({ sql: 'SELECT * FROM users WHERE email=?', args: [email] })).rows[0];
  res.json({ token: jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: '1h' }), user });
});
app.get('/api/notifications/my', (_req, res) => res.json({ rows: [], unread: 0 }));
app.get('/api/chat/threads', (_req, res) => res.json([]));
app.get('/api/me/unread-counts', (_req,res) => res.json({notifications:0,chats:0}));
app.use(academicRouter);
const server = createHttpServer(app);
process.chdir(storageRoot);
const vite = await createServer({ configFile: false, envDir: false, root: projectRoot, cacheDir: join(storageRoot, '.vite'), plugins: [react(), tailwindcss()], server: { middlewareMode: true, hmr: { server } }, appType: 'spa', define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') } });
app.use(vite.middlewares);
const port = Number(process.env.ACADEMIC_PREVIEW_PORT || 4318);
server.listen(port, '127.0.0.1', () => console.log(`Academic isolated preview: http://127.0.0.1:${port}`));
const close = async () => { server.close(); await vite.close(); client.close(); process.chdir(projectRoot); await rm(storageRoot, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', close); process.on('SIGINT', close);
