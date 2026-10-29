import XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { campaignKey, type AcademicClass, type CourseEnrollment } from '../../src/shared/academic';
import { currentVersion, hasGrade, isBachelor, newClass, newEnrollment, normalized, now, text } from './domain';
import { fail, type ChangeSet, type Snapshot } from './store';
import { changeTopic } from './topics';

export interface ImportResolution {
  studentId?: string; name?: string; dob?: string; className?: string; classCode?: string;
  primaryId?: number | null; ignoreAdvisor?: boolean; topic?: string; note?: string;
  excluded?: boolean; useFile?: boolean;
}
export interface ImportRow {
  key: string; sources: string[]; studentId: string; name: string; dob: string;
  className: string; classCode: string; topic: string; note: string;
  advisorName: string; advisorEmail: string; primaryId: number | null;
  excluded: boolean; useFile: boolean; issues: string[];
}
export interface ImportPlan { semesterId: string; rows: ImportRow[]; changes: ChangeSet; summary: { rows: number; students: number; classes: number; created: number; updated: number; unchanged: number; excluded: number; errors: number } }
const header = (v: unknown) => normalized(v).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
const lecturerName = (v: unknown) => normalized(v).replace(/^(?:(?:pgs|gs|ts|ths|cn)\.?\s*)+/iu, '').replace(/\s+/g, ' ').trim();

