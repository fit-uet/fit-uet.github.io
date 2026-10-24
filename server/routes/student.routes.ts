import express, { Router } from 'express';
import { db, executeBatch } from '../db';
import { MAX_REPORT_BYTES } from '../config';
import { requireAuth, requireStudent } from '../middlewares/auth';
import {
  rowsToSettings,
  isWithinLocalWindow,
  isBachelorLecturer,
  normalizeCompanyName,
  getItCompanyNameSet,
} from '../services/helpers';
import { assertStudentCohortAllowed } from '../services/cohorts';
import {
  findLecturerByNameText,
  advisorRequestWithNames,
  advisorQuotaStatus,
  createAdvisorAssignment,
  ensureSchoolFinalInternshipFromRegistration,
} from '../services/advisorSync';
import { reportObjectKey, saveReportObject } from '../services/storage';
import { createNotification } from '../services/notifications';

export const studentRouter = Router();
const processingUsers = new Set<number>();

// 3. Get Registration (Student)
studentRouter.get('/api/registrations/my', requireAuth, requireStudent, async (req: any, res: any) => {
  const regs = (await db.execute({
    sql: `
    SELECT r.*, COALESCE(c.name, 'Không rõ/đã bị xoá') as company_name
    FROM registrations r
    LEFT JOIN companies c ON r.company_id = c.id
    WHERE r.user_id = ?
    ORDER BY COALESCE(r.preference_order, r.id) ASC, r.id ASC
  `, args: [req.user.id]
  })).rows;
  res.json(regs);
});

studentRouter.get('/api/internships/final/my', requireAuth, requireStudent, async (req: any, res: any) => {
  await ensureSchoolFinalInternshipFromRegistration(Number(req.user.id), Number(req.user.id));
  const final = (await db.execute({
    sql: `SELECT f.*, c.name as company_name, r.other_company_name, r.other_company_role, r.other_company_contact
          FROM final_internships f
          LEFT JOIN companies c ON f.company_id = c.id
          LEFT JOIN registrations r ON f.registration_id = r.id
          WHERE f.user_id = ?`,
    args: [req.user.id]
  })).rows[0] || null;
  res.json(final);
});

studentRouter.get('/api/advisor/my', requireAuth, requireStudent, async (req: any, res: any) => {
  const rows = (await db.execute({
    sql: `SELECT aa.*, l.name as lecturer_name, l.email as lecturer_email
          FROM advisor_assignments aa
          JOIN lecturers l ON l.id = aa.lecturer_id
          WHERE aa.user_id = ?
          ORDER BY CASE aa.role WHEN 'primary' THEN 0 ELSE 1 END, l.name ASC`,
    args: [req.user.id],
  })).rows;
  res.json(rows);
});

