import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middlewares/auth';
import { rowsToSettings, isWithinLocalWindow, normalizeScore, calculateFinalScore } from '../services/helpers';
import { streamReportObject } from '../services/storage';
import { createNotification } from '../services/notifications';

export const lecturerRouter = Router();

async function canAccessStudentReport(actor: any, userId: number) {
  if (actor.role === 'admin') return true;
  if (actor.role === 'student' && Number(actor.id) === Number(userId)) return true;
  if (actor.role !== 'lecturer') return false;
  const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [actor.email, actor.name] })).rows[0] as any;
  if (!lecturer) return false;
  const assignment = (await db.execute({
    sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
    args: [userId, Number(lecturer.id)],
  })).rows[0];
  return !!assignment;
}

async function getPrimaryLecturerForUser(actor: any, userId: number) {
  const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [actor.email, actor.name] })).rows[0] as any;
  if (actor.role === 'admin') {
    return lecturer ? Number(lecturer.id) : 1;
  }
  if (!lecturer) return null;
  const assignment = (await db.execute({
    sql: "SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1",
    args: [userId, Number(lecturer.id)],
  })).rows[0];
  return assignment ? Number(lecturer.id) : null;
}

async function saveGradeForStudent(userId: number, lecturerId: number, body: any, submit = false, actorRole = 'lecturer') {
  const existing = (await db.execute({ sql: 'SELECT * FROM grades WHERE user_id = ?', args: [userId] })).rows[0] as any;
  if (existing?.locked_at) return { error: 'Điểm đã bị khóa. Vui lòng liên hệ Khoa nếu cần sửa.', status: 400 };
  if (actorRole !== 'admin') {
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('grading_open_at', 'grading_close_at')")).rows);
    const windowStatus = isWithinLocalWindow(settings, 'grading_open_at', 'grading_close_at');
    if (!windowStatus.ok) {
      return {
        error: windowStatus.error === 'Chưa đến thời gian cho phép.'
          ? 'Chưa đến thời gian nhập điểm học phần.'
          : 'Đã hết thời hạn nhập điểm học phần. Vui lòng liên hệ Khoa nếu cần hỗ trợ.',
        status: 403,
      };
    }
  }
  const progressScore = normalizeScore(body.progress_score);
  const reportScore = normalizeScore(body.report_score);
  const companyScore = normalizeScore(body.company_score);
  if (progressScore === undefined || reportScore === undefined || companyScore === undefined) {
    return { error: 'Điểm phải nằm trong khoảng 0 đến 10.', status: 400 };
  }
  if (submit && (progressScore === null || reportScore === null || companyScore === null)) {
    return { error: 'Cần nhập đủ 3 đầu điểm trước khi nộp.', status: 400 };
  }
  const finalScore = calculateFinalScore(progressScore, reportScore, companyScore);
  const status = submit ? 'submitted' : 'draft';
  await db.execute({
    sql: `INSERT INTO grades (user_id, lecturer_id, progress_score, report_score, company_score, final_score, status, comment, submitted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${submit ? "datetime('now', '+7 hours')" : 'NULL'}, datetime('now', '+7 hours'))
          ON CONFLICT(user_id) DO UPDATE SET
            lecturer_id = excluded.lecturer_id,
            progress_score = excluded.progress_score,
            report_score = excluded.report_score,
            company_score = excluded.company_score,
            final_score = excluded.final_score,
            status = excluded.status,
            comment = excluded.comment,
            submitted_at = ${submit ? "datetime('now', '+7 hours')" : 'grades.submitted_at'},
            updated_at = datetime('now', '+7 hours')`,
    args: [userId, lecturerId, progressScore, reportScore, companyScore, finalScore, status, body.comment || null],
  });
  if (submit) {
    await db.execute({
      sql: `UPDATE final_reports 
            SET status = 'accepted', updated_at = datetime('now', '+7 hours') 
            WHERE user_id = ? AND (status IS NULL OR status != 'accepted')`,
      args: [userId],
    });
  }
  return { row: (await db.execute({ sql: 'SELECT * FROM grades WHERE user_id = ?', args: [userId] })).rows[0] };
}

