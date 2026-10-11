import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { db, executeBatch, isTransientLibsqlError } from '../db';
import { requireAuth, requireAdmin } from '../middlewares/auth';
import {
  cleanStudentName,
  rowsToSettings,
  isWithinLocalWindow,
  isBachelorLecturer,
  getLecturerDegreePriority,
  normalizeCompanyName,
  getItCompanyNameSet,
  normalizeScore,
  calculateFinalScore,
} from '../services/helpers';
import { deleteLegacyStudentRow, ensureSpecialCompanies } from '../db/initDb';
import {
  syncLecturerUsers,
  advisorQuotaLimit,
  advisorQuotaStatus,
  createAdvisorAssignment,
  autoAssignPrimaryAdvisors,
  autoAssignAfterAdvisorWindow,
  ensureAdvisorRequestsFromLegacySchoolRegistrations,
  approvePendingAgreedAdvisorRequests,
  findLecturerByNameText,
  syncAdvisorFromSchoolRegistration,
  ensureSchoolFinalInternshipFromRegistration,
  backfillSchoolFinalInternshipsFromRegistrations,
} from '../services/advisorSync';
import { cleanupChatAttachments, deleteReportObject } from '../services/storage';
import { createNotification, insertNotification } from '../services/notifications';
import { sendQueuedNotificationBatch, emailSentTodayCount, emailDailySendCap, emailBatchSize } from '../services/email';
import {
  addApprovedCompanyFromRegistration,
  approveMatchingOtherCompanyRegistrations,
} from '../services/companyApproval';
import { exportRegistrationsToGoogleSheets } from '../services/googleSheets';
import {
  DEFAULT_ALLOWED_REGISTRATION_COHORTS,
  DEFAULT_REGISTRATION_RULES,
  DEFAULT_STUDENT_FAQ,
  DEFAULT_LECTURER_FAQ,
  DEFAULT_LECTURER_GUIDE,
} from '../config';
import { NotificationInput } from '../types';

export const adminRouter = Router();

let advisorAutoAssignRunning = false;
let advisorRequestBackfillRunning = false;

