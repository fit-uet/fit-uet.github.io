import { db } from '../db';
import { createNotification } from './notifications';
import { rowsToSettings, isBachelorLecturer, getLecturerDegreePriority } from './helpers';

export const chatMessageSelect = `
  SELECT cm.id, cm.student_user_id, cm.lecturer_id, cm.sender_user_id, cm.body,
         cm.attachment_name, cm.attachment_size, cm.attachment_mime,
         CASE WHEN cm.attachment_key IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
         cm.created_at, cm.read_at,
         u.name as sender_name, u.role as sender_role, u.email as sender_email
  FROM chat_messages cm
  JOIN users u ON u.id = cm.sender_user_id
`;

export const chatGroupMessageSelect = `
  SELECT cgm.id, NULL as student_user_id, cgm.lecturer_id, cgm.sender_user_id, cgm.body,
         cgm.attachment_name, cgm.attachment_size, cgm.attachment_mime,
         CASE WHEN cgm.attachment_key IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
         cgm.created_at, NULL as read_at, 1 as is_group,
         u.name as sender_name, u.role as sender_role, u.email as sender_email
  FROM chat_group_messages cgm
  JOIN users u ON u.id = cgm.sender_user_id
`;

export async function syncLecturerUsers() {
  await db.executeMultiple(`
    DELETE FROM lecturers
    WHERE email IN (
      SELECT email FROM users
      WHERE role = 'admin' AND COALESCE(is_lecturer, 0) = 0
    );

    UPDATE users
    SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'lecturer' END,
        is_lecturer = 1,
        name = (
          SELECT lecturers.name
          FROM lecturers
          WHERE lecturers.email = users.email
          LIMIT 1
        )
    WHERE email IN (
      SELECT email FROM lecturers
      WHERE email IS NOT NULL AND email != ''
    );

    UPDATE users
    SET role = 'student',
        is_lecturer = 0
    WHERE role = 'lecturer'
      AND email NOT IN (
        SELECT email FROM lecturers
        WHERE email IS NOT NULL AND email != ''
      );

    UPDATE lecturers
    SET email = (
      SELECT users.email
      FROM users
      WHERE users.name = lecturers.name
        AND (users.role = 'lecturer' OR (users.role = 'admin' AND COALESCE(users.is_lecturer, 0) = 1))
      LIMIT 1
    )
    WHERE (email IS NULL OR email = '')
      AND name IN (
        SELECT name FROM users
        WHERE (role = 'lecturer' OR (role = 'admin' AND COALESCE(is_lecturer, 0) = 1))
      );

    DELETE FROM lecturers
    WHERE email IN (
      SELECT email FROM users
      WHERE role = 'admin' AND COALESCE(is_lecturer, 0) = 0
    )
      AND name != (
        SELECT users.name
        FROM users
        WHERE users.email = lecturers.email
          AND users.role = 'admin'
          AND COALESCE(users.is_lecturer, 0) = 1
      );

    UPDATE lecturers
    SET name = (
      SELECT users.name
      FROM users
      WHERE users.email = lecturers.email
        AND (users.role = 'lecturer' OR (users.role = 'admin' AND COALESCE(users.is_lecturer, 0) = 1))
    )
    WHERE email IN (
      SELECT email FROM users
      WHERE role = 'lecturer' OR (role = 'admin' AND COALESCE(is_lecturer, 0) = 1)
    );

    INSERT OR IGNORE INTO lecturers (name, email)
    SELECT name, email
    FROM users
    WHERE role = 'admin'
      AND COALESCE(is_lecturer, 0) = 1
      AND email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM lecturers
        WHERE lecturers.email = users.email
      );
  `);
}