// Lecturer: Students list
lecturerRouter.get('/api/lecturer/students', requireAuth, async (req: any, res: any) => {
  if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
  if (!lecturer) return res.json([]);
  const rows = (await db.execute({
    sql: `SELECT aa.id as assignment_id, aa.user_id, aa.lecturer_id, aa.role as advisor_role, aa.assigned_at, aa.note as assignment_note,
                 aa.contacted_at, aa.contact_note,
                 u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
                 COALESCE(f.internship_type, CASE WHEN sr.school_place IS NOT NULL THEN 'school' ELSE NULL END) as internship_type,
                 f.confirmed_at,
                 CASE
                   WHEN c.name = 'Công ty khác' THEN r.other_company_name
                   WHEN c.name IS NOT NULL THEN c.name
                   ELSE sr.school_place
                 END as internship_place,
                 COALESCE(r.other_company_role, sr.school_co_lecturer) as other_company_role,
                 COALESCE(r.other_company_contact, sr.school_lecturer) as other_company_contact,
                 fr.status as report_status, fr.original_filename as report_filename, fr.file_size as report_file_size, fr.submitted_at as report_submitted_at,
                 g.status as grade_status, g.final_score, g.progress_score, g.report_score, g.company_score, g.comment as grade_comment, g.locked_at as grade_locked_at
          FROM advisor_assignments aa
          JOIN users u ON u.id = aa.user_id
          LEFT JOIN final_internships f ON f.user_id = aa.user_id
          LEFT JOIN companies c ON c.id = f.company_id
          LEFT JOIN registrations r ON r.id = f.registration_id
          LEFT JOIN (
            SELECT r.user_id,
                   'Trường Đại học Công nghệ' as school_place,
                   MAX(r.other_company_contact) as school_lecturer,
                   MAX(r.other_company_role) as school_co_lecturer
            FROM registrations r
            JOIN companies c2 ON c2.id = r.company_id
            WHERE r.status != 'rejected'
              AND c2.name = 'Trường Đại học Công nghệ'
            GROUP BY r.user_id
          ) sr ON sr.user_id = aa.user_id
          LEFT JOIN final_reports fr ON fr.user_id = aa.user_id
          LEFT JOIN grades g ON g.user_id = aa.user_id
          WHERE aa.lecturer_id = ?
          ORDER BY u.student_id ASC`,
    args: [Number(lecturer.id)],
  })).rows;
  res.json(rows);
});

lecturerRouter.put('/api/lecturer/students/:assignmentId/contact', requireAuth, async (req: any, res: any) => {
  if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) return res.status(400).json({ error: 'Phân công không hợp lệ.' });
  const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
  if (!lecturer) return res.status(403).json({ error: 'Không tìm thấy tài khoản giảng viên.' });
  const assignment = (await db.execute({
    sql: 'SELECT * FROM advisor_assignments WHERE id = ? AND lecturer_id = ?',
    args: [assignmentId, Number(lecturer.id)],
  })).rows[0] as any;
  if (!assignment) return res.status(404).json({ error: 'Không tìm thấy sinh viên trong danh sách phụ trách.' });

  const contacted = !!req.body?.contacted;
  const contactNote = String(req.body?.contact_note || '').trim();
  await db.execute({
    sql: `UPDATE advisor_assignments
          SET contacted_at = ${contacted ? "COALESCE(contacted_at, datetime('now', '+7 hours'))" : 'NULL'},
              contact_note = ?
          WHERE id = ?`,
    args: [contactNote || null, assignmentId],
  });
  const updated = (await db.execute({
    sql: 'SELECT id as assignment_id, contacted_at, contact_note FROM advisor_assignments WHERE id = ?',
    args: [assignmentId],
  })).rows[0];
  res.json(updated);
});

// Reports view & download
lecturerRouter.get('/api/reports/final/:userId/download', requireAuth, async (req: any, res: any) => {
  const userId = Number(req.params.userId);
  if (!(await canAccessStudentReport(req.user, userId))) return res.status(403).json({ error: 'Forbidden' });
  const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [userId] })).rows[0] as any;
  if (!report) return res.status(404).json({ error: 'Chưa có báo cáo.' });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(report.original_filename)}"`);
  try {
    const streamed = await streamReportObject(report.object_key, res);
    if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file báo cáo.' });
  } catch (e: any) {
    if (!res.headersSent) return res.status(500).json({ error: 'Không tải được file báo cáo: ' + e.message });
    res.destroy(e);
  }
});

lecturerRouter.get('/api/reports/final/:userId/view', requireAuth, async (req: any, res: any) => {
  const userId = Number(req.params.userId);
  if (!(await canAccessStudentReport(req.user, userId))) return res.status(403).json({ error: 'Forbidden' });
  const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [userId] })).rows[0] as any;
  if (!report) return res.status(404).json({ error: 'Chưa có báo cáo.' });
  const etag = `"${report.id}-${report.file_size}-${new Date(report.submitted_at || report.updated_at || Date.now()).getTime()}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');

  if (req.header('if-none-match') === etag) {
    return res.status(304).end();
  }

  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(report.original_filename)}"`);
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  try {
    const streamed = await streamReportObject(report.object_key, res);
    if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file báo cáo.' });
  } catch (e: any) {
    if (!res.headersSent) return res.status(500).json({ error: 'Không tải được file báo cáo: ' + e.message });
    res.destroy(e);
  }
});