adminRouter.get('/api/admin/dashboard-stats', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const stats = (await db.execute(`
        SELECT
          (SELECT COUNT(DISTINCT user_id) FROM (SELECT user_id FROM registrations UNION SELECT user_id FROM final_internships)) AS registeredCount,
          (SELECT COUNT(DISTINCT user_id) FROM final_internships) AS confirmedCount,
          (SELECT COUNT(DISTINCT user_id) FROM final_reports WHERE status = 'submitted' OR object_key IS NOT NULL) AS reportCount,
          (SELECT COUNT(DISTINCT user_id)
             FROM grades
            WHERE status IN ('submitted', 'draft') OR final_score IS NOT NULL) AS gradedCount
      `)).rows[0] as any;
      res.json({
        registeredCount: Number(stats?.registeredCount || 0),
        confirmedCount: Number(stats?.confirmedCount || 0),
        reportCount: Number(stats?.reportCount || 0),
        gradedCount: Number(stats?.gradedCount || 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 12. Admin: Get Students (exclude admins)
adminRouter.get('/api/admin/students', requireAuth, requireAdmin, async (req: any, res: any) => {
    const students = (await db.execute("SELECT id, email, name, student_id, dob, class_name, course_code, phone, personal_email FROM users WHERE role = 'student' ORDER BY student_id ASC")).rows;
    res.json(students);
  });

  // 12b. Admin: Get Admins list
adminRouter.get('/api/admin/admins', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const admins = (await db.execute("SELECT id, email, name, picture, is_lecturer FROM users WHERE role = 'admin' ORDER BY name ASC")).rows;
      res.json(admins);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 12c. Admin: Toggle is_lecturer for an admin
adminRouter.put('/api/admin/admins/:id/lecturer', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { is_lecturer } = req.body;
      const adminUser = (await db.execute({ sql: "SELECT * FROM users WHERE id = ? AND role = 'admin'", args: [req.params.id] })).rows[0] as any;
      if (!adminUser) return res.status(404).json({ error: 'Admin not found' });

      await db.execute({ sql: 'UPDATE users SET is_lecturer = ? WHERE id = ?', args: [is_lecturer ? 1 : 0, req.params.id] });
      await syncLecturerUsers();

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 13. Admin: Bulk Import Students
adminRouter.post('/api/admin/students/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { students, override } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'Expected array of students' });
    try {
      const statements = students
        .filter((s: any) => s?.student_id && s?.name)
        .map((s: any) => {
          const email = `${s.student_id}@vnu.edu.vn`;
          if (override) {
            return {
              sql: `INSERT INTO users (email, name, role, student_id, dob, class_name) 
                    VALUES (?, ?, 'student', ?, ?, ?) 
                    ON CONFLICT(email) DO UPDATE SET 
                    name=excluded.name, dob=excluded.dob, class_name=excluded.class_name, student_id=excluded.student_id`,
              args: [email, s.name, s.student_id, s.dob || '', s.class_name || '']
            };
          }
          return {
            sql: `INSERT OR IGNORE INTO users (email, name, role, student_id, dob, class_name) 
                  VALUES (?, ?, 'student', ?, ?, ?)`,
            args: [email, s.name, s.student_id, s.dob || '', s.class_name || '']
          };
        });
      if (statements.length > 0) {
        await executeBatch(statements);
      }
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 14. Admin: Add/Update Single Student
adminRouter.post('/api/admin/students', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { student_id, name, dob, class_name, phone, personal_email } = req.body;
    if (!student_id || !name) return res.status(400).json({ error: 'Mã SV và Họ tên là bắt buộc' });
    try {
      await db.execute({
        sql: `INSERT INTO users (email, name, role, student_id, dob, class_name, phone, personal_email)
              VALUES (?, ?, 'student', ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET
              name=excluded.name, dob=excluded.dob, class_name=excluded.class_name, student_id=excluded.student_id,
              phone=excluded.phone, personal_email=excluded.personal_email`,
        args: [`${student_id}@vnu.edu.vn`, name, student_id, dob || '', class_name || '', phone || '', personal_email || '']
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 14b. Admin: Edit Single Student
adminRouter.put('/api/admin/students/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const selector = decodeURIComponent(req.params.id || '').trim();
      if (!selector) return res.status(400).json({ error: 'Thiếu mã sinh viên cần sửa.' });

      const isUserIdSelector = selector.startsWith('user:');
      const userId = isUserIdSelector ? Number(selector.slice(5)) : null;
      if (isUserIdSelector && (!Number.isInteger(userId) || userId <= 0)) {
        return res.status(400).json({ error: 'Mã định danh sinh viên không hợp lệ.' });
      }

      const current = (await db.execute({
        sql: isUserIdSelector
          ? "SELECT id FROM users WHERE id = ? AND role = 'student'"
          : "SELECT id FROM users WHERE student_id = ? AND role = 'student'",
        args: [isUserIdSelector ? userId : selector],
      })).rows[0] as any;
      if (!current) return res.status(404).json({ error: 'Không tìm thấy sinh viên.' });

      const studentId = String(req.body.student_id || '').trim();
      const name = String(req.body.name || '').trim();
      const dob = String(req.body.dob || '').trim();
      const className = String(req.body.class_name || '').trim();
      const phone = String(req.body.phone || '').trim();
      const personalEmail = String(req.body.personal_email || '').trim();

      if (!studentId || !name) return res.status(400).json({ error: 'Mã SV và Họ tên là bắt buộc.' });
      if (!/^\d{8}$/.test(studentId)) return res.status(400).json({ error: 'Mã SV phải gồm 8 chữ số.' });
      if (phone) {
        const cleanPhone = phone.replace(/[\s\-\.]/g, '');
        if (!/^(0|\+84)[35789]\d{8}$/.test(cleanPhone)) {
          return res.status(400).json({ error: 'Số điện thoại cá nhân không hợp lệ (phải bắt đầu bằng 0 hoặc +84 và có 10 chữ số).' });
        }
      }
      if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
        return res.status(400).json({ error: 'Email cá nhân không hợp lệ.' });
      }

      const email = `${studentId}@vnu.edu.vn`;
      await db.execute({
        sql: `UPDATE users
              SET email = ?, name = ?, student_id = ?, dob = ?, class_name = ?, phone = ?, personal_email = ?
              WHERE id = ? AND role = 'student'`,
        args: [email, name, studentId, dob || '', className || '', phone || '', personalEmail || '', current.id],
      });
      res.json({ success: true });
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('unique')) return res.status(400).json({ error: 'Mã SV hoặc email VNU đã tồn tại ở tài khoản khác.' });
      res.status(500).json({ error: 'Database error: ' + message });
    }
  });

  // 15. Admin: Delete Single Student
adminRouter.delete('/api/admin/students/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const selector = decodeURIComponent(req.params.id || '').trim();
      if (!selector) return res.status(400).json({ error: 'Thiếu mã sinh viên cần xoá.' });

      const isUserIdSelector = selector.startsWith('user:');
      const userId = isUserIdSelector ? Number(selector.slice(5)) : null;
      if (isUserIdSelector && (!Number.isInteger(userId) || userId <= 0)) {
        return res.status(400).json({ error: 'Mã định danh sinh viên không hợp lệ.' });
      }

      const user = (await db.execute({
        sql: isUserIdSelector
          ? "SELECT id, email, student_id FROM users WHERE id = ? AND role = 'student'"
          : "SELECT id, email, student_id FROM users WHERE student_id = ? AND role = 'student'",
        args: [isUserIdSelector ? userId : selector]
      })).rows[0] as any;
      if (user) {
        const reports = (await db.execute({
          sql: 'SELECT object_key FROM final_reports WHERE user_id = ?',
          args: [user.id],
        })).rows as any[];
        await cleanupChatAttachments('SELECT attachment_key FROM chat_messages WHERE (student_user_id = ? OR sender_user_id = ?) AND attachment_key IS NOT NULL', [user.id, user.id]);
        await cleanupChatAttachments('SELECT attachment_key FROM chat_group_messages WHERE sender_user_id = ? AND attachment_key IS NOT NULL', [user.id]);
        await executeBatch([
          { sql: 'DELETE FROM advisor_assignment_history WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM advisor_requests WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM final_reports WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM grades WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM chat_messages WHERE student_user_id = ? OR sender_user_id = ?', args: [user.id, user.id] },
          { sql: 'DELETE FROM chat_group_message_reads WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM chat_group_message_reads WHERE message_id IN (SELECT id FROM chat_group_messages WHERE sender_user_id = ?)', args: [user.id] },
          { sql: 'DELETE FROM chat_group_messages WHERE sender_user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM notifications WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM final_internships WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM users WHERE id = ?', args: [user.id] },
        ]);
        await Promise.all(reports.map(report => deleteReportObject(report.object_key).catch(() => undefined)));
      }
      const studentId = user?.student_id || (!isUserIdSelector ? selector : '');
      const deletedLegacyStudent = studentId
        ? await deleteLegacyStudentRow(studentId, user?.email || `${studentId}@vnu.edu.vn`)
        : false;
      res.json({ success: true, deleted_user: Boolean(user), deleted_legacy_student: deletedLegacyStudent });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 16. Admin: Get Lecturers
adminRouter.get('/api/admin/lecturers', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const lecturers = (await db.execute("SELECT * FROM lecturers ORDER BY name ASC")).rows;
      res.json(lecturers);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
adminRouter.get('/api/admin/lecturers/student-assignments', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        WITH participants AS (
          SELECT user_id FROM final_internships
          UNION
          SELECT user_id FROM advisor_requests
          UNION
          SELECT user_id FROM registrations WHERE status != 'rejected'
        ),
        registration_places AS (
          SELECT r.user_id,
                 GROUP_CONCAT(
                   CASE
                     WHEN c.name = 'Công ty khác' THEN COALESCE(NULLIF(trim(r.other_company_name), ''), c.name)
                     ELSE c.name
                   END,
                   '; '
                 ) as registered_places
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.status != 'rejected'
          GROUP BY r.user_id
        )
        SELECT p.user_id, f.internship_type, f.school_assignment_request, f.confirmed_at,
               ar.id as advisor_request_id, ar.request_type as advisor_request_type, ar.status as advisor_request_status, ar.quota_status as advisor_request_quota_status,
               u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
               CASE
                 WHEN f.id IS NULL THEN COALESCE(rp.registered_places, 'Chưa xác nhận nơi thực tập')
                 WHEN c.name = 'Công ty khác' THEN r.other_company_name
                 ELSE c.name
               END as internship_place,
               GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN aa.lecturer_id || '|' || l.name || '|' || COALESCE(l.email, '') END) as primary_assignments,
               GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN aa.lecturer_id || '|' || l.name || '|' || COALESCE(l.email, '') END) as co_assignments,
               CASE WHEN ar.status IN ('pending', 'approved') AND ar.lecturer_id IS NOT NULL
                    THEN ar.lecturer_id || '|' || COALESCE(rl.name, ar.lecturer_name_text, '') || '|' || COALESCE(rl.email, '')
               END as primary_requests,
               CASE WHEN ar.status IN ('pending', 'approved') AND ar.co_lecturer_id IS NOT NULL
                    THEN ar.co_lecturer_id || '|' || COALESCE(rcl.name, ar.co_lecturer_name_text, '') || '|' || COALESCE(rcl.email, '')
               END as co_requests
        FROM participants p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN final_internships f ON f.user_id = p.user_id
        LEFT JOIN advisor_requests ar ON ar.user_id = p.user_id
        LEFT JOIN registration_places rp ON rp.user_id = p.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = p.user_id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        LEFT JOIN lecturers rl ON rl.id = ar.lecturer_id
        LEFT JOIN lecturers rcl ON rcl.id = ar.co_lecturer_id
        GROUP BY p.user_id
        ORDER BY u.student_id ASC
      `)).rows;
      res.json({ rows });
    } catch (e: any) {
      res.status(isTransientLibsqlError(e) ? 503 : 500).json({ error: 'Không tải được danh sách sinh viên theo giảng viên.', detail: e?.message || String(e) });
    }
  });

  // 17. Admin: Bulk Import Lecturers
adminRouter.post('/api/admin/lecturers/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { lecturers, override } = req.body;
    if (!Array.isArray(lecturers)) return res.status(400).json({ error: 'Expected array' });
    try {
      const statements = lecturers
        .map((item: any) => {
          const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
          const email = typeof item === 'string' ? null : item?.email?.trim() || null;
          const workUnit = typeof item === 'string' ? null : item?.work_unit?.trim() || null;
          if (!name) return null;
          return {
            sql: `
              INSERT INTO lecturers (name, email, work_unit)
              VALUES (?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET
                email = CASE
                  WHEN ? = 1 AND excluded.email IS NOT NULL AND excluded.email != '' THEN excluded.email
                  WHEN excluded.email IS NOT NULL AND excluded.email != '' AND (lecturers.email IS NULL OR lecturers.email = '')
                  THEN excluded.email
                  ELSE lecturers.email
                END,
                work_unit = CASE
                  WHEN ? = 1 AND excluded.work_unit IS NOT NULL AND excluded.work_unit != '' THEN excluded.work_unit
                  WHEN excluded.work_unit IS NOT NULL AND excluded.work_unit != '' AND (lecturers.work_unit IS NULL OR lecturers.work_unit = '')
                  THEN excluded.work_unit
                  ELSE lecturers.work_unit
                END
            `,
            args: [name, email, workUnit, override ? 1 : 0, override ? 1 : 0]
          };
        })
        .filter(Boolean);
      if (statements.length > 0) {
        await executeBatch(statements);
      }
      await syncLecturerUsers();
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 17b. Admin: Add Single Lecturer
adminRouter.post('/api/admin/lecturers', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, email, work_unit } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên không được để trống' });
      const result = await db.execute({ sql: "INSERT INTO lecturers (name, email, work_unit) VALUES (?, ?, ?)", args: [name.trim(), email?.trim() || null, work_unit?.trim() || null] });
      if (email?.trim()) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 1, name = ? WHERE email = ? AND role = 'admin'",
          args: [name.trim(), email.trim()]
        });
      }
      await syncLecturerUsers();
      const newLec = (await db.execute({ sql: "SELECT * FROM lecturers WHERE id = ?", args: [Number(result.lastInsertRowid)] })).rows[0];
      res.json(newLec);
    } catch (e: any) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Giảng viên đã tồn tại' });
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 17c. Admin: Update Single Lecturer
adminRouter.put('/api/admin/lecturers/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, email, work_unit } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên không được để trống' });
      const oldLecturer = (await db.execute({ sql: "SELECT email FROM lecturers WHERE id = ?", args: [req.params.id] })).rows[0] as any;
      await db.execute({ sql: "UPDATE lecturers SET name = ?, email = ?, work_unit = ? WHERE id = ?", args: [name.trim(), email?.trim() || null, work_unit?.trim() || null, req.params.id] });
      if (oldLecturer?.email && oldLecturer.email !== email?.trim()) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 0 WHERE email = ? AND role = 'admin'",
          args: [oldLecturer.email]
        });
      }
      if (email?.trim()) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 1, name = ? WHERE email = ? AND role = 'admin'",
          args: [name.trim(), email.trim()]
        });
      }
      await syncLecturerUsers();
      res.json({ success: true });
    } catch (e: any) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Tên giảng viên đã tồn tại' });
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
adminRouter.put('/api/admin/lecturers/:id/students-drive-link', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const link = String(req.body?.students_drive_link || '').trim();
      if (!link) return res.status(400).json({ error: 'Link Drive không được để trống.' });
      await db.execute({
        sql: 'UPDATE lecturers SET students_drive_link = ? WHERE id = ?',
        args: [link, req.params.id],
      });
      res.json({ success: true, students_drive_link: link });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
adminRouter.post('/api/admin/lecturers/send-students-email', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const lecturerName = String(req.body.lecturer_name || '').trim();
      const recipientEmail = String(req.body.recipient_email || '').trim();
      const ccEmails = Array.isArray(req.body.cc_emails)
        ? req.body.cc_emails.map((email: any) => String(email || '').trim()).filter(Boolean)
        : String(req.body.cc_emails || '').split(/[,\s;]+/).map((email: string) => email.trim()).filter(Boolean);
      const subject = String(req.body.subject || '').trim();
      const body = String(req.body.body || '').trim();
      if (!lecturerName) return res.status(400).json({ error: 'Thiếu tên giảng viên.' });
      if (!recipientEmail) return res.status(400).json({ error: 'Thiếu email giảng viên.' });
      if (!subject) return res.status(400).json({ error: 'Thiếu tiêu đề email.' });
      if (!body) return res.status(400).json({ error: 'Thiếu nội dung email.' });
      const notificationStatus = await createNotification({
        recipient_email: recipientEmail,
        cc_emails: ccEmails,
        type: 'lecturer_students_mail_merge',
        subject,
        body,
        send_now: true,
      });
      if (notificationStatus !== 'sent') {
        return res.status(400).json({
          error: notificationStatus === 'queued'
            ? 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY/EMAIL_FROM nên email chỉ được ghi vào hàng đợi, chưa gửi thật.'
            : 'Gửi email thất bại. Vui lòng xem trang Thông báo để biết lỗi chi tiết.',
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 18. Admin: Delete Single Lecturer
adminRouter.delete('/api/admin/lecturers/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const idVal = Number(req.params.id);
      const lecturer = (await db.execute({ sql: "SELECT email FROM lecturers WHERE id = ?", args: [idVal] })).rows[0] as any;
      await cleanupChatAttachments('SELECT attachment_key FROM chat_messages WHERE lecturer_id = ? AND attachment_key IS NOT NULL', [idVal]);
      await cleanupChatAttachments('SELECT attachment_key FROM chat_group_messages WHERE lecturer_id = ? AND attachment_key IS NOT NULL', [idVal]);
      await executeBatch([
        { sql: 'DELETE FROM advisor_assignments WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM lecturer_quotas WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM chat_messages WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM chat_group_message_reads WHERE message_id IN (SELECT id FROM chat_group_messages WHERE lecturer_id = ?)', args: [idVal] },
        { sql: 'DELETE FROM chat_group_messages WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM lecturers WHERE id = ?', args: [idVal] }
      ]);
      if (lecturer?.email) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 0 WHERE email = ? AND role = 'admin'",
          args: [lecturer.email]
        });
        await syncLecturerUsers();
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // ── Admin: Company CRUD ──

  // 19a. Admin: Add Single Company
adminRouter.post('/api/admin/companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, description, slots, contact_email, address, recruitment_link, phone, contact_name } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên công ty không được để trống' });
      const result = await db.execute({
        sql: `INSERT INTO companies (name, description, slots, contact_email, address, recruitment_link, phone, contact_name, history, qualifications)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '')`,
        args: [name.trim(), description || 'Chưa rõ', parseInt(slots) || 5, contact_email || '', address || '', recruitment_link || '', phone || '', contact_name || '']
      });
      const newComp = (await db.execute({ sql: 'SELECT * FROM companies WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0];
      res.json(newComp);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 19b. Admin: Update Single Company
adminRouter.put('/api/admin/companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, description, slots, contact_email, address, recruitment_link, phone, contact_name, history, qualifications } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên công ty không được để trống' });
      await db.execute({
        sql: `UPDATE companies SET name = ?, description = ?, slots = ?, contact_email = ?, address = ?, recruitment_link = ?, phone = ?, contact_name = ?, history = ?, qualifications = ? WHERE id = ?`,
        args: [name.trim(), description || 'Chưa rõ', parseInt(slots) || 5, contact_email || '', address || '', recruitment_link || '', phone || '', contact_name || '', history || '', qualifications || '', req.params.id]
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
adminRouter.put('/api/admin/companies/:id/applicants-drive-link', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const link = String(req.body?.applicants_drive_link || '').trim();
      if (!link) return res.status(400).json({ error: 'Link Drive không được để trống.' });
      await db.execute({
        sql: 'UPDATE companies SET applicants_drive_link = ? WHERE id = ?',
        args: [link, req.params.id],
      });
      res.json({ success: true, applicants_drive_link: link });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
adminRouter.get('/api/admin/companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const officialRows = (await db.execute(`
        SELECT c.*,
               'company' as record_type,
               CAST(c.id AS TEXT) as company_key,
               c.name as display_name,
               COALESCE(rc.applicant_count, 0) as applicant_count,
               COALESCE(rc.approved_count, 0) as approved_applicant_count,
               COALESCE(rc.sent_count, 0) as sent_count,
               rc.last_sent_at,
               c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots
        FROM companies c
        LEFT JOIN (
          SELECT c2.id as company_id,
                 COUNT(r.id) as applicant_count,
                 SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
                 SUM(CASE WHEN r.sent_to_company_at IS NOT NULL THEN 1 ELSE 0 END) as sent_count,
                 MAX(r.sent_to_company_at) as last_sent_at
          FROM companies c2
          LEFT JOIN registrations r
            ON (r.company_id = c2.id AND COALESCE(r.other_company_name, '') = '')
            OR lower(trim(r.other_company_name)) = lower(trim(c2.name))
          WHERE c2.name != 'Công ty khác'
          GROUP BY c2.id
        ) rc ON rc.company_id = c.id
        WHERE c.name != 'Công ty khác'
        ORDER BY c.name ASC
      `)).rows;
      const officialNormalizedNames = new Set(officialRows.map((row: any) => normalizeCompanyName(row.name)).filter(Boolean));
      const rawOtherRows = (await db.execute(`
        SELECT other_company_name, other_company_role, other_company_contact, status, sent_to_company_at
        FROM registrations
        WHERE other_company_name IS NOT NULL AND trim(other_company_name) != ''
      `)).rows as any[];
      const otherMap = new Map<string, any>();
      for (const row of rawOtherRows) {
        const normalized = normalizeCompanyName(row.other_company_name || '');
        if (!normalized || officialNormalizedNames.has(normalized)) continue;
        const current = otherMap.get(normalized) || {
          id: null,
          record_type: 'other',
          company_key: `other:${normalized}`,
          name: String(row.other_company_name || '').trim(),
          display_name: String(row.other_company_name || '').trim(),
          description: '',
          slots: 0,
          contact_email: '',
          contact_name: '',
          history: '',
          qualifications: '',
          address: '',
          recruitment_link: '',
          phone: '',
          applicant_count: 0,
          approved_applicant_count: 0,
          sent_count: 0,
          last_sent_at: null,
          remaining_slots: 0,
          roles_set: new Set<string>(),
          contacts_set: new Set<string>(),
        };
        current.applicant_count += 1;
        if (row.status === 'approved') current.approved_applicant_count += 1;
        if (row.sent_to_company_at) {
          current.sent_count += 1;
          if (!current.last_sent_at || row.sent_to_company_at > current.last_sent_at) current.last_sent_at = row.sent_to_company_at;
        }
        if (row.other_company_role) current.roles_set.add(row.other_company_role);
        if (row.other_company_contact) current.contacts_set.add(row.other_company_contact);
        otherMap.set(normalized, current);
      }
      const otherRows = Array.from(otherMap.values())
        .map(row => ({
          ...row,
          roles: Array.from(row.roles_set).join(','),
          contacts: Array.from(row.contacts_set).join(','),
          roles_set: undefined,
          contacts_set: undefined,
        }))
        .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'vi'));
      res.json([...officialRows, ...otherRows]);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 19c. Admin: Delete Single Company
adminRouter.delete('/api/admin/companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      // Also delete dependent internship/registration records for this company
      await executeBatch([
        { sql: 'DELETE FROM final_internships WHERE company_id = ?', args: [req.params.id] },
        { sql: 'DELETE FROM registrations WHERE company_id = ?', args: [req.params.id] },
        { sql: 'DELETE FROM companies WHERE id = ?', args: [req.params.id] },
      ]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 19d. Admin: Bulk Import Companies from CSV
adminRouter.post('/api/admin/companies/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { companies, override } = req.body;
    if (!Array.isArray(companies)) return res.status(400).json({ error: 'Expected array' });
    try {
      if (override) {
        await db.executeMultiple('DELETE FROM final_internships');
        await db.executeMultiple('DELETE FROM registrations');
        await db.executeMultiple('DELETE FROM companies');
      }
      const statements = companies
        .map((item: any) => {
          const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
          if (!name) return null;
          const slots = parseInt(item?.slots) || 5;
          const contact_email = item?.contact_email || '';
          const address = item?.address || '';
          const phone = item?.phone || '';
          const contact_name = item?.contact_name || '';
          return {
            sql: `INSERT OR IGNORE INTO companies (name, description, slots, contact_email, address, phone, contact_name, history, qualifications, recruitment_link) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '')`,
            args: [name, 'Chưa rõ', slots, contact_email, address, phone, contact_name]
          };
        })
        .filter(Boolean);
      if (statements.length > 0) {
        await executeBatch(statements);
      }
      await ensureSpecialCompanies();
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 6. Admin: Get all registrations
adminRouter.get('/api/admin/registrations', requireAuth, requireAdmin, async (req, res) => {
    const data = (await db.execute(`
      SELECT 
        r.id as registration_id,
        r.user_id,
        r.company_id,
        u.email,
        u.name as student_name,
        u.student_id,
        u.dob,
        u.class_name,
        r.note,
        r.review_comment,
        r.preference_order,
        COALESCE(c.name, 'Không rõ/đã bị xoá') as company_name,
        r.status,
        r.created_at,
        r.other_company_name,
        r.other_company_role,
        r.other_company_contact,
        r.sent_to_company_at,
        r.sent_to_company_note,
        u.course_code,
        c.contact_email,
        u.phone,
        u.personal_email
      FROM registrations r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN companies c ON r.company_id = c.id
      ORDER BY r.created_at DESC
    `)).rows;
    res.json(data);
  });
adminRouter.post('/api/admin/registrations', requireAuth, requireAdmin, async (req: any, res: any) => {
    const userId = Number(req.body?.user_id);
    const companyId = Number(req.body?.company_id);
    const status = String(req.body?.status || 'approved');
    const note = String(req.body?.note || '').trim();
    const reviewComment = String(req.body?.review_comment || '').trim();
    const courseCode = String(req.body?.course_code || '').trim();
    const requestedOrder = req.body?.preference_order === '' || req.body?.preference_order === undefined || req.body?.preference_order === null
      ? null
      : Number(req.body.preference_order);

    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Sinh viên không hợp lệ.' });
    if (!Number.isInteger(companyId) || companyId <= 0) return res.status(400).json({ error: 'Nơi thực tập không hợp lệ.' });
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    if (requestedOrder !== null && (!Number.isInteger(requestedOrder) || requestedOrder < 1)) return res.status(400).json({ error: 'Thứ tự nguyện vọng không hợp lệ.' });

    try {
      const student = (await db.execute({
        sql: "SELECT id, email, personal_email, name FROM users WHERE id = ? AND role = 'student'",
        args: [userId],
      })).rows[0] as any;
      if (!student) return res.status(404).json({ error: 'Không tìm thấy sinh viên.' });

      const company = (await db.execute({ sql: 'SELECT id, name FROM companies WHERE id = ?', args: [companyId] })).rows[0] as any;
      if (!company) return res.status(400).json({ error: 'Không tìm thấy nơi thực tập.' });

      const existingRows = (await db.execute({
        sql: 'SELECT id, company_id, other_company_name, preference_order FROM registrations WHERE user_id = ? ORDER BY COALESCE(preference_order, 999), created_at ASC',
        args: [userId],
      })).rows as any[];
      if (existingRows.length >= 5) return res.status(400).json({ error: 'Sinh viên đã có đủ 5 nguyện vọng. Vui lòng sửa/xóa nguyện vọng hiện có nếu cần thay đổi.' });
      for (let index = 0; index < existingRows.length; index++) {
        const normalizedOrder = index + 1;
        if (Number(existingRows[index].preference_order || 0) !== normalizedOrder) {
          await db.execute({
            sql: 'UPDATE registrations SET preference_order = ? WHERE id = ?',
            args: [normalizedOrder, Number(existingRows[index].id)],
          });
          existingRows[index].preference_order = normalizedOrder;
        }
      }

      const isOtherCompany = company.name === 'Công ty khác';
      const isSchoolInternship = company.name === 'Trường Đại học Công nghệ';
      const otherCompanyName = isOtherCompany ? String(req.body?.other_company_name || '').trim() : '';
      const otherCompanyRole = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_role || '').trim() : '';
      const otherCompanyContact = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_contact || '').trim() : '';
      if (isOtherCompany && !otherCompanyName) return res.status(400).json({ error: 'Vui lòng nhập tên công ty tự liên hệ.' });

      const normalizedOtherName = normalizeCompanyName(otherCompanyName);
      const duplicate = existingRows.some((row: any) => {
        if (isOtherCompany) {
          return Number(row.company_id) === companyId && normalizeCompanyName(row.other_company_name || '') === normalizedOtherName;
        }
        return Number(row.company_id) === companyId;
      });
      if (duplicate) return res.status(400).json({ error: 'Sinh viên đã có nguyện vọng này trong danh sách đăng ký.' });

      const preferenceOrder = requestedOrder === null
        ? existingRows.length + 1
        : Math.min(requestedOrder, existingRows.length + 1);

      await db.execute({
        sql: 'UPDATE registrations SET preference_order = preference_order + 1 WHERE user_id = ? AND preference_order >= ?',
        args: [userId, preferenceOrder],
      });

      const result = await db.execute({
        sql: `INSERT INTO registrations (user_id, company_id, note, status, review_comment, other_company_name, other_company_role, other_company_contact, preference_order, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
        args: [
          userId,
          companyId,
          note || null,
          status,
          reviewComment || null,
          otherCompanyName || null,
          otherCompanyRole || null,
          otherCompanyContact || null,
          preferenceOrder,
        ],
      });

      if (courseCode) {
        await db.execute({ sql: 'UPDATE users SET course_code = ? WHERE id = ?', args: [courseCode, userId] });
      }

      const inserted = (await db.execute({
        sql: `SELECT r.*, c.name as company_name
              FROM registrations r
              LEFT JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [Number(result.lastInsertRowid)],
      })).rows[0] as any;
      if (status === 'approved') {
        await addApprovedCompanyFromRegistration(inserted);
      }
      await ensureSchoolFinalInternshipFromRegistration(userId, req.user.id);

      await createNotification({
        user_id: userId,
        recipient_email: student.personal_email || student.email,
        type: 'registration_status_changed',
        subject: 'Khoa đã bổ sung đăng ký thực tập cho bạn',
        body: `Khoa đã bổ sung nguyện vọng thực tập: ${isOtherCompany ? otherCompanyName : company.name}. Trạng thái hiện tại: ${status === 'approved' ? 'Đã duyệt' : status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}.${reviewComment ? `\n\nNhận xét: ${reviewComment}` : ''}`,
        status: 'website_only',
      });

      res.json({ success: true, registration_id: Number(result.lastInsertRowid) });
    } catch (error: any) {
      if (String(error?.message || '').includes('UNIQUE')) {
        return res.status(400).json({ error: 'Sinh viên đã có nguyện vọng này trong danh sách đăng ký.' });
      }
      console.error('[admin registrations] add failed:', error);
      res.status(500).json({ error: 'Không thể thêm đăng ký thực tập.' });
    }
  });
adminRouter.put('/api/admin/registrations/:id(\\d+)', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const companyId = Number(req.body?.company_id);
    const note = String(req.body?.note || '').trim();
    const courseCode = String(req.body?.course_code || '').trim();
    const preferenceOrder = req.body?.preference_order === '' || req.body?.preference_order === undefined || req.body?.preference_order === null
      ? null
      : Number(req.body.preference_order);

    if (!Number.isInteger(companyId) || companyId <= 0) return res.status(400).json({ error: 'Nơi thực tập không hợp lệ.' });
    if (preferenceOrder !== null && (!Number.isInteger(preferenceOrder) || preferenceOrder < 1)) return res.status(400).json({ error: 'Thứ tự nguyện vọng không hợp lệ.' });

    try {
      const current = (await db.execute({
        sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [id],
      })).rows[0] as any;
      if (!current) return res.status(404).json({ error: 'Không tìm thấy đăng ký.' });

      const company = (await db.execute({ sql: 'SELECT id, name FROM companies WHERE id = ?', args: [companyId] })).rows[0] as any;
      if (!company) return res.status(400).json({ error: 'Không tìm thấy nơi thực tập.' });

      const isOtherCompany = company.name === 'Công ty khác';
      const isSchoolInternship = company.name === 'Trường Đại học Công nghệ';
      const otherCompanyName = isOtherCompany ? String(req.body?.other_company_name || '').trim() : '';
      const otherCompanyRole = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_role || '').trim() : '';
      const otherCompanyContact = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_contact || '').trim() : '';
      if (isOtherCompany && !otherCompanyName) return res.status(400).json({ error: 'Vui lòng nhập tên công ty tự liên hệ.' });
      const approvedCompany = isOtherCompany
        ? (await db.execute({
            sql: 'SELECT id FROM approved_company_names WHERE normalized_name = ? LIMIT 1',
            args: [normalizeCompanyName(otherCompanyName)],
          })).rows[0]
        : company;
      const status = approvedCompany ? 'approved' : 'pending';
      const reviewComment = current.status === status ? String(current.review_comment || '').trim() : '';
      const targetChanged =
        Number(current.company_id) !== companyId ||
        String(current.other_company_name || '').trim() !== otherCompanyName;

      await db.execute({
        sql: `UPDATE registrations
              SET company_id = ?, note = ?, status = ?,
                  review_comment = CASE WHEN status != ? THEN NULL ELSE review_comment END,
                  preference_order = ?,
                  other_company_name = ?, other_company_role = ?, other_company_contact = ?,
                  created_at = datetime('now', '+7 hours')
              WHERE id = ?`,
        args: [companyId, note || null, status, status, preferenceOrder, otherCompanyName || null, otherCompanyRole || null, otherCompanyContact || null, id],
      });
      await db.execute({
        sql: 'UPDATE users SET course_code = ? WHERE id = ?',
        args: [courseCode || null, current.user_id],
      });
      if (targetChanged) {
        await db.execute({
          sql: 'UPDATE registrations SET sent_to_company_at = NULL, sent_to_company_note = NULL WHERE id = ?',
          args: [id],
        });
      }

      const updated = {
        ...current,
        company_id: companyId,
        company_name: company.name,
        other_company_name: otherCompanyName,
        other_company_role: otherCompanyRole,
        other_company_contact: otherCompanyContact,
      };
      if (status === 'approved') {
        await addApprovedCompanyFromRegistration(updated);
        const autoApproved = await approveMatchingOtherCompanyRegistrations(updated, reviewComment);
        for (const item of autoApproved) {
          await createNotification({
            user_id: Number(item.user_id),
            recipient_email: item.personal_email || item.email,
            type: 'registration_status_changed',
            subject: 'Đăng ký thực tập đã được duyệt',
            body: `Đăng ký thực tập tại ${item.other_company_name || 'Công ty tự liên hệ'} đã được tự động duyệt vì công ty này đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
            send_now: true,
          });
        }
      }

      if (current.status !== status) {
        await createNotification({
          user_id: Number(current.user_id),
          recipient_email: current.personal_email || current.email,
          type: 'registration_status_changed',
          subject: `Đăng ký thực tập ${status === 'approved' ? 'đã được duyệt' : 'đang chờ duyệt'}`,
          body: `Đăng ký thực tập tại ${company.name === 'Công ty khác' ? otherCompanyName || 'Công ty khác' : company.name} hiện có trạng thái: ${status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
          send_now: true,
        });
      }
      if (company.name !== 'Trường Đại học Công nghệ' && current.company_name === 'Trường Đại học Công nghệ') {
        await db.execute({
          sql: "DELETE FROM final_internships WHERE user_id = ? AND registration_id = ? AND internship_type = 'school' AND locked_at IS NULL",
          args: [Number(current.user_id), Number(id)],
        });
      } else {
        await ensureSchoolFinalInternshipFromRegistration(Number(current.user_id), req.user.id);
        // Đồng bộ advisor_assignments khi GVHD thay đổi (chỉ áp dụng với đăng ký Trường Đại học Công nghệ)
        if (isSchoolInternship) {
          const syncResult = await syncAdvisorFromSchoolRegistration(
            Number(current.user_id),
            otherCompanyContact,
            otherCompanyRole,
            Number(req.user.id),
          );
          if (syncResult.warning) console.warn(`[syncAdvisor] userId=${current.user_id}: ${syncResult.warning}`);
        }
      }

      res.json({ success: true, status });
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('unique')) return res.status(400).json({ error: 'Sinh viên đã có đăng ký trùng nơi thực tập này.' });
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.delete('/api/admin/registrations/:id(\\d+)', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const registrationId = Number(id);
    if (!Number.isInteger(registrationId) || registrationId <= 0) {
      return res.status(400).json({ error: 'Mã đăng ký không hợp lệ.' });
    }

    try {
      const reg = (await db.execute({
        sql: `SELECT r.*, u.name as student_name, u.student_id, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              LEFT JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [registrationId],
      })).rows[0] as any;

      if (!reg) {
        return res.status(404).json({ error: 'Không tìm thấy đăng ký cần xóa.' });
      }

      const lockedFinal = (await db.execute({
        sql: 'SELECT id, locked_at FROM final_internships WHERE registration_id = ? AND locked_at IS NOT NULL LIMIT 1',
        args: [registrationId],
      })).rows[0] as any;

      if (lockedFinal) {
        return res.status(400).json({
          error: 'Không thể xóa đăng ký đã được chốt và khóa nơi thực tập chính thức.',
        });
      }

      await executeBatch([
        { sql: 'DELETE FROM final_internships WHERE (registration_id = ? OR (user_id = ? AND registration_id IS NULL)) AND locked_at IS NULL', args: [registrationId, reg.user_id] },
        { sql: 'UPDATE advisor_requests SET source_registration_id = NULL WHERE source_registration_id = ?', args: [registrationId] },
        { sql: 'DELETE FROM registrations WHERE id = ?', args: [registrationId] },
      ]);

      res.json({ success: true, message: 'Đã xóa đăng ký thành công.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Lỗi khi xóa đăng ký.' });
    }
  });
adminRouter.get('/api/admin/approved-companies', requireAuth, requireAdmin, async (req, res) => {
    const rows = (await db.execute('SELECT * FROM approved_company_names ORDER BY name ASC')).rows;
    res.json(rows);
  });
adminRouter.post('/api/admin/approved-companies/import', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const items = Array.isArray(req.body.companies) ? req.body.companies : [];
      if (req.body.override) await db.execute('DELETE FROM approved_company_names');
      const statements = items.map((item: any) => {
        const name = typeof item === 'string' ? item.trim() : String(item?.name || '').trim();
        const normalized = normalizeCompanyName(name);
        if (!name || !normalized) return null;
        return {
          sql: `INSERT INTO approved_company_names (name, normalized_name, source)
                VALUES (?, ?, ?)
                ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name, source = excluded.source`,
          args: [name, normalized, req.body.source || 'manual'],
        };
      }).filter(Boolean);
      await executeBatch(statements);
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.post('/api/admin/approved-companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const name = String(req.body.name || '').trim();
      const normalized = normalizeCompanyName(name);
      if (!name || !normalized) return res.status(400).json({ error: 'Tên công ty không được để trống.' });
      const result = await db.execute({
        sql: `INSERT INTO approved_company_names (name, normalized_name, source) VALUES (?, ?, ?)`,
        args: [name, normalized, req.body.source || 'manual'],
      });
      const row = (await db.execute({ sql: 'SELECT * FROM approved_company_names WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0];
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: 'Công ty này đã có trong danh sách thẩm định.' });
    }
  });
adminRouter.put('/api/admin/approved-companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const name = String(req.body.name || '').trim();
      const normalized = normalizeCompanyName(name);
      if (!name || !normalized) return res.status(400).json({ error: 'Tên công ty không được để trống.' });
      await db.execute({
        sql: `UPDATE approved_company_names SET name = ?, normalized_name = ?, source = ? WHERE id = ?`,
        args: [name, normalized, req.body.source || 'manual', Number(req.params.id)],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: 'Tên công ty bị trùng với một mục đã có.' });
    }
  });
adminRouter.delete('/api/admin/approved-companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({ sql: 'DELETE FROM approved_company_names WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ success: true });
  });
