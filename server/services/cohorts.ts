import { db } from '../db';
import { DEFAULT_ALLOWED_REGISTRATION_COHORTS } from '../config';

export function cohortFromVnuEmail(email: string) {
  const localPart = String(email || '').toLowerCase().split('@')[0] || '';
  const prefix = localPart.match(/^\d{4}/)?.[0] || '';
  const yearCode = Number(prefix.slice(0, 2));
  if (!Number.isInteger(yearCode) || yearCode < 0) return null;
  return `K${yearCode + 45}`;
}

export async function getAllowedRegistrationCohorts() {
  const row = (await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'allowed_registration_cohorts'",
    args: [],
  })).rows[0] as { value?: string } | undefined;
  return new Set(String(row?.value || DEFAULT_ALLOWED_REGISTRATION_COHORTS).split(',').map(item => item.trim()).filter(Boolean));
}

export async function getRegistrationExceptionEmails() {
  const row = (await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'registration_exception_emails'",
    args: [],
  })).rows[0] as { value?: string } | undefined;
  return new Set(String(row?.value || '')
    .split(/[\s,;]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean));
}

export async function isListedStudentCohortException(email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const studentId = normalizedEmail.split('@')[0] || '';
  if (!studentId) return false;
  const row = (await db.execute({
    sql: `SELECT id FROM users
          WHERE role = 'student'
            AND COALESCE(legacy_internship_access, 1) = 1
            AND (lower(email) = ? OR student_id = ?)
          LIMIT 1`,
    args: [normalizedEmail, studentId],
  })).rows[0];
  return Boolean(row);
}

export async function assertStudentCohortAllowed(email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cohort = cohortFromVnuEmail(email);
  const allowed = await getAllowedRegistrationCohorts();
  if (cohort && allowed.has(cohort)) return;
  if (await isListedStudentCohortException(normalizedEmail)) return;
  const allowedText = Array.from(allowed).join(', ') || 'không có khóa nào';
  throw new Error(`Khóa ${cohort || 'không xác định'} không được phép đăng nhập/đăng ký học phần trong đợt này. Các khóa đang mở: ${allowedText}.`);
}