studentRouter.get('/api/advisor/request/my', requireAuth, requireStudent, async (req: any, res: any) => {
  try {
    res.json(await advisorRequestWithNames(req.user.id));
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

studentRouter.post('/api/advisor/request/my', requireAuth, requireStudent, async (req: any, res: any) => {
  try {
    const advisorWindow = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_request_open_at', 'advisor_request_close_at')")).rows as any[]);
    const windowStatus = isWithinLocalWindow(advisorWindow, 'advisor_request_open_at', 'advisor_request_close_at');
    if (!advisorWindow.advisor_request_open_at && !advisorWindow.advisor_request_close_at) {
      return res.status(403).json({ error: 'Chưa mở đợt đăng ký GVHD.' });
    }
    if (!windowStatus.ok) return res.status(403).json({ error: `Ngoài thời gian đăng ký GVHD: ${windowStatus.error}` });
    const requestType = req.body.request_type === 'agreed' ? 'agreed' : null;
    if (!requestType) return res.status(400).json({ error: 'Chỉ đăng ký GVHD khi sinh viên đã được giảng viên đồng ý hướng dẫn. Nếu chưa có GVHD, Khoa sẽ phân công sau.' });
    const lecturerFromName = req.body.lecturer_name ? await findLecturerByNameText(String(req.body.lecturer_name || '')) : null;
    const coLecturerFromName = req.body.co_lecturer_name ? await findLecturerByNameText(String(req.body.co_lecturer_name || '')) : null;
    const lecturerId = req.body.lecturer_id ? Number(req.body.lecturer_id) : lecturerFromName ? Number(lecturerFromName.id) : null;
    const coLecturerId = req.body.co_lecturer_id ? Number(req.body.co_lecturer_id) : coLecturerFromName ? Number(coLecturerFromName.id) : null;
    if (!lecturerId) return res.status(400).json({ error: 'Vui lòng chọn giảng viên hướng dẫn.' });
    const lecturer = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE id = ?', args: [lecturerId] })).rows[0] as any;
    if (!lecturer) return res.status(400).json({ error: 'Giảng viên hướng dẫn không hợp lệ.' });
    if (isBachelorLecturer(lecturer.name)) return res.status(400).json({ error: 'Giảng viên CN không được làm hướng dẫn chính.' });
    if (coLecturerId && coLecturerId === lecturerId) return res.status(400).json({ error: 'Giảng viên đồng hướng dẫn không được trùng GVHD chính.' });
    if (coLecturerId) {
      const coLecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE id = ?', args: [coLecturerId] })).rows[0];
      if (!coLecturer) return res.status(400).json({ error: 'Giảng viên đồng hướng dẫn không hợp lệ.' });
    }
    const primaryQuotaStatus = await advisorQuotaStatus(lecturerId);
    const coQuotaStatus = coLecturerId ? await advisorQuotaStatus(coLecturerId) : 'within_quota';
    const quotaStatus = primaryQuotaStatus === 'over_quota' || coQuotaStatus === 'over_quota' ? 'over_quota' : primaryQuotaStatus;
    await executeBatch([
      { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [req.user.id] },
      { sql: 'DELETE FROM advisor_assignment_history WHERE user_id = ?', args: [req.user.id] },
    ]);
    await db.execute({
      sql: `INSERT INTO advisor_requests (user_id, lecturer_id, co_lecturer_id, lecturer_name_text, co_lecturer_name_text, request_type, status, quota_status, student_note, source_registration_id, created_at, updated_at)
            VALUES (?, ?, ?, NULL, NULL, ?, 'pending', ?, ?, NULL, datetime('now', '+7 hours'), datetime('now', '+7 hours'))
            ON CONFLICT(user_id) DO UPDATE SET
              lecturer_id = excluded.lecturer_id,
              co_lecturer_id = excluded.co_lecturer_id,
              lecturer_name_text = excluded.lecturer_name_text,
              co_lecturer_name_text = excluded.co_lecturer_name_text,
              request_type = excluded.request_type,
              status = 'pending',
              quota_status = excluded.quota_status,
              student_note = excluded.student_note,
              admin_note = NULL,
              reviewed_by = NULL,
              reviewed_at = NULL,
              updated_at = datetime('now', '+7 hours')`,
      args: [req.user.id, lecturerId, coLecturerId, requestType, quotaStatus, req.body.student_note || null],
    });
    if (requestType === 'agreed' && lecturerId) {
      const primaryResult = await createAdvisorAssignment({
        user_id: req.user.id,
        lecturer_id: lecturerId,
        role: 'primary',
        note: 'Sinh viên khai báo đã được GV đồng ý hướng dẫn',
        allow_over_quota: true,
        allow_without_final: true,
        suppress_student_notification: true,
      }, req.user.id);
      if (primaryResult.error) return res.status(primaryResult.status || 400).json({ error: primaryResult.error });
      if (coLecturerId) {
        await createAdvisorAssignment({
          user_id: req.user.id,
          lecturer_id: coLecturerId,
          role: 'co',
          note: 'Sinh viên khai báo đồng hướng dẫn',
          allow_over_quota: true,
          allow_without_final: true,
          suppress_student_notification: true,
        }, req.user.id);
      }
      await db.execute({
        sql: "UPDATE advisor_requests SET status = 'approved', reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours') WHERE user_id = ?",
        args: [req.user.id],
      });
    }
    res.json({
      success: true,
      request: await advisorRequestWithNames(req.user.id),
      warning: quotaStatus === 'over_quota'
        ? 'Giảng viên đã đủ/vượt chỉ tiêu. Hệ thống vẫn chấp nhận và ghi nhận GVHD theo thông tin bạn khai báo.'
        : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

studentRouter.delete('/api/advisor/request/my', requireAuth, requireStudent, async (req: any, res: any) => {
  try {
    const advisorWindow = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_request_open_at', 'advisor_request_close_at')")).rows as any[]);
    const windowStatus = isWithinLocalWindow(advisorWindow, 'advisor_request_open_at', 'advisor_request_close_at');
    if (!advisorWindow.advisor_request_open_at && !advisorWindow.advisor_request_close_at) {
      return res.status(403).json({ error: 'Chưa mở đợt đăng ký GVHD.' });
    }
    if (!windowStatus.ok) return res.status(403).json({ error: `Ngoài thời gian đăng ký GVHD: ${windowStatus.error}` });
    await executeBatch([
      { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [req.user.id] },
      { sql: 'DELETE FROM advisor_assignment_history WHERE user_id = ?', args: [req.user.id] },
      { sql: 'DELETE FROM advisor_requests WHERE user_id = ?', args: [req.user.id] },
    ]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// Final Reports
studentRouter.get('/api/reports/final/my', requireAuth, requireStudent, async (req: any, res: any) => {
  const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [req.user.id] })).rows[0] || null;
  res.json(report);
});

studentRouter.post('/api/reports/final', requireAuth, requireStudent, express.raw({ type: 'application/pdf', limit: '11mb' }), async (req: any, res: any) => {
  try {
    const final = (await db.execute({ sql: 'SELECT id FROM final_internships WHERE user_id = ?', args: [req.user.id] })).rows[0];
    if (!final) return res.status(400).json({ error: 'Bạn cần xác nhận nơi thực tập chính thức trước khi nộp báo cáo.' });
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('campaign_year', 'final_report_open_at', 'final_report_close_at')")).rows);
    const windowStatus = isWithinLocalWindow(settings, 'final_report_open_at', 'final_report_close_at');
    if (!windowStatus.ok) return res.status(403).json({ error: windowStatus.error });
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    const filename = decodeURIComponent(String(req.header('x-filename') || 'final.pdf')).trim();
    if (!filename.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'Chỉ chấp nhận file PDF.' });
    if (file.length === 0) return res.status(400).json({ error: 'File rỗng.' });
    if (file.length > MAX_REPORT_BYTES) return res.status(413).json({ error: 'File PDF vượt quá 10 MB. Vui lòng nén lại trước khi nộp.' });
    if (file.subarray(0, 4).toString('utf8') !== '%PDF') return res.status(400).json({ error: 'Nội dung file không phải PDF hợp lệ.' });
    const key = reportObjectKey(settings.campaign_year, req.user.student_id || req.user.email);
    await saveReportObject(key, file);
    await db.execute({
      sql: `INSERT INTO final_reports (user_id, object_key, original_filename, file_size, mime_type, status, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, 'application/pdf', 'submitted', datetime('now', '+7 hours'), datetime('now', '+7 hours'))
            ON CONFLICT(user_id) DO UPDATE SET
              object_key = excluded.object_key,
              original_filename = excluded.original_filename,
              file_size = excluded.file_size,
              mime_type = excluded.mime_type,
              status = 'submitted',
              submitted_at = datetime('now', '+7 hours'),
              updated_at = datetime('now', '+7 hours'),
              lecturer_comment = NULL`,
      args: [req.user.id, key, filename, file.length],
    });
    const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [req.user.id] })).rows[0];
    await createNotification({
      user_id: req.user.id,
      recipient_email: req.user.personal_email || req.user.email,
      type: 'final_report_status_changed',
      subject: 'Hệ thống đã ghi nhận báo cáo',
      body: `Hệ thống đã ghi nhận file báo cáo: ${filename}. Dung lượng: ${Math.round(file.length / 1024)} KB.`,
    });
    res.json(report);
  } catch (e: any) {
    res.status(e?.type === 'entity.too.large' ? 413 : 500).json({ error: e?.type === 'entity.too.large' ? 'File PDF vượt quá 10 MB. Vui lòng nén lại trước khi nộp.' : e.message });
  }
});

// Student Grades - Deprecated: Chức năng xem điểm ở site sinh viên đã được loại bỏ; điểm chính thức công bố trên Cổng Đào tạo
studentRouter.get('/api/grades/my', requireAuth, requireStudent, async (_req: any, res: any) => {
  res.status(403).json({
    error: 'Chức năng xem điểm trên hệ thống này đã đóng. Điểm học phần thực tập được công bố chính thức trên Cổng Đào tạo của Trường (daotao.vnu.edu.vn).'
  });
});

// Final Internship Confirmation
studentRouter.post('/api/internships/final/confirm', requireAuth, requireStudent, async (req: any, res: any) => {
  try {
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('confirmation_open_at', 'confirmation_close_at')
    `)).rows);
    const now = new Date();
    if (settings.confirmation_open_at && now < new Date(settings.confirmation_open_at + ':00+07:00')) {
      return res.status(403).json({ error: 'Chưa đến thời gian xác nhận nơi thực tập.' });
    }
    if (settings.confirmation_close_at && now > new Date(settings.confirmation_close_at + ':00+07:00')) {
      return res.status(403).json({ error: 'Đã hết thời gian xác nhận nơi thực tập.' });
    }
    const existing = (await db.execute({ sql: 'SELECT * FROM final_internships WHERE user_id = ?', args: [req.user.id] })).rows[0] as any;
    if (existing?.locked_at) return res.status(400).json({ error: 'Nơi thực tập chính thức đã bị khóa. Vui lòng liên hệ Khoa nếu cần thay đổi.' });

    const type = req.body.internship_type === 'school' ? 'school' : 'company';
    const school = (await db.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
    if (type === 'school') {
      const requestAssignment = !!req.body.school_assignment_request;
      const lecturerName = String(req.body.school_lecturer || '').trim();
      let validLecturer: any = null;
      if (!requestAssignment) {
        if (!lecturerName) return res.status(400).json({ error: 'Vui lòng chọn giảng viên hướng dẫn hoặc để trống để Khoa phân công.' });
        validLecturer = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE name = ?', args: [lecturerName] })).rows[0] as any;
        if (!validLecturer) return res.status(400).json({ error: 'Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' });
        if (isBachelorLecturer(validLecturer.name)) return res.status(400).json({ error: 'Giảng viên CN không được làm hướng dẫn chính. Vui lòng chọn giảng viên khác hoặc để trống để Khoa phân công.' });
      }
      await db.execute({
        sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
              VALUES (?, NULL, ?, 'school', 'confirmed', 1, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))
              ON CONFLICT(user_id) DO UPDATE SET registration_id = NULL, company_id = excluded.company_id, internship_type = 'school',
                status = 'confirmed', student_attested = 1, attestation_text = excluded.attestation_text, school_lecturer = excluded.school_lecturer,
                school_assignment_request = excluded.school_assignment_request, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
        args: [
          req.user.id,
          school?.id || null,
          requestAssignment
            ? 'Tôi xác nhận chưa trúng tuyển công ty nào và để Khoa phân công giảng viên hướng dẫn thực tập tại trường.'
            : 'Tôi xác nhận đã được giảng viên đồng ý hướng dẫn thực tập tại trường.',
          requestAssignment ? null : lecturerName,
          requestAssignment ? 1 : 0,
          req.user.id,
          req.body.note || null,
        ],
      });
      let advisorWarning: string | null = null;
      if (!requestAssignment && validLecturer) {
        const quotaStatus = await advisorQuotaStatus(Number(validLecturer.id));
        await db.execute({
          sql: `INSERT INTO advisor_requests (user_id, lecturer_id, lecturer_name_text, request_type, status, quota_status, student_note, created_at, updated_at)
                VALUES (?, ?, ?, 'agreed', ?, ?, 'Sinh viên xác nhận đã được GV đồng ý hướng dẫn thực tập tại trường.', datetime('now', '+7 hours'), datetime('now', '+7 hours'))
                ON CONFLICT(user_id) DO UPDATE SET lecturer_id = excluded.lecturer_id, lecturer_name_text = excluded.lecturer_name_text,
                  request_type = 'agreed', status = excluded.status, quota_status = excluded.quota_status, student_note = excluded.student_note,
                  reviewed_at = CASE WHEN excluded.status = 'approved' THEN datetime('now', '+7 hours') ELSE NULL END,
                  updated_at = datetime('now', '+7 hours')`,
          args: [req.user.id, Number(validLecturer.id), lecturerName, 'approved', quotaStatus],
        });
        if (quotaStatus === 'over_quota') {
          advisorWarning = 'Giảng viên đã đủ/vượt chỉ tiêu. Hệ thống vẫn chấp nhận và ghi nhận GVHD theo thông tin bạn khai báo.';
        }
        await createAdvisorAssignment({
          user_id: req.user.id,
          lecturer_id: Number(validLecturer.id),
          role: 'primary',
          note: 'Sinh viên xác nhận GVHD thực tập tại trường',
          allow_over_quota: true,
          allow_without_final: true,
          suppress_student_notification: true,
        }, req.user.id);
      }
      await createNotification({
        user_id: req.user.id,
        recipient_email: req.user.personal_email || req.user.email,
        type: 'final_internship_confirmed',
        subject: 'Bạn đã xác nhận nơi thực tập chính thức',
        body: `Hệ thống đã ghi nhận nơi thực tập chính thức của bạn: Thực tập tại trường.${requestAssignment ? '\nKhoa sẽ phân công GVHD sau.' : `\nGVHD đăng ký: ${lecturerName}.`}`,
        send_now: true,
      });
      return res.json({ success: true, advisor_warning: advisorWarning });
    }

    const registrationId = Number(req.body.registration_id);
    if (!registrationId) return res.status(400).json({ error: 'Vui lòng chọn nơi thực tập cần xác nhận.' });
    if (!req.body.attested) return res.status(400).json({ error: 'Vui lòng xác nhận cam kết đã được đơn vị tiếp nhận thực tập.' });
    const reg = (await db.execute({
      sql: `SELECT r.*, c.name as company_name
            FROM registrations r JOIN companies c ON r.company_id = c.id
            WHERE r.id = ? AND r.user_id = ?`,
      args: [registrationId, req.user.id],
    })).rows[0] as any;
    if (!reg) return res.status(404).json({ error: 'Không tìm thấy đăng ký này.' });
    if (reg.status !== 'approved') return res.status(400).json({ error: 'Bạn chỉ có thể xác nhận nơi thực tập đã được Khoa duyệt.' });
    if (reg.company_name === 'Trường Đại học Công nghệ') return res.status(400).json({ error: 'Vui lòng chọn hình thức thực tập tại trường.' });
    await db.execute({
      sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_assignment_request, confirmed_by, note, confirmed_at)
            VALUES (?, ?, ?, 'company', 'confirmed', 1, ?, 0, ?, ?, datetime('now', '+7 hours'))
            ON CONFLICT(user_id) DO UPDATE SET registration_id = excluded.registration_id, company_id = excluded.company_id, internship_type = 'company',
              status = 'confirmed', student_attested = 1, attestation_text = excluded.attestation_text, school_lecturer = NULL,
              school_assignment_request = 0, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
      args: [req.user.id, registrationId, reg.company_id, 'Tôi xác nhận đã được đơn vị này tiếp nhận thực tập và chịu trách nhiệm về thông tin khai báo.', req.user.id, req.body.note || null],
    });
    await createNotification({
      user_id: req.user.id,
      recipient_email: req.user.personal_email || req.user.email,
      type: 'final_internship_confirmed',
      subject: 'Bạn đã xác nhận nơi thực tập chính thức',
      body: `Hệ thống đã ghi nhận nơi thực tập chính thức của bạn: ${reg.company_name === 'Công ty khác' ? reg.other_company_name || 'Công ty khác' : reg.company_name}.`,
      send_now: true,
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// 4. Register for companies (batch - up to 5)
studentRouter.post('/api/registrations', requireAuth, requireStudent, async (req: any, res: any) => {
  const userId = req.user.id;
  if (processingUsers.has(userId)) {
    return res.status(429).json({ error: 'Yêu cầu đăng ký đang được xử lý, vui lòng không nhấn thêm.' });
  }
  processingUsers.add(userId);
  try {
    await assertStudentCohortAllowed(req.user.email);
    const { company_ids, student_id, dob, class_name, note, other_companies, course_code, school_lecturer, school_co_lecturer, phone, personal_email } = req.body;
    const advisorRequestPayload = req.body.advisor_request && typeof req.body.advisor_request === 'object' ? req.body.advisor_request : null;
    const rawAdvisorRequestType = advisorRequestPayload ? String(advisorRequestPayload.request_type || '') : '';
    if (advisorRequestPayload && rawAdvisorRequestType !== 'agreed') {
      return res.status(400).json({ error: 'Chỉ đăng ký GVHD khi sinh viên đã được giảng viên đồng ý hướng dẫn. Nếu chưa có GVHD, Khoa sẽ phân công sau.' });
    }
    const advisorRequestType = advisorRequestPayload && rawAdvisorRequestType === 'agreed'
      ? 'agreed'
      : 'faculty_assign';
    const advisorLecturerName = String(advisorRequestPayload?.lecturer_name || '').trim();
    const advisorCoLecturerName = String(advisorRequestPayload?.co_lecturer_name || '').trim();
    const schoolLecturerName = String(school_lecturer || advisorLecturerName || '').trim();
    const schoolCoLecturerName = String(school_co_lecturer || advisorCoLecturerName || '').trim();
    let advisorLecturer: any = null;
    let advisorCoLecturer: any = null;
    let advisorQuota = 'unknown';
    const profile = {
      student_id: student_id || req.user.student_id || null,
      dob: dob || req.user.dob || null,
      class_name: class_name || req.user.class_name || null,
      course_code: course_code || req.user.course_code || null,
      phone: phone || req.user.phone || null,
      personal_email: personal_email || req.user.personal_email || null
    };

    // Check registration time window (GMT+7)
    const registrationWindow = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('registration_open_at', 'registration_close_at')
    `)).rows);
    const openAt = registrationWindow.registration_open_at;
    const closeAt = registrationWindow.registration_close_at;
    if (openAt || closeAt) {
      const toUTC = (localStr: string) => {
        if (!localStr) return null;
        const d = new Date(localStr + ':00+07:00');
        return isNaN(d.getTime()) ? null : d;
      };
      const nowUTC = new Date();
      const openUTC = openAt ? toUTC(openAt) : null;
      const closeUTC = closeAt ? toUTC(closeAt) : null;
      if (openUTC && nowUTC < openUTC) {
        return res.status(403).json({ error: `Chưa đến giờ đăng ký. Thời gian mở đăng ký: ${new Date(openUTC.getTime() + 7*3600000).toISOString().replace('T',' ').slice(0,16)} (GMT+7).` });
      }
      if (closeUTC && nowUTC > closeUTC) {
        return res.status(403).json({ error: `Đã hết thời gian đăng ký. Thời gian kết thúc: ${new Date(closeUTC.getTime() + 7*3600000).toISOString().replace('T',' ').slice(0,16)} (GMT+7).` });
      }
    }
    if (advisorRequestPayload) {
      const advisorWindow = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_request_open_at', 'advisor_request_close_at')")).rows as any[]);
      const hasAdvisorWindow = !!(advisorWindow.advisor_request_open_at || advisorWindow.advisor_request_close_at);
      const advisorWindowStatus = isWithinLocalWindow(advisorWindow, 'advisor_request_open_at', 'advisor_request_close_at');
      if (!hasAdvisorWindow || !advisorWindowStatus.ok) {
        return res.status(403).json({ error: advisorWindowStatus.error ? `Ngoài thời gian đăng ký GVHD: ${advisorWindowStatus.error}` : 'Chưa mở đợt đăng ký GVHD.' });
      }
    }
    if (!Array.isArray(req.body.preferences) && !Array.isArray(company_ids) && (!Array.isArray(other_companies) || other_companies.length === 0)) {
      return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 công ty.' });
    }

    const khacCompany = (await db.execute("SELECT id FROM companies WHERE name = 'Công ty khác'")).rows[0] as any;
    const schoolCompany = (await db.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
    const fallbackCompanyIds = Array.isArray(company_ids) ? Array.from(new Set(company_ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id !== khacCompany?.id))) : [];
    const fallbackOtherCompanies = Array.isArray(other_companies) ? other_companies : [];
    const rawPreferences = Array.isArray(req.body.preferences) ? req.body.preferences : [];
    const orderedPreferences = rawPreferences.length > 0
      ? rawPreferences.flatMap((item: any) => {
        if (item?.type === 'other') return [{ type: 'other', name: item.name, role: item.role, contact: item.contact, note: item.note }];
        const companyId = Number(item?.company_id);
        if (!Number.isFinite(companyId) || companyId === khacCompany?.id) return [];
        return [{ type: 'company', company_id: companyId }];
      })
      : [
        ...fallbackCompanyIds.map((companyId: number) => ({ type: 'company', company_id: companyId })),
        ...fallbackOtherCompanies.map((item: any) => ({ type: 'other', name: item.name, role: item.role, contact: item.contact, note: item.note })),
      ];
    const seenCompanyIds = new Set<number>();
    const dedupedPreferences = orderedPreferences.filter((item: any) => {
      if (item.type !== 'company') return true;
      if (seenCompanyIds.has(item.company_id)) return false;
      seenCompanyIds.add(item.company_id);
      return true;
    });
    const normal_company_ids = dedupedPreferences.filter((item: any) => item.type === 'company').map((item: any) => item.company_id);
    const otherCompanies = dedupedPreferences.filter((item: any) => item.type === 'other');
    const totalWishes = dedupedPreferences.length;

    if (!profile.student_id || !profile.dob || !profile.class_name || !profile.course_code || !profile.phone || !profile.personal_email) {
      return res.status(400).json({ error: 'Vui lòng cập nhật đầy đủ Mã SV, ngày sinh, lớp khóa học, học phần thực tập, số điện thoại và email cá nhân trước khi đăng ký.' });
    }

    if (profile.phone) {
      const cleanPhone = profile.phone.replace(/[\s\-\.]/g, '');
      if (!/^(0|\+84)[35789]\d{8}$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Số điện thoại cá nhân không hợp lệ (phải bắt đầu bằng 0 hoặc +84 và có 10 chữ số).' });
      }
    }

    if (profile.dob) {
      const d = new Date(profile.dob);
      if (isNaN(d.getTime()) || d > new Date()) {
        return res.status(400).json({ error: 'Ngày sinh không hợp lệ.' });
      }
    }

    if (totalWishes === 0) {
      return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 công ty.' });
    }
    if (advisorRequestPayload && advisorRequestType !== 'faculty_assign') {
      if (!advisorLecturerName) return res.status(400).json({ error: 'Vui lòng chọn giảng viên hướng dẫn.' });
      advisorLecturer = await findLecturerByNameText(advisorLecturerName);
      if (!advisorLecturer) return res.status(400).json({ error: 'Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' });
      if (isBachelorLecturer(advisorLecturer.name)) return res.status(400).json({ error: 'Giảng viên CN không được làm hướng dẫn chính.' });
      if (advisorCoLecturerName) {
        if (advisorCoLecturerName === advisorLecturerName) {
          return res.status(400).json({ error: 'Giảng viên đồng hướng dẫn không được trùng với giảng viên hướng dẫn chính.' });
        }
        advisorCoLecturer = await findLecturerByNameText(advisorCoLecturerName);
        if (!advisorCoLecturer) return res.status(400).json({ error: 'Giảng viên đồng hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' });
      }
      const primaryQuotaStatus = await advisorQuotaStatus(Number(advisorLecturer.id));
      const coQuotaStatus = advisorCoLecturer ? await advisorQuotaStatus(Number(advisorCoLecturer.id)) : 'within_quota';
      advisorQuota = primaryQuotaStatus === 'over_quota' || coQuotaStatus === 'over_quota' ? 'over_quota' : primaryQuotaStatus;
    }
    if (normal_company_ids.includes(schoolCompany?.id)) {
      if (!schoolLecturerName && advisorRequestType !== 'faculty_assign') {
        return res.status(400).json({ error: 'Vui lòng chọn giảng viên hướng dẫn khi thực tập ở trường.' });
      }
      if (schoolLecturerName) {
        const validLecturer = (await db.execute({ sql: "SELECT id FROM lecturers WHERE name = ?", args: [schoolLecturerName] })).rows[0];
        if (!validLecturer) {
          return res.status(400).json({ error: 'Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' });
        }
        if (schoolCoLecturerName) {
          if (schoolCoLecturerName === schoolLecturerName) {
            return res.status(400).json({ error: 'Giảng viên đồng hướng dẫn không được trùng với giảng viên hướng dẫn chính.' });
          }
          const validCoLecturer = (await db.execute({ sql: "SELECT id FROM lecturers WHERE name = ?", args: [schoolCoLecturerName] })).rows[0];
          if (!validCoLecturer) {
            return res.status(400).json({ error: 'Giảng viên đồng hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' });
          }
        }
      }
    }
    if (totalWishes > 5) {
      return res.status(400).json({ error: 'Bạn chỉ được chọn tối đa 5 công ty.' });
    }

    if (otherCompanies.length > 0) {
      const seenOtherNames = new Set();
      let selectedCompanyNames: string[] = [];
      if (normal_company_ids.length > 0) {
        const selectedRes = await db.execute({
          sql: `SELECT name FROM companies WHERE id IN (${normal_company_ids.map(() => '?').join(',')})`,
          args: normal_company_ids
        });
        selectedCompanyNames = selectedRes.rows.map(r => (r.name as string).trim().toLowerCase());
      }

      for (const other of otherCompanies) {
        if (!other.name || !other.role || !other.contact) {
          return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin các công ty ngoài danh sách.' });
        }
        const otherNameNorm = other.name.trim().toLowerCase();
        if (seenOtherNames.has(otherNameNorm)) {
          return res.status(400).json({ error: `Bạn đã nhập trùng lặp công ty "${other.name}" trong danh sách tự liên hệ.` });
        }
        seenOtherNames.add(otherNameNorm);
        
        if (selectedCompanyNames.includes(otherNameNorm)) {
          return res.status(400).json({ error: `Công ty "${other.name}" đã được bạn chọn trong danh sách chính thức, vui lòng không đăng ký lại ở phần tự liên hệ.` });
        }
      }
    }

    const insertSql2 = "INSERT INTO registrations (user_id, company_id, note, status, other_company_name, other_company_role, other_company_contact, preference_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))";
    const writeStatements: any[] = [
      { sql: 'DELETE FROM final_internships WHERE user_id = ? AND locked_at IS NULL', args: [req.user.id] },
      { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [req.user.id] },
      {
        sql: 'UPDATE users SET student_id = ?, dob = ?, class_name = ?, course_code = ?, phone = ?, personal_email = ? WHERE id = ?',
        args: [profile.student_id, profile.dob, profile.class_name, profile.course_code, profile.phone, profile.personal_email, req.user.id]
      }
    ];

    let preferenceOrder = 1;
    const approvedRows = otherCompanies.length > 0 ? (await db.execute('SELECT normalized_name FROM approved_company_names')).rows : [];
    const approvedCompanyNames = approvedRows.length > 0
      ? new Set(approvedRows.map((row: any) => String(row.normalized_name || '').trim()).filter(Boolean))
      : getItCompanyNameSet();
    for (const preference of dedupedPreferences) {
      if (preference.type === 'company') {
        const companyId = preference.company_id;
        const contactInfo = companyId === schoolCompany?.id ? schoolLecturerName : null;
        const roleInfo = companyId === schoolCompany?.id ? schoolCoLecturerName || null : null;
        writeStatements.push({ sql: insertSql2, args: [req.user.id, companyId, note || null, 'approved', null, roleInfo, contactInfo || null, preferenceOrder] });
        preferenceOrder += 1;
      } else {
        const other = preference;
        const inList = other.name ? approvedCompanyNames.has(normalizeCompanyName(other.name)) : false;
        const status = inList ? 'approved' : 'pending';

        writeStatements.push({
          sql: insertSql2,
          args: [
            req.user.id,
            khacCompany.id,
            String(other.note || '').trim() || note || null,
            status,
            other.name || null,
            other.role || null,
            other.contact || null,
            preferenceOrder
          ]
        });
        preferenceOrder += 1;
      }
    }
    await executeBatch(writeStatements);
    await ensureSchoolFinalInternshipFromRegistration(Number(req.user.id), Number(req.user.id));

    if (advisorRequestPayload) {
      await executeBatch([
        { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [req.user.id] },
        { sql: 'DELETE FROM advisor_assignment_history WHERE user_id = ?', args: [req.user.id] },
      ]);
      await db.execute({
        sql: `INSERT INTO advisor_requests (user_id, lecturer_id, co_lecturer_id, lecturer_name_text, co_lecturer_name_text, request_type, status, quota_status, student_note, source_registration_id, created_at, updated_at)
              VALUES (?, ?, ?, NULL, NULL, ?, 'pending', ?, ?, NULL, datetime('now', '+7 hours'), datetime('now', '+7 hours'))
              ON CONFLICT(user_id) DO UPDATE SET
                lecturer_id = excluded.lecturer_id,
                co_lecturer_id = excluded.co_lecturer_id,
                lecturer_name_text = excluded.lecturer_name_text,
                co_lecturer_name_text = excluded.co_lecturer_name_text,
                request_type = excluded.request_type,
                status = 'pending',
                quota_status = excluded.quota_status,
                student_note = excluded.student_note,
                admin_note = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL,
                updated_at = datetime('now', '+7 hours')`,
        args: [req.user.id, advisorLecturer?.id || null, advisorCoLecturer?.id || null, advisorRequestType, advisorQuota, advisorRequestPayload.student_note || null],
      });
      let advisorWarning: string | null = null;
      if (advisorRequestType === 'agreed' && advisorQuota === 'over_quota') {
        advisorWarning = 'Giảng viên đã đủ/vượt chỉ tiêu. Hệ thống vẫn chấp nhận và ghi nhận GVHD theo thông tin bạn khai báo.';
      }
      if (advisorRequestType === 'agreed' && advisorLecturer) {
        const primaryResult = await createAdvisorAssignment({
          user_id: req.user.id,
          lecturer_id: Number(advisorLecturer.id),
          role: 'primary',
          note: 'Sinh viên khai báo đã được GV đồng ý hướng dẫn khi đăng ký thực tập',
          allow_over_quota: true,
          allow_without_final: true,
          suppress_student_notification: true,
        }, req.user.id);
        if (primaryResult.error) return res.status(primaryResult.status || 400).json({ error: primaryResult.error });
        if (advisorCoLecturer) {
          await createAdvisorAssignment({
            user_id: req.user.id,
            lecturer_id: Number(advisorCoLecturer.id),
            role: 'co',
            note: 'Sinh viên khai báo đồng hướng dẫn khi đăng ký thực tập',
            allow_over_quota: true,
            allow_without_final: true,
            suppress_student_notification: true,
          }, req.user.id);
        }
        await db.execute({
          sql: "UPDATE advisor_requests SET status = 'approved', reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours') WHERE user_id = ?",
          args: [req.user.id],
        });
      }
      (req as any).advisorWarning = advisorWarning;
    }

    const updatedUser = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] })).rows[0];

    res.json({ success: true, user: updatedUser, advisor_warning: (req as any).advisorWarning || null });
  } catch (e: any) {
    const message = String(e?.message || '');
    res.status(message.includes('không được phép đăng nhập/đăng ký') ? 403 : 500).json({ error: message.includes('không được phép đăng nhập/đăng ký') ? message : 'Database error: ' + message });
  } finally {
    processingUsers.delete(userId);
  }
});

