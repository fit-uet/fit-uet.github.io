import {compoundSelect} from '../services/compoundSelect';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { COURSE_CATALOG, EMPTY_CLASS_SETTINGS, campaignKey, type AcademicClass, type AcademicSemester, type CourseEnrollment, type LecturerInfo, type CourseCampaign } from '../../src/shared/academic';
import { hydrateLegacy } from './legacy';
import { invalidateReadCache } from './reads';

export class AcademicError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const fail = (status: number, code: string, message: string, details?: unknown): never => { throw new AcademicError(status, code, message, details); };
export interface Quota { id: string; semesterId: string; lecturerId: number; maxReviews: number | null; internshipMax: number | null }
export interface AcademicEvent { id: string; email: string; userId: number | null; classId: string; campaignId?: string; audienceClassIds?: string[]; enrollmentId?: string; type: string; subject: string; body: string; deliveryMode?: 'website_only' | 'website_and_email'; forceImmediate?: boolean }
export interface Snapshot {
  revision: number; semesters: AcademicSemester[]; classes: AcademicClass[];
  enrollments: CourseEnrollment[]; lecturers: LecturerInfo[]; quotas: Quota[];
  campaigns?: CourseCampaign[]; storedClasses?: AcademicClass[];
}
export async function snapshot(): Promise<Snapshot> {
  // One SELECT observes a consistent snapshot. Keep individual records in separate
  // rows instead of aggregating years of submissions into one oversized D1 cell.
  const rows = (await db.execute(compoundSelect(`SELECT 'revision' kind,CAST(revision AS TEXT) data FROM academic_meta WHERE id=1
    UNION ALL SELECT 'semesters',data FROM academic_semesters
    UNION ALL SELECT 'campaigns',data FROM academic_campaigns
    UNION ALL SELECT 'classes',data FROM academic_classes
    UNION ALL SELECT 'enrollments',data FROM academic_enrollments
    UNION ALL SELECT 'quotas',data FROM academic_quotas
    UNION ALL SELECT 'lecturers',json_object('id',id,'name',name,'email',COALESCE(email,''),'work_unit',COALESCE(work_unit,'')) FROM lecturers`.split(/\n\s*UNION ALL /)))).rows;
  const result: Snapshot = { revision: 0, campaigns: [], semesters: [], classes: [], enrollments: [], quotas: [], lecturers: [] };
  for (const row of rows) {
    if (row.kind === 'revision') result.revision = Number(row.data);
    else result[String(row.kind)].push(JSON.parse(String(row.data)));
  }
  for (const p of result.campaigns) p.settings = { ...EMPTY_CLASS_SETTINGS, ...p.settings };
  result.storedClasses = structuredClone(result.classes);
  for (const c of result.classes) {
    const group = COURSE_CATALOG.find(x => x.code === c.courseCode)!.group;
    c.campaignId ||= campaignKey(c.semesterId, group);
    let parent = result.campaigns.find(x => x.id === c.campaignId);
    if (!parent) { parent = { id: c.campaignId, semesterId: c.semesterId, group, status: 'draft', settings: { ...EMPTY_CLASS_SETTINGS, ...c.settings }, revision: 0, legacy: c.legacy, pendingMigration: true }; result.campaigns.push(parent); }
    c.status = parent.status; c.settings = { ...parent.settings };
  }
  await hydrateLegacy(result);
  return result;
}
export interface ChangeSet {
  projectAdmission?:{campaignId:string;campaignRevision:number;classId:string;studentId:string;email:string;account:{id:number;email:string;studentId:string;name:string;dob:string;className:string;role:string}|null};
  membershipMigration?:boolean;
  deletedEnrollmentIds?:string[]; purgeCommands?:{id:unknown;paths:string[]}[]; deletePreviewIds?:string[];
  cleanupFiles?:{id:string;jobId:string;kind:string;objectKey:string}[];
  deletionJob?:{id:string;campaignId:string;actorId:number;enrollmentIds:string[];reason:string};
  semesters?: AcademicSemester[]; classes?: AcademicClass[]; enrollments?: CourseEnrollment[]; quotas?: Quota[];
  campaigns?: CourseCampaign[];
  legacySettings?: { key: string; value: string }[];
  legacyGradeLocks?: { userId: number; lockedAt: string | null }[];
  users?: { studentId: string; email: string; name: string; dob: string; className: string }[];
  events?: AcademicEvent[]; previewId?: string; previewResult?: unknown;
}
export async function commit(s: Snapshot, actorId: number, action: string, changes: ChangeSet, reason = '', commandId = randomUUID()) {
  changes.campaigns ||= [];
  for (const c of changes.classes || []) {
    c.campaignId ||= campaignKey(c.semesterId, COURSE_CATALOG.find(x => x.code === c.courseCode)!.group);
    let p = changes.campaigns.find(p => p.id === c.campaignId) || s.campaigns?.find(p => p.id === c.campaignId && !p.pendingMigration);
    if (!p) {
      if (s.storedClasses?.some(x => campaignKey(x.semesterId, COURSE_CATALOG.find(k => k.code === x.courseCode)!.group) === c.campaignId)) fail(409, 'CAMPAIGN_MIGRATION_REQUIRED', 'Cần xem trước chuyển cấu hình lớp sang nhóm môn.');
      p = { id: c.campaignId, semesterId: c.semesterId, group: COURSE_CATALOG.find(x => x.code === c.courseCode)!.group, status: c.status, settings: { ...c.settings }, revision: 0, legacy: c.legacy };
      changes.campaigns.push(p);
    }
    c.status = p.status; c.settings = { ...p.settings };
  }
  for (const p of changes.campaigns) p.revision++;
  for (const c of changes.classes || []) c.revision++;
  for (const e of changes.enrollments || []) e.revision++;
  const before = {
    campaigns: s.campaigns?.filter(p => changes.campaigns?.some(x => x.id === p.id)),
    classes: s.classes.filter(c => changes.classes?.some(x => x.id === c.id)),
    enrollments: s.enrollments.filter(e => changes.enrollments?.some(x => x.id === e.id)),
  };
  const payload = JSON.stringify({ ...changes, before, lecturerGuards: s.lecturers });
  if (Buffer.byteLength(payload) > 1_800_000) fail(422, 'COMMAND_TOO_LARGE', 'Lần cập nhật quá lớn để ghi an toàn. Hãy chia danh sách thành các file nhỏ hơn. Chưa có dữ liệu nào được thay đổi.');
  try {
    await db.execute({ sql: `INSERT INTO academic_commands(id,expected_revision,actor_id,action,reason,payload,created_at) VALUES(?,?,?,?,?,?,?)`, args: [commandId, s.revision, actorId, action, reason, payload, new Date().toISOString()] });
    invalidateReadCache();
  } catch (error) {
    if (/ACADEMIC_STALE/.test(String(error))) fail(409, 'STALE_PREVIEW', 'Dữ liệu đã thay đổi. Vui lòng tải lại và xác nhận lại.');
    if (/ACADEMIC_ADMIN_REQUIRED|ACADEMIC_ROLE_CHANGED/.test(String(error))) fail(403, 'ACTOR_ROLE_CHANGED', 'Vai trò tài khoản đã thay đổi. Vui lòng đăng nhập lại.');
    throw error;
  }
}
export async function savePreview(actorId: number, kind: string, s: Snapshot, payload: unknown) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  await db.execute({ sql: 'INSERT INTO academic_previews(id,actor_id,kind,revision,expires_at,payload) VALUES(?,?,?,?,?,?)', args: [id, actorId, kind, s.revision, expiresAt, JSON.stringify(payload)] });
  return { id, expiresAt };
}
export async function readPreview(actorId: number, id: string, kind: string) {
  const p = (await db.execute({ sql: 'SELECT * FROM academic_previews WHERE id=? AND actor_id=? AND kind=?', args: [id, actorId, kind] })).rows[0] as { id: string; revision: number; expires_at: string; payload: string; result: string | null };
  if (!p) fail(404, 'PREVIEW_NOT_FOUND', 'Không tìm thấy bản xem trước.');
  if (p.result) return { ...p, payload: JSON.parse(String(p.payload)), result: JSON.parse(String(p.result)) };
  if (Date.parse(String(p.expires_at)) < Date.now()) fail(409, 'PREVIEW_EXPIRED', 'Bản xem trước đã hết hạn.');
  return { ...p, payload: JSON.parse(String(p.payload)), result: null };
}
