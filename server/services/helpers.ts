import fs from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { db } from '../db';

export function rowsToSettings(rows: any[]) {
  return Object.fromEntries(rows.map(row => [row.key, row.value])) as Record<string, string>;
}

export function normalizeCompanyName(name: string) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function lecturerDefaultQuota(name: string) {
  const upper = String(name || '').toUpperCase();
  if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return 5;
  if (/\bTS\b/.test(upper) || upper.includes('TS.')) return 8;
  return 10;
}

export function isBachelorLecturer(name: string) {
  const upper = String(name || '').toUpperCase();
  return /\bCN\b/.test(upper) || upper.includes('CN.');
}

export function getLecturerDegreePriority(name: string): number {
  const upper = String(name || '').toUpperCase();
  if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return 3;
  if (/\bTS\b/.test(upper) || upper.includes('TS.')) return 2;
  return 1;
}

export function isWithinLocalWindow(settings: Record<string, string>, openKey: string, closeKey: string) {
  const now = new Date();
  const openAt = settings[openKey];
  const closeAt = settings[closeKey];
  if (openAt && now < new Date(openAt + ':00+07:00')) return { ok: false, error: 'Chưa đến thời gian cho phép.' };
  if (closeAt && now > new Date(closeAt + ':00+07:00')) return { ok: false, error: 'Đã hết thời gian cho phép.' };
  return { ok: true };
}

export function cleanStudentName(rawName?: string, studentId?: string, email?: string): string {
  if (!rawName) return '';
  let name = String(rawName).trim();

  const stripIdAndEmail = (str: string) => {
    let s = str;
    if (studentId) {
      const sId = String(studentId).trim();
      if (sId) {
        if (s.toLowerCase().startsWith(sId.toLowerCase())) {
          s = s.slice(sId.length).trim().replace(/^[-_.:/\s]+/, '');
        }
        if (s.toLowerCase().endsWith(sId.toLowerCase())) {
          s = s.slice(0, -sId.length).trim().replace(/[-_.:/\s]+$/, '');
        }
      }
    }
    if (email) {
      const userPart = String(email).split('@')[0]?.trim();
      if (userPart && userPart.length >= 3) {
        if (s.toLowerCase().startsWith(userPart.toLowerCase())) {
          s = s.slice(userPart.length).trim().replace(/^[-_.:/\s]+/, '');
        }
        if (s.toLowerCase().endsWith(userPart.toLowerCase())) {
          s = s.slice(0, -userPart.length).trim().replace(/[-_.:/\s]+$/, '');
        }
      }
    }
    s = s.replace(/^(?:mssv|msv|sv)?\s*[:#-]?\s*\(?\d{6,12}\)?\s*[-_.:/\s]*/i, '').trim();
    s = s.replace(/\s*[-_.:/]?\s*\(?\d{6,12}\)?$/i, '').trim();
    return s;
  };

  name = stripIdAndEmail(name);

  // 1. Handle duplicate name with separator
  const sepParts = name.split(/\s*[-–—/|,]\s*/);
  if (sepParts.length === 2) {
    const p1 = sepParts[0].trim();
    const p2 = sepParts[1].trim();
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 ||
        (p2.length >= 2 && p1.toLowerCase().startsWith(p2.toLowerCase()))) {
      name = p1;
    }
  }

  // 2. Handle repeated name without separator
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let i = 1; i < words.length; i++) {
      const first = words.slice(0, i).join(' ');
      const rest = words.slice(i).join(' ');
      if (first.localeCompare(rest, undefined, { sensitivity: 'accent' }) === 0) {
        name = first;
        break;
      }
      if (i >= 2 && rest.length >= 2 && first.toLowerCase().startsWith(rest.toLowerCase())) {
        name = first;
        break;
      }
    }
  }

  // 3. Handle 3-times repetition
  const words3 = name.split(/\s+/).filter(Boolean);
  if (words3.length >= 3 && words3.length % 3 === 0) {
    const third = words3.length / 3;
    const p1 = words3.slice(0, third).join(' ');
    const p2 = words3.slice(third, third * 2).join(' ');
    const p3 = words3.slice(third * 2).join(' ');
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 &&
        p2.localeCompare(p3, undefined, { sensitivity: 'accent' }) === 0) {
      name = p1;
    }
  }

  name = stripIdAndEmail(name);
  name = name.replace(/\s+/g, ' ').trim();
  return name || String(rawName).trim();
}

export async function normalizeExistingStudentNames() {
  try {
    const students = (await db.execute(`
      SELECT id, student_id, name, email FROM users
      WHERE role = 'student' AND name IS NOT NULL AND name != ''
    `)).rows as any[];
    for (const s of students) {
      const clean = cleanStudentName(s.name, s.student_id, s.email);
      if (clean && clean !== s.name) {
        await db.execute({
          sql: 'UPDATE users SET name = ? WHERE id = ?',
          args: [clean, s.id],
        });
      }
    }
  } catch (e) {
    console.error('Failed to normalize existing student names:', e);
  }
}

export function normalizeScore(value: any) {
  if (value === '' || value === null || value === undefined) return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 10) return undefined;
  return Math.round(score * 100) / 100;
}

export function calculateFinalScore(progressScore: number | null, reportScore: number | null, companyScore: number | null) {
  if (progressScore === null || reportScore === null || companyScore === null) return null;
  // Điểm tổng kết thực tập chỉ làm tròn đến một chữ số sau phần thập phân theo quy chế đào tạo
  return Math.round((progressScore * 0.2 + reportScore * 0.2 + companyScore * 0.6) * 10) / 10;
}

let cachedItCompanyNames: { mtimeMs: number; names: Set<string> } | null = null;

export function getItCompanyNameSet() {
  const itCompaniesFile = join(process.cwd(), 'data/seed/it-companies-list.csv');
  if (!fs.existsSync(itCompaniesFile)) return new Set<string>();

  const stat = fs.statSync(itCompaniesFile);
  if (cachedItCompanyNames && cachedItCompanyNames.mtimeMs === stat.mtimeMs) {
    return cachedItCompanyNames.names;
  }

  const content = fs.readFileSync(itCompaniesFile, 'utf8');
  const records = parse(content, { columns: true, skip_empty_lines: true });
  const names = new Set<string>(records.map((r: any) => normalizeCompanyName(r['Tên công ty']?.trim())).filter(Boolean));
  cachedItCompanyNames = { mtimeMs: stat.mtimeMs, names };
  return names;
}
