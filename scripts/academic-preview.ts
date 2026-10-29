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
const { newEnrollment } = await import('../server/academic/domain');
const { createSemester, createClass, updateClass } = await import('../server/academic/service');
const { updateCampaign } = await import('../server/academic/campaigns');
const { academicRouter } = await import('../server/academic/routes');
const projectRoot = process.cwd();
const storageRoot = await mkdtemp(join(tmpdir(), 'academic-preview-'));
const admin = { id: 1, email: 'admin@vnu.edu.vn', name: 'Khoa', role: 'admin' as const };
const client = await createAcademicFixture();
await createSemester(admin, 2026, '1');
for (const code of ['INT3132', 'INT3131']) {
  const c = await createClass(admin, { semesterId: '2026-2027-1', courseCode: code, section: '1' });
  const parent = (await snapshot()).campaigns!.find(p => p.id === c.campaignId)!;
  if (parent.status !== 'active') await updateCampaign(admin, parent.id, { expectedRevision: parent.revision, status: 'active', settings: { plan: '# Kế hoạch Dự án\n\n1. Khai tên đề tài.\n2. Nộp PDF, slide và video demo.\n3. Theo dõi phản hồi của giảng viên.' } });
  const active = (await snapshot()).classes.find(x => x.id === c.id)!;
  const s = await snapshot();
  const enrollments = ['24020001', '24020002', '24020003'].map((id, i) => {
    const e = newEnrollment(active, { studentId: id, name: ['Sinh viên An', 'Sinh viên Bình', 'Sinh viên Chi'][i], className: 'QH-2024-I/CQ-I-CS1' });
    e.topic = ['Ứng dụng quản lý học vụ', 'Hệ thống tìm kiếm tài liệu', 'Phân tích dữ liệu học tập'][i];
    e.assignments = [{ id: randomUUID(), lecturerId: i + 1, role: 'primary', assignedAt: new Date().toISOString() }]; return e;
  });
  await commit(s, admin.id, 'admin.fixture.seed', { enrollments, users: enrollments.map(e => ({ studentId: e.studentId, email: e.email, name: e.name, dob: '', className: e.className })) });
}
const app = express(); app.use(express.json());
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
app.use(academicRouter);
const server = createHttpServer(app);
process.chdir(storageRoot);
const vite = await createServer({ configFile: false, envDir: false, root: projectRoot, cacheDir: join(storageRoot, '.vite'), plugins: [react(), tailwindcss()], server: { middlewareMode: true, hmr: { server } }, appType: 'spa', define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') } });
app.use(vite.middlewares);
const port = Number(process.env.ACADEMIC_PREVIEW_PORT || 4318);
server.listen(port, '127.0.0.1', () => console.log(`Academic isolated preview: http://127.0.0.1:${port}`));
const close = async () => { server.close(); await vite.close(); client.close(); process.chdir(projectRoot); await rm(storageRoot, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', close); process.on('SIGINT', close);