export async function syncAdvisorFromSchoolRegistration(
  userId: number,
  newPrimaryName: string,
  newCoName: string,
  actorUserId: number,
): Promise<{ warning?: string }> {
  const final = (await db.execute({
    sql: 'SELECT id FROM final_internships WHERE user_id = ?',
    args: [userId],
  })).rows[0];
  if (!final) return {};

  const student = (await db.execute({
    sql: 'SELECT email, personal_email FROM users WHERE id = ?',
    args: [userId],
  })).rows[0] as any;

  const warnings: string[] = [];

  async function syncRole(newName: string, role: 'primary' | 'co') {
    const existingRows = (await db.execute({
      sql: 'SELECT * FROM advisor_assignments WHERE user_id = ? AND role = ?',
      args: [userId, role],
    })).rows as any[];

    const trimmedName = newName.trim();

    if (!trimmedName) {
      for (const existing of existingRows) {
        await db.execute({
          sql: `INSERT INTO advisor_assignment_history
                  (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
                VALUES (?, ?, ?, ?, 'deleted', ?, ?, datetime('now', '+7 hours'))`,
          args: [Number(existing.id), userId, Number(existing.lecturer_id), role, actorUserId, 'Xóa GVHD từ chỉnh sửa đăng ký'],
        });
        await db.execute({ sql: 'DELETE FROM advisor_assignments WHERE id = ?', args: [Number(existing.id)] });
      }
      return;
    }

    const lecturerRow = (await db.execute({
      sql: 'SELECT id, name, email FROM lecturers WHERE name = ? LIMIT 1',
      args: [trimmedName],
    })).rows[0] as any;

    if (!lecturerRow) {
      warnings.push(`Không tìm thấy giảng viên "${trimmedName}" trong danh sách; bỏ qua đồng bộ ${role === 'primary' ? 'GVHD chính' : 'đồng hướng dẫn'}.`);
      return;
    }

    const lecturerId = Number(lecturerRow.id);

    if (existingRows.length === 1 && Number(existingRows[0].lecturer_id) === lecturerId) return;

    for (const existing of existingRows) {
      await db.execute({
        sql: `INSERT INTO advisor_assignment_history
                (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
              VALUES (?, ?, ?, ?, 'replaced', ?, ?, datetime('now', '+7 hours'))`,
        args: [
          Number(existing.id), userId, Number(existing.lecturer_id), role,
          actorUserId, `Thay bằng ${trimmedName} từ chỉnh sửa đăng ký`,
        ],
      });
      await db.execute({ sql: 'DELETE FROM advisor_assignments WHERE id = ?', args: [Number(existing.id)] });
    }

    const result = await db.execute({
      sql: `INSERT INTO advisor_assignments (user_id, lecturer_id, role, assigned_by, note, assigned_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [userId, lecturerId, role, actorUserId, 'Đồng bộ từ chỉnh sửa đăng ký'],
    });
    await db.execute({
      sql: `INSERT INTO advisor_assignment_history
              (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
            VALUES (?, ?, ?, ?, 'created', ?, ?, datetime('now', '+7 hours'))`,
      args: [
        Number(result.lastInsertRowid), userId, lecturerId, role,
        actorUserId, 'Đồng bộ từ chỉnh sửa đăng ký',
      ],
    });

    await createNotification({
      user_id: userId,
      recipient_email: student?.personal_email || student?.email,
      type: 'advisor_assigned',
      subject: 'Giảng viên hướng dẫn của bạn đã được cập nhật',
      body: `${role === 'primary' ? 'GVHD chính' : 'Đồng hướng dẫn'} của bạn đã được cập nhật thành: ${lecturerRow.name}${lecturerRow.email ? ` (${lecturerRow.email})` : ''}.`,
    });
  }

  await syncRole(newPrimaryName, 'primary');
  await syncRole(newCoName, 'co');

  return warnings.length > 0 ? { warning: warnings.join(' ') } : {};
}

export async function ensureSchoolFinalInternshipFromRegistration(userId: number, actorUserId?: number) {
  const final = (await db.execute({
    sql: 'SELECT * FROM final_internships WHERE user_id = ?',
    args: [userId],
  })).rows[0] as any;
  if (final || final?.locked_at) return final || null;
  const schoolReg = (await db.execute({
    sql: `SELECT r.*, c.id as school_company_id
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.user_id = ?
            AND r.status != 'rejected'
            AND c.name = 'Trường Đại học Công nghệ'
          ORDER BY COALESCE(r.preference_order, 999), r.created_at ASC
          LIMIT 1`,
    args: [userId],
  })).rows[0] as any;
  if (!schoolReg) return null;
  const lecturerName = String(schoolReg.other_company_contact || '').trim();
  const requestAssignment = lecturerName ? 0 : 1;
  await db.execute({
    sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
          VALUES (?, ?, ?, 'school', 'confirmed', 1, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))
          ON CONFLICT(user_id) DO NOTHING`,
    args: [
      userId,
      Number(schoolReg.id),
      Number(schoolReg.school_company_id),
      lecturerName
        ? 'Hệ thống tự chốt nơi thực tập tại trường từ đăng ký Trường Đại học Công nghệ.'
        : 'Hệ thống tự chốt nơi thực tập tại trường; Khoa sẽ phân công GVHD sau.',
      lecturerName || null,
      requestAssignment,
      actorUserId || userId,
      'Tự động chốt từ đăng ký thực tập tại Trường Đại học Công nghệ.',
    ],
  });
  return (await db.execute({
    sql: 'SELECT * FROM final_internships WHERE user_id = ?',
    args: [userId],
  })).rows[0] || null;
}

export async function backfillSchoolFinalInternshipsFromRegistrations(actorUserId?: number) {
  await db.execute({
    sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
          SELECT r.user_id, r.id, c.id, 'school', 'confirmed', 1,
                 CASE
                   WHEN COALESCE(trim(r.other_company_contact), '') != ''
                     THEN 'Hệ thống tự chốt nơi thực tập tại trường từ đăng ký Trường Đại học Công nghệ.'
                   ELSE 'Hệ thống tự chốt nơi thực tập tại trường; Khoa sẽ phân công GVHD sau.'
                 END,
                 NULLIF(trim(r.other_company_contact), ''),
                 CASE WHEN COALESCE(trim(r.other_company_contact), '') != '' THEN 0 ELSE 1 END,
                 COALESCE(?, r.user_id),
                 'Tự động chốt từ đăng ký thực tập tại Trường Đại học Công nghệ.',
                 datetime('now', '+7 hours')
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.status != 'rejected'
            AND c.name = 'Trường Đại học Công nghệ'
            AND NOT EXISTS (
              SELECT 1 FROM final_internships f WHERE f.user_id = r.user_id
            )`,
    args: [actorUserId || null],
  });
}

export async function resolveLecturerId(body: any) {
  if (body.lecturer_id) return Number(body.lecturer_id);
  const key = String(body.lecturer_email_or_name || body.lecturer || '').trim();
  if (!key) return 0;
  const row = (await db.execute({
    sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1',
    args: [key, key],
  })).rows[0] as any;
  return row ? Number(row.id) : 0;
}

export async function advisorQuotaLimit(lecturer: any) {
  const quotaRow = (await db.execute({ sql: 'SELECT max_total_students FROM lecturer_quotas WHERE lecturer_id = ?', args: [Number(lecturer.id)] })).rows[0] as any;
  if (quotaRow && quotaRow.max_total_students != null) return Number(quotaRow.max_total_students);
  const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')")).rows as any[]);
  const upper = String(lecturer.name || '').toUpperCase();
  if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return Number(settings.advisor_quota_pgs || 5);
  if (/\bTS\b/.test(upper) || upper.includes('TS.')) return Number(settings.advisor_quota_ts || 8);
  return Number(settings.advisor_quota_ths || 10);
}

export async function advisorQuotaStatus(lecturerId: number | null) {
  if (!lecturerId) return 'unknown';
  const lecturer = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE id = ?', args: [lecturerId] })).rows[0] as any;
  if (!lecturer) return 'unknown';
  const maxTotal = await advisorQuotaLimit(lecturer);
  const current = (await db.execute({ sql: 'SELECT COUNT(DISTINCT user_id) as count FROM advisor_assignments WHERE lecturer_id = ?', args: [lecturerId] })).rows[0] as any;
  return Number(current?.count || 0) >= maxTotal ? 'over_quota' : 'within_quota';
}

export async function findLecturerByNameText(name: string) {
  const key = String(name || '').trim();
  if (!key) return null;
  return (await db.execute({
    sql: 'SELECT * FROM lecturers WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1',
    args: [key],
  })).rows[0] as any || null;
}

export async function advisorRequestWithNames(userId: number) {
  return (await db.execute({
    sql: `SELECT ar.*, l.name as lecturer_name, l.email as lecturer_email, cl.name as co_lecturer_name, cl.email as co_lecturer_email
          FROM advisor_requests ar
          LEFT JOIN lecturers l ON l.id = ar.lecturer_id
          LEFT JOIN lecturers cl ON cl.id = ar.co_lecturer_id
          WHERE ar.user_id = ?`,
    args: [userId],
  })).rows[0] || null;
}

export async function createAdvisorAssignment(body: any, adminUserId: number) {
  const userId = Number(body.user_id);
  const lecturerId = await resolveLecturerId(body);
  const role = body.role === 'co' ? 'co' : 'primary';
  if (!userId || !lecturerId) return { error: 'Sinh viên hoặc giảng viên không hợp lệ.', status: 400 };
  const final = (await db.execute({ sql: 'SELECT id FROM final_internships WHERE user_id = ?', args: [userId] })).rows[0];
  if (!final && !body.allow_without_final) return { error: 'Sinh viên chưa xác nhận nơi thực tập chính thức.', status: 400 };
  const lecturer = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE id = ?', args: [lecturerId] })).rows[0] as any;
  if (!lecturer) return { error: 'Không tìm thấy giảng viên.', status: 404 };
  if (role === 'primary' && isBachelorLecturer(lecturer.name)) return { error: 'Giảng viên CN không được làm hướng dẫn chính.', status: 400 };
  const maxTotal = await advisorQuotaLimit(lecturer);
  const current = (await db.execute({ sql: 'SELECT COUNT(DISTINCT user_id) as count FROM advisor_assignments WHERE lecturer_id = ?', args: [lecturerId] })).rows[0] as any;
  const alreadyAssigned = (await db.execute({
    sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? AND role = ?',
    args: [userId, lecturerId, role],
  })).rows[0];
  if (alreadyAssigned) return { row: alreadyAssigned };
  if (!alreadyAssigned && Number(current?.count || 0) >= maxTotal && !body.allow_over_quota) return { error: `Giảng viên đã đủ chỉ tiêu ${maxTotal} sinh viên.`, status: 400 };
  try {
    if (body.replace_existing) {
      const existingSameRole = (await db.execute({
        sql: 'SELECT * FROM advisor_assignments WHERE user_id = ? AND role = ?',
        args: [userId, role],
      })).rows as any[];
      for (const existing of existingSameRole) {
        await db.execute({
          sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
                VALUES (?, ?, ?, ?, 'replaced', ?, ?, datetime('now', '+7 hours'))`,
          args: [
            Number(existing.id),
            userId,
            Number(existing.lecturer_id),
            role,
            adminUserId,
            body.note || `Thay bằng ${lecturer.name}`,
          ],
        });
        await db.execute({ sql: 'DELETE FROM advisor_assignments WHERE id = ?', args: [Number(existing.id)] });
      }
    }
    const result = await db.execute({
      sql: `INSERT INTO advisor_assignments (user_id, lecturer_id, role, assigned_by, note, assigned_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [userId, lecturerId, role, adminUserId, body.note || null],
    });
    await db.execute({
      sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
            VALUES (?, ?, ?, ?, 'created', ?, ?, datetime('now', '+7 hours'))`,
      args: [Number(result.lastInsertRowid), userId, lecturerId, role, adminUserId, body.note || null],
    });
    const student = (await db.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
    if (!body.suppress_student_notification) {
      await createNotification({
        user_id: userId,
        recipient_email: student?.personal_email || student?.email,
        type: 'advisor_assigned',
        subject: 'Bạn đã được phân công giảng viên hướng dẫn',
        body: `Bạn đã được phân công ${role === 'primary' ? 'GVHD chính' : 'đồng hướng dẫn'}: ${lecturer.name}.`,
      });
    }
    return { row: (await db.execute({ sql: 'SELECT * FROM advisor_assignments WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0] };
  } catch (e) {
    const existing = (await db.execute({
      sql: 'SELECT * FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? AND role = ?',
      args: [userId, lecturerId, role],
    })).rows[0];
    if (existing) return { row: existing };
    return { error: role === 'primary' ? 'Sinh viên đã có giảng viên hướng dẫn chính.' : 'Phân công này đã tồn tại.', status: 400 };
  }
}

export async function approveAgreedAdvisorRequest(request: any, actorId: number) {
  if (!request || request.request_type !== 'agreed' || request.status === 'approved') return false;
  let lecturerId = request.lecturer_id ? Number(request.lecturer_id) : 0;
  let coLecturerId = request.co_lecturer_id ? Number(request.co_lecturer_id) : 0;
  if (!lecturerId && request.lecturer_name_text) {
    const lecturer = await findLecturerByNameText(request.lecturer_name_text);
    lecturerId = lecturer?.id ? Number(lecturer.id) : 0;
  }
  if (!coLecturerId && request.co_lecturer_name_text) {
    const coLecturer = await findLecturerByNameText(request.co_lecturer_name_text);
    coLecturerId = coLecturer?.id ? Number(coLecturer.id) : 0;
  }
  const primaryQuotaStatus = await advisorQuotaStatus(lecturerId || null);
  const coQuotaStatus = coLecturerId ? await advisorQuotaStatus(coLecturerId) : 'within_quota';
  const quotaStatus = primaryQuotaStatus === 'over_quota' || coQuotaStatus === 'over_quota' ? 'over_quota' : primaryQuotaStatus;
  if (lecturerId) {
    const primaryResult = await createAdvisorAssignment({
      user_id: Number(request.user_id),
      lecturer_id: lecturerId,
      role: 'primary',
      note: 'Tự duyệt do sinh viên khai báo đã được GV đồng ý hướng dẫn',
      allow_over_quota: true,
      allow_without_final: true,
      suppress_student_notification: true,
    }, actorId);
    if (primaryResult.error) return false;
    if (coLecturerId) {
      await createAdvisorAssignment({
        user_id: Number(request.user_id),
        lecturer_id: coLecturerId,
        role: 'co',
        note: 'Tự duyệt đồng hướng dẫn do sinh viên khai báo',
        allow_over_quota: true,
        allow_without_final: true,
        suppress_student_notification: true,
      }, actorId);
    }
  }
  await db.execute({
    sql: `UPDATE advisor_requests
          SET lecturer_id = ?, co_lecturer_id = ?, quota_status = ?, status = 'approved', reviewed_by = ?,
              reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours')
          WHERE id = ?`,
    args: [lecturerId, coLecturerId || null, quotaStatus, actorId, Number(request.id)],
  });
  return true;
}

export async function ensureAdvisorRequestFromSchoolRegistration(userId: number) {
  const existing = (await db.execute({ sql: 'SELECT * FROM advisor_requests WHERE user_id = ?', args: [userId] })).rows[0] as any;
  if (existing) {
    await approveAgreedAdvisorRequest(existing, userId);
    return (await db.execute({ sql: 'SELECT * FROM advisor_requests WHERE user_id = ?', args: [userId] })).rows[0] as any;
  }
  const assigned = (await db.execute({ sql: "SELECT id FROM advisor_assignments WHERE user_id = ? AND role = 'primary' LIMIT 1", args: [userId] })).rows[0];
  if (assigned) return null;
  const reg = (await db.execute({
    sql: `SELECT r.id, r.other_company_contact, r.other_company_role
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.user_id = ? AND c.name = 'Trường Đại học Công nghệ'
            AND r.status != 'rejected'
            AND COALESCE(trim(r.other_company_contact), '') != ''
          ORDER BY r.created_at DESC
          LIMIT 1`,
    args: [userId],
  })).rows[0] as any;
  if (!reg) return null;
  const lecturer = await findLecturerByNameText(reg.other_company_contact || '');
  const coLecturer = await findLecturerByNameText(reg.other_company_role || '');
  const quotaStatus = await advisorQuotaStatus(lecturer ? Number(lecturer.id) : null);
  await db.execute({
    sql: `INSERT INTO advisor_requests (user_id, lecturer_id, co_lecturer_id, lecturer_name_text, co_lecturer_name_text, request_type, status, quota_status, student_note, source_registration_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'agreed', 'pending', ?, 'Sinh viên đã khai báo GVHD khi đăng ký thực tập tại trường.', ?, datetime('now', '+7 hours'), datetime('now', '+7 hours'))`,
    args: [userId, lecturer?.id || null, coLecturer?.id || null, reg.other_company_contact || null, reg.other_company_role || null, quotaStatus, Number(reg.id)],
  });
  const created = (await db.execute({ sql: 'SELECT * FROM advisor_requests WHERE user_id = ?', args: [userId] })).rows[0] as any;
  await approveAgreedAdvisorRequest(created, userId);
  return (await db.execute({ sql: 'SELECT * FROM advisor_requests WHERE user_id = ?', args: [userId] })).rows[0] as any;
}

export async function ensureAdvisorRequestsFromLegacySchoolRegistrations() {
  const rows = (await db.execute(`
    SELECT DISTINCT r.user_id
    FROM registrations r
    JOIN companies c ON c.id = r.company_id
    WHERE c.name = 'Trường Đại học Công nghệ'
      AND r.status != 'rejected'
      AND COALESCE(trim(r.other_company_contact), '') != ''
  `)).rows as any[];
  let synced = 0;
  for (const row of rows) {
    const result = await ensureAdvisorRequestFromSchoolRegistration(Number(row.user_id));
    if (result) synced++;
  }
  return { checked: rows.length, synced };
}

export async function approvePendingAgreedAdvisorRequests(actorId: number) {
  const rows = (await db.execute(`
    SELECT *
    FROM advisor_requests
    WHERE request_type = 'agreed' AND status = 'pending'
  `)).rows as any[];
  let approved = 0;
  for (const row of rows) {
    const ok = await approveAgreedAdvisorRequest(row, actorId);
    if (ok) approved++;
  }
  return { checked: rows.length, approved };
}

export async function autoAssignPrimaryAdvisors(adminUserId: number) {
  await ensureAdvisorRequestsFromLegacySchoolRegistrations();
  await approvePendingAgreedAdvisorRequests(adminUserId);
  const quotaSettings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')")).rows as any[]);
  const candidates = (await db.execute(`
    SELECT l.id, l.name, l.email,
           q.max_total_students as quota_override,
           COALESCE(ac.assignment_count, 0) as assignment_count
    FROM lecturers l
    LEFT JOIN lecturer_quotas q ON q.lecturer_id = l.id
    LEFT JOIN (SELECT lecturer_id, COUNT(DISTINCT user_id) as assignment_count FROM advisor_assignments GROUP BY lecturer_id) ac ON ac.lecturer_id = l.id
    ORDER BY assignment_count ASC, l.name ASC
  `)).rows
    .map((row: any) => {
      const upper = String(row.name || '').toUpperCase();
      const defaultQuota = /\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')
        ? Number(quotaSettings.advisor_quota_pgs || 5)
        : /\bTS\b/.test(upper) || upper.includes('TS.')
          ? Number(quotaSettings.advisor_quota_ts || 8)
          : Number(quotaSettings.advisor_quota_ths || 10);
      return { ...row, id: Number(row.id), max_total_students: row.quota_override !== null && row.quota_override !== undefined ? Number(row.quota_override) : defaultQuota, assignment_count: Number(row.assignment_count || 0) };
    })
    .filter((row: any) => !isBachelorLecturer(row.name) && row.assignment_count < row.max_total_students);
  const students = (await db.execute(`
    SELECT r.user_id, u.student_id, u.email, u.personal_email, u.name
    FROM registrations r
    JOIN users u ON u.id = r.user_id
    WHERE r.status != 'rejected'
    AND NOT EXISTS (
      SELECT 1 FROM advisor_assignments aa
      WHERE aa.user_id = r.user_id AND aa.role = 'primary'
    )
    AND NOT EXISTS (
      SELECT 1 FROM advisor_requests ar
      WHERE ar.user_id = r.user_id
        AND ar.status IN ('pending', 'approved')
        AND ar.request_type = 'agreed'
    )
    GROUP BY r.user_id
    ORDER BY u.student_id ASC
  `)).rows as any[];

  let count = 0;
  const errors: string[] = [];
  for (const student of students) {
    candidates.sort((a: any, b: any) => {
      const priorityA = getLecturerDegreePriority(a.name);
      const priorityB = getLecturerDegreePriority(b.name);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return (a.assignment_count - b.assignment_count) || String(a.name).localeCompare(String(b.name), 'vi');
    });
    let lecturer: any = null;
    for (const candidate of candidates) {
      const freshCountRow = (await db.execute({
        sql: 'SELECT COUNT(DISTINCT user_id) as count FROM advisor_assignments WHERE lecturer_id = ?',
        args: [Number(candidate.id)],
      })).rows[0] as any;
      const freshCount = Number(freshCountRow?.count || 0);
      candidate.assignment_count = freshCount;
      if (freshCount < Number(candidate.max_total_students || 0)) {
        lecturer = candidate;
        break;
      }
    }
    if (!lecturer) {
      errors.push(`${student.student_id || student.user_id}: không còn giảng viên đủ chỉ tiêu`);
      continue;
    }
    await db.execute({
      sql: `INSERT INTO advisor_assignments (user_id, lecturer_id, role, assigned_by, note, assigned_at)
            VALUES (?, ?, 'primary', ?, 'Tự phân công theo quota', datetime('now', '+7 hours'))`,
      args: [Number(student.user_id), lecturer.id, adminUserId],
    });
    const assignment = (await db.execute({
      sql: "SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? AND role = 'primary'",
      args: [Number(student.user_id), lecturer.id],
    })).rows[0] as any;
    await db.execute({
      sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
            VALUES (?, ?, ?, 'primary', 'auto_created', ?, 'Tự phân công theo quota', datetime('now', '+7 hours'))`,
      args: [Number(assignment?.id || 0), Number(student.user_id), lecturer.id, adminUserId],
    });
    await createNotification({
      user_id: Number(student.user_id),
      recipient_email: student.personal_email || student.email,
      type: 'advisor_assigned',
      subject: 'Bạn đã được phân công giảng viên hướng dẫn',
      body: `Bạn đã được phân công GVHD chính: ${lecturer.name}.`,
    });
    lecturer.assignment_count += 1;
    count++;
  }
  return { count, errors };
}

export async function autoAssignAfterAdvisorWindow(adminUserId: number) {
  const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_request_close_at', 'advisor_auto_assigned_at')")).rows as any[]);
  if (!settings.advisor_request_close_at || settings.advisor_auto_assigned_at) return { count: 0, errors: [], skipped: true };
  const closeAt = new Date(settings.advisor_request_close_at + ':00+07:00');
  if (Number.isNaN(closeAt.getTime()) || new Date() <= closeAt) return { count: 0, errors: [], skipped: true };
  const result = await autoAssignPrimaryAdvisors(adminUserId);
  await db.execute({
    sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_auto_assigned_at', datetime('now', '+7 hours'))",
    args: [],
  });
  return { ...result, skipped: false };
}
