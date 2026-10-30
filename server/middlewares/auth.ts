import jwt from 'jsonwebtoken';
import { db } from '../db';
import { JWT_SECRET } from '../config';
import { assertStudentCohortAllowed } from '../services/cohorts';
import {databaseAvailability,isDatabaseUnavailable} from '../services/databaseAvailability';

export const requireAuth = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let decoded:any;
  try { decoded=jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({error:'Invalid token'}); }
  try {
    if (!decoded.email) {
      return res.status(401).json({ error: 'Unauthorized: Phiên đăng nhập cũ đã hết hạn, vui lòng đăng nhập lại.' });
    }
    req.user = (await db.execute({ sql: 'SELECT * FROM users WHERE LOWER(email) = ?', args: [String(decoded.email).toLowerCase().trim()] })).rows[0];
    if (!req.user) return res.status(401).json({ error: 'User not found' });
  } catch (e) {
    return res.status(503).json(databaseAvailability(e));
  }
  next();
};

export const requireAdmin = async (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
};

export const requireStudent = async (req: any, res: any, next: any) => {
  if (req.user?.role !== 'student') {
    return res.status(403).json({ error: 'Student only' });
  }
  try { await assertStudentCohortAllowed(req.user.email); }
  catch (error) { return isDatabaseUnavailable(error)?res.status(503).json(databaseAvailability(error)):res.status(403).json({ error: 'Tài khoản chỉ có quyền ở các lớp được tiếp nhận. Vui lòng mở mục Học kỳ và lớp.' }); }
  next();
};

export const requireStudentOrAdmin = async (req: any, res: any, next: any) => {
  if (req.user?.role !== 'student' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Student or admin only' });
  }
  next();
};

export const getActorLecturer = async (actor: any) => {
  if (actor.role !== 'lecturer' && actor.role !== 'admin' && !actor.is_lecturer) return null;
  return (await db.execute({
    sql: 'SELECT id, name, email FROM lecturers WHERE lower(trim(email)) = lower(trim(?)) LIMIT 1',
    args: [actor.email || ''],
  })).rows[0] as any || null;
};

export const canAccessChatThread = async (actor: any, studentUserId: number, lecturerId: number) => {
  if (!Number.isFinite(studentUserId) || !Number.isFinite(lecturerId)) return false;
  if (actor.role === 'student') {
    if (Number(actor.id) !== studentUserId) return false;
  } else {
    const lecturer = await getActorLecturer(actor);
    if (!lecturer || Number(lecturer.id) !== lecturerId) return false;
  }
  const assignment = (await db.execute({
    sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
    args: [studentUserId, lecturerId],
  })).rows[0];
  return !!assignment;
};

export const canAccessChatGroup = async (actor: any, lecturerId: number) => {
  if (!Number.isFinite(lecturerId)) return false;
  if (actor.role === 'student') {
    const assignment = (await db.execute({
      sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
      args: [actor.id, lecturerId],
    })).rows[0];
    return !!assignment;
  }
  const lecturer = await getActorLecturer(actor);
  return !!lecturer && Number(lecturer.id) === lecturerId;
};