// Update registration preferences
studentRouter.put('/api/registrations/my/preferences', requireAuth, requireStudent, async (req: any, res: any) => {
  const userId = req.user.id;
  if (processingUsers.has(userId)) {
    return res.status(429).json({ error: 'Yêu cầu cập nhật đang được xử lý, vui lòng không nhấn thêm.' });
  }
  processingUsers.add(userId);
  try {
    await assertStudentCohortAllowed(req.user.email);
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('registration_open_at', 'registration_close_at')
    `)).rows as any[]);
    const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
    if (!windowStatus.ok) return res.status(403).json({ error: 'Chỉ được sửa nguyện vọng trong thời gian Khoa mở đăng ký.' });

    const preferences = Array.isArray(req.body.preferences) ? req.body.preferences : [];
    if (preferences.length === 0) return res.status(400).json({ error: 'Vui lòng giữ ít nhất 1 nguyện vọng.' });
    if (preferences.length > 5) return res.status(400).json({ error: 'Bạn chỉ được chọn tối đa 5 nơi thực tập.' });

    const khacCompany = (await db.execute("SELECT id FROM companies WHERE name = 'Công ty khác'")).rows[0] as any;
    const schoolCompany = (await db.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
    if (!khacCompany) return res.status(500).json({ error: 'Thiếu bản ghi Công ty khác trong hệ thống.' });

    const existingRows = (await db.execute({ sql: 'SELECT * FROM registrations WHERE user_id = ? ORDER BY preference_order ASC, created_at ASC', args: [userId] })).rows as any[];
    const existingById = new Map(existingRows.map(row => [Number(row.id), row]));
    const existingNote = existingRows.find(row => row.note)?.note || null;
    const final = (await db.execute({ sql: 'SELECT * FROM final_internships WHERE user_id = ?', args: [userId] })).rows[0] as any;
    if (final?.locked_at) return res.status(400).json({ error: 'Nơi thực tập chính thức đã bị khóa. Vui lòng liên hệ Khoa nếu cần thay đổi nguyện vọng.' });

    const approvedRows = (await db.execute('SELECT normalized_name FROM approved_company_names')).rows as any[];
    const approvedCompanyNames = approvedRows.length > 0
      ? new Set(approvedRows.map(row => String(row.normalized_name || '').trim()).filter(Boolean))
      : getItCompanyNameSet();

    const normalizedPrefs: any[] = [];
    const seenCompanyIds = new Set<number>();
    const seenOtherNames = new Set<string>();
    const seenCompanyNames = new Set<string>();
    for (const raw of preferences) {
      const id = raw.id ? Number(raw.id) : null;
      if (id && !existingById.has(id)) return res.status(403).json({ error: 'Nguyện vọng không thuộc tài khoản của bạn.' });
      if (final?.registration_id && id === Number(final.registration_id) && final.internship_type !== 'school') {
        const existing = existingById.get(id);
        const requestedCompanyId = raw.type === 'other' ? Number(khacCompany.id) : Number(raw.company_id);
        if (requestedCompanyId !== Number(existing.company_id)) {
          return res.status(400).json({ error: 'Không thể đổi nơi thực tập đã được dùng để xác nhận chính thức.' });
        }
        if (requestedCompanyId === Number(khacCompany.id)) {
          const requestedOtherName = normalizeCompanyName(String(raw.name || raw.other_company_name || ''));
          const existingOtherName = normalizeCompanyName(String(existing.other_company_name || ''));
          if (requestedOtherName !== existingOtherName) {
            return res.status(400).json({ error: 'Không thể đổi nơi thực tập đã được dùng để xác nhận chính thức.' });
          }
        }
      }
      if (raw.type === 'other') {
        const name = String(raw.name || raw.other_company_name || '').trim();
        const role = String(raw.role || raw.other_company_role || '').trim();
        const contact = String(raw.contact || raw.other_company_contact || '').trim();
        if (!name || !role || !contact) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên, vị trí và liên hệ cho công ty tự liên hệ.' });
        const normalizedName = normalizeCompanyName(name);
        if (seenCompanyNames.has(normalizedName)) return res.status(400).json({ error: `Bạn đã chọn trùng nơi thực tập "${name}".` });
        seenCompanyNames.add(normalizedName);
        if (seenOtherNames.has(normalizedName)) return res.status(400).json({ error: `Bạn đã nhập trùng công ty "${name}".` });
        seenOtherNames.add(normalizedName);
        normalizedPrefs.push({ id, type: 'other', company_id: Number(khacCompany.id), name, role, contact, status: approvedCompanyNames.has(normalizedName) ? 'approved' : 'pending', note: String(raw.note || '').trim() || existingNote });
      } else {
        const companyId = Number(raw.company_id);
        if (!Number.isFinite(companyId) || companyId === Number(khacCompany.id)) return res.status(400).json({ error: 'Công ty không hợp lệ.' });
        if (seenCompanyIds.has(companyId)) return res.status(400).json({ error: 'Bạn đã chọn trùng công ty trong danh sách nguyện vọng.' });
        seenCompanyIds.add(companyId);
        const company = (await db.execute({ sql: 'SELECT id, name FROM companies WHERE id = ?', args: [companyId] })).rows[0] as any;
        if (!company) return res.status(400).json({ error: 'Không tìm thấy công ty đã chọn.' });
        const normalizedName = normalizeCompanyName(String(company.name || ''));
        if (seenCompanyNames.has(normalizedName)) return res.status(400).json({ error: `Bạn đã chọn trùng nơi thực tập "${company.name}".` });
        seenCompanyNames.add(normalizedName);
        normalizedPrefs.push({ id, type: 'company', company_id: companyId, name: company.name, status: 'approved', note: String(raw.note || '').trim() || existingNote });
      }
    }
    if (normalizedPrefs.some(item => item.company_id === Number(schoolCompany?.id)) && normalizedPrefs.length > 1) {
      return res.status(400).json({ error: 'Nếu chọn Trường Đại học Công nghệ, sinh viên không được chọn thêm nơi thực tập khác.' });
    }

    const incomingIds = new Set(normalizedPrefs.map(item => item.id).filter(Boolean).map(Number));
    if (final?.registration_id && !incomingIds.has(Number(final.registration_id)) && final.internship_type !== 'school') {
      return res.status(400).json({ error: 'Không thể xóa nguyện vọng đã được dùng để xác nhận nơi thực tập chính thức.' });
    }

    const statements: any[] = [];
    if (final?.registration_id && final.internship_type === 'school' && !incomingIds.has(Number(final.registration_id))) {
      statements.push({ sql: "DELETE FROM final_internships WHERE user_id = ? AND internship_type = 'school' AND locked_at IS NULL", args: [userId] });
    }
    for (const row of existingRows) {
      if (!incomingIds.has(Number(row.id))) {
        statements.push({ sql: 'DELETE FROM registrations WHERE id = ? AND user_id = ?', args: [Number(row.id), userId] });
      }
    }
    normalizedPrefs.forEach((item, idx) => {
      const order = idx + 1;
      if (item.id) {
        const otherName = item.type === 'other' ? item.name : null;
        statements.push({
          sql: `UPDATE registrations
                SET sent_to_company_at = CASE WHEN ? != 'approved' OR company_id != ? OR COALESCE(other_company_name, '') != COALESCE(?, '') THEN NULL ELSE sent_to_company_at END,
                    sent_to_company_note = CASE WHEN ? != 'approved' OR company_id != ? OR COALESCE(other_company_name, '') != COALESCE(?, '') THEN NULL ELSE sent_to_company_note END,
                    company_id = ?, note = ?, status = ?, other_company_name = ?, other_company_role = ?, other_company_contact = ?,
                    preference_order = ?, review_comment = CASE WHEN status != ? THEN NULL ELSE review_comment END
                WHERE id = ? AND user_id = ?`,
          args: [
            item.status,
            item.company_id,
            otherName,
            item.status,
            item.company_id,
            otherName,
            item.company_id,
            item.note,
            item.status,
            otherName,
            item.type === 'other' ? item.role : null,
            item.type === 'other' ? item.contact : null,
            order,
            item.status,
            item.id,
            userId,
          ],
        });
      } else {
        statements.push({
          sql: `INSERT INTO registrations (user_id, company_id, note, status, other_company_name, other_company_role, other_company_contact, preference_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
          args: [
            userId,
            item.company_id,
            item.note,
            item.status,
            item.type === 'other' ? item.name : null,
            item.type === 'other' ? item.role : null,
            item.type === 'other' ? item.contact : null,
            order,
          ],
        });
      }
    });
    await executeBatch(statements);
    await db.execute({
      sql: `DELETE FROM final_internships
            WHERE user_id = ?
              AND internship_type = 'school'
              AND locked_at IS NULL
              AND registration_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM registrations r
                JOIN companies c ON c.id = r.company_id
                WHERE r.user_id = final_internships.user_id
                  AND r.status != 'rejected'
                  AND c.name = 'Trường Đại học Công nghệ'
              )`,
      args: [userId],
    });
    await ensureSchoolFinalInternshipFromRegistration(userId, userId);
    const rows = (await db.execute({
      sql: `SELECT r.*, c.name as company_name, c.contact_email, c.address, c.slots, c.description
            FROM registrations r
            JOIN companies c ON r.company_id = c.id
            WHERE r.user_id = ?
            ORDER BY r.preference_order ASC, r.created_at ASC`,
      args: [userId],
    })).rows;
    res.json({ success: true, registrations: rows });
  } catch (e: any) {
    const message = String(e?.message || '');
    res.status(message.includes('không được phép đăng nhập/đăng ký') ? 403 : 500).json({ error: message.includes('không được phép đăng nhập/đăng ký') ? message : 'Database error: ' + message });
  } finally {
    processingUsers.delete(userId);
  }
});

