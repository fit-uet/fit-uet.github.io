import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireStudentOrAdmin } from '../middlewares/auth';
import { cleanStudentName, rowsToSettings, getItCompanyNameSet } from '../services/helpers';
import { syncLecturerUsers } from '../services/advisorSync';
import { createNotification } from '../services/notifications';
import {
  DEFAULT_ALLOWED_REGISTRATION_COHORTS,
  DEFAULT_REGISTRATION_RULES,
  DEFAULT_STUDENT_FAQ,
  DEFAULT_LECTURER_FAQ,
  DEFAULT_LECTURER_GUIDE,
} from '../config';

export const commonRouter = Router();

// 2. Get Companies
commonRouter.get('/api/companies', requireAuth, requireStudentOrAdmin, async (req: any, res: any) => {
  const companies = (await db.execute(`
    SELECT c.*,
           c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots,
           COALESCE(rc.applicant_count, 0) as applicant_count
    FROM companies c
    LEFT JOIN (
      SELECT company_id, COUNT(*) as applicant_count
      FROM registrations
      WHERE status != 'rejected'
      GROUP BY company_id
    ) rc ON rc.company_id = c.id
  `)).rows;
  res.json(companies);
});

commonRouter.get('/api/companies/it-list', requireAuth, requireStudentOrAdmin, async (req, res) => {
  try {
    const rows = (await db.execute('SELECT name FROM approved_company_names ORDER BY name ASC')).rows as any[];
    const names = rows.map(row => String(row.name || '').trim()).filter(Boolean);
    res.json(names.length > 0 ? names : Array.from(getItCompanyNameSet()));
  } catch (e) {
    res.json(Array.from(getItCompanyNameSet()));
  }
});

// 2c. Get lecturers
commonRouter.get('/api/lecturers', requireAuth, async (req: any, res: any) => {
  try {
    const lecturers = (await db.execute("SELECT name FROM lecturers ORDER BY name ASC")).rows.map((r: any) => r.name);
    res.json(lecturers);
  } catch (e) {
    res.json([]);
  }
});

// 2b. Get a single company
commonRouter.get('/api/companies/:id', requireAuth, requireStudentOrAdmin, async (req: any, res: any) => {
  const company = (await db.execute({
    sql: `
    SELECT c.*,
           c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots,
           COALESCE(rc.applicant_count, 0) as applicant_count
    FROM companies c
    LEFT JOIN (
      SELECT company_id, COUNT(*) as applicant_count
      FROM registrations
      WHERE status != 'rejected'
      GROUP BY company_id
    ) rc ON rc.company_id = c.id
    WHERE c.id = ?
  `, args: [req.params.id]
  })).rows[0];
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }
  res.json(company);
});