adminRouter.put('/api/admin/registrations/mark-sent', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const note = req.body.note || null;
      if (Array.isArray(req.body.registration_ids) && req.body.registration_ids.length > 0) {
        const ids = req.body.registration_ids.map((id: any) => Number(id)).filter(Boolean);
        if (ids.length === 0) return res.status(400).json({ error: 'Danh sách đăng ký không hợp lệ' });
        await db.execute({
          sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
                WHERE id IN (${ids.map(() => '?').join(',')})`,
          args: [note, ...ids],
        });
        return res.json({ success: true, count: ids.length });
      }
      if (req.body.company_name) {
        await db.execute({
          sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
                WHERE status = 'approved'
                  AND (
                    company_id IN (SELECT id FROM companies WHERE name = ?)
                    OR lower(trim(other_company_name)) = lower(trim(?))
                  )`,
          args: [note, req.body.company_name, req.body.company_name],
        });
        return res.json({ success: true });
      }
      if (req.body.other_company_name) {
        await db.execute({
          sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
                WHERE status = 'approved'
                  AND lower(trim(other_company_name)) = lower(trim(?))`,
          args: [note, req.body.other_company_name],
        });
        return res.json({ success: true });
      }
      res.status(400).json({ error: 'Vui lòng chọn đăng ký hoặc công ty cần đánh dấu đã gửi.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.post('/api/admin/companies/send-applicants-email', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyName = String(req.body.company_name || req.body.other_company_name || '').trim();
      const recipientEmail = String(req.body.recipient_email || '').trim();
      const ccEmails = Array.isArray(req.body.cc_emails)
        ? req.body.cc_emails.map((email: any) => String(email || '').trim()).filter(Boolean)
        : String(req.body.cc_emails || '').split(/[,\s;]+/).map((email: string) => email.trim()).filter(Boolean);
      if (!companyName) return res.status(400).json({ error: 'Thiếu tên công ty.' });
      if (!recipientEmail) return res.status(400).json({ error: 'Thiếu email doanh nghiệp.' });
      const isOther = Boolean(req.body.other_company_name);
      if (isOther) return res.status(400).json({ error: 'Chỉ hỗ trợ gửi email thật cho doanh nghiệp chính thức.' });
      const rows = (await db.execute({
        sql: `SELECT r.id, u.student_id, u.name, u.phone, u.personal_email, u.class_name, u.course_code, r.note
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.status = 'approved'
                AND ${isOther ? 'lower(trim(r.other_company_name)) = lower(trim(?))' : '(c.name = ? OR lower(trim(r.other_company_name)) = lower(trim(?)))'}
              ORDER BY u.student_id ASC`,
        args: isOther ? [companyName] : [companyName, companyName],
      })).rows as any[];
      if (rows.length === 0) return res.status(400).json({ error: 'Công ty này chưa có đăng ký đã duyệt để gửi.' });
      const body = String(req.body.body || '').trim() || [
        'Kính gửi Quý Công ty,',
        '',
        `Khoa CNTT gửi danh sách sinh viên đăng ký thực tập tại ${companyName}.`,
        '',
        ...rows.map((row, idx) => `${idx + 1}. ${row.student_id || ''} - ${row.name || ''} - ${row.class_name || ''} - ${row.course_code || ''} - ${row.phone || ''} - ${row.personal_email || ''}${row.note ? ` - Ghi chú: ${row.note}` : ''}`),
        '',
        'Trân trọng.',
      ].join('\n');
      const subject = String(req.body.subject || '').trim() || `Danh sách sinh viên đăng ký thực tập - ${companyName}`;
      const notificationStatus = await createNotification({
        recipient_email: recipientEmail,
        cc_emails: ccEmails,
        type: 'company_applicants_sent',
        subject,
        body,
        send_now: true,
      });
      if (notificationStatus !== 'sent') {
        return res.status(400).json({
          error: notificationStatus === 'queued'
            ? 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY/EMAIL_FROM nên email chỉ được ghi vào hàng đợi, chưa gửi thật.'
            : 'Gửi email thất bại. Vui lòng xem trang Thông báo để biết lỗi chi tiết.',
        });
      }
      await db.execute({
        sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = 'Gửi email thật qua hệ thống'
              WHERE status = 'approved'
                AND ${isOther ? 'lower(trim(other_company_name)) = lower(trim(?))' : '(company_id IN (SELECT id FROM companies WHERE name = ?) OR lower(trim(other_company_name)) = lower(trim(?)))'}`,
        args: isOther ? [companyName] : [companyName, companyName],
      });
      res.json({ success: true, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.get('/api/admin/final-internships', requireAuth, requireAdmin, async (req, res) => {
    await backfillSchoolFinalInternshipsFromRegistrations((req as any).user?.id);
    const rows = (await db.execute(`
      SELECT f.*, u.email, u.name as student_name, u.student_id, u.class_name, u.course_code, u.phone, u.personal_email,
             c.name as company_name, r.other_company_name, r.other_company_role, r.other_company_contact
      FROM final_internships f
      JOIN users u ON f.user_id = u.id
      LEFT JOIN companies c ON f.company_id = c.id
      LEFT JOIN registrations r ON f.registration_id = r.id
      ORDER BY f.confirmed_at DESC
    `)).rows;
    res.json(rows);
  });
adminRouter.get('/api/admin/unconfirmed-internships', requireAuth, requireAdmin, async (req, res) => {
    try {
      await backfillSchoolFinalInternshipsFromRegistrations((req as any).user?.id);
      const rows = (await db.execute(`
        WITH confirmed_students AS (
          SELECT DISTINCT user_id FROM final_internships
        ),
        student_regs AS (
          SELECT 
            r.user_id,
            COUNT(r.id) as reg_count,
            GROUP_CONCAT(
              (CASE WHEN r.preference_order IS NOT NULL THEN 'NV' || r.preference_order || ': ' ELSE '' END) ||
              (CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || COALESCE(r.other_company_name, '')
                    WHEN c.name = 'Trường Đại học Công nghệ' THEN 'Trường Đại học Công nghệ'
                    ELSE COALESCE(c.name, 'Chưa rõ') END) ||
              ' (' || (CASE WHEN r.status = 'approved' THEN 'Đã duyệt' WHEN r.status = 'rejected' THEN 'Từ chối' ELSE 'Chờ duyệt' END) || ')',
              '; '
            ) as registered_places_summary
          FROM registrations r
          LEFT JOIN companies c ON r.company_id = c.id
          GROUP BY r.user_id
        )
        SELECT 
          u.id as user_id,
          u.student_id,
          u.name as student_name,
          u.dob,
          u.class_name,
          u.course_code,
          u.phone,
          u.email,
          u.personal_email,
          COALESCE(sr.reg_count, 0) as registered_count,
          COALESCE(sr.registered_places_summary, 'Chưa đăng ký') as registered_places,
          'Chưa xác nhận' as confirmation_status
        FROM registrations r
        JOIN users u ON r.user_id = u.id
        LEFT JOIN student_regs sr ON sr.user_id = u.id
        WHERE u.id NOT IN (SELECT user_id FROM confirmed_students)
        GROUP BY u.id
        ORDER BY u.class_name ASC, u.student_id ASC
      `)).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.get('/api/admin/registered-students-export', requireAuth, requireAdmin, async (req, res) => {
    try {
      await backfillSchoolFinalInternshipsFromRegistrations((req as any).user?.id);
      const rows = (await db.execute(`
        WITH registered_students AS (
          SELECT DISTINCT user_id FROM registrations
        ),
        school_proposals AS (
          SELECT r.user_id,
                 MAX(CASE WHEN NULLIF(TRIM(r.other_company_contact), '') IS NOT NULL THEN r.other_company_contact END) as school_primary,
                 MAX(CASE WHEN NULLIF(TRIM(r.other_company_role), '') IS NOT NULL THEN r.other_company_role END) as school_co
          FROM registrations r
          JOIN companies sc ON sc.id = r.company_id
          WHERE sc.name = 'Trường Đại học Công nghệ' AND r.status != 'rejected'
          GROUP BY r.user_id
        )
        SELECT 
          u.id as user_id,
          u.student_id,
          u.name as student_name,
          u.dob,
          u.class_name,
          CASE
            WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
            ELSE COALESCE(u.course_code, '')
          END as course_code,
          u.phone,
          u.personal_email,
          u.email,
          CASE
            WHEN f.id IS NULL THEN 'Chưa xác nhận'
            WHEN fc.name = 'Công ty khác' THEN COALESCE(NULLIF(TRIM(fr.other_company_name), ''), 'Công ty khác')
            ELSE COALESCE(fc.name, 'Chưa rõ')
          END as final_internship_place,
          COALESCE(
            NULLIF(GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN l.name END, '; '), ''),
            NULLIF(TRIM(f.school_lecturer), ''),
            NULLIF(TRIM(sp.school_primary), ''),
            ''
          ) as primary_advisors,
          COALESCE(
            NULLIF(GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN l.name END, '; '), ''),
            NULLIF(TRIM(sp.school_co), ''),
            ''
          ) as co_advisors
        FROM registered_students rs
        JOIN users u ON u.id = rs.user_id
        LEFT JOIN final_internships f ON f.user_id = u.id
        LEFT JOIN companies fc ON fc.id = f.company_id
        LEFT JOIN registrations fr ON fr.id = f.registration_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = u.id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        LEFT JOIN school_proposals sp ON sp.user_id = u.id
        GROUP BY u.id
        ORDER BY u.class_name ASC, u.student_id ASC
      `)).rows as any[];
      res.json(rows.map(r => ({ ...r, student_name: cleanStudentName(r.student_name, r.student_id, r.email) })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.put('/api/admin/final-internships/:userId', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const targetUserId = Number(req.params.userId);
      if (!targetUserId) return res.status(400).json({ error: 'User không hợp lệ' });
      const type = req.body.internship_type === 'school' || req.body.internship_type === 'partner' ? req.body.internship_type : 'company';
      let registrationId = req.body.registration_id ? Number(req.body.registration_id) : null;
      let companyId = req.body.company_id ? Number(req.body.company_id) : null;
      if (registrationId) {
        const reg = (await db.execute({ sql: 'SELECT * FROM registrations WHERE id = ? AND user_id = ?', args: [registrationId, targetUserId] })).rows[0] as any;
        if (!reg) return res.status(404).json({ error: 'Không tìm thấy đăng ký của sinh viên.' });
        if (reg.status !== 'approved') return res.status(400).json({ error: 'Chỉ có thể tạo nơi thực tập từ đăng ký đã duyệt.' });
        companyId = reg.company_id;
      }
      if (!companyId && type !== 'partner') {
        const school = (await db.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
        companyId = school?.id || null;
      }
      const schoolAssignmentRequest = req.body.school_assignment_request ? 1 : 0;
      await db.execute({
        sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
              VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))
              ON CONFLICT(user_id) DO UPDATE SET registration_id = excluded.registration_id, company_id = excluded.company_id,
                internship_type = excluded.internship_type, status = 'confirmed', student_attested = excluded.student_attested,
                attestation_text = excluded.attestation_text, school_lecturer = excluded.school_lecturer,
                school_assignment_request = excluded.school_assignment_request, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
        args: [targetUserId, registrationId, companyId, type, req.body.student_attested ? 1 : 0, req.body.attestation_text || null, req.body.school_lecturer || null, schoolAssignmentRequest, req.user.id, req.body.note || null],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.delete('/api/admin/final-internships/:userId', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const targetUserId = Number(req.params.userId);
      if (!targetUserId) return res.status(400).json({ error: 'User không hợp lệ' });
      const locked = (await db.execute({
        sql: 'SELECT locked_at FROM final_internships WHERE user_id = ? AND locked_at IS NOT NULL',
        args: [targetUserId],
      })).rows[0];
      if (locked) {
        return res.status(400).json({ error: 'Không thể xóa nơi thực tập chính thức đã bị khóa.' });
      }
      await executeBatch([
        { sql: 'DELETE FROM grades WHERE user_id = ? AND locked_at IS NULL', args: [targetUserId] },
        { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [targetUserId] },
        { sql: 'DELETE FROM final_reports WHERE user_id = ?', args: [targetUserId] },
        { sql: 'DELETE FROM final_internships WHERE user_id = ?', args: [targetUserId] },
      ]);
      res.json({ success: true, message: 'Đã xóa sinh viên khỏi danh sách thực tập chính thức và bảng điểm.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.put('/api/admin/final-internships/:userId/lock', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      await db.execute({
        sql: `UPDATE final_internships SET locked_at = ${req.body.locked === false ? 'NULL' : "datetime('now', '+7 hours')"} WHERE user_id = ?`,
        args: [Number(req.params.userId)],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.get('/api/admin/advisor-assignments', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        WITH participants AS (
          SELECT user_id FROM final_internships
          UNION
          SELECT user_id FROM advisor_requests
          UNION
          SELECT user_id FROM registrations WHERE status != 'rejected'
          UNION
          SELECT user_id FROM advisor_assignments
        ),
        registration_places AS (
          SELECT r.user_id,
                 GROUP_CONCAT(
                   CASE
                     WHEN c.name = 'Công ty khác' THEN COALESCE(NULLIF(trim(r.other_company_name), ''), c.name)
                     ELSE c.name
                   END,
                   '; '
                 ) as registered_places
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.status != 'rejected'
          GROUP BY r.user_id
        )
        SELECT p.user_id, f.internship_type, f.school_assignment_request, f.confirmed_at,
               ar.request_type as advisor_request_type, ar.status as advisor_request_status,
               u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
               CASE
                 WHEN f.id IS NULL THEN 'Chưa xác nhận nơi thực tập'
                 WHEN c.name = 'Công ty khác' THEN r.other_company_name
                 ELSE c.name
               END as final_internship_place,
               CASE
                 WHEN f.id IS NULL THEN COALESCE(rp.registered_places, 'Chưa xác nhận nơi thực tập')
                 WHEN c.name = 'Công ty khác' THEN r.other_company_name
                 ELSE c.name
               END as internship_place,
               GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN aa.id || '|' || COALESCE(l.name, 'Giảng viên đã bị xóa') || '|' || COALESCE(l.email, '') || '|' || COALESCE(aa.note, '') END) as primary_assignments,
               GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN aa.id || '|' || COALESCE(l.name, 'Giảng viên đã bị xóa') || '|' || COALESCE(l.email, '') || '|' || COALESCE(aa.note, '') END) as co_assignments
        FROM participants p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN final_internships f ON f.user_id = p.user_id
        LEFT JOIN advisor_requests ar ON ar.user_id = p.user_id
        LEFT JOIN registration_places rp ON rp.user_id = p.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = p.user_id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        GROUP BY p.user_id
        ORDER BY u.student_id ASC
      `)).rows;
      const quotaSettings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')")).rows as any[]);
      const lecturersRaw = (await db.execute(`
        SELECT l.*, q.max_total_students as quota_override,
               COALESCE(ac.assignment_count, 0) as assignment_count
        FROM lecturers l
        LEFT JOIN lecturer_quotas q ON q.lecturer_id = l.id
        LEFT JOIN (SELECT lecturer_id, COUNT(DISTINCT user_id) as assignment_count FROM advisor_assignments GROUP BY lecturer_id) ac ON ac.lecturer_id = l.id
        ORDER BY l.name ASC
      `)).rows as any[];
      const lecturers = lecturersRaw.map((lecturer: any) => {
        const upper = String(lecturer.name || '').toUpperCase();
        const defaultQuota = /\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')
          ? Number(quotaSettings.advisor_quota_pgs || 5)
          : /\bTS\b/.test(upper) || upper.includes('TS.')
            ? Number(quotaSettings.advisor_quota_ts || 8)
            : Number(quotaSettings.advisor_quota_ths || 10);
        return { ...lecturer, max_total_students: lecturer.quota_override !== null && lecturer.quota_override !== undefined ? Number(lecturer.quota_override) : defaultQuota, assignment_count: Number(lecturer.assignment_count || 0) };
      });
      res.json({ rows, lecturers });
      setTimeout(() => {
        if (advisorAutoAssignRunning) return;
        advisorAutoAssignRunning = true;
        autoAssignAfterAdvisorWindow(req.user.id)
          .catch((autoAssignError: any) => {
            console.error('[advisor] auto-assign after window failed:', autoAssignError);
          })
          .finally(() => {
            advisorAutoAssignRunning = false;
          });
      }, 0);
    } catch (error: any) {
      console.error('[advisor] failed to load advisor assignments:', error);
      res.status(isTransientLibsqlError(error) ? 503 : 500).json({ error: 'Không tải được danh sách phân công.', detail: error?.message || String(error) });
    }
  });
adminRouter.post('/api/admin/advisor-assignments', requireAuth, requireAdmin, async (req: any, res: any) => {
    const result = await createAdvisorAssignment({ ...req.body, allow_without_final: true, allow_over_quota: true, replace_existing: true }, req.user.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result.row);
  });
adminRouter.post('/api/admin/advisor-assignments/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const items = Array.isArray(req.body.assignments) ? req.body.assignments : [];
    let count = 0;
    const errors: string[] = [];
    for (const item of items) {
      const studentId = String(item.student_id || '').trim();
      const student = (await db.execute({ sql: "SELECT id FROM users WHERE student_id = ? AND role = 'student'", args: [studentId] })).rows[0] as any;
      if (!student) {
        errors.push(`${studentId}: không tìm thấy sinh viên`);
        continue;
      }
      const result = await createAdvisorAssignment({ ...item, user_id: student.id, allow_without_final: true }, req.user.id);
      if (result.error) errors.push(`${studentId}: ${result.error}`);
      else count++;
    }
    res.json({ success: true, count, errors });
  });
adminRouter.post('/api/admin/advisor-assignments/auto-primary', requireAuth, requireAdmin, async (req: any, res: any) => {
    const result = await autoAssignPrimaryAdvisors(req.user.id);
    res.json({ success: true, ...result });
  });
adminRouter.post('/api/admin/advisor-requests/sync-legacy', requireAuth, requireAdmin, async (req: any, res: any) => {
    if (advisorRequestBackfillRunning) return res.status(409).json({ error: 'Đang có tiến trình đồng bộ dữ liệu GVHD cũ. Vui lòng thử lại sau.' });
    advisorRequestBackfillRunning = true;
    try {
      const legacy = await ensureAdvisorRequestsFromLegacySchoolRegistrations();
      const pending = await approvePendingAgreedAdvisorRequests(req.user.id);
      res.json({ success: true, legacy, pending });
    } catch (error: any) {
      console.error('[advisor] manual legacy sync failed:', error);
      res.status(isTransientLibsqlError(error) ? 503 : 500).json({ error: 'Không đồng bộ được dữ liệu GVHD cũ.', detail: error?.message || String(error) });
    } finally {
      advisorRequestBackfillRunning = false;
    }
  });
adminRouter.get('/api/admin/advisor-requests', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        SELECT ar.*, u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
               l.name as lecturer_name, l.email as lecturer_email,
               cl.name as co_lecturer_name, cl.email as co_lecturer_email,
               CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place
        FROM advisor_requests ar
        JOIN users u ON u.id = ar.user_id
        LEFT JOIN lecturers l ON l.id = ar.lecturer_id
        LEFT JOIN lecturers cl ON cl.id = ar.co_lecturer_id
        LEFT JOIN final_internships f ON f.user_id = ar.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        WHERE NOT (ar.request_type = 'agreed' AND ar.status = 'approved')
        ORDER BY CASE ar.status WHEN 'pending' THEN 0 ELSE 1 END, ar.updated_at DESC
      `)).rows;
      res.json(rows);
    } catch (error: any) {
      console.error('[advisor] failed to load advisor requests:', error);
      res.status(isTransientLibsqlError(error) ? 503 : 500).json({ error: 'Không tải được danh sách đăng ký GVHD.', detail: error?.message || String(error) });
    }
  });
adminRouter.put('/api/admin/advisor-requests/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const action = String(req.body.action || '').trim();
    const request = (await db.execute({ sql: 'SELECT * FROM advisor_requests WHERE id = ?', args: [id] })).rows[0] as any;
    if (!request) return res.status(404).json({ error: 'Không tìm thấy đăng ký GVHD.' });
    if (action === 'reject') {
      await db.execute({
        sql: `UPDATE advisor_requests SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours') WHERE id = ?`,
        args: [req.body.admin_note || null, req.user.id, id],
      });
      const student = (await db.execute({ sql: 'SELECT email, personal_email FROM users WHERE id = ?', args: [Number(request.user_id)] })).rows[0] as any;
      await createNotification({
        user_id: Number(request.user_id),
        recipient_email: student?.personal_email || student?.email,
        type: 'advisor_request_rejected',
        subject: 'Đăng ký GVHD chưa được duyệt',
        body: `Khoa chưa duyệt đăng ký GVHD của bạn.${req.body.admin_note ? `\nNhận xét: ${req.body.admin_note}` : ''}`,
      });
      return res.json({ success: true });
    }
    if (action !== 'approve') return res.status(400).json({ error: 'Thao tác không hợp lệ.' });
    const lecturerId = req.body.lecturer_id ? Number(req.body.lecturer_id) : Number(request.lecturer_id);
    const coLecturerId = req.body.co_lecturer_id ? Number(req.body.co_lecturer_id) : Number(request.co_lecturer_id || 0);
    if (!lecturerId) return res.status(400).json({ error: 'Đăng ký chưa có GVHD chính để duyệt.' });
    const primaryResult = await createAdvisorAssignment({
      user_id: Number(request.user_id),
      lecturer_id: lecturerId,
      role: 'primary',
      note: req.body.admin_note || 'Duyệt đăng ký GVHD từ sinh viên',
      allow_over_quota: true,
      allow_without_final: true,
      suppress_student_notification: request.request_type === 'agreed',
    }, req.user.id);
    if (primaryResult.error) return res.status(primaryResult.status || 400).json({ error: primaryResult.error });
    if (coLecturerId) {
      await createAdvisorAssignment({
        user_id: Number(request.user_id),
        lecturer_id: coLecturerId,
        role: 'co',
        note: req.body.admin_note || 'Duyệt đăng ký đồng hướng dẫn từ sinh viên',
        allow_over_quota: true,
        allow_without_final: true,
        suppress_student_notification: request.request_type === 'agreed',
      }, req.user.id);
    }
    await db.execute({
      sql: `UPDATE advisor_requests SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours') WHERE id = ?`,
      args: [req.body.admin_note || null, req.user.id, id],
    });
    const adminNote = String(req.body.admin_note || '').trim();
    if (adminNote) {
      const student = (await db.execute({ sql: 'SELECT email, personal_email FROM users WHERE id = ?', args: [Number(request.user_id)] })).rows[0] as any;
      await createNotification({
        user_id: Number(request.user_id),
        recipient_email: student?.personal_email || student?.email,
        type: 'advisor_request_approved_comment',
        subject: 'Nhận xét về đăng ký GVHD',
        body: `Khoa đã duyệt đăng ký GVHD của bạn.\nNhận xét: ${adminNote}`,
        send_now: true,
        no_queue_on_send_skip: true,
      });
    }
    res.json({ success: true });
  });
adminRouter.delete('/api/admin/advisor-assignments/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const existing = (await db.execute({ sql: 'SELECT * FROM advisor_assignments WHERE id = ?', args: [Number(req.params.id)] })).rows[0] as any;
    if (existing) {
      await db.execute({
        sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
              VALUES (?, ?, ?, ?, 'deleted', ?, ?, datetime('now', '+7 hours'))`,
        args: [Number(existing.id), Number(existing.user_id), Number(existing.lecturer_id), existing.role, req.user.id, existing.note || null],
      });
    }
    await db.execute({ sql: 'DELETE FROM advisor_assignments WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ success: true });
  });
adminRouter.put('/api/admin/lecturer-quotas/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const maxTotal = Number(req.body.max_total_students);
    if (!Number.isInteger(maxTotal) || maxTotal < 0) return res.status(400).json({ error: 'Chỉ tiêu không hợp lệ.' });
    await db.execute({
      sql: `INSERT INTO lecturer_quotas (lecturer_id, max_total_students, note)
            VALUES (?, ?, ?)
            ON CONFLICT(lecturer_id) DO UPDATE SET max_total_students = excluded.max_total_students, note = excluded.note`,
      args: [Number(req.params.id), maxTotal, req.body.note || null],
    });
    res.json({ success: true });
  });
adminRouter.get('/api/admin/reports/final', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT f.user_id, f.internship_type, f.confirmed_at,
             u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
             fr.id as report_id, fr.original_filename, fr.file_size, fr.status as report_status,
             fr.submitted_at as report_submitted_at, fr.updated_at as report_updated_at, fr.lecturer_comment,
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as primary_advisors,
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as co_advisors
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows;
    res.json(rows);
  });
adminRouter.get('/api/admin/grades', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT f.user_id, f.internship_type, f.confirmed_at,
             u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
             fr.status as report_status,
             g.progress_score, g.report_score, g.company_score, g.final_score,
             COALESCE(g.status, 'missing') as grade_status, g.comment, g.submitted_at as grade_submitted_at, g.locked_at,
             CASE
               WHEN g.id IS NULL THEN NULL
               ELSE gl.name
             END as grading_lecturer_name,
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as primary_advisors,
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as co_advisors
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      LEFT JOIN grades g ON g.user_id = f.user_id
      LEFT JOIN lecturers gl ON gl.id = g.lecturer_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows as any[];

    for (const r of rows) {
      const clean = cleanStudentName(r.student_name, r.student_id, r.email);
      if (clean && clean !== r.student_name) {
        db.execute({ sql: 'UPDATE users SET name = ? WHERE id = ?', args: [clean, r.user_id] }).catch(() => {});
      }
    }

    res.json(rows.map(r => ({
      ...r,
      student_name: cleanStudentName(r.student_name, r.student_id, r.email),
    })));
  });
adminRouter.put('/api/admin/grades/lock-all', requireAuth, requireAdmin, async (req: any, res: any) => {
    const locked = req.body.locked !== false;
    const onlySubmitted = req.body.onlySubmitted !== false;
    if (locked) {
      const condition = onlySubmitted ? "(status = 'submitted' OR final_score IS NOT NULL)" : '1=1';
      const result = await db.execute(`
        UPDATE grades
        SET locked_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours')
        WHERE ${condition} AND locked_at IS NULL
      `);
      await db.execute(`
        UPDATE final_internships
        SET locked_at = datetime('now', '+7 hours')
        WHERE user_id IN (SELECT user_id FROM grades WHERE locked_at IS NOT NULL)
          AND locked_at IS NULL
      `);
      res.json({ success: true, count: result.rowsAffected || 0 });
    } else {
      const result = await db.execute(`
        UPDATE grades
        SET locked_at = NULL, updated_at = datetime('now', '+7 hours')
        WHERE locked_at IS NOT NULL
      `);
      await db.execute(`
        UPDATE final_internships
        SET locked_at = NULL
        WHERE locked_at IS NOT NULL
      `);
      res.json({ success: true, count: result.rowsAffected || 0 });
    }
  });
adminRouter.put('/api/admin/grades/:userId/lock', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({
      sql: `UPDATE grades SET locked_at = ${req.body.locked === false ? 'NULL' : "datetime('now', '+7 hours')"}, updated_at = datetime('now', '+7 hours') WHERE user_id = ?`,
      args: [Number(req.params.userId)],
    });
    if (req.body.locked !== false) {
      const row = (await db.execute({
        sql: `SELECT u.email, u.personal_email, g.final_score
              FROM users u LEFT JOIN grades g ON g.user_id = u.id
              WHERE u.id = ?`,
        args: [Number(req.params.userId)],
      })).rows[0] as any;
      await createNotification({
        user_id: Number(req.params.userId),
        recipient_email: row?.personal_email || row?.email,
        type: 'grade_submitted',
        subject: 'Khoa đã khóa điểm thực tập',
        body: `Khoa đã khóa điểm thực tập của bạn. Điểm tổng kết: ${row?.final_score ?? '-'}.`,
      });
    }
    res.json({ success: true });
  });
adminRouter.get('/api/admin/grades/export.csv', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT u.student_id as "Mã SV", u.name as "Họ và tên", u.class_name as "Lớp",
             CASE
               WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
               ELSE COALESCE(u.course_code, '')
             END as "Mã học phần",
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as "Nơi thực tập",
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as "GVHD chính",
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as "Đồng hướng dẫn",
             g.progress_score as "Điểm báo cáo định kỳ",
             g.report_score as "Điểm báo cáo",
             g.company_score as "Điểm đánh giá công ty/GVHD",
             g.final_score as "Điểm tổng kết",
             COALESCE(g.status, 'missing') as "Trạng thái điểm",
             gl.name as "Người nhập",
             g.submitted_at as "Thời gian nộp điểm",
             g.comment as "Ghi chú"
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN grades g ON g.user_id = f.user_id
      LEFT JOIN lecturers gl ON gl.id = g.lecturer_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows as any[];
    const headers = rows.length ? Object.keys(rows[0]) : ['Mã SV', 'Họ và tên', 'Điểm tổng kết'];
    const csv = [headers, ...rows.map(row => {
      const copy = { ...row };
      if (copy['Họ và tên']) copy['Họ và tên'] = cleanStudentName(copy['Họ và tên'], copy['Mã SV']);
      return headers.map(header => copy[header] ?? '');
    })]
      .map(items => items.map(item => `"${String(item ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment('bang_diem_thuc_tap.csv');
    res.send('\uFEFF' + csv);
  });
adminRouter.get('/api/admin/notifications', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;

      if (!hasPagination) {
        // Chế độ tương thích ngược: nạp tối đa 500 bản ghi mới nhất dưới dạng mảng
        const rows = (await db.execute(`
          SELECT n.*, u.name as user_name, u.student_id
          FROM notifications n
          LEFT JOIN users u ON u.id = n.user_id
          ORDER BY n.created_at DESC
          LIMIT 500
        `)).rows;
        return res.json(rows);
      }

      // Chế độ phân trang hỗ trợ Virtual Proxy & Cache Proxy
      const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || 25), 10) || 25));
      const offset = (page - 1) * limit;

      const search = String(req.query.search || '').trim();
      const status = String(req.query.status || '').trim();
      const type = String(req.query.type || '').trim();

      const conditions: string[] = [];
      const filterArgs: any[] = [];

      if (status) {
        conditions.push('n.status = ?');
        filterArgs.push(status);
      }
      if (type) {
        conditions.push('n.type = ?');
        filterArgs.push(type);
      }
      if (search) {
        conditions.push('(n.recipient_email LIKE ? OR n.subject LIKE ? OR n.body LIKE ? OR u.name LIKE ? OR u.student_id LIKE ?)');
        const term = `%${search}%`;
        filterArgs.push(term, term, term, term, term);
      }

      const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM notifications n LEFT JOIN users u ON u.id = n.user_id ${whereSql}`,
        args: filterArgs,
      });
      const total = Number(countRes.rows[0]?.count || 0);

      const itemsRes = await db.execute({
        sql: `SELECT n.*, u.name as user_name, u.student_id
              FROM notifications n
              LEFT JOIN users u ON u.id = n.user_id
              ${whereSql}
              ORDER BY n.created_at DESC
              LIMIT ? OFFSET ?`,
        args: [...filterArgs, limit, offset],
      });

      const totalPages = Math.max(1, Math.ceil(total / limit));

      return res.json({
        items: itemsRes.rows,
        total,
        page,
        limit,
        totalPages,
      });
    } catch (e: any) {
      console.error('[adminRouter] Error fetching paginated notifications:', e);
      return res.status(500).json({ error: 'Không tải được danh sách thông báo.' });
    }
  });
adminRouter.get('/api/admin/notifications/stats', requireAuth, requireAdmin, async (req: any, res: any) => {
    const statusRows = (await db.execute(`
      SELECT status, COUNT(*) as count
      FROM notifications
      GROUP BY status
    `)).rows as any[];
    const sentToday = await emailSentTodayCount();
    res.json({
      provider: process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : 'none'),
      daily_cap: emailDailySendCap(),
      sent_today: sentToday,
      remaining_today: Math.max(0, emailDailySendCap() - sentToday),
      batch_size: emailBatchSize(),
      statuses: Object.fromEntries(statusRows.map(row => [row.status, Number(row.count || 0)])),
    });
  });
adminRouter.post('/api/admin/notifications/send-queued', requireAuth, requireAdmin, async (req: any, res: any) => {
    const provider = process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '');
    if (!provider || provider === 'none') return res.status(400).json({ error: 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY hoặc RESEND_API_KEY.' });
    if (provider === 'brevo' && !process.env.BREVO_API_KEY) return res.status(400).json({ error: 'Chưa cấu hình BREVO_API_KEY.' });
    if (provider === 'resend' && !process.env.RESEND_API_KEY) return res.status(400).json({ error: 'Chưa cấu hình RESEND_API_KEY.' });
    if (!process.env.EMAIL_FROM && !process.env.NOTIFICATION_EMAIL_FROM) return res.status(400).json({ error: 'Chưa cấu hình EMAIL_FROM.' });
    const notificationIds = Array.isArray(req.body?.notification_ids)
      ? req.body.notification_ids
      : Array.isArray(req.body?.ids)
        ? req.body.ids
        : undefined;
    const result = await sendQueuedNotificationBatch({
      requestedLimit: Number(req.body?.limit || 0) || undefined,
      notificationIds,
      ignoreBatchSize: req.body?.mode === 'quota',
    });
    res.json({ success: true, ...result });
  });
adminRouter.delete('/api/admin/notifications/queued', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rawIds = Array.isArray(req.body?.notification_ids) ? req.body.notification_ids : [];
    const notificationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (notificationIds.length > 0) {
      const placeholders = notificationIds.map(() => '?').join(',');
      const result = await db.execute({
        sql: `DELETE FROM notifications WHERE status = 'queued' AND id IN (${placeholders})`,
        args: notificationIds,
      });
      return res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    const result = await db.execute("DELETE FROM notifications WHERE status = 'queued'");
    res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
  });
adminRouter.delete('/api/admin/notifications', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rawIds = Array.isArray(req.body?.notification_ids) ? req.body.notification_ids : [];
    const notificationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    const status = String(req.body?.status || '').trim();
    if (notificationIds.length > 0) {
      const placeholders = notificationIds.map(() => '?').join(',');
      const result = await db.execute({
        sql: `DELETE FROM notifications WHERE id IN (${placeholders})`,
        args: notificationIds,
      });
      return res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    if (status) {
      if (!['queued', 'sent', 'failed', 'website_only'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
      const result = await db.execute({ sql: 'DELETE FROM notifications WHERE status = ?', args: [status] });
      return res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    res.status(400).json({ error: 'Cần chọn thông báo hoặc trạng thái cần xoá.' });
  });
adminRouter.put('/api/admin/notifications/:id/status', requireAuth, requireAdmin, async (req: any, res: any) => {
    const status = String(req.body.status || 'queued');
    if (!['queued', 'sent', 'failed', 'website_only'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    await db.execute({
      sql: `UPDATE notifications SET status = ?, error = ?, sent_at = ${status === 'sent' ? "datetime('now', '+7 hours')" : 'NULL'} WHERE id = ?`,
      args: [status, req.body.error || null, Number(req.params.id)],
    });
    res.json({ success: true });
  });
adminRouter.post('/api/admin/notifications/final-report-reminders', requireAuth, requireAdmin, async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('final_report_close_at')")).rows);
    const rows = (await db.execute(`
      SELECT u.id, u.email, u.personal_email, u.name, u.student_id
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      WHERE fr.id IS NULL OR fr.status = 'needs_revision'
      ORDER BY u.student_id ASC
    `)).rows as any[];
    for (const row of rows) {
      await createNotification({
        user_id: Number(row.id),
        recipient_email: row.personal_email || row.email,
        type: 'final_report_due_reminder',
        subject: 'Nhắc nộp báo cáo',
        body: `Bạn cần nộp báo cáo${settings.final_report_close_at ? ` trước ${settings.final_report_close_at} (GMT+7)` : ''}. File PDF tối đa 10 MB.`,
      });
    }
    res.json({ success: true, count: rows.length });
  });
adminRouter.post('/api/admin/notifications/final-confirmation-open', requireAuth, requireAdmin, async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('confirmation_open_at', 'confirmation_close_at')")).rows);
    const rows = (await db.execute(`
      SELECT DISTINCT u.id, u.email, u.personal_email, u.name, u.student_id
      FROM registrations r
      JOIN users u ON u.id = r.user_id
      WHERE NOT EXISTS (SELECT 1 FROM final_internships f WHERE f.user_id = u.id)
      ORDER BY u.student_id ASC
    `)).rows as any[];
    for (const row of rows) {
      await createNotification({
        user_id: Number(row.id),
        recipient_email: row.personal_email || row.email,
        type: 'final_confirmation_open',
        subject: 'Mở xác nhận nơi thực tập chính thức',
        body: `Khoa đã mở giai đoạn xác nhận nơi thực tập chính thức${settings.confirmation_close_at ? ` đến ${settings.confirmation_close_at} (GMT+7)` : ''}. Vui lòng đăng nhập hệ thống để xác nhận một nơi thực tập đã trúng tuyển hoặc đăng ký thực tập tại trường nếu không trúng tuyển doanh nghiệp nào.`,
      });
    }
    res.json({ success: true, count: rows.length });
  });
adminRouter.post('/api/admin/notifications/manual', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const target = String(req.body.target || '').trim();
      const recipientInput = String(req.body.recipient || req.body.recipient_email || '').trim();
      const deliveryMode = String(req.body.delivery_mode || 'website_and_email').trim();
      const subject = String(req.body.subject || '').trim();
      const body = String(req.body.body || '').trim();
      if (!subject) return res.status(400).json({ error: 'Tiêu đề không được để trống.' });
      if (!body) return res.status(400).json({ error: 'Nội dung không được để trống.' });
      if (!['website_and_email', 'website_only'].includes(deliveryMode)) return res.status(400).json({ error: 'Kiểu gửi thông báo không hợp lệ.' });

      const notificationIds: number[] = [];
      const persistManualNotification = async (data: NotificationInput) => {
        const notification = await insertNotification(data);
        if (notification) notificationIds.push(notification.id);
      };
      const manualDeliveryResult = async () => {
        if (deliveryMode === 'website_only') {
          return { created: notificationIds.length, sent: 0, queued: 0, failed: 0 };
        }
        const delivery = await sendQueuedNotificationBatch({
          requestedLimit: notificationIds.length,
          notificationIds,
          ignoreBatchSize: true,
        });
        return {
          created: notificationIds.length,
          sent: delivery.sent,
          queued: Math.max(0, notificationIds.length - delivery.sent - delivery.failed),
          failed: delivery.failed,
        };
      };

      if (target === 'system_all') {
        const result = await db.execute({
          sql: `
            INSERT INTO system_notifications (type, subject, body, target_role, active, created_by, created_at)
            VALUES ('system_announcement', ?, ?, 'all', 1, ?, datetime('now', '+7 hours'))
          `,
          args: [subject, body, req.user.id],
        });
        if (deliveryMode === 'website_only') {
          return res.json({
            success: true,
            count: 1,
            created: 1,
            sent: 0,
            queued: 0,
            failed: 0,
            id: Number(result.lastInsertRowid),
          });
        }

        const users = (await db.execute(`
          SELECT id as user_id, email, personal_email, role
          FROM users
          WHERE email IS NOT NULL AND trim(email) != ''
          ORDER BY role ASC, name ASC
        `)).rows as any[];
        for (const row of users) {
          const recipient = row.personal_email || row.email;
          if (!recipient) continue;
          await persistManualNotification({
            user_id: Number(row.user_id),
            recipient_email: recipient,
            type: row.role === 'lecturer' ? 'manual_lecturer_notice' : 'manual_student_notice',
            subject,
            body,
            status: 'queued',
          });
        }
        const delivery = await manualDeliveryResult();
        return res.json({
          success: true,
          count: delivery.created,
          ...delivery,
          system_notification_id: Number(result.lastInsertRowid),
        });
      }

      let rows: any[] = [];
      if (target === 'lecturers') {
        rows = (await db.execute(`
          SELECT NULL as user_id, email, name, NULL as student_id
          FROM lecturers
          WHERE email IS NOT NULL AND trim(email) != ''
          ORDER BY name ASC
        `)).rows as any[];
      } else if (target === 'students_approved' || target === 'students_rejected' || target === 'students_pending') {
        const status = target.replace('students_', '');
        rows = (await db.execute({
          sql: `
            SELECT DISTINCT u.id as user_id, u.email, u.personal_email, u.name, u.student_id
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            WHERE r.status = ?
            ORDER BY u.student_id ASC
          `,
          args: [status],
        })).rows as any[];
      } else if (target === 'students_with_registration') {
        rows = (await db.execute(`
          SELECT DISTINCT u.id as user_id, u.email, u.personal_email, u.name, u.student_id
          FROM registrations r
          JOIN users u ON u.id = r.user_id
          ORDER BY u.student_id ASC
        `)).rows as any[];
      } else if (target === 'all_students') {
        rows = (await db.execute(`
          SELECT id as user_id, email, personal_email, name, student_id
          FROM users
          WHERE role = 'student'
          ORDER BY student_id ASC
        `)).rows as any[];
      } else if (target === 'single_account') {
        if (!recipientInput) return res.status(400).json({ error: 'Vui lòng nhập email hoặc mã sinh viên/giảng viên.' });
        const userRows = (await db.execute({
          sql: `
            SELECT id as user_id, email, personal_email, name, student_id, role
            FROM users
            WHERE lower(email) = lower(?)
               OR lower(coalesce(personal_email, '')) = lower(?)
               OR student_id = ?
            LIMIT 1
          `,
          args: [recipientInput, recipientInput, recipientInput],
        })).rows as any[];
        if (userRows.length) {
          rows = userRows;
        } else {
          const lecturerRows = (await db.execute({
            sql: `
              SELECT NULL as user_id, email, name, NULL as student_id, 'lecturer' as role
              FROM lecturers
              WHERE lower(email) = lower(?)
              LIMIT 1
            `,
            args: [recipientInput],
          })).rows as any[];
          if (lecturerRows.length) {
            rows = lecturerRows;
          } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientInput)) {
            rows = [{ user_id: null, email: recipientInput, personal_email: '', name: recipientInput, student_id: null, role: 'external' }];
          } else {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản theo email hoặc mã đã nhập.' });
          }
        }
      } else {
        return res.status(400).json({ error: 'Nhóm nhận thông báo không hợp lệ.' });
      }

      for (const row of rows) {
        const recipient = row.personal_email || row.email;
        if (!recipient) continue;
        await persistManualNotification({
          user_id: row.user_id ? Number(row.user_id) : null,
          recipient_email: recipient,
          type: target === 'lecturers' || row.role === 'lecturer' ? 'manual_lecturer_notice' : target === 'single_account' ? 'manual_direct_notice' : 'manual_student_notice',
          subject,
          body,
          status: deliveryMode === 'website_only' ? 'website_only' : 'queued',
        });
      }
      const delivery = await manualDeliveryResult();
      res.json({ success: true, count: delivery.created, ...delivery });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 7. Admin: Export CSV
adminRouter.get('/api/admin/export.csv', requireAuth, requireAdmin, async (req, res) => {
    const data = (await db.execute(`
      SELECT 
        u.student_id as "Mã SV",
        u.name as "Họ và tên",
        u.dob as "Ngày sinh",
        u.class_name as "Lớp KH",
        CASE
          WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
          ELSE COALESCE(u.course_code, '')
        END as "Mã môn học",
        CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || coalesce(r.other_company_name, '') ELSE c.name END as "Nơi thực tập",
        CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_role, '') ELSE 'Thực tập sinh' END as "Vị trí",
        CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_contact, '') ELSE c.contact_email END as "Liên hệ",
        CASE WHEN c.name = 'Trường Đại học Công nghệ' THEN 'GVHD: ' || coalesce(r.other_company_contact, '') || CASE WHEN coalesce(r.note, '') != '' THEN ' - ' || r.note ELSE '' END ELSE r.note END as "Ghi chú",
        r.review_comment as "Nhận xét duyệt",
        r.status as "Trạng thái",
        r.created_at as "Thời gian đăng ký"
      FROM registrations r
      JOIN users u ON r.user_id = u.id
      JOIN companies c ON r.company_id = c.id
      ORDER BY r.created_at DESC
    `)).rows as any[];

    if (data.length === 0) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="thuctap_cntt_uet.csv"');
      return res.send('\uFEFF"STT","Mã SV","Họ và tên","Ngày sinh","Lớp KH","Mã môn học","Nơi thực tập","Vị trí","Liên hệ","Ghi chú","Nhận xét duyệt","Trạng thái","Thời gian đăng ký"\n');
    }

    const headers = Object.keys(data[0]);
    const csvRows = [];
    csvRows.push('"STT",' + headers.map(h => `"${h}"`).join(','));

    let stt = 1;
    for (const row of data) {
      const values = headers.map(header => {
        const val = row[header] || '';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvRows.push(`"${stt++}",` + values.join(','));
    }

    const csvStr = '\uFEFF' + csvRows.join('\n'); // BOM for Excel UTF-8 UTF16
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="thuctap_cntt_uet_2026.csv"');
    res.send(csvStr);
  });


  // 7a. Admin: Save to Google Sheets
adminRouter.post('/api/admin/export-to-sheet', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const result = await exportRegistrationsToGoogleSheets();
      res.json({ success: true, message: 'Đã lưu dữ liệu vào Google Sheets thành công!', ...result });
    } catch (error: any) {
      console.error(error);
      res.status(error.status || 500).json({ error: 'Lỗi khi lưu vào Google Sheets: ' + error.message });
    }
  });
adminRouter.put('/api/admin/registrations/approve-all', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const reviewComment = String(req.body?.review_comment || '').trim();
      const pending = (await db.execute(`
        SELECT r.id, u.id as user_id, u.email, u.personal_email, c.name as company_name, r.other_company_name
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        JOIN companies c ON c.id = r.company_id
        WHERE r.status = 'pending'
      `)).rows as any[];
      await db.execute({
        sql: "UPDATE registrations SET status = 'approved', review_comment = ? WHERE status = 'pending'",
        args: [reviewComment || null],
      });
      for (const row of pending) {
        await addApprovedCompanyFromRegistration(row);
        await createNotification({
          user_id: Number(row.user_id),
          recipient_email: row.personal_email || row.email,
          type: 'registration_status_changed',
          subject: 'Đăng ký thực tập đã được duyệt',
          body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
          send_now: true,
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 8. Admin: Update registration status
adminRouter.put('/api/admin/registrations/:id/status', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const { status } = req.body;
    const reviewComment = String(req.body?.review_comment || '').trim();

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    try {
      const row = (await db.execute({
        sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [id],
      })).rows[0] as any;
      await db.execute({ sql: 'UPDATE registrations SET status = ?, review_comment = ? WHERE id = ?', args: [status, reviewComment || null, id] });
      if (row && status === 'approved') {
        await addApprovedCompanyFromRegistration(row);
        const autoApproved = await approveMatchingOtherCompanyRegistrations(row, reviewComment);
        for (const item of autoApproved) {
          await createNotification({
            user_id: Number(item.user_id),
            recipient_email: item.personal_email || item.email,
            type: 'registration_status_changed',
            subject: 'Đăng ký thực tập đã được duyệt',
            body: `Đăng ký thực tập tại ${item.other_company_name || 'Công ty tự liên hệ'} đã được tự động duyệt vì công ty này đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
            send_now: true,
          });
        }
      }
      if (row && row.status !== status) {
        await createNotification({
          user_id: Number(row.user_id),
          recipient_email: row.personal_email || row.email,
          type: 'registration_status_changed',
          subject: `Đăng ký thực tập ${status === 'approved' ? 'đã được duyệt' : status === 'rejected' ? 'đã bị từ chối' : 'đang chờ duyệt'}`,
          body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} hiện có trạng thái: ${status === 'approved' ? 'Đã duyệt' : status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
          send_now: true,
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.put('/api/admin/registrations/:id/comment', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const reviewComment = String(req.body?.review_comment || '').trim();
    if (!reviewComment) return res.status(400).json({ error: 'Nội dung nhận xét không được để trống.' });

    try {
      const row = (await db.execute({
        sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [id],
      })).rows[0] as any;
      if (!row) return res.status(404).json({ error: 'Không tìm thấy đăng ký.' });

      await db.execute({
        sql: 'UPDATE registrations SET review_comment = ? WHERE id = ?',
        args: [reviewComment, id],
      });
      await createNotification({
        user_id: Number(row.user_id),
        recipient_email: row.personal_email || row.email,
        type: 'registration_review_comment',
        subject: 'Khoa gửi nhận xét về đăng ký thực tập',
        body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} có nhận xét từ Khoa:\n${reviewComment}`,
        send_now: true,
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.put('/api/admin/registrations/comments', requireAuth, requireAdmin, async (req: any, res: any) => {
    const reviewComment = String(req.body?.review_comment || '').trim();
    const rawIds = Array.isArray(req.body?.registration_ids) ? req.body.registration_ids : [];
    const registrationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (!reviewComment) return res.status(400).json({ error: 'Nội dung nhận xét không được để trống.' });
    if (registrationIds.length === 0) return res.status(400).json({ error: 'Danh sách đăng ký cần gửi nhận xét đang trống.' });

    try {
      const placeholders = registrationIds.map(() => '?').join(',');
      const rows = (await db.execute({
        sql: `
          SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
          FROM registrations r
          JOIN users u ON u.id = r.user_id
          JOIN companies c ON c.id = r.company_id
          WHERE r.id IN (${placeholders})
        `,
        args: registrationIds,
      })).rows as any[];
      await db.execute({
        sql: `UPDATE registrations SET review_comment = ? WHERE id IN (${placeholders})`,
        args: [reviewComment, ...registrationIds],
      });
      for (const row of rows) {
        await createNotification({
          user_id: Number(row.user_id),
          recipient_email: row.personal_email || row.email,
          type: 'registration_review_comment',
          subject: 'Khoa gửi nhận xét về đăng ký thực tập',
          body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} có nhận xét từ Khoa:\n${reviewComment}`,
          send_now: true,
        });
      }
      res.json({ success: true, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.get('/api/settings/campaign', async (req: any, res: any) => {
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
adminRouter.put('/api/settings/campaign', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { year, start, end, classes_list, allowed_registration_cohorts, registration_open_at, registration_close_at, confirmation_open_at, confirmation_close_at, final_report_open_at, final_report_close_at, grading_open_at, grading_close_at, advisor_request_open_at, advisor_request_close_at, advisor_quota_pgs, advisor_quota_ts, advisor_quota_ths } = req.body;
      const currentAdvisorCloseAt = (((await db.execute("SELECT value FROM settings WHERE key = 'advisor_request_close_at'")).rows as any[])[0]?.value || '').toString();
      const statements: any[] = [
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_year', ?)", args: [year || null] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_start', ?)", args: [start || null] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_end', ?)", args: [end || null] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_open_at', ?)", args: [registration_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_close_at', ?)", args: [registration_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('confirmation_open_at', ?)", args: [confirmation_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('confirmation_close_at', ?)", args: [confirmation_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('final_report_open_at', ?)", args: [final_report_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('final_report_close_at', ?)", args: [final_report_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('grading_open_at', ?)", args: [grading_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('grading_close_at', ?)", args: [grading_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_request_open_at', ?)", args: [advisor_request_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_request_close_at', ?)", args: [advisor_request_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('allowed_registration_cohorts', ?)", args: [Array.isArray(allowed_registration_cohorts) ? allowed_registration_cohorts.join(',') : String(allowed_registration_cohorts || '')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_quota_pgs', ?)", args: [String(advisor_quota_pgs || '5')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_quota_ts', ?)", args: [String(advisor_quota_ts || '8')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_quota_ths', ?)", args: [String(advisor_quota_ths || '10')] }
      ];
      if (currentAdvisorCloseAt !== String(advisor_request_close_at || '')) {
        statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_auto_assigned_at', '')", args: [] });
      }
      if (classes_list) {
        statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('classes_list', ?)", args: [classes_list] });
      }
      await executeBatch(statements);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[settings] failed to update campaign settings:', error);
      res.status(500).json({ error: 'Không thể lưu cài đặt hệ thống. Vui lòng thử lại sau.', detail: error?.message || String(error) });
    }
  });
adminRouter.get('/api/settings/registration-rules', requireAuth, requireAdmin, async (req: any, res: any) => {
    const setting = (await db.execute("SELECT value FROM settings WHERE key = 'registration_rules_md'")).rows[0] as unknown as { value: string };
    res.json({ registration_rules_md: setting?.value || DEFAULT_REGISTRATION_RULES });
  });
adminRouter.put('/api/settings/registration-rules', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_rules_md', ?)",
      args: [String(req.body.registration_rules_md || '')],
    });
    res.json({ success: true });
  });
adminRouter.get('/api/settings/faq', requireAuth, async (req: any, res: any) => {
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
adminRouter.put('/api/settings/faq', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      await executeBatch([
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('faq_student_md', ?)", args: [String(req.body.faq_student_md || '')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('faq_lecturer_md', ?)", args: [String(req.body.faq_lecturer_md || '')] },
      ]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(503).json({ error: 'Không lưu được FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });
adminRouter.get('/api/lecturer-guide', requireAuth, async (req: any, res: any) => {
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
adminRouter.get('/api/settings/lecturer-guide', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const setting = (await db.execute("SELECT value FROM settings WHERE key = 'lecturer_guide_md'")).rows[0] as unknown as { value: string };
      res.json({ guide: setting?.value || DEFAULT_LECTURER_GUIDE });
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được cài đặt hướng dẫn sử dụng. Vui lòng thử lại sau.', detail: e.message });
    }
  });
adminRouter.put('/api/settings/lecturer-guide', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      await db.execute({
        sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('lecturer_guide_md', ?)",
        args: [String(req.body.guide || '')],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(503).json({ error: 'Không lưu được hướng dẫn sử dụng. Vui lòng thử lại sau.', detail: e.message });
    }
  });
adminRouter.get('/api/faq/questions/my', requireAuth, async (req: any, res: any) => {
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
adminRouter.post('/api/faq/questions', requireAuth, async (req: any, res: any) => {
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
adminRouter.get('/api/admin/faq/questions', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        SELECT q.*, u.name as user_name, u.email as user_email, u.student_id, a.name as answered_by_name
        FROM faq_questions q
        JOIN users u ON u.id = q.user_id
        LEFT JOIN users a ON a.id = q.answered_by
        ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END, q.created_at DESC
        LIMIT 500
      `)).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được danh sách câu hỏi FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });
adminRouter.put('/api/admin/faq/questions/:id/answer', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const answer = String(req.body.answer || '').trim();
      if (!answer) return res.status(400).json({ error: 'Vui lòng nhập câu trả lời.' });
      const existing = (await db.execute({
        sql: `
          SELECT q.*, u.email, u.personal_email
          FROM faq_questions q
          JOIN users u ON u.id = q.user_id
          WHERE q.id = ?
        `,
        args: [Number(req.params.id)],
      })).rows[0] as any;
      if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
      await db.execute({
        sql: `
          UPDATE faq_questions
          SET answer = ?, status = 'answered', answered_at = datetime('now', '+7 hours'), answered_by = ?
          WHERE id = ?
        `,
        args: [answer, req.user.id, Number(req.params.id)],
      });
      await createNotification({
        user_id: Number(existing.user_id),
        recipient_email: existing.personal_email || existing.email,
        type: 'faq_answered',
        subject: 'Câu hỏi FAQ của bạn đã được trả lời',
        body: `Câu hỏi:\n${existing.question}\n\nTrả lời:\n${answer}`,
        status: 'website_only',
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(503).json({ error: 'Không lưu được câu trả lời FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });
adminRouter.get('/api/settings/plan', requireAuth, requireAdmin, async (req: any, res: any) => {
    const planSetting = (await db.execute("SELECT value FROM settings WHERE key = 'implementation_plan_md'")).rows[0] as unknown as { value: string };
    res.json({ plan: planSetting ? planSetting.value : '' });
  });
adminRouter.put('/api/settings/plan', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('implementation_plan_md', ?)",
      args: [String(req.body.plan || '')],
    });
    res.json({ success: true });
  });

  // 9. Admin: Settings
adminRouter.get('/api/settings/google-sheet', requireAuth, requireAdmin, async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('google_sheet_url', 'export_google_sheet_url', 'implementation_plan_md')
    `)).rows);
    res.json({
      url: settings.google_sheet_url || '',
      export_url: settings.export_google_sheet_url || '',
      plan: settings.implementation_plan_md || ''
    });
  });
adminRouter.put('/api/settings/google-sheet', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { url, export_url, plan } = req.body;
    const statements: any[] = [];
    if (url !== undefined) {
      statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)", args: [url] });
    }
    if (export_url !== undefined) {
      statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('export_google_sheet_url', ?)", args: [export_url] });
    }
    if (plan !== undefined) {
      statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('implementation_plan_md', ?)", args: [plan] });
    }
    if (statements.length > 0) {
      await executeBatch(statements);
    }
    res.json({ success: true });
  });
adminRouter.post('/api/admin/admins', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { email } = req.body;
    if (!email || (!email.endsWith('@vnu.edu.vn') && email !== process.env.ADMIN_EMAIL)) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ email @vnu.edu.vn' });
    }
    try {
      // Check if this email exists in the lecturers table
      const lecturerRecord = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE email = ?', args: [email] })).rows[0] as any;
      const nameFromLecturer = lecturerRecord?.name || null;
      const isLecturer = !!lecturerRecord;

      await db.execute({
        sql: `
          INSERT INTO users (email, name, role, is_lecturer)
          VALUES (?, ?, 'admin', ?)
          ON CONFLICT(email) DO UPDATE SET
            role = 'admin',
            name = CASE WHEN ? IS NOT NULL THEN ? ELSE name END,
            is_lecturer = CASE WHEN ? = 1 THEN 1 ELSE is_lecturer END
        `,
        args: [email, nameFromLecturer || 'Admin', isLecturer ? 1 : 0, nameFromLecturer, nameFromLecturer, isLecturer ? 1 : 0]
      });
      await syncLecturerUsers();
      res.json({
        success: true,
        isLecturer,
        message: isLecturer
          ? `Đã thêm admin. Email này tồn tại trong danh sách Giảng viên nên đã tự động bật "Là Giảng viên" và dùng tên "${nameFromLecturer}".`
          : 'Đã thêm admin thành công.'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
adminRouter.delete('/api/admin/admins/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Không thể tự hủy quyền của chính mình' });
    }
    try {
      await db.execute({ sql: "UPDATE users SET role = 'student', is_lecturer = 0 WHERE id = ?", args: [id] });
      await syncLecturerUsers();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 10. Admin: Import companies from Google Sheet
adminRouter.post('/api/settings/import-companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const setting = (await db.execute("SELECT value FROM settings WHERE key = 'google_sheet_url'")).rows[0] as unknown as { value: string };
      if (!setting || !setting.value) {
        return res.status(400).json({ error: 'Spreadsheet URL not set' });
      }

      let fetchUrl = setting.value;
      if (!fetchUrl.includes('export?format=csv')) {
        if (fetchUrl.includes('edit?usp=sharing')) {
          fetchUrl = fetchUrl.replace('edit?usp=sharing', 'export?format=csv');
        } else if (fetchUrl.includes('edit')) {
          fetchUrl = fetchUrl.split('edit')[0] + 'export?format=csv';
        }
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch from Google Sheets');
      }

      const csvData = await response.text();
      const records = parse(csvData, {
        columns: true,
        skip_empty_lines: true
      });

      if (records.length === 0) {
        return res.status(400).json({ error: 'No records found in CSV' });
      }

      // Clear companies and optionally registrations
      const { keepRegistrations } = req.body || {};

      // If NOT keeping registrations, clear everything (old behavior)
      if (!keepRegistrations) {
        await db.executeMultiple('DELETE FROM final_internships');
        await db.executeMultiple('DELETE FROM registrations');
        await db.executeMultiple('DELETE FROM companies');
      }

      const statements = records
        .map((record: any) => {
          if (!record["Timestamp"]) return null;

          const name = record["Tên doanh nghiệp"]?.trim();
          if (!name) return null;

          const slotsStr = record["Số lượng sinh viên cần tuyển  "]?.trim() || record["Số lượng sinh viên cần tuyển"]?.trim() || "0";
          const slots = parseInt(slotsStr) || 5;
          let contactEmail = record["Email liên hệ"]?.trim() || record["Email Address"]?.trim() || '';
          const contactName = record["Họ và tên người liên hệ phụ trách thực tập"]?.trim() || '';
          let phone = record["Điện thoại liên hệ"]?.trim() || '';
          const address = record["Địa chỉ nơi thực tập"]?.trim() || '';
          const infoLink = record["Thông tin vị trí tuyển thực tập"]?.trim() || '';

          // Clean up email/phone if they are combined in the email field
          if (contactEmail && !phone) {
            const parts = contactEmail.split(/[\/,;\s]+/);
            const emails: string[] = [];
            const phones: string[] = [];
            for (const p of parts) {
              if (p.includes('@')) emails.push(p);
              else if (p.match(/[\d]{8,}/)) phones.push(p);
            }
            if (emails.length > 0) contactEmail = emails.join(', ');
            if (phones.length > 0) phone = phones.join(', ');
          }

          const qualifications = '';
          const description = 'Chưa rõ';
          const history = `Công ty ${name} tuyển dụng thực tập sinh.`;

          return {
            sql: `
              INSERT INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                slots = excluded.slots,
                contact_email = excluded.contact_email,
                history = excluded.history,
                qualifications = excluded.qualifications,
                address = excluded.address,
                recruitment_link = excluded.recruitment_link,
                phone = excluded.phone,
                contact_name = excluded.contact_name
            `,
            args: [name, description, slots, contactEmail, history, qualifications, address, infoLink, phone, contactName]
          };
        })
        .filter(Boolean);

      if (statements.length > 0) {
        await executeBatch(statements);
      }

      await ensureSpecialCompanies();

      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