lecturerRouter.put('/api/reports/final/:userId/status', requireAuth, async (req: any, res: any) => {
  const userId = Number(req.params.userId);
  if (req.user.role !== 'admin' && req.user.role !== 'lecturer') return res.status(403).json({ error: 'Forbidden' });
  if (!(await canAccessStudentReport(req.user, userId))) return res.status(403).json({ error: 'Forbidden' });
  const status = String(req.body.status || '');
  if (!['submitted', 'accepted', 'needs_revision'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
  await db.execute({
    sql: `UPDATE final_reports SET status = ?, lecturer_comment = ?, updated_at = datetime('now', '+7 hours') WHERE user_id = ?`,
    args: [status, req.body.lecturer_comment || null, userId],
  });
  const student = (await db.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
  await createNotification({
    user_id: userId,
    recipient_email: student?.personal_email || student?.email,
    type: 'final_report_status_changed',
    subject: 'Cập nhật trạng thái báo cáo',
    body: `Báo cáo của bạn đã được cập nhật trạng thái: ${status === 'accepted' ? 'Đã chấp nhận' : status === 'needs_revision' ? 'Cần nộp lại' : 'Đã nộp'}.${req.body.lecturer_comment ? `\nGhi chú: ${req.body.lecturer_comment}` : ''}`,
  });
  res.json({ success: true });
});

// Grades
lecturerRouter.get('/api/lecturer/grades', requireAuth, async (req: any, res: any) => {
  if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
  if (!lecturer) return res.json([]);
  const rows = (await db.execute({
    sql: `SELECT aa.user_id, aa.role as advisor_role, u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
                 CASE
                   WHEN c.name = 'Công ty khác' THEN r.other_company_name
                   WHEN c.name IS NOT NULL THEN c.name
                   ELSE sr.school_place
                 END as internship_place,
                 fr.status as report_status, fr.original_filename, fr.file_size, fr.submitted_at as report_submitted_at,
                 g.progress_score, g.report_score, g.company_score, g.final_score, g.status as grade_status,
                 g.comment, g.submitted_at as grade_submitted_at, g.locked_at
          FROM advisor_assignments aa
          JOIN users u ON u.id = aa.user_id
          LEFT JOIN final_internships f ON f.user_id = aa.user_id
          LEFT JOIN companies c ON c.id = f.company_id
          LEFT JOIN registrations r ON r.id = f.registration_id
          LEFT JOIN (
            SELECT r.user_id,
                   'Trường Đại học Công nghệ' as school_place
            FROM registrations r
            JOIN companies c2 ON c2.id = r.company_id
            WHERE r.status != 'rejected'
              AND c2.name = 'Trường Đại học Công nghệ'
            GROUP BY r.user_id
          ) sr ON sr.user_id = aa.user_id
          LEFT JOIN final_reports fr ON fr.user_id = aa.user_id
          LEFT JOIN grades g ON g.user_id = aa.user_id
          WHERE aa.lecturer_id = ?
          ORDER BY u.student_id ASC`,
    args: [Number(lecturer.id)],
  })).rows;
  res.json(rows);
});

lecturerRouter.get('/api/lecturer/grades/:userId', requireAuth, async (req: any, res: any) => {
  if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const userId = Number(req.params.userId);
  const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
  if (!lecturer && req.user.role !== 'admin') return res.json(null);
  const row = (await db.execute({
    sql: `SELECT g.* FROM grades g
          JOIN advisor_assignments aa ON aa.user_id = g.user_id
          WHERE g.user_id = ? AND (aa.lecturer_id = ? OR ? = 'admin')
          LIMIT 1`,
    args: [userId, lecturer ? Number(lecturer.id) : 0, req.user.role],
  })).rows[0] || null;
  res.json(row);
});

lecturerRouter.put('/api/lecturer/grades/:userId', requireAuth, async (req: any, res: any) => {
  if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const userId = Number(req.params.userId);
  let lecturerId = await getPrimaryLecturerForUser(req.user, userId);
  if (req.user.role === 'admin' && req.body.lecturer_id) lecturerId = Number(req.body.lecturer_id);
  if (!lecturerId) return res.status(403).json({ error: 'Chỉ GVHD chính được nhập điểm cho sinh viên này.' });
  const result = await saveGradeForStudent(userId, lecturerId, req.body, false, req.user.role);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result.row);
});

lecturerRouter.post('/api/lecturer/grades/:userId/submit', requireAuth, async (req: any, res: any) => {
  if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const userId = Number(req.params.userId);
  let lecturerId = await getPrimaryLecturerForUser(req.user, userId);
  if (req.user.role === 'admin' && req.body.lecturer_id) lecturerId = Number(req.body.lecturer_id);
  if (!lecturerId) return res.status(403).json({ error: 'Chỉ GVHD chính được nộp điểm cho sinh viên này.' });
  const result = await saveGradeForStudent(userId, lecturerId, req.body, true, req.user.role);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  const student = (await db.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
  await createNotification({
    user_id: userId,
    recipient_email: student?.personal_email || student?.email,
    type: 'grade_submitted',
    subject: 'GVHD đã nộp điểm thực tập',
    body: `GVHD đã nộp điểm thực tập của bạn về Khoa. Điểm tổng kết tạm tính: ${result.row?.final_score ?? '-'}.`,
  });
  res.json(result.row);
});