// 1.5. Update user profile
commonRouter.put('/api/users/profile', requireAuth, async (req: any, res: any) => {
  const { name, student_id, dob, class_name, course_code, phone, personal_email } = req.body;
  const isStaffProfile = req.user.role === 'admin' || req.user.role === 'lecturer';
  if (!name) {
    return res.status(400).json({ error: 'Họ và tên là bắt buộc.' });
  }
  if (!isStaffProfile && phone) {
    const cleanPhone = phone.replace(/[\s\-\.]/g, '');
    if (!/^(0|\+84)[35789]\d{8}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'Số điện thoại cá nhân không hợp lệ (phải bắt đầu bằng 0 hoặc +84 và có 10 chữ số).' });
    }
  }
  if (!isStaffProfile && dob) {
    const d = new Date(dob);
    if (isNaN(d.getTime()) || d > new Date()) {
      return res.status(400).json({ error: 'Ngày sinh không hợp lệ.' });
    }
  }
  try {
    if (isStaffProfile) {
      await db.execute({
        sql: 'UPDATE users SET name = ? WHERE id = ?',
        args: [name, req.user.id]
      });
      if (req.user.role === 'lecturer' || req.user.is_lecturer) {
        await db.execute({
          sql: 'UPDATE lecturers SET name = ? WHERE email = ?',
          args: [name, req.user.email]
        });
        await syncLecturerUsers();
      }
    } else {
      const studentCleanName = cleanStudentName(name, student_id, req.user.email);
      await db.execute({
        sql: 'UPDATE users SET name = ?, student_id = ?, dob = ?, class_name = ?, course_code = ?, phone = ?, personal_email = ? WHERE id = ?',
        args: [studentCleanName, student_id || null, dob || null, class_name || null, course_code || null, phone || null, personal_email || null, req.user.id]
      });
    }
    const updatedUser = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] })).rows[0];
    res.json(updatedUser);
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// Notifications
commonRouter.get('/api/notifications/my', requireAuth, async (req: any, res: any) => {
  try {
    const email = String(req.user.email || '').trim();
    const personalEmail = String(req.user.personal_email || '').trim();
    const userId = req.user.id ? Number(req.user.id) : null;

    const personalRows = (await db.execute({
      sql: `
        SELECT id, 'personal' as source, type, subject, body, status, error, created_at, sent_at, read_at
        FROM (
          SELECT id, type, subject, body, status, error, created_at, sent_at, read_at
          FROM notifications
          WHERE user_id = ? AND type != 'advisor_quota_exceeded'
          UNION
          SELECT id, type, subject, body, status, error, created_at, sent_at, read_at
          FROM notifications
          WHERE user_id IS NULL
            AND (
              recipient_email = ? COLLATE NOCASE
              OR (? != '' AND recipient_email = ? COLLATE NOCASE)
            )
            AND type != 'advisor_quota_exceeded'
        )
        ORDER BY created_at DESC
        LIMIT 100
      `,
      args: [userId, email, personalEmail, personalEmail],
    })).rows as any[];
    const systemRows = (await db.execute({
      sql: `
        SELECT s.id, 'system' as source, s.type, s.subject, s.body, 'system' as status, NULL as error, s.created_at, NULL as sent_at, r.read_at
        FROM system_notifications s
        LEFT JOIN system_notification_reads r ON r.system_notification_id = s.id AND r.user_id = ?
        WHERE s.active = 1
          AND (s.target_role = 'all' OR s.target_role = ?)
        ORDER BY s.created_at DESC
        LIMIT 100
      `,
      args: [req.user.id, req.user.role || 'student'],
    })).rows as any[];
    const rows = [...personalRows, ...systemRows]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 100);
    const unread = rows.filter(row => !row.read_at).length;
    res.json({ rows, unread });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

commonRouter.put('/api/notifications/my/system/:id/read', requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const notification = (await db.execute({
      sql: `SELECT id FROM system_notifications WHERE id = ? AND active = 1 AND (target_role = 'all' OR target_role = ?)`,
      args: [id, req.user.role || 'student'],
    })).rows[0];
    if (!notification) return res.status(404).json({ error: 'Không tìm thấy thông báo hệ thống.' });
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO system_notification_reads (system_notification_id, user_id, read_at)
        VALUES (?, ?, datetime('now', '+7 hours'))
      `,
      args: [id, req.user.id],
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

commonRouter.put('/api/notifications/my/:id/read', requireAuth, async (req: any, res: any) => {
  try {
    await db.execute({
      sql: `
        UPDATE notifications
        SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
        WHERE id = ?
      `,
      args: [Number(req.params.id)],
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

commonRouter.put('/api/notifications/my/read-all', requireAuth, async (req: any, res: any) => {
  try {
    const email = String(req.user.email || '').trim();
    const personalEmail = String(req.user.personal_email || '').trim();
    const userId = req.user.id ? Number(req.user.id) : null;
    await db.execute({
      sql: `
        UPDATE notifications
        SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
        WHERE user_id = ?
           OR (
             user_id IS NULL
             AND (
               recipient_email = ? COLLATE NOCASE
               OR (? != '' AND recipient_email = ? COLLATE NOCASE)
             )
           )
      `,
      args: [userId, email, personalEmail, personalEmail],
    });
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO system_notification_reads (system_notification_id, user_id, read_at)
        SELECT id, ?, datetime('now', '+7 hours')
        FROM system_notifications
        WHERE active = 1 AND (target_role = 'all' OR target_role = ?)
      `,
      args: [req.user.id, req.user.role || 'student'],
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// Campaign & Settings (Public / General)
commonRouter.get('/api/settings/campaign', async (req: any, res: any) => {
  const settings = rowsToSettings((await db.execute(`
    SELECT key, value FROM settings
    WHERE key IN ('campaign_year', 'campaign_start', 'campaign_end', 'classes_list', 'allowed_registration_cohorts', 'registration_rules_md', 'faq_student_md', 'faq_lecturer_md', 'registration_open_at', 'registration_close_at', 'confirmation_open_at', 'confirmation_close_at', 'final_report_open_at', 'final_report_close_at', 'grading_open_at', 'grading_close_at', 'advisor_request_open_at', 'advisor_request_close_at', 'advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')
  `)).rows);

  res.json({
    year: settings.campaign_year || '2026',
    start: settings.campaign_start || '22/05/2026',
    end: settings.campaign_end || '15/06/2026',
    classes_list: settings.classes_list || 'QH-2023-I/CQ-I-IT1, QH-2023-I/CQ-I-IT2, QH-2023-I/CQ-I-IT3, QH-2023-I/CQ-I-IS, QH-2023-I/CQ-I-CS1, QH-2023-I/CQ-I-CS2, QH-2023-I/CQ-I-CS3, QH-2023-I/CQ-I-CS4, QH-2023-I/CQ-I-CN',
    allowed_registration_cohorts: settings.allowed_registration_cohorts || DEFAULT_ALLOWED_REGISTRATION_COHORTS,
    registration_rules_md: settings.registration_rules_md || DEFAULT_REGISTRATION_RULES,
    faq_student_md: settings.faq_student_md || DEFAULT_STUDENT_FAQ,
    faq_lecturer_md: settings.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
    registration_open_at: settings.registration_open_at || '',
    registration_close_at: settings.registration_close_at || '',
    confirmation_open_at: settings.confirmation_open_at || '',
    confirmation_close_at: settings.confirmation_close_at || '',
    final_report_open_at: settings.final_report_open_at || '',
    final_report_close_at: settings.final_report_close_at || '',
    grading_open_at: settings.grading_open_at || '',
    grading_close_at: settings.grading_close_at || '',
    advisor_request_open_at: settings.advisor_request_open_at || '',
    advisor_request_close_at: settings.advisor_request_close_at || '',
    advisor_quota_pgs: settings.advisor_quota_pgs || '5',
    advisor_quota_ts: settings.advisor_quota_ts || '8',
    advisor_quota_ths: settings.advisor_quota_ths || '10'
  });
});

commonRouter.get('/api/settings/faq', requireAuth, async (req: any, res: any) => {
  try {
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('faq_student_md', 'faq_lecturer_md')
    `)).rows);
    res.json({
      faq_student_md: settings.faq_student_md || DEFAULT_STUDENT_FAQ,
      faq_lecturer_md: settings.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
    });
  } catch (e: any) {
    res.status(503).json({ error: 'Không tải được FAQ. Vui lòng thử lại sau.', detail: e.message });
  }
});

commonRouter.get('/api/lecturer-guide', requireAuth, async (req: any, res: any) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'lecturer' && !req.user.is_lecturer) {
      return res.status(403).json({ error: 'Chỉ giảng viên hoặc quản trị viên được xem hướng dẫn này.' });
    }
    const setting = (await db.execute("SELECT value FROM settings WHERE key = 'lecturer_guide_md'")).rows[0] as unknown as { value: string };
    res.json({ guide: setting?.value || DEFAULT_LECTURER_GUIDE });
  } catch (e: any) {
    res.status(503).json({ error: 'Không tải được hướng dẫn sử dụng. Vui lòng thử lại sau.', detail: e.message });
  }
});

commonRouter.get('/api/plan', async (req: any, res: any) => {
  const planSetting = (await db.execute("SELECT value FROM settings WHERE key = 'implementation_plan_md'")).rows[0] as unknown as { value: string };
  res.json({ plan: planSetting ? planSetting.value : '' });
});

// FAQ Q&A for authenticated users
commonRouter.get('/api/faq/questions/my', requireAuth, async (req: any, res: any) => {
  try {
    const rows = (await db.execute({
      sql: `
        SELECT id, role, question, answer, status, created_at, answered_at
        FROM faq_questions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `,
      args: [req.user.id],
    })).rows;
    res.json(rows);
  } catch (e: any) {
    res.status(503).json({ error: 'Không tải được câu hỏi FAQ. Vui lòng thử lại sau.', detail: e.message });
  }
});

commonRouter.post('/api/faq/questions', requireAuth, async (req: any, res: any) => {
  try {
    const question = String(req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Vui lòng nhập câu hỏi.' });
    if (question.length > 2000) return res.status(400).json({ error: 'Câu hỏi không được vượt quá 2000 ký tự.' });
    const role = req.user.role === 'lecturer' ? 'lecturer' : 'student';
    const result = await db.execute({
      sql: `
        INSERT INTO faq_questions (user_id, role, question, status, created_at)
        VALUES (?, ?, ?, 'pending', datetime('now', '+7 hours'))
      `,
      args: [req.user.id, role, question],
    });
    const admins = (await db.execute(`
      SELECT id, email, personal_email, name
      FROM users
      WHERE role = 'admin'
        AND email IS NOT NULL
        AND trim(email) != ''
    `)).rows as any[];
    const askerName = req.user.name || req.user.email || (role === 'lecturer' ? 'Giảng viên' : 'Sinh viên');
    const seenAdminEmails = new Set<string>();
    const uniqueAdmins: any[] = [];
    for (const admin of admins) {
      const targetEmail = String(admin.personal_email || admin.email || '').trim().toLowerCase();
      if (targetEmail && seenAdminEmails.has(targetEmail)) continue;
      if (targetEmail) seenAdminEmails.add(targetEmail);
      uniqueAdmins.push(admin);
    }
    for (const admin of uniqueAdmins) {
      await createNotification({
        user_id: Number(admin.id),
        recipient_email: admin.personal_email || admin.email,
        type: 'faq_question_created',
        subject: 'Có câu hỏi FAQ mới cần trả lời',
        body: `${askerName} vừa gửi câu hỏi FAQ:\n\n${question}\n\nVui lòng vào trang Trả lời câu hỏi FAQ để xử lý.`,
        status: 'website_only',
      });
    }
    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (e: any) {
    res.status(503).json({ error: 'Không gửi được câu hỏi FAQ. Vui lòng thử lại sau.', detail: e.message });
  }
});
