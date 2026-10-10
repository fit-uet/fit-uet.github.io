import { db, executeBatch } from '../db';
import { normalizeCompanyName } from './helpers';

export async function addApprovedCompanyFromRegistration(row: any) {
  if (!row || row.company_name !== 'Công ty khác') return false;
  const name = String(row.other_company_name || '').trim();
  const normalized = normalizeCompanyName(name);
  if (!name || !normalized) return false;

  await db.execute({
    sql: `INSERT OR IGNORE INTO approved_company_names (name, normalized_name, source)
          VALUES (?, ?, 'registration_approval')`,
    args: [name, normalized],
  });
  return true;
}

export async function approveMatchingOtherCompanyRegistrations(row: any, reviewComment: string) {
  if (!row || row.company_name !== 'Công ty khác') return [];
  const normalized = normalizeCompanyName(row.other_company_name || '');
  if (!normalized) return [];
  const pending = (await db.execute(`
    SELECT r.id, u.id as user_id, u.email, u.personal_email, r.other_company_name
    FROM registrations r
    JOIN users u ON u.id = r.user_id
    JOIN companies c ON c.id = r.company_id
    WHERE c.name = 'Công ty khác'
      AND r.status = 'pending'
      AND r.other_company_name IS NOT NULL
  `)).rows as any[];
  const matched = pending.filter(item => normalizeCompanyName(item.other_company_name || '') === normalized);
  if (matched.length === 0) return [];
  await executeBatch(matched.map(item => ({
    sql: 'UPDATE registrations SET status = ?, review_comment = ? WHERE id = ?',
    args: ['approved', reviewComment || 'Tự động duyệt do công ty tự liên hệ đã được Khoa duyệt.', item.id],
  })));
  return matched;
}

export async function approvePendingOtherRegistrationsFromApprovedNames() {
  const approvedRows = (await db.execute('SELECT normalized_name FROM approved_company_names')).rows as any[];
  const approvedNames = new Set(approvedRows.map(row => String(row.normalized_name || '').trim()).filter(Boolean));
  if (approvedNames.size === 0) return;
  const pendingRows = (await db.execute(`
    SELECT r.id, r.other_company_name
    FROM registrations r
    JOIN companies c ON c.id = r.company_id
    WHERE c.name = 'Công ty khác'
      AND r.status = 'pending'
      AND r.other_company_name IS NOT NULL
  `)).rows as any[];
  const matched = pendingRows.filter(row => approvedNames.has(normalizeCompanyName(row.other_company_name || '')));
  if (matched.length === 0) return;
  await executeBatch(matched.map(row => ({
    sql: `UPDATE registrations
          SET status = 'approved',
              review_comment = COALESCE(review_comment, 'Tự động duyệt do công ty tự liên hệ đã có trong danh sách thẩm định.')
          WHERE id = ?`,
    args: [row.id],
  })));
}
