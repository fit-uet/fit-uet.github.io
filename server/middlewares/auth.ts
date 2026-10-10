import jwt from 'jsonwebtoken';
import { db } from '../db';
import { JWT_SECRET } from '../config';

export const requireAuth = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (!decoded.email) {
      return res.status(401).json({ error: 'Unauthorized: Phiên đăng nhập cũ đã hết hạn, vui lòng đăng nhập lại.' });
    }
    req.user = (await db.execute({ sql: 'SELECT * FROM users WHERE LOWER(email) = ?', args: [String(decoded.email).toLowerCase().trim()] })).rows[0];
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
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
    sql: 'SELECT id, name, email FROM lecturers WHERE email = ? OR name = ? LIMIT 1',
    args: [actor.email || '', actor.name || ''],
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