function studentId(v: unknown) {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  const raw = text(v);
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(raw) && Number.isSafeInteger(Number(raw))) return String(Number(raw));
  return raw;
}
export function dateOfBirth(v: unknown, date1904: boolean) {
  if (v == null || v === '') return '';
  let y: number, m: number, d: number;
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v, { date1904 });
    if (!parsed) return null;
    ({ y, m, d } = parsed);
  } else {
    const raw = text(v); const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/); const local = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (iso) [, y, m, d] = iso.map(Number);
    else if (local) { d = Number(local[1]); m = Number(local[2]); y = Number(local[3]); }
    else return null;
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function planImport(s: Snapshot, semesterId: string, bytes: Buffer, resolutions: Record<string, ImportResolution> = {}): ImportPlan {
  if (!s.semesters.some(x => x.id === semesterId)) fail(404, 'SEMESTER_NOT_FOUND', 'Chưa tạo học kỳ cần nhập.');
  const parent = s.campaigns?.find(p => p.id === campaignKey(semesterId, 'project'));
  if (parent?.pendingMigration || parent?.status === 'archived') fail(409, 'CAMPAIGN_READ_ONLY', 'Cần chuyển đổi hoặc mở lại nhóm Dự án trước khi nhập danh sách.');
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: 'buffer', cellDates: false, cellFormula: true }); }
  catch { return fail(422, 'INVALID_WORKBOOK', 'Không đọc được file Excel.'); }
  const groups = new Map<string, ImportRow>();
  let count = 0;
  for (const sheetName of ['DACN', 'DAKH']) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
    const headerRow = rows.findIndex(r => r.some(v => header(v) === 'ma sv') && r.some(v => header(v) === 'ma lmh'));
    if (headerRow < 0) fail(422, 'HEADERS_NOT_FOUND', `Sheet ${sheetName} thiếu cột Mã SV/Mã LMH.`);
    const headers = rows[headerRow].map(header);
    const index = (name: string) => headers.indexOf(name);
    const indexes = { sid: index('ma sv'), name: index('ho va ten'), dob: index('ngay sinh'), className: index('lop khoa hoc'), code: index('ma lmh'), advisor: index('gvhd'), email: index('email cua gvhd'), topic: index('chu de'), note: index('ghi chu') };
    if ([indexes.name, indexes.className, indexes.code].some(i => i < 0)) fail(422, 'HEADERS_NOT_FOUND', `Sheet ${sheetName} thiếu cột hồ sơ.`);
    for (let i = headerRow + 1; i < rows.length; i++) {
      const cells = rows[i]; if (!cells.some(Boolean) || header(cells[indexes.sid]) === 'ma sv') continue;
      if (++count > 5000) fail(422, 'IMPORT_LIMIT', 'Mỗi lần nhập tối đa 5.000 dòng.');
      const source = `${sheetName}:${i + 1}`;
      const r = resolutions[source] || {};
      const sid = r.studentId ?? studentId(cells[indexes.sid]);
      const code = text(r.classCode ?? cells[indexes.code]).toUpperCase().replace(/\s+/g, ' ');
      const parsedDate = dateOfBirth(r.dob ?? cells[indexes.dob], !!workbook.Workbook?.WBProps?.date1904);
      const row: ImportRow = {
        key: source, sources: [source], studentId: sid, name: text(r.name ?? cells[indexes.name]), dob: parsedDate ?? text(cells[indexes.dob]),
        className: text(r.className ?? cells[indexes.className]), classCode: code, topic: text(r.topic ?? cells[indexes.topic]), note: text(r.note ?? cells[indexes.note]),
        advisorName: text(cells[indexes.advisor]), advisorEmail: normalized(cells[indexes.email]), primaryId: r.primaryId ?? null,
        excluded: !!r.excluded, useFile: !!r.useFile, issues: [],
      };
      if (parsedDate === null) row.issues.push('Ngày sinh không hợp lệ.');
      if (!/^\d{8}$/.test(sid)) row.issues.push('Mã SV phải gồm 8 chữ số; không tự sửa hoặc thêm số.');
      if (!row.name) row.issues.push('Thiếu họ tên sinh viên.');
      if (!/^INT313[12] [\p{L}\p{N}_-]{1,30}$/u.test(code) || (sheetName === 'DACN' ? !code.startsWith('INT3132 ') : !code.startsWith('INT3131 '))) row.issues.push('Mã LMH không khớp học phần của sheet.');
      if (r.ignoreAdvisor) { row.advisorName = ''; row.advisorEmail = ''; row.primaryId = null; }
      else if (r.primaryId != null) {
        const l = s.lecturers.find(l => l.id === r.primaryId);
        if (!l || !l.email || isBachelor(l)) row.issues.push('GVHD được chọn không hợp lệ hoặc là CN.');
      } else if (row.advisorName || row.advisorEmail) {
        const candidates = s.lecturers.filter(l => lecturerName(l.name) === lecturerName(row.advisorName));
        const l = candidates.length === 1 ? candidates[0] : null;
        if (l && l.email && (!row.advisorEmail || normalized(l.email) === row.advisorEmail) && !isBachelor(l)) row.primaryId = l.id;
        else row.issues.push('Cần ánh xạ GVHD với danh mục chung (tên/email/học vị chưa khớp).');
      }
      const groupKey = row.excluded ? source : `${sid}|${code}`;
      const existing = groups.get(groupKey);
      if (!existing) { groups.set(groupKey, row); continue; }
      existing.sources.push(source);
      // Comparing semantic fields avoids a blank first row hiding an assigned duplicate.
      for (const field of ['name', 'dob', 'className', 'topic', 'note', 'primaryId'] as const) {
        const a = existing[field], b = row[field];
        if (!a && b) (existing as any)[field] = b;
        else if (a && b && a !== b) existing.issues.push(`Các dòng trùng có ${field} khác nhau; hãy sửa hoặc loại dòng nguồn.`);
      }
      existing.issues.push(...row.issues);
    }
  }
  if (!count) fail(422, 'EMPTY_WORKBOOK', 'Không tìm thấy dữ liệu ở hai sheet DACN/DAKH.');
  const rows = [...groups.values()];
  const classes: AcademicClass[] = [];
  const enrollments: CourseEnrollment[] = [];
  let created = 0, updated = 0, unchanged = 0;
  for (const row of rows.filter(r => !r.excluded)) {
    if (row.issues.length) continue;
    let c = [...s.classes, ...classes].find(c => c.semesterId === semesterId && c.code === row.classCode);
    if (!c) { const [code, section] = row.classCode.split(' '); c = newClass(semesterId, code, section); classes.push(c); }
    if (c.status === 'archived' || c.legacy) { row.issues.push('Lớp chỉ đọc, không thể import.'); continue; }
    const old = s.enrollments.find(e => e.classId === c.id && e.studentId === row.studentId);
    if (old?.status === 'withdrawn') { row.issues.push('Sinh viên đã rút; Khoa cần tiếp nhận lại riêng.'); continue; }
    const e = old ? structuredClone(old) : newEnrollment(c, row);
    if (old) {
      for (const field of ['name', 'dob', 'className', 'note'] as const) {
        if (row[field] && old[field] && row[field] !== old[field] && !row.useFile) row.issues.push(`${field} khác dữ liệu hiện có; xác nhận dùng file hoặc sửa dòng nguồn.`);
        if (row[field] && (!old[field] || row.useFile)) e[field] = row[field];
      }
    }
    if (row.primaryId != null && !e.assignments.some(a => a.role === 'primary' && a.lecturerId === row.primaryId)) {
      if (hasGrade(e)) row.issues.push('Đã có điểm; đổi GVHD cần mở lại bài riêng.');
      else if (old?.assignments.some(a => a.role === 'primary') && !row.useFile) row.issues.push('GVHD khác hiện có; cần xác nhận thay phân công.');
      else if (e.assignments.some(a => a.role === 'reviewer' && a.lecturerId === row.primaryId)) row.issues.push('GVHD trùng GVNX hiện tại.');
      else if (e.assignments.some(a => a.role === 'co' && a.lecturerId === row.primaryId)) row.issues.push('GVHD chính trùng đồng hướng dẫn hiện tại; Khoa cần điều chỉnh phân công riêng.');
      else e.assignments = [...e.assignments.filter(a => a.role !== 'primary'), { id: randomUUID(), role: 'primary', lecturerId: row.primaryId, assignedAt: now() }];
    }
    if (row.topic && row.topic !== e.topic) {
      if (hasGrade(e)) row.issues.push('Đã có điểm; đổi đề tài cần mở lại bài riêng.');
      else if (e.topic && !row.useFile) row.issues.push('Đề tài khác hiện có; cần xác nhận dùng file.');
      else { changeTopic(e, row.topic); if (currentVersion(e).state === 'empty') currentVersion(e).title = row.topic; }
    }
    if (row.issues.length) continue;
    if (old && JSON.stringify(old) === JSON.stringify(e)) unchanged++;
    else { enrollments.push(e); if (old) updated++; else created++; }
  }
  return {
    semesterId, rows, changes: { classes, enrollments, users: enrollments.map(e => ({ studentId: e.studentId, email: e.email, name: e.name, dob: e.dob, className: e.className })) },
    summary: { rows: count, students: rows.filter(r => !r.excluded).length, classes: new Set(rows.filter(r => !r.excluded).map(r => r.classCode)).size, created, updated, unchanged, excluded: rows.filter(r => r.excluded).length, errors: rows.filter(r => !r.excluded && r.issues.length > 0).length },
  };
}
