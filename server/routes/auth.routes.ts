import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { GOOGLE_CLIENT_ID, JWT_SECRET } from '../config';
import { cleanStudentName } from '../services/helpers';
import { assertStudentCohortAllowed } from '../services/cohorts';

export const authRouter = Router();
const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID);

authRouter.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Thiếu thông tin xác thực Google.' });
  }

  try {
    let payload: any;
    try {
      const ticket = await oAuth2Client.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (e) {
      if (process.env.NODE_ENV === 'production') {
        throw e;
      }
      const jwtDecode = (await import('jwt-decode')).jwtDecode;
      payload = jwtDecode(credential);
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const email = String(payload.email || '').trim().toLowerCase();
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();

    if (!email.endsWith('@vnu.edu.vn') && email !== adminEmail) {
      return res.status(403).json({ error: 'Chỉ chấp nhận email @vnu.edu.vn' });
    }

    const lecturerRecord = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE email = ?', args: [email] })).rows[0] as any;
    const isLecturerInDb = !!lecturerRecord;
    const rawDisplayName = lecturerRecord?.name || payload.name || email;
    const defaultRole = (email === adminEmail) ? 'admin' : (isLecturerInDb ? 'lecturer' : 'student');
    const studentId = defaultRole === 'student' ? email.split('@')[0] : null;
    const displayName = defaultRole === 'student' ? cleanStudentName(rawDisplayName, studentId, email) : rawDisplayName;
    const picture = payload.picture || null;
    let user = (await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] })).rows[0] as any;
    if (!user && studentId) {
      user = (await db.execute({
        sql: "SELECT * FROM users WHERE role = 'student' AND student_id = ?",
        args: [studentId],
      })).rows[0] as any;
    }
    const effectiveRole = user?.role || defaultRole;
    let admittedProject = false;
    if (effectiveRole === 'student' && !isLecturerInDb && email !== adminEmail) {
      admittedProject = !!(await db.execute({
        sql: `SELECT e.id FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id
          WHERE lower(json_extract(e.data,'$.email'))=? AND COALESCE(json_extract(e.data,'$.status'),'active')='active'
            AND json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132')
            AND json_extract(c.data,'$.status') IN ('active','archived') LIMIT 1`, args: [email],
      })).rows[0];
      if (!admittedProject) await assertStudentCohortAllowed(email);
    }
    if (!user) {
      const result = await db.execute({
        sql: 'INSERT INTO users (email, name, picture, role, student_id, is_lecturer, legacy_internship_access) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [email, displayName, picture, defaultRole, studentId, isLecturerInDb ? 1 : 0, admittedProject ? 0 : 1]
      });
      user = { id: Number(result.lastInsertRowid), email, name: displayName, picture, role: defaultRole, student_id: studentId, dob: null, class_name: null, is_lecturer: isLecturerInDb ? 1 : 0, legacy_internship_access: admittedProject ? 0 : 1 };
    } else {
      let nextRole = user.role;
      if (isLecturerInDb) {
        nextRole = user.role === 'admin' ? 'admin' : 'lecturer';
      } else if (user.role === 'lecturer') {
        nextRole = 'student';
      }
      await db.execute({
        sql: `UPDATE users
              SET email = ?,
                  picture = ?,
                  role = ?,
                  name = CASE WHEN ? = 1 THEN ? ELSE name END,
                  is_lecturer = CASE WHEN ? = 1 THEN 1 ELSE CASE WHEN ? = 1 THEN 0 ELSE is_lecturer END END,
                  student_id = CASE WHEN ? = 'student' THEN COALESCE(NULLIF(student_id, ''), ?) ELSE NULL END
              WHERE id = ?`,
        args: [email, picture, nextRole, isLecturerInDb ? 1 : 0, displayName, isLecturerInDb ? 1 : 0, nextRole === 'student' ? 1 : 0, nextRole, studentId, user.id]
      });
      user.email = email;
      user.role = nextRole;
      if (isLecturerInDb) {
        user.name = displayName;
        user.is_lecturer = 1;
        user.student_id = nextRole === 'student' ? user.student_id : null;
      } else if (nextRole === 'student') {
        user.is_lecturer = 0;
        user.student_id = user.student_id || studentId;
      }
      user.picture = picture;
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role, student_id: user.student_id, dob: user.dob, class_name: user.class_name, course_code: user.course_code, is_lecturer: user.is_lecturer, legacy_internship_access: user.legacy_internship_access ?? 1 } });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message.includes('không được phép đăng nhập/đăng ký')) {
      return res.status(403).json({ error: message });
    }
    if (/UNIQUE constraint failed: users\.student_id|idx_users_student_id_unique/i.test(message)) {
      return res.status(409).json({
        error: 'Tài khoản này bị trùng mã sinh viên với một hồ sơ khác trong hệ thống. Vui lòng liên hệ quản trị viên để gộp hoặc sửa hồ sơ sinh viên.',
      });
    }
    const isGoogleTokenError = /token|jwt|audience|recipient|issuer|signature|login ticket|No pem found/i.test(message);
    if (isGoogleTokenError) {
      console.error('Google authentication failed:', message);
      return res.status(401).json({
        error: 'Không xác thực được tài khoản Google. Vui lòng thử đăng nhập lại; nếu vẫn lỗi, cần kiểm tra OAuth Client ID của frontend và API.',
      });
    }
    res.status(500).json({ error: 'Đăng nhập thất bại do lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});