// 5. Withdraw Registration
studentRouter.delete('/api/registrations/my', requireAuth, requireStudent, async (req: any, res: any) => {
  const settings = rowsToSettings((await db.execute(`
    SELECT key, value FROM settings
    WHERE key IN ('registration_open_at', 'registration_close_at')
  `)).rows as any[]);
  const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
  if (!windowStatus.ok) {
    return res.status(403).json({ error: 'Chỉ được hủy đăng ký trong thời gian Khoa mở đăng ký.' });
  }
  await executeBatch([
    { sql: 'DELETE FROM final_internships WHERE user_id = ? AND locked_at IS NULL', args: [req.user.id] },
    { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [req.user.id] },
  ]);
  res.json({ success: true });
});

// 5b. Withdraw a single registration
studentRouter.delete('/api/registrations/:id', requireAuth, requireStudent, async (req: any, res: any) => {
  const { id } = req.params;
  const settings = rowsToSettings((await db.execute(`
    SELECT key, value FROM settings
    WHERE key IN ('registration_open_at', 'registration_close_at')
  `)).rows as any[]);
  const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
  if (!windowStatus.ok) {
    return res.status(403).json({ error: 'Chỉ được hủy đăng ký trong thời gian Khoa mở đăng ký.' });
  }
  const reg = (await db.execute({ sql: 'SELECT * FROM registrations WHERE id = ? AND user_id = ?', args: [id, req.user.id] })).rows[0];
  if (!reg) {
    return res.status(404).json({ error: 'Registration not found' });
  }
  await executeBatch([
    { sql: 'DELETE FROM final_internships WHERE registration_id = ? AND user_id = ? AND locked_at IS NULL', args: [id, req.user.id] },
    { sql: 'DELETE FROM registrations WHERE id = ?', args: [id] },
  ]);
  res.json({ success: true });
});
