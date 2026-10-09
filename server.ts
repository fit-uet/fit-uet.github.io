import express from 'express';
import cors from 'cors';
import { dirname, join } from 'path';
import fs from 'fs';
import { createClient, Client } from '@libsql/client';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { parse } from 'csv-parse/sync';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const DEFAULT_JWT_SECRET = 'uyet-vnu-secret-key-1234';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const CHAT_THREAD_STORAGE_LIMIT_BYTES = Math.max(1, Number(process.env.CHAT_THREAD_STORAGE_MB || 200)) * 1024 * 1024;
const CHAT_DAILY_UPLOAD_LIMIT_BYTES = Math.max(1, Number(process.env.CHAT_DAILY_UPLOAD_MB || 50)) * 1024 * 1024;
const ALLOWED_CHAT_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'jpg', 'jpeg', 'png']);
const ALLOWED_CHAT_ATTACHMENT_MIME_PREFIXES = ['application/pdf', 'application/msword', 'application/vnd.', 'text/plain', 'application/zip', 'image/jpeg', 'image/png'];

// A mock OAuth client ID. In production, this must match the frontend client ID.
const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || '123456789-mock.apps.googleusercontent.com';
const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID);

interface DatabaseClient {
  execute(stmt: string | { sql: string; args?: any[] }): Promise<{ rows: any[]; lastInsertRowid?: number | bigint; rowsAffected?: number }>;
  executeMultiple(sql: string): Promise<void>;
  batch(statements: Array<{ sql: string; args?: any[] }>, mode?: string): Promise<any[]>;
}

class CloudflareD1Client implements DatabaseClient {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;
  private baseUrl: string;

  constructor(accountId: string, databaseId: string, apiToken: string) {
    this.accountId = accountId;
    this.databaseId = databaseId;
    this.apiToken = apiToken;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  }

  async execute(stmt: string | { sql: string; args?: any[] }): Promise<{ rows: any[]; lastInsertRowid?: number | bigint; rowsAffected?: number }> {
    let sql: string;
    let params: any[] | undefined;

    if (typeof stmt === 'string') {
      sql = stmt;
      params = undefined;
    } else {
      sql = stmt.sql;
      params = stmt.args;
    }

    const payload: any = { sql };
    if (params && params.length > 0) {
      payload.params = params.map(p => (p === undefined ? null : p));
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`D1 HTTP Error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json() as any;
    if (!data.success) {
      const errMessage = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 Query Error: ${errMessage}`);
    }

    const firstResult = data.result?.[0];
    const rows = firstResult?.results || [];
    const meta = firstResult?.meta || {};

    return {
      rows,
      lastInsertRowid: meta.last_row_id !== undefined ? meta.last_row_id : undefined,
      rowsAffected: meta.changes !== undefined ? meta.changes : 0,
    };
  }

  async executeMultiple(sql: string): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`D1 HTTP Error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json() as any;
    if (!data.success) {
      const errMessage = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 ExecuteMultiple Error: ${errMessage}`);
    }
  }

  async batch(statements: Array<{ sql: string; args?: any[] }>, _mode?: string): Promise<any[]> {
    if (!statements || statements.length === 0) return [];

    const formattedQueries = statements.map(st => {
      let q = st.sql.trim();
      if (q.endsWith(';')) q = q.slice(0, -1);
      return this.formatSqlWithArgs(q, st.args);
    });

    const combinedSql = formattedQueries.join(';\n') + ';';

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: combinedSql }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`D1 HTTP Error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json() as any;
    if (!data.success) {
      const errMessage = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 Batch Error: ${errMessage}`);
    }

    const results = data.result || [];
    return results.map((r: any) => ({
      rows: r.results || [],
      lastInsertRowid: r.meta?.last_row_id,
      rowsAffected: r.meta?.changes || 0,
    }));
  }

  private formatSqlWithArgs(sql: string, args?: any[]): string {
    if (!args || args.length === 0) return sql;
    let i = 0;
    return sql.replace(/\?/g, () => {
      if (i >= args.length) return '?';
      const val = args[i++];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
      if (typeof val === 'boolean') return val ? '1' : '0';
      if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
        return `X'${Buffer.from(val).toString('hex')}'`;
      }
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }
}

let db: DatabaseClient;
const DB_BATCH_SIZE = 50;
let r2Client: S3Client | null = null;

function isTransientLibsqlError(error: any) {
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.cause?.status || error?.status || 0);
  return code === 'SERVER_ERROR' || [429, 500, 502, 503, 504].includes(status) || /bad gateway|service unavailable|gateway timeout|fetch failed|network|rate limit|econnreset|etimedout/i.test(message);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withDbRetry<T>(operation: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (!isTransientLibsqlError(error) || attempt === attempts) break;
      const delay = Math.min(3000, 250 * Math.pow(2, attempt - 1));
      console.warn(`[db] transient ${label} error, retry ${attempt}/${attempts - 1} after ${delay}ms: ${error.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function executeBatch(statements: any[], mode: 'read' | 'write' = 'write') {
  for (let i = 0; i < statements.length; i += DB_BATCH_SIZE) {
    const chunk = statements.slice(i, i + DB_BATCH_SIZE);
    await withDbRetry(() => (db as any).batch(chunk, mode), `batch(${chunk.length})`);
  }
}

function normalizeOrigin(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function isCorsAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalized)) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
  return false;
}

function rowsToSettings(rows: any[]) {
  return Object.fromEntries(rows.map(row => [row.key, row.value])) as Record<string, string>;
}

function normalizeCompanyName(name: string) {
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

async function addApprovedCompanyFromRegistration(row: any) {
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

async function approveMatchingOtherCompanyRegistrations(row: any, reviewComment: string) {
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

async function approvePendingOtherRegistrationsFromApprovedNames() {
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

function lecturerDefaultQuota(name: string) {
  const upper = String(name || '').toUpperCase();
  if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return 5;
  if (/\bTS\b/.test(upper) || upper.includes('TS.')) return 8;
  return 10;
}

function isBachelorLecturer(name: string) {
  const upper = String(name || '').toUpperCase();
  return /\bCN\b/.test(upper) || upper.includes('CN.');
}

function getLecturerDegreePriority(name: string): number {
  const upper = String(name || '').toUpperCase();
  if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return 3;
  if (/\bTS\b/.test(upper) || upper.includes('TS.')) return 2;
  return 1;
}

function isWithinLocalWindow(settings: Record<string, string>, openKey: string, closeKey: string) {
  const now = new Date();
  const openAt = settings[openKey];
  const closeAt = settings[closeKey];
  if (openAt && now < new Date(openAt + ':00+07:00')) return { ok: false, error: 'Chưa đến thời gian cho phép.' };
  if (closeAt && now > new Date(closeAt + ':00+07:00')) return { ok: false, error: 'Đã hết thời gian cho phép.' };
  return { ok: true };
}

function cleanStudentName(rawName?: string, studentId?: string, email?: string): string {
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

  // 1. Handle duplicate name with separator: e.g. "Khuất Tuấn Anh - Khuất Tuấn Anh" or "Khuất Tuấn Anh - Khuất Tuấn"
  const sepParts = name.split(/\s*[-–—/|,]\s*/);
  if (sepParts.length === 2) {
    const p1 = sepParts[0].trim();
    const p2 = sepParts[1].trim();
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 ||
        (p2.length >= 2 && p1.toLowerCase().startsWith(p2.toLowerCase()))) {
      name = p1;
    }
  }

  // 2. Handle repeated name or truncated repeated name without separator
  // e.g. "Lê Tuấn Đạt Lê Tuấn Đạt" or "Phạm Đức Toàn Phạm Đức T"
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

  // 3. Handle 3-times repetition: e.g. length % 3 === 0
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

async function normalizeExistingStudentNames() {
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

async function exportRegistrationsToGoogleSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    const error = new Error('Chức năng này yêu cầu cấu hình Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL và GOOGLE_PRIVATE_KEY) trên Render.');
    (error as any).status = 400;
    throw error;
  }

  const setting = (await db.execute("SELECT value FROM settings WHERE key = 'export_google_sheet_url'")).rows[0] as unknown as { value: string };
  const url = setting?.value;
  if (!url) {
    const error = new Error('Bạn chưa cấu hình [Đường dẫn Google Sheet xuất dữ liệu] trong phần Cài đặt hệ thống.');
    (error as any).status = 400;
    throw error;
  }

  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    const error = new Error('URL Google Sheet không hợp lệ');
    (error as any).status = 400;
    throw error;
  }
  const spreadsheetId = match[1];

  const data = (await db.execute(`
    SELECT
      u.student_id as "Mã SV",
      u.name as "Họ và tên",
      u.dob as "Ngày sinh",
      u.class_name as "Lớp KH",
      CASE
        WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
        ELSE COALESCE(u.course_code, '')
      END as "Mã môn học",
      CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || coalesce(r.other_company_name, '') ELSE c.name END as "Nơi thực tập",
      CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_role, '') ELSE 'Thực tập sinh' END as "Vị trí",
      CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_contact, '') ELSE c.contact_email END as "Liên hệ",
      CASE WHEN c.name = 'Trường Đại học Công nghệ' THEN 'GVHD: ' || coalesce(r.other_company_contact, '') || CASE WHEN coalesce(r.note, '') != '' THEN ' - ' || r.note ELSE '' END ELSE r.note END as "Ghi chú",
      r.review_comment as "Nhận xét duyệt",
      r.status as "Trạng thái",
      r.created_at as "Thời gian đăng ký"
    FROM registrations r
    JOIN users u ON r.user_id = u.id
    JOIN companies c ON r.company_id = c.id
    ORDER BY r.created_at DESC
  `)).rows as any[];

  const headers = data.length > 0 ? ['STT', ...Object.keys(data[0])] : ['STT'];
  const rows = data.map((r, i) => [i + 1, ...Object.values(r)]);
  const sheetData = [headers, ...rows];

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: sheetData },
  });

  return { rowCount: data.length, spreadsheetId };
}

function reportObjectKey(year: string, studentId: string | null | undefined) {
  const cleanYear = String(year || new Date().getFullYear()).replace(/[^0-9A-Za-z_-]/g, '_');
  const cleanStudent = String(studentId || 'unknown').replace(/[^0-9A-Za-z_-]/g, '_');
  return `reports/${cleanYear}/${cleanStudent}/final.pdf`;
}

function safeFilename(filename: string) {
  const clean = String(filename || 'attachment')
    .replace(/[/\\]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, 180);
  return clean || 'attachment';
}

function safeDecodeHeader(value: string | undefined, fallback = '') {
  try {
    return decodeURIComponent(String(value || fallback));
  } catch (e) {
    return String(value || fallback);
  }
}

function fileExtension(filename: string) {
  const clean = safeFilename(filename);
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : '';
}

function chatAttachmentObjectKey(studentUserId: number, lecturerId: number, senderUserId: number, filename: string) {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `chat/${studentUserId}/${lecturerId}/${senderUserId}/${stamp}-${random}-${safeFilename(filename)}`;
}

function chatGroupAttachmentObjectKey(lecturerId: number, senderUserId: number, filename: string) {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `chat-groups/${lecturerId}/${senderUserId}/${stamp}-${random}-${safeFilename(filename)}`;
}

function isAllowedChatAttachment(filename: string, mimeType: string) {
  const ext = fileExtension(filename);
  const mime = String(mimeType || '').toLowerCase();
  return ALLOWED_CHAT_ATTACHMENT_EXTENSIONS.has(ext) || ALLOWED_CHAT_ATTACHMENT_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
}

function normalizeChatAttachmentMime(filename: string, mimeType: string) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = fileExtension(filename);
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    zip: 'application/zip',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || 'application/octet-stream';
}

function getR2Config() {
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

function getR2Client() {
  const config = getR2Config();
  if (!config) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return { client: r2Client, bucket: config.bucket };
}

function localReportPath(key: string) {
  return join(process.cwd(), 'scratch', 'final-reports', key);
}

function localChatAttachmentPath(key: string) {
  return join(process.cwd(), 'scratch', 'chat-attachments', key);
}

async function saveReportObject(key: string, file: Buffer) {
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: file,
      ContentType: 'application/pdf',
    }));
    return 'r2';
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho lưu báo cáo PDF. Cần R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY và R2_ACCOUNT_ID/R2_ENDPOINT.');
  }

  const localPath = localReportPath(key);
  fs.mkdirSync(dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, file);
  return 'local';
}

async function streamReportObject(key: string, res: any) {
  const r2 = getR2Client();
  if (r2) {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    const body = object.Body as any;
    if (!body) return false;
    if (typeof body.pipe === 'function') {
      body.pipe(res);
      return true;
    }
    if (typeof body.transformToByteArray === 'function') {
      res.end(Buffer.from(await body.transformToByteArray()));
      return true;
    }
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho tải báo cáo PDF.');
  }

  const localPath = localReportPath(key);
  if (!fs.existsSync(localPath)) return false;
  fs.createReadStream(localPath).pipe(res);
  return true;
}

async function deleteReportObject(key: string | null | undefined) {
  if (!key) return;
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    const localPath = localReportPath(key);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  }
}

async function saveChatAttachmentObject(key: string, file: Buffer, contentType: string) {
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: file,
      ContentType: contentType || 'application/octet-stream',
    }));
    return 'r2';
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho lưu file trao đổi. Cần R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY và R2_ACCOUNT_ID/R2_ENDPOINT.');
  }

  const localPath = localChatAttachmentPath(key);
  fs.mkdirSync(dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, file);
  return 'local';
}

async function streamChatAttachmentObject(key: string, res: any) {
  const r2 = getR2Client();
  if (r2) {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    const body = object.Body as any;
    if (!body) return false;
    if (typeof body.pipe === 'function') {
      body.pipe(res);
      return true;
    }
    if (typeof body.transformToByteArray === 'function') {
      res.end(Buffer.from(await body.transformToByteArray()));
      return true;
    }
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho tải file trao đổi.');
  }

  const localPath = localChatAttachmentPath(key);
  if (!fs.existsSync(localPath)) return false;
  fs.createReadStream(localPath).pipe(res);
  return true;
}

async function deleteChatAttachmentObject(key: string | null | undefined) {
  if (!key) return;
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
    const localPath = localChatAttachmentPath(key);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  }
}

async function cleanupChatAttachments(sql: string, args: any[]) {
  const rows = (await db.execute({ sql, args })).rows as any[];
  await Promise.all(rows
    .map(row => row.attachment_key)
    .filter(Boolean)
    .map(key => deleteChatAttachmentObject(String(key)).catch(() => undefined))
  );
}

function normalizeScore(value: any) {
  if (value === '' || value === null || value === undefined) return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 10) return undefined;
  return Math.round(score * 100) / 100;
}

function calculateFinalScore(progressScore: number | null, reportScore: number | null, companyScore: number | null) {
  if (progressScore === null || reportScore === null || companyScore === null) return null;
  return Math.round((progressScore * 0.2 + reportScore * 0.2 + companyScore * 0.6) * 100) / 100;
}

const DEFAULT_ALLOWED_REGISTRATION_COHORTS = 'K66,K67,K68';
const DEFAULT_REGISTRATION_RULES = [
  'Chỉ dành cho sinh viên nhận được thông báo.',
  'Mỗi sinh viên chọn tối đa 05 nơi thực tập.',
  'Sinh viên có thể lựa chọn các công ty không có trong Danh sách (các công ty đăng ký tiếp nhận thực tập sinh chính thức với Khoa). Nếu công ty đó có trong danh sách các công ty đã được Khoa thẩm định chất lượng thì sẽ được phê duyệt tự động. Ngược lại, công ty đó sẽ được Khoa xem xét và phê duyệt sau.',
  'Sinh viên có nhu cầu Thực tập tại trường có thể đăng ký Nơi thực tập là Trường Đại học Công nghệ, lưu ý phải tìm và được sự đồng ý hướng dẫn của Giảng viên Khoa CNTT.',
  'Sinh viên có thể thay đổi đăng ký bằng cách chọn "Huỷ tất cả đăng ký" và đăng ký lại từ đầu trong thời gian Khoa mở đăng ký.',
].join('\n');
const DEFAULT_STUDENT_FAQ = `## FAQ cho sinh viên

### 1. Em được đăng ký tối đa bao nhiêu nơi thực tập?
Mỗi sinh viên được đăng ký tối đa 05 nơi thực tập trong thời gian Khoa mở đăng ký.

### 2. Em có thể đăng ký công ty tự liên hệ không?
Có. Nếu công ty đã nằm trong danh sách thẩm định nội bộ của Khoa, đăng ký sẽ được duyệt tự động. Nếu chưa có, Khoa sẽ xem xét và duyệt thủ công.

### 3. Sau khi có kết quả phỏng vấn, em cần làm gì?
Em cần đăng nhập hệ thống và xác nhận đúng một nơi thực tập chính thức đã trúng tuyển trong thời hạn Khoa cho phép.

### 4. Nếu không trúng tuyển công ty nào thì sao?
Em có thể đăng ký thực tập tại trường. Nếu đã được giảng viên đồng ý, em chọn giảng viên đó; nếu chưa có GVHD, Khoa sẽ phân công sau.

### 5. Báo cáo nộp ở đâu và định dạng gì?
Em nộp báo cáo trên hệ thống trong thời gian mở nộp. File phải là PDF và không vượt quá 10 MB. Báo cáo định kỳ vẫn trao đổi trực tiếp với giảng viên qua email.

### 6. Em thấy đăng ký bị từ chối thì xem lý do ở đâu?
Lý do hoặc nhận xét của Khoa được hiển thị trong hồ sơ đăng ký và trong mục Thông báo.`;
const DEFAULT_LECTURER_FAQ = `## FAQ cho giảng viên

### 1. Giảng viên xem danh sách sinh viên được phân công ở đâu?
Giảng viên đăng nhập hệ thống bằng email VNU, trang chủ giảng viên sẽ hiển thị danh sách sinh viên được Khoa phân công hướng dẫn hoặc đồng hướng dẫn.

### 2. Giảng viên cần đánh giá những gì trên hệ thống?
Giảng viên nhập điểm quá trình, điểm báo cáo, điểm doanh nghiệp và nhận xét nếu có. Hệ thống tự tính điểm tổng kết theo cấu hình hiện tại.

### 3. Báo cáo của sinh viên được xử lý thế nào?
Sinh viên nộp file PDF trên hệ thống. Giảng viên có thể tải báo cáo, đánh dấu đã chấp nhận hoặc yêu cầu nộp lại kèm ghi chú.

### 4. Giảng viên có nhận thông báo trên website không?
Có. Các thông báo liên quan đến phân công hướng dẫn, báo cáo và thông báo chung từ Khoa được hiển thị ở biểu tượng chuông và trang Thông báo.

### 5. Giảng viên CN có được hướng dẫn chính không?
Theo nghiệp vụ hiện tại, giảng viên có tên chứa “CN” không được làm hướng dẫn chính, chỉ có thể là đồng hướng dẫn.

### 6. Khi cần điều chỉnh phân công hoặc điểm đã khóa thì làm gì?
Giảng viên liên hệ Khoa để được hỗ trợ mở khóa hoặc điều chỉnh theo quy trình quản lý của Khoa.`;

const DEFAULT_LECTURER_GUIDE = `# Hướng dẫn sử dụng hệ thống cho giảng viên

Tài liệu này mô tả các chức năng chính dành cho giảng viên hướng dẫn thực tập trên hệ thống. Nội dung có thể được Khoa cập nhật theo từng đợt triển khai.

## 1. Đăng nhập và truy cập trang giảng viên

- Giảng viên đăng nhập bằng tài khoản email VNU đã có trong danh sách giảng viên của hệ thống.
- Sau khi đăng nhập, chọn **Trang giảng viên** từ avatar hoặc truy cập trang chủ dành cho giảng viên.
- Nếu tài khoản là quản trị viên đồng thời là giảng viên, trong menu avatar vẫn có lối vào **Trang giảng viên** và **Chấm điểm thực tập**.

## 2. Xem danh sách sinh viên phụ trách

Tại trang giảng viên, khối **Sinh viên phụ trách** hiển thị các sinh viên đã được Khoa phân công cho giảng viên.

Các thông tin chính gồm:

- Mã sinh viên, họ tên, lớp khóa học và học phần.
- Vai trò hướng dẫn: **Hướng dẫn chính** hoặc **Đồng hướng dẫn**.
- Nơi thực tập chính thức nếu sinh viên đã xác nhận; riêng sinh viên thực tập tại trường sẽ hiển thị **Trường Đại học Công nghệ**.
- Thông tin liên hệ của sinh viên, gồm email VNU, email khác nếu có và số điện thoại.
- Trạng thái báo cáo.

## 3. Đánh dấu tình trạng sinh viên đã liên hệ

Mặc định sinh viên mới được phân công được xem là **chưa liên hệ** để giảng viên dễ theo dõi.

Giảng viên có thể:

- Tích **Đã liên hệ** khi sinh viên đã chủ động trao đổi hoặc giảng viên đã liên hệ được.
- Ghi chú nhanh tình trạng liên hệ, ví dụ: đã trao đổi đề tài, chưa phản hồi email, cần bổ sung thông tin công ty.
- Xuất danh sách XLSX để lưu hoặc xử lý ngoài hệ thống.

## 4. Trao đổi với sinh viên

Hệ thống hỗ trợ hai kiểu trao đổi:

### Chat riêng

- Mỗi sinh viên được phân công với giảng viên sẽ có một cuộc trò chuyện riêng.
- Dùng để trao đổi tiến độ, góp ý báo cáo, nhắc sinh viên bổ sung thông tin hoặc gửi file liên quan.

### Chat nhóm

- Mỗi giảng viên có một nhóm chat với toàn bộ sinh viên mình hướng dẫn.
- Dùng để gửi thông báo chung, hướng dẫn chung hoặc nhắc mốc thời gian cho cả nhóm.
- Sinh viên chỉ thấy nhóm của giảng viên đang hướng dẫn mình.

## 5. Gửi và quản lý file trong chat

Trong chat riêng và chat nhóm, người dùng có thể gửi file đính kèm.

Quy định mặc định:

- Hỗ trợ PDF, Word, Excel, PowerPoint, TXT, ZIP, JPG và PNG.
- Mỗi file tối đa 10 MB.
- Hệ thống có quota lưu trữ theo cuộc trò chuyện và quota upload theo ngày.
- Có thể xem trước file PDF/ảnh nếu trình duyệt hỗ trợ.
- Người gửi có thể **thu hồi** tin nhắn; nếu tin nhắn có file, file cũng được xóa khỏi kho lưu trữ.

## 6. Xem và xử lý báo cáo

Sinh viên nộp báo cáo PDF trên hệ thống trong thời gian Khoa mở nộp.

Giảng viên có thể:

- Xem trạng thái nộp báo cáo của từng sinh viên trong trang giảng viên.
- Tải báo cáo để đọc và đánh giá.
- Đánh dấu báo cáo đã chấp nhận hoặc yêu cầu sinh viên nộp lại nếu cần.
- Ghi nhận xét khi yêu cầu nộp lại để sinh viên biết nội dung cần sửa.

## 7. Chấm điểm thực tập

Chỉ **giảng viên hướng dẫn chính** có quyền nhập và nộp điểm cho sinh viên.

Trang **Chấm điểm thực tập** cho phép:

- Xem danh sách sinh viên mà giảng viên là hướng dẫn chính.
- Tải báo cáo nếu sinh viên đã nộp.
- Nhập điểm quá trình, điểm báo cáo và điểm đánh giá công ty hoặc giảng viên.
- Hệ thống tự tính điểm tổng kết theo công thức hiện tại: 20% quá trình, 20% báo cáo, 60% đánh giá công ty hoặc giảng viên.
- Lưu nháp trong quá trình chấm.
- Nộp điểm về Khoa khi đã hoàn tất.

Sau khi điểm đã khóa hoặc đã tổng hợp, nếu cần sửa điểm giảng viên liên hệ Khoa để được hỗ trợ theo quy trình.

## 8. Thông báo trên website

Giảng viên có thể xem thông báo từ biểu tượng chuông hoặc mục **Thông báo**.

Thông báo có thể bao gồm:

- Thông báo chung từ Khoa.
- Các thông báo liên quan đến báo cáo, điểm hoặc phân công.
- Câu trả lời cho câu hỏi FAQ nếu giảng viên gửi câu hỏi.

## 9. FAQ và gửi câu hỏi

Trang **FAQ** hiển thị nội dung câu hỏi thường gặp theo vai trò giảng viên.

Nếu chưa rõ quy trình hoặc gặp lỗi nghiệp vụ, giảng viên có thể gửi câu hỏi tại trang FAQ. Quản trị viên sẽ trả lời trên hệ thống; câu trả lời cũng được hiển thị trong mục thông báo.

## 10. Các lỗi thường gặp

| Tình huống | Cách xử lý |
| --- | --- |
| Không thấy sinh viên trong danh sách phụ trách | Kiểm tra lại phân công với Khoa; sinh viên có thể chưa được phân công GVHD trên hệ thống. |
| Không tải được báo cáo | Thử tải lại trang; nếu vẫn lỗi, liên hệ Khoa để kiểm tra file hoặc cấu hình lưu trữ. |
| Không nhập được điểm | Kiểm tra giảng viên có phải hướng dẫn chính hay không; đồng hướng dẫn không có quyền nhập điểm. |
| Không thấy nút chấm điểm | Tài khoản có thể chưa được nhận diện là giảng viên hoặc chưa có sinh viên hướng dẫn chính. |
| Cần sửa điểm đã nộp hoặc đã khóa | Liên hệ Khoa để mở khóa hoặc điều chỉnh theo quy trình. |

## 11. Khuyến nghị vận hành

- Kiểm tra danh sách sinh viên phụ trách ngay sau khi Khoa công bố phân công.
- Đánh dấu tình trạng liên hệ để tránh bỏ sót sinh viên.
- Dùng chat nhóm cho thông báo chung và chat riêng cho góp ý cá nhân.
- Tải và kiểm tra báo cáo trước hạn chấm điểm.
- Lưu nháp điểm trước khi nộp chính thức về Khoa.`;

function cohortFromVnuEmail(email: string) {
  const localPart = String(email || '').toLowerCase().split('@')[0] || '';
  const prefix = localPart.match(/^\d{4}/)?.[0] || '';
  const yearCode = Number(prefix.slice(0, 2));
  if (!Number.isInteger(yearCode) || yearCode < 0) return null;
  return `K${yearCode + 45}`;
}

async function getAllowedRegistrationCohorts() {
  const row = (await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'allowed_registration_cohorts'",
    args: [],
  })).rows[0] as { value?: string } | undefined;
  return new Set(String(row?.value || DEFAULT_ALLOWED_REGISTRATION_COHORTS).split(',').map(item => item.trim()).filter(Boolean));
}

async function getRegistrationExceptionEmails() {
  const row = (await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'registration_exception_emails'",
    args: [],
  })).rows[0] as { value?: string } | undefined;
  return new Set(String(row?.value || '')
    .split(/[\s,;]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean));
}

async function isListedStudentCohortException(email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const studentId = normalizedEmail.split('@')[0] || '';
  if (!studentId) return false;
  const row = (await db.execute({
    sql: `SELECT id FROM users
          WHERE role = 'student'
            AND (lower(email) = ? OR student_id = ?)
          LIMIT 1`,
    args: [normalizedEmail, studentId],
  })).rows[0];
  return Boolean(row);
}

async function assertStudentCohortAllowed(email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cohort = cohortFromVnuEmail(email);
  const allowed = await getAllowedRegistrationCohorts();
  if (cohort && allowed.has(cohort)) return;
  if (await isListedStudentCohortException(normalizedEmail)) return;
  const allowedText = Array.from(allowed).join(', ') || 'không có khóa nào';
  throw new Error(`Khóa ${cohort || 'không xác định'} không được phép đăng nhập/đăng ký học phần trong đợt này. Các khóa đang mở: ${allowedText}.`);
}

function parseEmailAddress(value: string | undefined) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '');
    return { email: match[2].trim(), name: name || undefined };
  }
  return { email: raw };
}

function emailDailySendCap() {
  const configured = Number(process.env.EMAIL_DAILY_SEND_CAP || process.env.BREVO_DAILY_SEND_CAP || 250);
  if (!Number.isFinite(configured) || configured < 1) return 250;
  return Math.min(Math.floor(configured), 300);
}

function emailBatchSize() {
  const configured = Number(process.env.EMAIL_BATCH_SIZE || 25);
  if (!Number.isFinite(configured) || configured < 1) return 25;
  return Math.min(Math.floor(configured), 100);
}

async function emailSentTodayCount() {
  const row = (await db.execute(`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE status = 'sent'
      AND date(sent_at) = date('now', '+7 hours')
  `)).rows[0] as any;
  return Number(row?.count || 0);
}

type NotificationInput = {
  user_id?: number | null;
  recipient_email: string;
  cc_emails?: string[];
  type: string;
  subject: string;
  body: string;
  status?: 'queued' | 'website_only';
  send_now?: boolean;
  no_queue_on_send_skip?: boolean;
};

async function insertNotification(data: NotificationInput) {
  if (!data.recipient_email) return null;
  const status = data.status === 'website_only' ? 'website_only' : 'queued';
  const result = await db.execute({
    sql: `INSERT INTO notifications (user_id, recipient_email, type, subject, body, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
    args: [data.user_id || null, data.recipient_email, data.type, data.subject, data.body, status],
  });
  return { id: Number(result.lastInsertRowid), status } as const;
}

async function createNotification(data: NotificationInput) {
  try {
    const notification = await insertNotification(data);
    if (!notification) return;
    if (notification.status === 'queued' && (data.send_now || process.env.EMAIL_SEND_IMMEDIATE === 'true')) {
      const notificationId = notification.id;
      const sendStatus = await sendNotificationEmail(notificationId, data);
      if (data.no_queue_on_send_skip && sendStatus === 'queued') {
        await db.execute({
          sql: `UPDATE notifications
                SET status = 'website_only',
                    error = COALESCE(error, 'Email chưa gửi do hết quota hoặc chưa cấu hình provider; thông báo chỉ hiển thị trên website.')
                WHERE id = ?`,
          args: [notificationId],
        });
        return 'website_only';
      }
      return sendStatus;
    }
    return notification.status;
  } catch (e) {
    // Notification failures must not block the main business flow.
  }
}

async function sendNotificationEmail(notificationId: number, data: {
  recipient_email: string;
  cc_emails?: string[];
  subject: string;
  body: string;
}) {
  const from = process.env.EMAIL_FROM || process.env.NOTIFICATION_EMAIL_FROM;
  const provider = (process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '')).toLowerCase();
  if (!from || !notificationId) return 'queued';
  if ((await emailSentTodayCount()) >= emailDailySendCap()) return 'queued';
  try {
    let response: Response;
    let providerMessageId: string | null = null;
    if (provider === 'brevo') {
      const apiKey = process.env.BREVO_API_KEY;
      if (!apiKey) return 'queued';
      response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: parseEmailAddress(from),
          to: [parseEmailAddress(data.recipient_email)],
          ...((data.cc_emails || []).length > 0 ? { cc: data.cc_emails.map(parseEmailAddress) } : {}),
          subject: data.subject,
          textContent: data.body,
        }),
      });
    } else if (provider === 'resend') {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return 'queued';
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [data.recipient_email],
          ...((data.cc_emails || []).length > 0 ? { cc: data.cc_emails } : {}),
          subject: data.subject,
          text: data.body,
        }),
      });
    } else {
      return 'queued';
    }
    const responseText = await response.text();
    if (response.status === 429) {
      await db.execute({
        sql: `UPDATE notifications
              SET error = ?, provider = ?, last_attempt_at = datetime('now', '+7 hours')
              WHERE id = ?`,
        args: ['Provider rate limit exceeded; giữ trong hàng đợi để gửi lại sau.', provider, notificationId],
      });
      return 'queued';
    }
    if (!response.ok) throw new Error(responseText.slice(0, 1000));
    try {
      const json = JSON.parse(responseText);
      providerMessageId = json.messageId || json.id || null;
    } catch (e) { }
    await db.execute({
      sql: `UPDATE notifications
            SET status = 'sent', sent_at = datetime('now', '+7 hours'), error = NULL,
                provider = ?, provider_message_id = ?, attempt_count = COALESCE(attempt_count, 0) + 1,
                last_attempt_at = datetime('now', '+7 hours')
            WHERE id = ?`,
      args: [provider, providerMessageId, notificationId],
    });
    return 'sent';
  } catch (e: any) {
    const rawError = String(e?.message || e);
    let message = rawError;
    if (/unrecognised IP address|authorised_ips|authorized_ips/i.test(rawError)) {
      const ipMatch = rawError.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      message = `Brevo đang chặn IP máy chủ${ipMatch ? ` ${ipMatch[0]}` : ''}. Vào Brevo > Security > Authorised IPs để thêm IP này, hoặc tắt giới hạn Authorized IPs nếu không cần. Lỗi gốc: ${rawError}`;
    }
    await db.execute({
      sql: `UPDATE notifications
            SET status = 'failed', error = ?, provider = ?,
                attempt_count = COALESCE(attempt_count, 0) + 1,
                last_attempt_at = datetime('now', '+7 hours')
            WHERE id = ?`,
      args: [message.slice(0, 1000), process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : 'resend'), notificationId],
    });
    return 'failed';
  }
}

async function sendQueuedNotificationBatch(options: { requestedLimit?: number; notificationIds?: number[]; ignoreBatchSize?: boolean } = {}) {
  const sentToday = await emailSentTodayCount();
  const remainingToday = Math.max(0, emailDailySendCap() - sentToday);
  const batchLimit = options.ignoreBatchSize ? remainingToday : emailBatchSize();
  const hasSelectedIds = Array.isArray(options.notificationIds);
  const normalizedIds = Array.from(new Set((options.notificationIds || [])
    .map(id => Number(id))
    .filter(id => Number.isInteger(id) && id > 0)));
  const requestedLimit = options.requestedLimit === undefined
    ? (hasSelectedIds ? normalizedIds.length : batchLimit)
    : Math.max(0, Number(options.requestedLimit) || 0);
  const idLimit = hasSelectedIds ? normalizedIds.length : requestedLimit;
  const limit = Math.max(0, Math.min(requestedLimit, idLimit, batchLimit, remainingToday));
  if (limit === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining_today: remainingToday,
      message: remainingToday === 0 ? 'Đã đạt giới hạn gửi email hôm nay.' : 'Không có thông báo phù hợp để gửi.',
    };
  }

  let rows: any[];
  if (hasSelectedIds) {
    const selectedRows: any[] = [];
    for (let offset = 0; offset < normalizedIds.length; offset += DB_BATCH_SIZE) {
      const idChunk = normalizedIds.slice(offset, offset + DB_BATCH_SIZE);
      const chunkRows = (await db.execute({
        sql: `SELECT id, recipient_email, subject, body
              FROM notifications
              WHERE status = 'queued'
                AND id IN (${idChunk.map(() => '?').join(',')})`,
        args: idChunk,
      })).rows as any[];
      selectedRows.push(...chunkRows);
    }
    rows = selectedRows.sort((a, b) => Number(a.id) - Number(b.id)).slice(0, limit);
  } else {
    rows = (await db.execute({
      sql: `SELECT id, recipient_email, subject, body
            FROM notifications
            WHERE status = 'queued'
            ORDER BY created_at ASC, id ASC
            LIMIT ?`,
      args: [limit],
    })).rows as any[];
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendNotificationEmail(Number(row.id), {
      recipient_email: row.recipient_email,
      subject: row.subject,
      body: row.body,
    });
    if (result === 'sent') sent++;
    else if (result === 'failed') failed++;
    else break;
  }
  return {
    sent,
    failed,
    skipped: Math.max(0, rows.length - sent - failed),
    remaining_today: Math.max(0, remainingToday - sent),
    selected: normalizedIds.length || null,
  };
}

let cachedItCompanyNames: { mtimeMs: number; names: Set<string> } | null = null;

function getItCompanyNameSet() {
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

async function getSqliteObjectType(name: string) {
  const row = (await db.execute({
    sql: "SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
    args: [name]
  })).rows[0] as { type?: string } | undefined;
  return row?.type || null;
}

async function deleteLegacyStudentRow(studentId: string, email?: string | null) {
  const studentsType = await getSqliteObjectType('students');
  if (studentsType !== 'table') return false;

  const columns = new Set(
    ((await db.execute('PRAGMA table_info(students)')).rows as any[])
      .map(row => String(row.name || ''))
      .filter(Boolean)
  );
  const clauses: string[] = [];
  const args: string[] = [];

  if (columns.has('student_id') && studentId) {
    clauses.push('student_id = ?');
    args.push(studentId);
  }
  if (columns.has('email') && email) {
    clauses.push('email = ?');
    args.push(email);
  }
  if (clauses.length === 0) return false;

  await db.execute({
    sql: `DELETE FROM students WHERE ${clauses.join(' OR ')}`,
    args,
  });
  return true;
}

async function consolidateLegacyPeopleTables() {
  const studentsType = await getSqliteObjectType('students');
  if (studentsType === 'table') {
    await db.executeMultiple(`
      INSERT INTO users (email, name, picture, role, student_id, dob, class_name, course_code)
      SELECT email, name, picture, 'student', student_id, dob, class_name, course_code
      FROM students
      WHERE email IS NOT NULL AND email != ''
      ON CONFLICT(email) DO UPDATE SET
        name = COALESCE(NULLIF(users.name, ''), excluded.name),
        picture = COALESCE(users.picture, excluded.picture),
        student_id = COALESCE(NULLIF(users.student_id, ''), excluded.student_id),
        dob = COALESCE(NULLIF(users.dob, ''), excluded.dob),
        class_name = COALESCE(NULLIF(users.class_name, ''), excluded.class_name),
        course_code = COALESCE(NULLIF(users.course_code, ''), excluded.course_code);
      DROP TABLE students;
    `);
  }

  const adminsType = await getSqliteObjectType('admins');
  if (adminsType === 'table') {
    await db.executeMultiple(`
      INSERT INTO users (email, name, picture, role)
      SELECT email, name, picture, 'admin'
      FROM admins
      WHERE email IS NOT NULL AND email != ''
      ON CONFLICT(email) DO UPDATE SET
        role = 'admin',
        name = COALESCE(NULLIF(users.name, ''), excluded.name),
        picture = COALESCE(users.picture, excluded.picture);
      DROP TABLE admins;
    `);
  }

  await db.executeMultiple(`
    DROP VIEW IF EXISTS students;
    CREATE VIEW students AS
      SELECT id, email, name, picture, student_id, dob, class_name, course_code
      FROM users
      WHERE role = 'student';

    DROP VIEW IF EXISTS admins;
    CREATE VIEW admins AS
      SELECT id, email, name, picture
      FROM users
      WHERE role = 'admin';
  `);
}

async function syncLecturerUsers() {
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
      WHERE role = 'admin' AND COALESCE(is_lecturer, 0) = 1
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

async function ensureDbIndexes(force = false) {
  if (force) {
    await db.executeMultiple(`
      DELETE FROM registrations
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM registrations
        GROUP BY user_id, company_id, COALESCE(other_company_name, '')
      );
    `);
  }

  await db.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id_unique
      ON users(student_id)
      WHERE role = 'student' AND student_id IS NOT NULL AND student_id != '';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_unique ON companies(name);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_lecturers_email_unique
      ON lecturers(email)
      WHERE email IS NOT NULL AND email != '';
    CREATE INDEX IF NOT EXISTS idx_lecturers_name ON lecturers(name);

    CREATE INDEX IF NOT EXISTS idx_registrations_user_id ON registrations(user_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_company_status ON registrations(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_registrations_created_at ON registrations(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_user_company_other_unique
      ON registrations(user_id, company_id, COALESCE(other_company_name, ''));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_approved_company_names_normalized_unique
      ON approved_company_names(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_final_internships_user_id ON final_internships(user_id);
    CREATE INDEX IF NOT EXISTS idx_final_internships_company_id ON final_internships(company_id);
    CREATE INDEX IF NOT EXISTS idx_advisor_assignments_user_id ON advisor_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_advisor_assignments_lecturer_id ON advisor_assignments(lecturer_id);
    CREATE INDEX IF NOT EXISTS idx_advisor_assignments_lecturer_role_user ON advisor_assignments(lecturer_id, role, user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_assignments_primary_unique
      ON advisor_assignments(user_id)
      WHERE role = 'primary';
    CREATE INDEX IF NOT EXISTS idx_final_reports_user_id ON final_reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_grades_user_id ON grades(user_id);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(student_user_id, lecturer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(student_user_id, lecturer_id, sender_user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_student_lecturer_id ON chat_messages(student_user_id, lecturer_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient_nocase ON notifications(recipient_email COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    CREATE INDEX IF NOT EXISTS idx_system_notifications_active_role ON system_notifications(active, target_role, created_at);
  `);
}

async function ensureSpecialCompanies() {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: ['Công ty khác', 'Đăng ký công ty ngoài danh sách phải đảm bảo công ty đó đáp ứng được chất lượng thực tập. Các công ty nằm trong danh sách do Khoa thẩm định sẽ được phê duyệt ngay lập tức. Các công ty còn lại cần được Khoa xem xét.', 9999, '', '', '', '', '', '', '']
  });

  await db.execute({
    sql: `
      INSERT OR IGNORE INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: ['Trường Đại học Công nghệ', 'Sinh viên thực tập tại các Lab/Dự án trong trường. Lưu ý, cần phải liên hệ và được sự đồng ý của Giảng viên từ trước và không được đăng ký thực tập ở công ty.', 9999, '', '', '', '', '', '', '']
  });
}

async function seedApprovedCompanyNamesIfEmpty() {
  const count = (await db.execute('SELECT COUNT(*) as count FROM approved_company_names')).rows[0] as unknown as { count: number };
  if (count.count > 0) return;
  const itCompaniesFile = join(process.cwd(), 'data/seed/it-companies-list.csv');
  if (!fs.existsSync(itCompaniesFile)) return;
  const content = fs.readFileSync(itCompaniesFile, 'utf8');
  const records = parse(content, { columns: true, skip_empty_lines: true });
  const statements = records.map((record: any) => {
    const name = String(record['Tên công ty'] || '').trim();
    const normalized = normalizeCompanyName(name);
    if (!name || !normalized) return null;
    return {
      sql: `INSERT OR IGNORE INTO approved_company_names (name, normalized_name, source) VALUES (?, ?, 'csv')`,
      args: [name, normalized],
    };
  }).filter(Boolean);
  if (statements.length > 0) await executeBatch(statements);
}

async function initDb() {
  if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET is required in production.');
  }

  const d1Token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_API_TOKEN;
  const d1AccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '7f6e0debd543c1ec1871f4f6d2c03dd5';
  const d1DatabaseId = process.env.CLOUDFLARE_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || '866e23b7-3b49-43e4-ab90-59dceb4c4f76';
  const dbProvider = (process.env.DB_PROVIDER || (d1Token ? 'd1' : 'turso')).toLowerCase();

  if (dbProvider === 'd1') {
    if (!d1Token) {
      throw new Error('CLOUDFLARE_API_TOKEN (or CLOUDFLARE_D1_API_TOKEN) is required when DB_PROVIDER=d1.');
    }
    console.log(`[db] Using Cloudflare D1 database: ${d1DatabaseId} (Account: ${d1AccountId})`);
    db = new CloudflareD1Client(d1AccountId, d1DatabaseId, d1Token);
  } else {
    const rawUrl = process.env.TURSO_DATABASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'file:./internship-db.db');
    const databaseUrl = rawUrl.trim().replace(/^["']|["']$/g, '');
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim().replace(/^["']|["']$/g, '');
    if (!databaseUrl) {
      throw new Error('TURSO_DATABASE_URL or CLOUDFLARE_API_TOKEN is required in production.');
    }
    if (databaseUrl.startsWith('libsql://') && !authToken) {
      throw new Error('TURSO_AUTH_TOKEN is required for Turso libsql databases.');
    }
    console.log(`[db] Using Turso database: ${databaseUrl}`);
    db = createClient({
      url: databaseUrl,
      authToken
    }) as any;
  }
  const rawExecute = db.execute.bind(db);
  const rawExecuteMultiple = db.executeMultiple.bind(db);
  db.execute = ((statement: any) => withDbRetry(() => rawExecute(statement), 'execute')) as any;
  db.executeMultiple = ((sql: string) => withDbRetry(() => rawExecuteMultiple(sql), 'executeMultiple')) as any;
  await db.execute('PRAGMA foreign_keys = ON');

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'lecturer', 'admin')),
      is_lecturer INTEGER DEFAULT 0,  -- 1 if this user is in the lecturer directory
      student_id TEXT,
      dob TEXT,
      class_name TEXT,
      course_code TEXT,
      phone TEXT,
      personal_email TEXT
    );
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      slots INTEGER NOT NULL DEFAULT 5,
      contact_email TEXT,
      history TEXT,
      qualifications TEXT,
      address TEXT,
      recruitment_link TEXT,
      phone TEXT,
      applicants_drive_link TEXT
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      note TEXT,
      review_comment TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      preference_order INTEGER,
      sent_to_company_at DATETIME,
      sent_to_company_note TEXT,
      created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (company_id) REFERENCES companies (id)
    );
    CREATE TABLE IF NOT EXISTS approved_company_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      normalized_name TEXT UNIQUE NOT NULL,
      source TEXT DEFAULT 'csv',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS final_internships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      registration_id INTEGER,
      company_id INTEGER,
      internship_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      student_attested INTEGER NOT NULL DEFAULT 0,
      attestation_text TEXT,
      school_lecturer TEXT,
      school_assignment_request INTEGER NOT NULL DEFAULT 0,
      confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_by INTEGER,
      locked_at DATETIME,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS advisor_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lecturer_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      assigned_by INTEGER,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT,
      contacted_at DATETIME,
      contact_note TEXT,
      UNIQUE(user_id, lecturer_id, role)
    );
    CREATE TABLE IF NOT EXISTS lecturer_quotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecturer_id INTEGER UNIQUE NOT NULL,
      max_total_students INTEGER,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS advisor_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      lecturer_id INTEGER,
      co_lecturer_id INTEGER,
      lecturer_name_text TEXT,
      co_lecturer_name_text TEXT,
      request_type TEXT NOT NULL DEFAULT 'agreed',
      status TEXT NOT NULL DEFAULT 'pending',
      quota_status TEXT NOT NULL DEFAULT 'unknown',
      student_note TEXT,
      admin_note TEXT,
      source_registration_id INTEGER,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS advisor_assignment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER,
      user_id INTEGER NOT NULL,
      lecturer_id INTEGER,
      role TEXT,
      action TEXT NOT NULL,
      actor_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS final_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      object_key TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      lecturer_comment TEXT
    );
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      lecturer_id INTEGER NOT NULL,
      progress_score REAL,
      report_score REAL,
      company_score REAL,
      final_score REAL,
      status TEXT NOT NULL DEFAULT 'draft',
      comment TEXT,
      submitted_at DATETIME,
      locked_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      recipient_email TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      provider TEXT,
      provider_message_id TEXT,
      attempt_count INTEGER DEFAULT 0,
      last_attempt_at DATETIME,
      read_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL,
      lecturer_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      attachment_key TEXT,
      attachment_name TEXT,
      attachment_size INTEGER,
      attachment_mime TEXT,
      created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      read_at DATETIME,
      FOREIGN KEY (student_user_id) REFERENCES users (id),
      FOREIGN KEY (lecturer_id) REFERENCES lecturers (id),
      FOREIGN KEY (sender_user_id) REFERENCES users (id)
    );
    CREATE TABLE IF NOT EXISTS chat_group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecturer_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      attachment_key TEXT,
      attachment_name TEXT,
      attachment_size INTEGER,
      attachment_mime TEXT,
      created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      FOREIGN KEY (lecturer_id) REFERENCES lecturers (id),
      FOREIGN KEY (sender_user_id) REFERENCES users (id)
    );
    CREATE TABLE IF NOT EXISTS chat_group_message_reads (
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS system_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'system_announcement',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      target_role TEXT NOT NULL DEFAULT 'all',
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS system_notification_reads (
      system_notification_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (system_notification_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS faq_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      answered_at DATETIME,
      answered_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS lecturers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      email TEXT,
      work_unit TEXT,
      students_drive_link TEXT
    );
  `);

  // Seed settings if empty
  const defaultSheetUrl = 'https://docs.google.com/spreadsheets/d/1VVH_O6glb3e9ugXa7SZcm0JuSNxm9NtarHRKubwJeY4/export?format=csv';
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('google_sheet_url', '${defaultSheetUrl}')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('campaign_year', '2026')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('campaign_start', '22/05/2026')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('campaign_end', '15/06/2026')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_open_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_close_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('confirmation_open_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('confirmation_close_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('final_report_open_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('final_report_close_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('advisor_request_open_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('advisor_request_close_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('advisor_auto_assigned_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('allowed_registration_cohorts', '${DEFAULT_ALLOWED_REGISTRATION_COHORTS}')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_exception_emails', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('advisor_quota_pgs', '5')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('advisor_quota_ts', '8')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('advisor_quota_ths', '10')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_rules_md', '${DEFAULT_REGISTRATION_RULES.replace(/'/g, "''")}')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('faq_student_md', '${DEFAULT_STUDENT_FAQ.replace(/'/g, "''")}')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('faq_lecturer_md', '${DEFAULT_LECTURER_FAQ.replace(/'/g, "''")}')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('lecturer_guide_md', '${DEFAULT_LECTURER_GUIDE.replace(/'/g, "''")}')`);
  const defaultClasses = 'QH-2023-I/CQ-I-IT1, QH-2023-I/CQ-I-IT2, QH-2023-I/CQ-I-IT3, QH-2023-I/CQ-I-IS, QH-2023-I/CQ-I-CS1, QH-2023-I/CQ-I-CS2, QH-2023-I/CQ-I-CS3, QH-2023-I/CQ-I-CS4, QH-2023-I/CQ-I-CN';
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('classes_list', '${defaultClasses}')`);

  const defaultPlan = `## KẾ HOẠCH TRIỂN KHAI HỌC PHẦN THỰC TẬP

Khoa Công nghệ Thông tin thông báo triển khai các học phần Thực tập dành cho sinh viên từ khóa **K68 trở về trước**, bao gồm các học phần:

1. **Thực tập Doanh nghiệp** (INT4002)
2. **Thực tập Chuyên ngành** (INT3508)
3. **Thực tập Doanh nghiệp Nhật Bản** (INT4003)

---

### 🔹 Thời hạn đăng ký
- **Thời gian:** Từ **18/05** đến **8h00, ngày 25/05/2026**
- 👉 **_Lưu ý quan trọng:_** Danh sách sinh viên đăng ký trên hệ thống sẽ được sử dụng làm danh sách chính thức để Khoa/Nhà trường thực hiện đăng ký học phần trên cổng đào tạo. Vì vậy, đề nghị sinh viên cân nhắc kỹ trước khi đăng ký và điền đầy đủ, chính xác thông tin theo yêu cầu.

---

### 📌 Mốc thời gian quan trọng

| STT | Mốc thời gian | Nội dung công việc |
| :---: | :--- | :--- |
| **1** | **25/05 – 31/05** | Khoa gửi danh sách sinh viên đăng ký đến các doanh nghiệp để tiến hành phỏng vấn (nếu có). |
| **2** | **25/05 – 31/05** | Khoa phân công giảng viên hướng dẫn thực tập cho sinh viên. |
| **3** | **10/06 – 17/06/2026** | Sinh viên chủ động liên hệ với Thầy/Cô hướng dẫn để trao đổi, nhận hướng dẫn về nội dung thực tập, kế hoạch thực hiện và các yêu cầu liên quan đến học phần. |
| **4** | **15/06 – 31/08** | **Sinh viên bắt đầu kỳ thực tập tại doanh nghiệp.**<br>_Lưu ý:_ Thời gian thực tập tại mỗi công ty có thể khác nhau, nhưng phải đảm bảo **tối thiểu 6 tuần làm việc full-time**. Sinh viên cần báo cáo định kỳ với giảng viên hướng dẫn. |
| **5** | **15/07 – 30/09** | Các sinh viên không tìm được cơ hội thực tập tại doanh nghiệp sẽ thực hiện **thực tập tại trường** cùng Thầy/Cô hướng dẫn hoặc với đối tác khác do Khoa sắp xếp. |
| **6** | **01/10 – 10/10** | **Sinh viên nộp báo cáo thực tập;** giảng viên hướng dẫn thực hiện đánh giá và chấm điểm. |
| **7** | **11/10 – 20/10** | Giảng viên nộp điểm về Khoa để tổng hợp và nhập hệ thống. |

---

### 📄 Mẫu báo cáo & Hướng dẫn hoàn thành học phần

Mỗi sinh viên cần viết **01 báo cáo thực tập** theo mẫu Khoa quy định:  
👉 **Tải biểu mẫu báo cáo của Khoa:** [TẠI ĐÂY (Google Drive)](https://drive.google.com/drive/folders/14Fm4yP-2Psj_qMpzI0pBARkcww1sblA3?usp=sharing)

#### 📝 Sinh viên cần nộp những gì để hoàn thành môn thực tập?

Để hoàn thành học phần Thực tập và được công nhận điểm, sinh viên cần thực hiện:

1. **Nộp Báo cáo thực tập (Bản mềm - PDF) trên hệ thống:**
   - Sinh viên nộp bản báo cáo hoàn chỉnh (định dạng **PDF, tối đa 10 MB**) trực tiếp trên hệ thống trong thời gian mở nộp (**01/10 – 10/10**).
   - Bản báo cáo này là cơ sở để Giảng viên hướng dẫn đánh giá và cho **Điểm tiến độ (20%)** và **Điểm báo cáo (20%)**.

2. **Nộp Trang nhận xét & Đánh giá kết quả thực tập (Có chữ ký & dấu công ty):**
   - Trong mẫu báo cáo thực tập của Khoa có sẵn **Trang nhận xét / Phiếu đánh giá kết quả thực tập**.
   - **Nếu thực tập tại Doanh nghiệp:** Sinh viên in riêng trang nhận xét này để xin điểm đánh giá, nhận xét chi tiết và chữ ký của người hướng dẫn trực tiếp tại doanh nghiệp, kèm **dấu xác nhận của công ty/doanh nghiệp**. Sau đó, nộp bản nhận xét này cho Giảng viên hướng dẫn của Khoa để Thầy/Cô ghi nhận và nhập **Điểm đánh giá của doanh nghiệp (60%)** vào hệ thống.
   - **Nếu thực tập tại Trường:** Giảng viên hướng dẫn tại trường sẽ trực tiếp theo dõi, nhận xét và đánh giá cho điểm phần này.

---

### 📊 Cơ cấu điểm đánh giá học phần

- **20%:** Điểm báo cáo định kỳ / tiến độ (sinh viên chủ động liên hệ và báo cáo tiến độ với GVHD).
- **20%:** Điểm nội dung của bản báo cáo thực tập theo mẫu quy định (nộp bản mềm trên hệ thống).
- **60%:** Điểm đánh giá của phía doanh nghiệp (theo trang nhận xét có chữ ký & dấu công ty) hoặc của Giảng viên hướng dẫn (nếu thực tập tại trường).`;
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('implementation_plan_md', '${defaultPlan.replace(/'/g, "''")}')`);

  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN contact_email TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN contact_name TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN history TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN qualifications TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN address TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN recruitment_link TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN phone TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE companies ADD COLUMN applicants_drive_link TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE lecturers ADD COLUMN students_drive_link TEXT'); } catch (e) { }

  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN student_id TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN dob TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN class_name TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN course_code TEXT'); } catch (e) { }

  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN note TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN review_comment TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN other_company_name TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN other_company_role TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN other_company_contact TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN preference_order INTEGER'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN sent_to_company_at DATETIME'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations ADD COLUMN sent_to_company_note TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE notifications ADD COLUMN provider TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE notifications ADD COLUMN provider_message_id TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE notifications ADD COLUMN attempt_count INTEGER DEFAULT 0'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE notifications ADD COLUMN last_attempt_at DATETIME'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE notifications ADD COLUMN read_at DATETIME'); } catch (e) { }
  try {
    await db.execute({
      sql: `UPDATE notifications
            SET status = 'website_only', error = 'Đã ngừng gửi thông báo vượt quota GVHD theo chính sách hiện tại.'
            WHERE type = 'advisor_quota_exceeded' AND status = 'queued'`,
      args: [],
    });
  } catch (e) { }
  // Legacy denormalized profile columns; reports now read these fields from users.
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN student_id'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN dob'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN class_name'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN course_code'); } catch (e) { }
  // Migration: add is_lecturer to users if not exists
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN is_lecturer INTEGER DEFAULT 0'); } catch (e) { }
  // Migration: add email to lecturers if not exists
  try { await db.executeMultiple('ALTER TABLE lecturers ADD COLUMN email TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE lecturers ADD COLUMN work_unit TEXT'); } catch (e) { }
  // Migration: add phone and personal_email to users if not exists
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN phone TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN personal_email TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE final_internships ADD COLUMN school_lecturer TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE final_internships ADD COLUMN school_assignment_request INTEGER NOT NULL DEFAULT 0'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE lecturer_quotas ADD COLUMN max_total_students INTEGER'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE advisor_assignments ADD COLUMN contacted_at DATETIME'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE advisor_assignments ADD COLUMN contact_note TEXT'); } catch (e) { }
  try {
    await db.executeMultiple(`CREATE TABLE IF NOT EXISTS advisor_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      lecturer_id INTEGER,
      co_lecturer_id INTEGER,
      lecturer_name_text TEXT,
      co_lecturer_name_text TEXT,
      request_type TEXT NOT NULL DEFAULT 'agreed',
      status TEXT NOT NULL DEFAULT 'pending',
      quota_status TEXT NOT NULL DEFAULT 'unknown',
      student_note TEXT,
      admin_note TEXT,
      source_registration_id INTEGER,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE final_reports ADD COLUMN lecturer_comment TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE grades ADD COLUMN locked_at DATETIME'); } catch (e) { }
  try {
    await db.executeMultiple(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL,
      lecturer_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      read_at DATETIME,
      FOREIGN KEY (student_user_id) REFERENCES users (id),
      FOREIGN KEY (lecturer_id) REFERENCES lecturers (id),
      FOREIGN KEY (sender_user_id) REFERENCES users (id)
    )`);
  } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE chat_messages ADD COLUMN attachment_key TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE chat_messages ADD COLUMN attachment_name TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE chat_messages ADD COLUMN attachment_size INTEGER'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE chat_messages ADD COLUMN attachment_mime TEXT'); } catch (e) { }
  try { await db.executeMultiple('CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(student_user_id, lecturer_id, created_at)'); } catch (e) { }
  try { await db.executeMultiple('CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(student_user_id, lecturer_id, sender_user_id, read_at)'); } catch (e) { }
  try {
    await db.executeMultiple(`CREATE TABLE IF NOT EXISTS chat_group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecturer_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      attachment_key TEXT,
      attachment_name TEXT,
      attachment_size INTEGER,
      attachment_mime TEXT,
      created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      FOREIGN KEY (lecturer_id) REFERENCES lecturers (id),
      FOREIGN KEY (sender_user_id) REFERENCES users (id)
    )`);
  } catch (e) { }
  try {
    await db.executeMultiple(`CREATE TABLE IF NOT EXISTS chat_group_message_reads (
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT (datetime('now', '+7 hours')),
      PRIMARY KEY (message_id, user_id)
    )`);
  } catch (e) { }
  try { await db.executeMultiple('CREATE INDEX IF NOT EXISTS idx_chat_group_messages_lecturer_created ON chat_group_messages(lecturer_id, created_at)'); } catch (e) { }
  try { await db.executeMultiple('CREATE INDEX IF NOT EXISTS idx_chat_group_reads_user ON chat_group_message_reads(user_id, message_id)'); } catch (e) { }

  const force = process.env.FORCE_DB_INIT === 'true';
  await ensureDbIndexes(force);

  if (force) {
    await consolidateLegacyPeopleTables();
    await ensureSpecialCompanies();
    await seedApprovedCompanyNamesIfEmpty();
    await approvePendingOtherRegistrationsFromApprovedNames();

    // Seed lecturers if empty but csv exists
    const lecCount = (await db.execute("SELECT COUNT(*) as count FROM lecturers")).rows[0] as unknown as { count: number };
    if (lecCount.count === 0) {
      const p = join(process.cwd(), 'data/seed/lecturers-list.csv');
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf-8');
        const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
        const statements = lines
          .map((line: string) => {
            const parts = line.split(',').map((s: string) => s.trim());
            const name = parts[0];
            const email = parts[1] && parts[1].includes('@') ? parts[1] : null;
            const workUnit = parts[2] || (parts[1] && !parts[1].includes('@') ? parts[1] : null);
            if (!name) return null;
            return { sql: "INSERT OR IGNORE INTO lecturers (name, email, work_unit) VALUES (?, ?, ?)", args: [name, email, workUnit] };
          })
          .filter(Boolean);
        if (statements.length > 0) {
          await executeBatch(statements);
        }
      }
    }

    await syncLecturerUsers();
    await normalizeExistingStudentNames();
  }
}

async function seedCompaniesIfEmpty() {
  const count = (await db.execute("SELECT COUNT(*) as count FROM companies WHERE name != 'Công ty khác' AND name != 'Trường Đại học Công nghệ'")).rows[0] as unknown as { count: number };
  if (count.count > 0) return;

  const setting = (await db.execute("SELECT value FROM settings WHERE key = 'google_sheet_url'")).rows[0] as unknown as { value: string };
  if (!setting || !setting.value) return;

  let fetchUrl = setting.value;
  if (!fetchUrl.includes('export?format=csv')) {
    if (fetchUrl.includes('edit?usp=sharing')) {
      fetchUrl = fetchUrl.replace('edit?usp=sharing', 'export?format=csv');
    } else if (fetchUrl.includes('edit')) {
      fetchUrl = fetchUrl.split('edit')[0] + 'export?format=csv';
    }
  }

  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) return;
    const csvData = await response.text();
    const records = parse(csvData, { columns: true, skip_empty_lines: true });

    const statements = records
      .map((record: any) => {
        if (!record["Timestamp"]) return null;
        const name = record["Tên doanh nghiệp"]?.trim();
        if (!name) return null;

        const slotsStr = record["Số lượng sinh viên cần tuyển  "]?.trim() || record["Số lượng sinh viên cần tuyển"]?.trim() || "0";
        const slots = parseInt(slotsStr) || 5;
        let contactEmail = record["Email liên hệ"]?.trim() || record["Email Address"]?.trim() || '';
        const contactName = record["Họ và tên người liên hệ phụ trách thực tập"]?.trim() || '';
        let phone = record["Điện thoại liên hệ"]?.trim() || '';
        const address = record["Địa chỉ nơi thực tập"]?.trim() || '';
        const infoLink = record["Thông tin vị trí tuyển thực tập"]?.trim() || '';

        if (contactEmail && !phone) {
          const parts = contactEmail.split(/[\/,;\s]+/);
          const emails: string[] = [];
          const phones: string[] = [];
          for (const p of parts) {
            if (p.includes('@')) emails.push(p);
            else if (p.match(/[\d]{8,}/)) phones.push(p);
          }
          if (emails.length > 0) contactEmail = emails.join(', ');
          if (phones.length > 0) phone = phones.join(', ');
        }

        const description = 'Chưa rõ';
        const qualifications = '';
        const history = `Công ty ${name} tuyển dụng thực tập sinh.`;

        return {
          sql: `
            INSERT OR IGNORE INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [name, description, slots, contactEmail, history, qualifications, address, infoLink, phone, contactName]
        };
      })
      .filter(Boolean);
    if (statements.length > 0) {
      await executeBatch(statements);
    }
  } catch (e) {
    console.error("Error seeding companies:", e);
  }
}

async function startServer() {
  await initDb();
  await seedCompaniesIfEmpty();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // In-memory lock to prevent duplicate concurrent registration requests
  const processingUsers = new Set<number>();
  let advisorAutoAssignRunning = false;
  let advisorRequestBackfillRunning = false;


  const allowedOrigins = Array.from(new Set([
    'https://fit-uet.github.io',
    ...(process.env.CORS_ORIGIN || '').split(',')
  ].map(normalizeOrigin).filter(Boolean)));
  const corsOptions = {
    origin: (origin: string | undefined, callback: any) => {
      if (isCorsAllowed(origin, allowedOrigins)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  };
  app.use(cors(corsOptions));
  app.options('/api/*', cors(corsOptions));
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin as string | undefined;
    if (req.path?.startsWith('/api/') && !isCorsAllowed(origin, allowedOrigins)) {
      console.warn(`[cors] blocked origin: ${origin || '(empty)'}; allowed: ${allowedOrigins.join(', ') || '(none)'}`);
      return res.status(403).json({ error: 'Origin không được phép gọi API. Vui lòng kiểm tra CORS_ORIGIN trên Render.' });
    }
    next();
  });
  app.use(express.json());

  // --- API Routes ---

  // Auth Middleware
  const requireAuth = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      if (decoded.email) {
        req.user = (await db.execute({ sql: 'SELECT * FROM users WHERE LOWER(email) = ?', args: [String(decoded.email).toLowerCase().trim()] })).rows[0];
      }
      if (!req.user && decoded.id) {
        req.user = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [decoded.id] })).rows[0];
      }
      if (!req.user) return res.status(401).json({ error: 'User not found' });
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  const requireAdmin = async (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  };

  const requireStudent = async (req: any, res: any, next: any) => {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Student only' });
    }
    next();
  };

  const requireStudentOrAdmin = async (req: any, res: any, next: any) => {
    if (req.user.role !== 'student' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Student or admin only' });
    }
    next();
  };

  const getActorLecturer = async (actor: any) => {
    if (actor.role !== 'lecturer' && actor.role !== 'admin' && !actor.is_lecturer) return null;
    return (await db.execute({
      sql: 'SELECT id, name, email FROM lecturers WHERE email = ? OR name = ? LIMIT 1',
      args: [actor.email || '', actor.name || ''],
    })).rows[0] as any || null;
  };

  const canAccessChatThread = async (actor: any, studentUserId: number, lecturerId: number) => {
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

  const canAccessChatGroup = async (actor: any, lecturerId: number) => {
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

  const chatMessageSelect = `
    SELECT cm.id, cm.student_user_id, cm.lecturer_id, cm.sender_user_id, cm.body,
           cm.attachment_name, cm.attachment_size, cm.attachment_mime,
           CASE WHEN cm.attachment_key IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
           cm.created_at, cm.read_at,
           u.name as sender_name, u.role as sender_role, u.email as sender_email
    FROM chat_messages cm
    JOIN users u ON u.id = cm.sender_user_id
  `;

  const chatGroupMessageSelect = `
    SELECT cgm.id, NULL as student_user_id, cgm.lecturer_id, cgm.sender_user_id, cgm.body,
           cgm.attachment_name, cgm.attachment_size, cgm.attachment_mime,
           CASE WHEN cgm.attachment_key IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
           cgm.created_at, NULL as read_at, 1 as is_group,
           u.name as sender_name, u.role as sender_role, u.email as sender_email
    FROM chat_group_messages cgm
    JOIN users u ON u.id = cgm.sender_user_id
  `;

  /**
   * Đồng bộ advisor_assignments cho sinh viên khi admin sửa GVHD trong đăng ký
   * "Trường Đại học Công nghệ". Chỉ chạy khi sinh viên đã có final_internships.
   *
   * @param userId           - ID sinh viên
   * @param newPrimaryName   - Tên GVHD chính mới (chuỗi rỗng = xóa phân công)
   * @param newCoName        - Tên GVHD đồng hướng dẫn mới (chuỗi rỗng = xóa)
   * @param actorUserId      - ID người thực hiện (admin)
   * @returns warningMessage nếu có tên nhưng không tìm thấy trong lecturers
   */
  async function syncAdvisorFromSchoolRegistration(
    userId: number,
    newPrimaryName: string,
    newCoName: string,
    actorUserId: number,
  ): Promise<{ warning?: string }> {
    // Chỉ đồng bộ khi sinh viên đã có final_internships
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

    // Hàm xử lý sync cho một role (primary / co)
    async function syncRole(newName: string, role: 'primary' | 'co') {
      // Lấy phân công hiện tại của role này
      const existingRows = (await db.execute({
        sql: 'SELECT * FROM advisor_assignments WHERE user_id = ? AND role = ?',
        args: [userId, role],
      })).rows as any[];

      const trimmedName = newName.trim();

      if (!trimmedName) {
        // Xóa phân công cũ nếu có
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

      // Resolve lecturer_id từ tên
      const lecturerRow = (await db.execute({
        sql: 'SELECT id, name, email FROM lecturers WHERE name = ? LIMIT 1',
        args: [trimmedName],
      })).rows[0] as any;

      if (!lecturerRow) {
        warnings.push(`Không tìm thấy giảng viên "${trimmedName}" trong danh sách; bỏ qua đồng bộ ${role === 'primary' ? 'GVHD chính' : 'đồng hướng dẫn'}.`);
        return;
      }

      const lecturerId = Number(lecturerRow.id);

      // Nếu phân công hiện tại đã đúng giảng viên này, không làm gì
      if (existingRows.length === 1 && Number(existingRows[0].lecturer_id) === lecturerId) return;

      // Xóa phân công cũ (nếu khác)
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

      // Tạo phân công mới
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

      // Thông báo cho sinh viên
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

  async function ensureSchoolFinalInternshipFromRegistration(userId: number, actorUserId?: number) {
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

  async function backfillSchoolFinalInternshipsFromRegistrations(actorUserId?: number) {
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

  // 1. Google Login endpoint
  app.post('/api/auth/google', async (req, res) => {
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

      // Check if this email exists in the lecturers table
      const lecturerRecord = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE email = ?', args: [email] })).rows[0] as any;
      const isLecturerInDb = !!lecturerRecord;
      // Use lecturer name from DB if available, otherwise use Google name
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
      if (effectiveRole === 'student' && !isLecturerInDb && email !== adminEmail) {
        await assertStudentCohortAllowed(email);
      }
      if (!user) {
        const result = await db.execute({
          sql: 'INSERT INTO users (email, name, picture, role, student_id, is_lecturer) VALUES (?, ?, ?, ?, ?, ?)',
          args: [email, displayName, picture, defaultRole, studentId, isLecturerInDb ? 1 : 0]
        });
        user = { id: Number(result.lastInsertRowid), email, name: displayName, picture, role: defaultRole, student_id: studentId, dob: null, class_name: null, is_lecturer: isLecturerInDb ? 1 : 0 };
      } else {
        // Update picture; also sync name from lecturers table if found and user hasn't customized it
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
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role, student_id: user.student_id, dob: user.dob, class_name: user.class_name, course_code: user.course_code, is_lecturer: user.is_lecturer } });
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

  // 2. Get Companies
  app.get('/api/companies', requireAuth, requireStudentOrAdmin, async (req: any, res: any) => {
    const companies = (await db.execute(`
      SELECT c.*,
             c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots,
             COALESCE(rc.applicant_count, 0) as applicant_count
      FROM companies c
      LEFT JOIN (
        SELECT company_id, COUNT(*) as applicant_count
        FROM registrations
        WHERE status != 'rejected'
        GROUP BY company_id
      ) rc ON rc.company_id = c.id
    `)).rows;
    res.json(companies);
  });

  app.get('/api/companies/it-list', requireAuth, requireStudentOrAdmin, async (req, res) => {
    try {
      const rows = (await db.execute('SELECT name FROM approved_company_names ORDER BY name ASC')).rows as any[];
      const names = rows.map(row => String(row.name || '').trim()).filter(Boolean);
      res.json(names.length > 0 ? names : Array.from(getItCompanyNameSet()));
    } catch (e) {
      res.json(Array.from(getItCompanyNameSet()));
    }
  });

  // 2c. Get lecturers
  app.get('/api/lecturers', requireAuth, async (req: any, res: any) => {
    try {
      const lecturers = (await db.execute("SELECT name FROM lecturers ORDER BY name ASC")).rows.map((r: any) => r.name);
      res.json(lecturers);
    } catch (e) {
      res.json([]);
    }
  });

  // 2b. Get a single company
  app.get('/api/companies/:id', requireAuth, requireStudentOrAdmin, async (req: any, res: any) => {
    const company = (await db.execute({
      sql: `
      SELECT c.*,
             c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots,
             COALESCE(rc.applicant_count, 0) as applicant_count
      FROM companies c
      LEFT JOIN (
        SELECT company_id, COUNT(*) as applicant_count
        FROM registrations
        WHERE status != 'rejected'
        GROUP BY company_id
      ) rc ON rc.company_id = c.id
      WHERE c.id = ?
    `, args: [req.params.id]
    })).rows[0];
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json(company);
  });

  // 1.5. Update user profile
  app.put('/api/users/profile', requireAuth, async (req: any, res: any) => {
    const { name, student_id, dob, class_name, course_code, phone, personal_email } = req.body;
    const isStaffProfile = req.user.role === 'admin' || req.user.role === 'lecturer';
    if (!name) {
      return res.status(400).json({ error: 'Họ và tên là bắt buộc.' });
    }
    if (!isStaffProfile && phone) {
      const cleanPhone = phone.replace(/[\s\-\.]/g, '');
      if (!/^(0|\+84)[35789]\d{8}$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Số điện thoại cá nhân không hợp lệ (phải bắt đầu bằng 0 hoặc +84 và có 10 chữ số).' });
      }
    }
    if (!isStaffProfile && dob) {
      const d = new Date(dob);
      if (isNaN(d.getTime()) || d > new Date()) {
        return res.status(400).json({ error: 'Ngày sinh không hợp lệ.' });
      }
    }
    try {
      if (isStaffProfile) {
        await db.execute({
          sql: 'UPDATE users SET name = ? WHERE id = ?',
          args: [name, req.user.id]
        });
        if (req.user.role === 'lecturer' || req.user.is_lecturer) {
          await db.execute({
            sql: 'UPDATE lecturers SET name = ? WHERE email = ?',
            args: [name, req.user.email]
          });
          await syncLecturerUsers();
        }
      } else {
        const studentCleanName = cleanStudentName(name, student_id, req.user.email);
        await db.execute({
          sql: 'UPDATE users SET name = ?, student_id = ?, dob = ?, class_name = ?, course_code = ?, phone = ?, personal_email = ? WHERE id = ?',
          args: [studentCleanName, student_id || null, dob || null, class_name || null, course_code || null, phone || null, personal_email || null, req.user.id]
        });
      }
      const updatedUser = (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] })).rows[0];
      res.json(updatedUser);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.get('/api/notifications/my', requireAuth, async (req: any, res: any) => {
    try {
      const email = String(req.user.email || '').trim();
      const personalEmail = String(req.user.personal_email || '').trim();
      const userId = req.user.id ? Number(req.user.id) : null;

      const personalRows = (await db.execute({
        sql: `
          SELECT id, 'personal' as source, type, subject, body, status, error, created_at, sent_at, read_at
          FROM (
            SELECT id, type, subject, body, status, error, created_at, sent_at, read_at
            FROM notifications
            WHERE user_id = ? AND type != 'advisor_quota_exceeded'
            UNION
            SELECT id, type, subject, body, status, error, created_at, sent_at, read_at
            FROM notifications
            WHERE user_id IS NULL
              AND (
                recipient_email = ? COLLATE NOCASE
                OR (? != '' AND recipient_email = ? COLLATE NOCASE)
              )
              AND type != 'advisor_quota_exceeded'
          )
          ORDER BY created_at DESC
          LIMIT 100
        `,
        args: [userId, email, personalEmail, personalEmail],
      })).rows as any[];
      const systemRows = (await db.execute({
        sql: `
          SELECT s.id, 'system' as source, s.type, s.subject, s.body, 'system' as status, NULL as error, s.created_at, NULL as sent_at, r.read_at
          FROM system_notifications s
          LEFT JOIN system_notification_reads r ON r.system_notification_id = s.id AND r.user_id = ?
          WHERE s.active = 1
            AND (s.target_role = 'all' OR s.target_role = ?)
          ORDER BY s.created_at DESC
          LIMIT 100
        `,
        args: [req.user.id, req.user.role || 'student'],
      })).rows as any[];
      const rows = [...personalRows, ...systemRows]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 100);
      const unread = rows.filter(row => !row.read_at).length;
      res.json({ rows, unread });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.put('/api/notifications/my/system/:id/read', requireAuth, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const notification = (await db.execute({
        sql: `SELECT id FROM system_notifications WHERE id = ? AND active = 1 AND (target_role = 'all' OR target_role = ?)`,
        args: [id, req.user.role || 'student'],
      })).rows[0];
      if (!notification) return res.status(404).json({ error: 'Không tìm thấy thông báo hệ thống.' });
      await db.execute({
        sql: `
          INSERT OR REPLACE INTO system_notification_reads (system_notification_id, user_id, read_at)
          VALUES (?, ?, datetime('now', '+7 hours'))
        `,
        args: [id, req.user.id],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.put('/api/notifications/my/:id/read', requireAuth, async (req: any, res: any) => {
    try {
      await db.execute({
        sql: `
          UPDATE notifications
          SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
          WHERE id = ?
        `,
        args: [Number(req.params.id)],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.put('/api/notifications/my/read-all', requireAuth, async (req: any, res: any) => {
    try {
      const email = String(req.user.email || '').trim();
      const personalEmail = String(req.user.personal_email || '').trim();
      const userId = req.user.id ? Number(req.user.id) : null;
      await db.execute({
        sql: `
          UPDATE notifications
          SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
          WHERE user_id = ?
             OR (
               user_id IS NULL
               AND (
                 recipient_email = ? COLLATE NOCASE
                 OR (? != '' AND recipient_email = ? COLLATE NOCASE)
               )
             )
        `,
        args: [userId, email, personalEmail, personalEmail],
      });
      await db.execute({
        sql: `
          INSERT OR REPLACE INTO system_notification_reads (system_notification_id, user_id, read_at)
          SELECT id, ?, datetime('now', '+7 hours')
          FROM system_notifications
          WHERE active = 1 AND (target_role = 'all' OR target_role = ?)
        `,
        args: [req.user.id, req.user.role || 'student'],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.get('/api/chat/threads', requireAuth, async (req: any, res: any) => {
    try {
      if (req.user.role === 'student') {
        const rows = (await db.execute({
          sql: `
            SELECT 0 as is_group, aa.user_id as student_user_id, aa.lecturer_id, aa.role as advisor_role,
                   l.name as lecturer_name, l.email as lecturer_email,
                   u.name as student_name, u.student_id, NULL as student_count,
                   (
                     SELECT body FROM chat_messages
                     WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                     ORDER BY id DESC LIMIT 1
                   ) as last_message,
                   (
                     SELECT attachment_name FROM chat_messages
                     WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                     ORDER BY id DESC LIMIT 1
                   ) as last_attachment_name,
                   (
                     SELECT created_at FROM chat_messages
                     WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                     ORDER BY id DESC LIMIT 1
                   ) as last_message_at,
                   (
                     SELECT COUNT(*) FROM chat_messages
                     WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                       AND sender_user_id != ? AND read_at IS NULL
                   ) as unread_count
            FROM advisor_assignments aa
            JOIN lecturers l ON l.id = aa.lecturer_id
            JOIN users u ON u.id = aa.user_id
            WHERE aa.user_id = ?
            ORDER BY CASE aa.role WHEN 'primary' THEN 0 ELSE 1 END, l.name ASC
          `,
          args: [req.user.id, req.user.id],
        })).rows;
        const groupRows = (await db.execute({
          sql: `
            SELECT 1 as is_group, NULL as student_user_id, gl.lecturer_id, 'group' as advisor_role,
                   l.name as lecturer_name, l.email as lecturer_email,
                   'Nhóm sinh viên hướng dẫn' as student_name, NULL as student_id,
                   COALESCE(student_counts.student_count, 0) as student_count,
                   (
                     SELECT body FROM chat_group_messages
                     WHERE lecturer_id = gl.lecturer_id
                     ORDER BY id DESC LIMIT 1
                   ) as last_message,
                   (
                     SELECT attachment_name FROM chat_group_messages
                     WHERE lecturer_id = gl.lecturer_id
                     ORDER BY id DESC LIMIT 1
                   ) as last_attachment_name,
                   (
                     SELECT created_at FROM chat_group_messages
                     WHERE lecturer_id = gl.lecturer_id
                     ORDER BY id DESC LIMIT 1
                   ) as last_message_at,
                   (
                     SELECT COUNT(*) FROM chat_group_messages cgm
                     LEFT JOIN chat_group_message_reads r ON r.message_id = cgm.id AND r.user_id = ?
                     WHERE cgm.lecturer_id = gl.lecturer_id AND cgm.sender_user_id != ? AND r.message_id IS NULL
                   ) as unread_count
            FROM (
              SELECT DISTINCT lecturer_id
              FROM advisor_assignments
              WHERE user_id = ?
            ) gl
            JOIN lecturers l ON l.id = gl.lecturer_id
            LEFT JOIN (
              SELECT lecturer_id, COUNT(DISTINCT user_id) as student_count
              FROM advisor_assignments
              GROUP BY lecturer_id
            ) student_counts ON student_counts.lecturer_id = gl.lecturer_id
            ORDER BY l.name ASC
          `,
          args: [req.user.id, req.user.id, req.user.id],
        })).rows;
        return res.json([...groupRows, ...rows]);
      }
      const lecturer = await getActorLecturer(req.user);
      if (!lecturer) return res.json([]);
      const rows = (await db.execute({
        sql: `
          SELECT 0 as is_group, aa.user_id as student_user_id, aa.lecturer_id, aa.role as advisor_role,
                 l.name as lecturer_name, l.email as lecturer_email,
                 u.name as student_name, u.student_id, u.email as student_email, u.class_name, u.course_code, NULL as student_count,
                 (
                   SELECT body FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_message,
                 (
                   SELECT attachment_name FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_attachment_name,
                 (
                   SELECT created_at FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_message_at,
                 (
                   SELECT COUNT(*) FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                     AND sender_user_id != ? AND read_at IS NULL
                 ) as unread_count
          FROM advisor_assignments aa
          JOIN lecturers l ON l.id = aa.lecturer_id
          JOIN users u ON u.id = aa.user_id
          WHERE aa.lecturer_id = ?
          ORDER BY COALESCE(last_message_at, aa.assigned_at) DESC, u.student_id ASC
        `,
        args: [req.user.id, Number(lecturer.id)],
      })).rows;
      const groupRows = (await db.execute({
        sql: `
          SELECT 1 as is_group, NULL as student_user_id, ? as lecturer_id, 'group' as advisor_role,
                 l.name as lecturer_name, l.email as lecturer_email,
                 'Nhóm sinh viên hướng dẫn' as student_name, NULL as student_id, NULL as student_email, NULL as class_name, NULL as course_code,
                 COALESCE(student_counts.student_count, 0) as student_count,
                 (
                   SELECT body FROM chat_group_messages
                   WHERE lecturer_id = ?
                   ORDER BY id DESC LIMIT 1
                 ) as last_message,
                 (
                   SELECT attachment_name FROM chat_group_messages
                   WHERE lecturer_id = ?
                   ORDER BY id DESC LIMIT 1
                 ) as last_attachment_name,
                 (
                   SELECT created_at FROM chat_group_messages
                   WHERE lecturer_id = ?
                   ORDER BY id DESC LIMIT 1
                 ) as last_message_at,
                 (
                   SELECT COUNT(*) FROM chat_group_messages cgm
                   LEFT JOIN chat_group_message_reads r ON r.message_id = cgm.id AND r.user_id = ?
                   WHERE cgm.lecturer_id = ? AND cgm.sender_user_id != ? AND r.message_id IS NULL
                 ) as unread_count
          FROM lecturers l
          LEFT JOIN (
            SELECT lecturer_id, COUNT(DISTINCT user_id) as student_count
            FROM advisor_assignments
            WHERE lecturer_id = ?
            GROUP BY lecturer_id
          ) student_counts ON student_counts.lecturer_id = l.id
          WHERE l.id = ? AND COALESCE(student_counts.student_count, 0) > 0
        `,
        args: [
          Number(lecturer.id),
          Number(lecturer.id),
          Number(lecturer.id),
          Number(lecturer.id),
          req.user.id,
          Number(lecturer.id),
          req.user.id,
          Number(lecturer.id),
          Number(lecturer.id)
        ],
      })).rows;
      res.json([...groupRows, ...rows]);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.get('/api/chat/groups/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
    try {
      const lecturerId = Number(req.params.lecturerId);
      if (!(await canAccessChatGroup(req.user, lecturerId))) {
        return res.status(403).json({ error: 'Bạn không có quyền xem nhóm trao đổi này.' });
      }
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO chat_group_message_reads (message_id, user_id, read_at)
          SELECT id, ?, datetime('now', '+7 hours')
          FROM chat_group_messages
          WHERE lecturer_id = ? AND sender_user_id != ?
        `,
        args: [req.user.id, lecturerId, req.user.id],
      });
      const rows = (await db.execute({
        sql: `${chatGroupMessageSelect}
              WHERE cgm.lecturer_id = ?
              ORDER BY cgm.created_at ASC, cgm.id ASC
              LIMIT 300`,
        args: [lecturerId],
      })).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.post('/api/chat/groups/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
    try {
      const lecturerId = Number(req.params.lecturerId);
      if (!(await canAccessChatGroup(req.user, lecturerId))) {
        return res.status(403).json({ error: 'Bạn không có quyền gửi tin nhắn trong nhóm này.' });
      }
      const body = String(req.body?.body || '').trim();
      if (!body) return res.status(400).json({ error: 'Vui lòng nhập nội dung tin nhắn.' });
      if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
      const result = await db.execute({
        sql: `INSERT INTO chat_group_messages (lecturer_id, sender_user_id, body, created_at)
              VALUES (?, ?, ?, datetime('now', '+7 hours'))`,
        args: [lecturerId, req.user.id, body],
      });
      const message = (await db.execute({
        sql: `${chatGroupMessageSelect} WHERE cgm.id = ?`,
        args: [Number(result.lastInsertRowid)],
      })).rows[0];
      res.json(message);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.post('/api/chat/groups/:lecturerId/attachments', requireAuth, express.raw({ type: '*/*', limit: '11mb' }), async (req: any, res: any) => {
    let uploadedKey = '';
    try {
      const lecturerId = Number(req.params.lecturerId);
      if (!(await canAccessChatGroup(req.user, lecturerId))) {
        return res.status(403).json({ error: 'Bạn không có quyền gửi file trong nhóm này.' });
      }
      const file = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      const originalFilename = safeFilename(safeDecodeHeader(req.header('x-filename'), 'attachment'));
      const rawMimeType = String(req.header('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      const mimeType = normalizeChatAttachmentMime(originalFilename, rawMimeType);
      const body = safeDecodeHeader(req.header('x-message-body'), '').trim();
      if (file.length === 0) return res.status(400).json({ error: 'File rỗng.' });
      if (file.length > MAX_CHAT_ATTACHMENT_BYTES) return res.status(413).json({ error: 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' });
      if (!isAllowedChatAttachment(originalFilename, mimeType)) {
        return res.status(400).json({ error: 'Định dạng file chưa được hỗ trợ. Hệ thống chỉ nhận PDF, Office, TXT, ZIP, JPG/PNG.' });
      }
      if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
      const threadUsage = (await db.execute({
        sql: 'SELECT COALESCE(SUM(attachment_size), 0) as total FROM chat_group_messages WHERE lecturer_id = ?',
        args: [lecturerId],
      })).rows[0] as any;
      if (Number(threadUsage?.total || 0) + file.length > CHAT_THREAD_STORAGE_LIMIT_BYTES) {
        return res.status(413).json({ error: `Nhóm trao đổi này đã gần vượt quota lưu file ${Math.round(CHAT_THREAD_STORAGE_LIMIT_BYTES / 1024 / 1024)} MB. Vui lòng dùng file nhỏ hơn hoặc trao đổi qua kênh lưu trữ khác.` });
      }
      const dailyUsage = (await db.execute({
        sql: `
          SELECT COALESCE(SUM(total), 0) as total
          FROM (
            SELECT COALESCE(SUM(attachment_size), 0) as total
            FROM chat_messages
            WHERE sender_user_id = ?
              AND attachment_key IS NOT NULL
              AND created_at >= datetime('now', '+7 hours', 'start of day')
            UNION ALL
            SELECT COALESCE(SUM(attachment_size), 0) as total
            FROM chat_group_messages
            WHERE sender_user_id = ?
              AND attachment_key IS NOT NULL
              AND created_at >= datetime('now', '+7 hours', 'start of day')
          )
        `,
        args: [req.user.id, req.user.id],
      })).rows[0] as any;
      if (Number(dailyUsage?.total || 0) + file.length > CHAT_DAILY_UPLOAD_LIMIT_BYTES) {
        return res.status(429).json({ error: `Bạn đã gần vượt quota gửi file trong ngày ${Math.round(CHAT_DAILY_UPLOAD_LIMIT_BYTES / 1024 / 1024)} MB. Vui lòng gửi tiếp vào ngày mai hoặc dùng file nhỏ hơn.` });
      }

      const key = chatGroupAttachmentObjectKey(lecturerId, Number(req.user.id), originalFilename);
      await saveChatAttachmentObject(key, file, mimeType);
      uploadedKey = key;
      const result = await db.execute({
        sql: `INSERT INTO chat_group_messages (lecturer_id, sender_user_id, body, attachment_key, attachment_name, attachment_size, attachment_mime, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
        args: [lecturerId, req.user.id, body || '', key, originalFilename, file.length, mimeType],
      });
      const message = (await db.execute({
        sql: `${chatGroupMessageSelect} WHERE cgm.id = ?`,
        args: [Number(result.lastInsertRowid)],
      })).rows[0];
      res.json(message);
      uploadedKey = '';
    } catch (e: any) {
      if (uploadedKey) {
        try { await deleteChatAttachmentObject(uploadedKey); } catch (cleanupError) { console.error('[chat-group] failed to cleanup orphan attachment:', cleanupError); }
      }
      res.status(e?.type === 'entity.too.large' ? 413 : 500).json({ error: e?.type === 'entity.too.large' ? 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' : e.message });
    }
  });

  app.get('/api/chat/group-messages/:messageId/attachment', requireAuth, async (req: any, res: any) => {
    try {
      const messageId = Number(req.params.messageId);
      const message = (await db.execute({
        sql: 'SELECT * FROM chat_group_messages WHERE id = ?',
        args: [messageId],
      })).rows[0] as any;
      if (!message || !message.attachment_key) return res.status(404).json({ error: 'Không tìm thấy file.' });
      if (!(await canAccessChatGroup(req.user, Number(message.lecturer_id)))) {
        return res.status(403).json({ error: 'Bạn không có quyền tải file này.' });
      }
      const preview = String(req.query.preview || '') === '1';
      const mime = String(message.attachment_mime || 'application/octet-stream');
      const disposition = preview && (mime.startsWith('image/') || mime === 'application/pdf') ? 'inline' : 'attachment';
      res.setHeader('content-type', mime);
      res.setHeader('content-length', String(message.attachment_size || ''));
      res.setHeader('content-disposition', `${disposition}; filename="${encodeURIComponent(message.attachment_name || 'attachment')}"`);
      const streamed = await streamChatAttachmentObject(message.attachment_key, res);
      if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file lưu trữ.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Không tải được file.' });
    }
  });

  app.delete('/api/chat/group-messages/:messageId', requireAuth, async (req: any, res: any) => {
    try {
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
      const message = (await db.execute({
        sql: 'SELECT * FROM chat_group_messages WHERE id = ?',
        args: [messageId],
      })).rows[0] as any;
      if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
      if (req.user.role !== 'admin') {
        if (Number(message.sender_user_id) !== Number(req.user.id)) {
          return res.status(403).json({ error: 'Bạn chỉ có thể thu hồi tin nhắn do mình gửi.' });
        }
        if (!(await canAccessChatGroup(req.user, Number(message.lecturer_id)))) {
          return res.status(403).json({ error: 'Bạn không có quyền thu hồi tin nhắn này.' });
        }
      }
      if (message.attachment_key) {
        await deleteChatAttachmentObject(message.attachment_key);
      }
      await executeBatch([
        { sql: 'DELETE FROM chat_group_message_reads WHERE message_id = ?', args: [messageId] },
        { sql: 'DELETE FROM chat_group_messages WHERE id = ?', args: [messageId] },
      ]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Không thu hồi được tin nhắn.' });
    }
  });

  app.get('/api/chat/threads/:studentUserId/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
    try {
      const studentUserId = Number(req.params.studentUserId);
      const lecturerId = Number(req.params.lecturerId);
      if (!(await canAccessChatThread(req.user, studentUserId, lecturerId))) {
        return res.status(403).json({ error: 'Bạn không có quyền xem cuộc trò chuyện này.' });
      }
      await db.execute({
        sql: `UPDATE chat_messages
              SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
              WHERE student_user_id = ? AND lecturer_id = ? AND sender_user_id != ? AND read_at IS NULL`,
        args: [studentUserId, lecturerId, req.user.id],
      });
      const rows = (await db.execute({
        sql: `${chatMessageSelect}
              WHERE cm.student_user_id = ? AND cm.lecturer_id = ?
              ORDER BY cm.created_at ASC, cm.id ASC
              LIMIT 300`,
        args: [studentUserId, lecturerId],
      })).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.post('/api/chat/threads/:studentUserId/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
    try {
      const studentUserId = Number(req.params.studentUserId);
      const lecturerId = Number(req.params.lecturerId);
      if (!(await canAccessChatThread(req.user, studentUserId, lecturerId))) {
        return res.status(403).json({ error: 'Bạn không có quyền gửi tin nhắn trong cuộc trò chuyện này.' });
      }
      const body = String(req.body?.body || '').trim();
      if (!body) return res.status(400).json({ error: 'Vui lòng nhập nội dung tin nhắn.' });
      if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
      const result = await db.execute({
        sql: `INSERT INTO chat_messages (student_user_id, lecturer_id, sender_user_id, body, created_at)
              VALUES (?, ?, ?, ?, datetime('now', '+7 hours'))`,
        args: [studentUserId, lecturerId, req.user.id, body],
      });
      const message = (await db.execute({
        sql: `${chatMessageSelect} WHERE cm.id = ?`,
        args: [Number(result.lastInsertRowid)],
      })).rows[0];
      res.json(message);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.post('/api/chat/threads/:studentUserId/:lecturerId/attachments', requireAuth, express.raw({ type: '*/*', limit: '11mb' }), async (req: any, res: any) => {
    let uploadedKey = '';
    try {
      const studentUserId = Number(req.params.studentUserId);
      const lecturerId = Number(req.params.lecturerId);
      if (!(await canAccessChatThread(req.user, studentUserId, lecturerId))) {
        return res.status(403).json({ error: 'Bạn không có quyền gửi file trong cuộc trò chuyện này.' });
      }
      const file = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      const originalFilename = safeFilename(safeDecodeHeader(req.header('x-filename'), 'attachment'));
      const rawMimeType = String(req.header('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      const mimeType = normalizeChatAttachmentMime(originalFilename, rawMimeType);
      const body = safeDecodeHeader(req.header('x-message-body'), '').trim();
      if (file.length === 0) return res.status(400).json({ error: 'File rỗng.' });
      if (file.length > MAX_CHAT_ATTACHMENT_BYTES) return res.status(413).json({ error: 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' });
      if (!isAllowedChatAttachment(originalFilename, mimeType)) {
        return res.status(400).json({ error: 'Định dạng file chưa được hỗ trợ. Hệ thống chỉ nhận PDF, Office, TXT, ZIP, JPG/PNG.' });
      }
      if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
      const threadUsage = (await db.execute({
        sql: 'SELECT COALESCE(SUM(attachment_size), 0) as total FROM chat_messages WHERE student_user_id = ? AND lecturer_id = ?',
        args: [studentUserId, lecturerId],
      })).rows[0] as any;
      if (Number(threadUsage?.total || 0) + file.length > CHAT_THREAD_STORAGE_LIMIT_BYTES) {
        return res.status(413).json({ error: `Cuộc trò chuyện này đã gần vượt quota lưu file ${Math.round(CHAT_THREAD_STORAGE_LIMIT_BYTES / 1024 / 1024)} MB. Vui lòng dùng file nhỏ hơn hoặc trao đổi qua kênh lưu trữ khác.` });
      }
      const dailyUsage = (await db.execute({
        sql: `
          SELECT COALESCE(SUM(total), 0) as total
          FROM (
            SELECT COALESCE(SUM(attachment_size), 0) as total
            FROM chat_messages
            WHERE sender_user_id = ?
              AND attachment_key IS NOT NULL
              AND created_at >= datetime('now', '+7 hours', 'start of day')
            UNION ALL
            SELECT COALESCE(SUM(attachment_size), 0) as total
            FROM chat_group_messages
            WHERE sender_user_id = ?
              AND attachment_key IS NOT NULL
              AND created_at >= datetime('now', '+7 hours', 'start of day')
          )
        `,
        args: [req.user.id, req.user.id],
      })).rows[0] as any;
      if (Number(dailyUsage?.total || 0) + file.length > CHAT_DAILY_UPLOAD_LIMIT_BYTES) {
        return res.status(429).json({ error: `Bạn đã gần vượt quota gửi file trong ngày ${Math.round(CHAT_DAILY_UPLOAD_LIMIT_BYTES / 1024 / 1024)} MB. Vui lòng gửi tiếp vào ngày mai hoặc dùng file nhỏ hơn.` });
      }

      const key = chatAttachmentObjectKey(studentUserId, lecturerId, Number(req.user.id), originalFilename);
      await saveChatAttachmentObject(key, file, mimeType);
      uploadedKey = key;
      const result = await db.execute({
        sql: `INSERT INTO chat_messages (student_user_id, lecturer_id, sender_user_id, body, attachment_key, attachment_name, attachment_size, attachment_mime, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
        args: [studentUserId, lecturerId, req.user.id, body || '', key, originalFilename, file.length, mimeType],
      });
      const message = (await db.execute({
        sql: `${chatMessageSelect} WHERE cm.id = ?`,
        args: [Number(result.lastInsertRowid)],
      })).rows[0];
      res.json(message);
      uploadedKey = '';
    } catch (e: any) {
      if (uploadedKey) {
        try { await deleteChatAttachmentObject(uploadedKey); } catch (cleanupError) { console.error('[chat] failed to cleanup orphan attachment:', cleanupError); }
      }
      res.status(e?.type === 'entity.too.large' ? 413 : 500).json({ error: e?.type === 'entity.too.large' ? 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' : e.message });
    }
  });

  app.get('/api/chat/messages/:messageId/attachment', requireAuth, async (req: any, res: any) => {
    try {
      const messageId = Number(req.params.messageId);
      const message = (await db.execute({
        sql: 'SELECT * FROM chat_messages WHERE id = ?',
        args: [messageId],
      })).rows[0] as any;
      if (!message || !message.attachment_key) return res.status(404).json({ error: 'Không tìm thấy file.' });
      if (!(await canAccessChatThread(req.user, Number(message.student_user_id), Number(message.lecturer_id)))) {
        return res.status(403).json({ error: 'Bạn không có quyền tải file này.' });
      }
      const preview = String(req.query.preview || '') === '1';
      const mime = String(message.attachment_mime || 'application/octet-stream');
      const disposition = preview && (mime.startsWith('image/') || mime === 'application/pdf') ? 'inline' : 'attachment';
      res.setHeader('content-type', mime);
      res.setHeader('content-length', String(message.attachment_size || ''));
      res.setHeader('content-disposition', `${disposition}; filename="${encodeURIComponent(message.attachment_name || 'attachment')}"`);
      const streamed = await streamChatAttachmentObject(message.attachment_key, res);
      if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file lưu trữ.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Không tải được file.' });
    }
  });

  app.delete('/api/chat/messages/:messageId', requireAuth, async (req: any, res: any) => {
    try {
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
      const message = (await db.execute({
        sql: 'SELECT * FROM chat_messages WHERE id = ?',
        args: [messageId],
      })).rows[0] as any;
      if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
      if (req.user.role !== 'admin') {
        if (Number(message.sender_user_id) !== Number(req.user.id)) {
          return res.status(403).json({ error: 'Bạn chỉ có thể thu hồi tin nhắn do mình gửi.' });
        }
        if (!(await canAccessChatThread(req.user, Number(message.student_user_id), Number(message.lecturer_id)))) {
          return res.status(403).json({ error: 'Bạn không có quyền thu hồi tin nhắn này.' });
        }
      }
      if (message.attachment_key) {
        await deleteChatAttachmentObject(message.attachment_key);
      }
      await db.execute({ sql: 'DELETE FROM chat_messages WHERE id = ?', args: [messageId] });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Không thu hồi được tin nhắn.' });
    }
  });

  // 3. Get Registration (Student)
  app.get('/api/registrations/my', requireAuth, requireStudent, async (req: any, res: any) => {
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

  app.get('/api/internships/final/my', requireAuth, requireStudent, async (req: any, res: any) => {
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

  app.get('/api/advisor/my', requireAuth, requireStudent, async (req: any, res: any) => {
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

  app.get('/api/advisor/request/my', requireAuth, requireStudent, async (req: any, res: any) => {
    try {
      res.json(await advisorRequestWithNames(req.user.id));
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.post('/api/advisor/request/my', requireAuth, requireStudent, async (req: any, res: any) => {
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

  app.delete('/api/advisor/request/my', requireAuth, requireStudent, async (req: any, res: any) => {
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

  app.get('/api/lecturer/students', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
    if (!lecturer) return res.json([]);
    const rows = (await db.execute({
      sql: `SELECT aa.id as assignment_id, aa.user_id, aa.lecturer_id, aa.role as advisor_role, aa.assigned_at, aa.note as assignment_note,
                   aa.contacted_at, aa.contact_note,
                   u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
                   COALESCE(f.internship_type, CASE WHEN sr.school_place IS NOT NULL THEN 'school' ELSE NULL END) as internship_type,
                   f.confirmed_at,
                   CASE
                     WHEN c.name = 'Công ty khác' THEN r.other_company_name
                     WHEN c.name IS NOT NULL THEN c.name
                     ELSE sr.school_place
                   END as internship_place,
                   COALESCE(r.other_company_role, sr.school_co_lecturer) as other_company_role,
                   COALESCE(r.other_company_contact, sr.school_lecturer) as other_company_contact,
                   fr.status as report_status, fr.original_filename as report_filename, fr.file_size as report_file_size, fr.submitted_at as report_submitted_at,
                   g.status as grade_status, g.final_score, g.progress_score, g.report_score, g.company_score, g.comment as grade_comment, g.locked_at as grade_locked_at
            FROM advisor_assignments aa
            JOIN users u ON u.id = aa.user_id
            LEFT JOIN final_internships f ON f.user_id = aa.user_id
            LEFT JOIN companies c ON c.id = f.company_id
            LEFT JOIN registrations r ON r.id = f.registration_id
            LEFT JOIN (
              SELECT r.user_id,
                     'Trường Đại học Công nghệ' as school_place,
                     MAX(r.other_company_contact) as school_lecturer,
                     MAX(r.other_company_role) as school_co_lecturer
              FROM registrations r
              JOIN companies c2 ON c2.id = r.company_id
              WHERE r.status != 'rejected'
                AND c2.name = 'Trường Đại học Công nghệ'
              GROUP BY r.user_id
            ) sr ON sr.user_id = aa.user_id
            LEFT JOIN final_reports fr ON fr.user_id = aa.user_id
            LEFT JOIN grades g ON g.user_id = aa.user_id
            WHERE aa.lecturer_id = ?
            ORDER BY u.student_id ASC`,
      args: [Number(lecturer.id)],
    })).rows;
    res.json(rows);
  });

  app.put('/api/lecturer/students/:assignmentId/contact', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) return res.status(400).json({ error: 'Phân công không hợp lệ.' });
    const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
    if (!lecturer) return res.status(403).json({ error: 'Không tìm thấy tài khoản giảng viên.' });
    const assignment = (await db.execute({
      sql: 'SELECT * FROM advisor_assignments WHERE id = ? AND lecturer_id = ?',
      args: [assignmentId, Number(lecturer.id)],
    })).rows[0] as any;
    if (!assignment) return res.status(404).json({ error: 'Không tìm thấy sinh viên trong danh sách phụ trách.' });

    const contacted = !!req.body?.contacted;
    const contactNote = String(req.body?.contact_note || '').trim();
    await db.execute({
      sql: `UPDATE advisor_assignments
            SET contacted_at = ${contacted ? "COALESCE(contacted_at, datetime('now', '+7 hours'))" : 'NULL'},
                contact_note = ?
            WHERE id = ?`,
      args: [contactNote || null, assignmentId],
    });
    const updated = (await db.execute({
      sql: 'SELECT id as assignment_id, contacted_at, contact_note FROM advisor_assignments WHERE id = ?',
      args: [assignmentId],
    })).rows[0];
    res.json(updated);
  });

  async function canAccessStudentReport(actor: any, userId: number) {
    if (actor.role === 'admin') return true;
    if (actor.role === 'student' && Number(actor.id) === Number(userId)) return true;
    if (actor.role !== 'lecturer') return false;
    const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [actor.email, actor.name] })).rows[0] as any;
    if (!lecturer) return false;
    const assignment = (await db.execute({
      sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
      args: [userId, Number(lecturer.id)],
    })).rows[0];
    return !!assignment;
  }

  app.get('/api/reports/final/my', requireAuth, requireStudent, async (req: any, res: any) => {
    const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [req.user.id] })).rows[0] || null;
    res.json(report);
  });

  app.post('/api/reports/final', requireAuth, requireStudent, express.raw({ type: 'application/pdf', limit: '11mb' }), async (req: any, res: any) => {
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

  app.get('/api/reports/final/:userId/download', requireAuth, async (req: any, res: any) => {
    const userId = Number(req.params.userId);
    if (!(await canAccessStudentReport(req.user, userId))) return res.status(403).json({ error: 'Forbidden' });
    const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [userId] })).rows[0] as any;
    if (!report) return res.status(404).json({ error: 'Chưa có báo cáo.' });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(report.original_filename)}"`);
    try {
      const streamed = await streamReportObject(report.object_key, res);
      if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file báo cáo.' });
    } catch (e: any) {
      if (!res.headersSent) return res.status(500).json({ error: 'Không tải được file báo cáo: ' + e.message });
      res.destroy(e);
    }
  });

  // Trả về PDF với Content-Disposition: inline để trình duyệt render trực tiếp trong iframe
  app.get('/api/reports/final/:userId/view', requireAuth, async (req: any, res: any) => {
    const userId = Number(req.params.userId);
    if (!(await canAccessStudentReport(req.user, userId))) return res.status(403).json({ error: 'Forbidden' });
    const report = (await db.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [userId] })).rows[0] as any;
    if (!report) return res.status(404).json({ error: 'Chưa có báo cáo.' });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(report.original_filename)}"`);
    // Cho phép iframe cùng origin nhúng file
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    try {
      const streamed = await streamReportObject(report.object_key, res);
      if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file báo cáo.' });
    } catch (e: any) {
      if (!res.headersSent) return res.status(500).json({ error: 'Không tải được file báo cáo: ' + e.message });
      res.destroy(e);
    }
  });


  app.put('/api/reports/final/:userId/status', requireAuth, async (req: any, res: any) => {
    const userId = Number(req.params.userId);
    if (req.user.role !== 'admin' && req.user.role !== 'lecturer') return res.status(403).json({ error: 'Forbidden' });
    if (!(await canAccessStudentReport(req.user, userId))) return res.status(403).json({ error: 'Forbidden' });
    const status = String(req.body.status || '');
    if (!['submitted', 'accepted', 'needs_revision'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    await db.execute({
      sql: `UPDATE final_reports SET status = ?, lecturer_comment = ?, updated_at = datetime('now', '+7 hours') WHERE user_id = ?`,
      args: [status, req.body.lecturer_comment || null, userId],
    });
    const student = (await db.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
    await createNotification({
      user_id: userId,
      recipient_email: student?.personal_email || student?.email,
      type: 'final_report_status_changed',
      subject: 'Cập nhật trạng thái báo cáo',
      body: `Báo cáo của bạn đã được cập nhật trạng thái: ${status === 'accepted' ? 'Đã chấp nhận' : status === 'needs_revision' ? 'Cần nộp lại' : 'Đã nộp'}.${req.body.lecturer_comment ? `\nGhi chú: ${req.body.lecturer_comment}` : ''}`,
    });
    res.json({ success: true });
  });

  async function getPrimaryLecturerForUser(actor: any, userId: number) {
    const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [actor.email, actor.name] })).rows[0] as any;
    if (actor.role === 'admin') {
      return lecturer ? Number(lecturer.id) : 1;
    }
    if (!lecturer) return null;
    const assignment = (await db.execute({
      sql: "SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1",
      args: [userId, Number(lecturer.id)],
    })).rows[0];
    return assignment ? Number(lecturer.id) : null;
  }

  async function saveGradeForStudent(userId: number, lecturerId: number, body: any, submit = false) {
    const existing = (await db.execute({ sql: 'SELECT * FROM grades WHERE user_id = ?', args: [userId] })).rows[0] as any;
    if (existing?.locked_at) return { error: 'Điểm đã bị khóa. Vui lòng liên hệ Khoa nếu cần sửa.', status: 400 };
    const progressScore = normalizeScore(body.progress_score);
    const reportScore = normalizeScore(body.report_score);
    const companyScore = normalizeScore(body.company_score);
    if (progressScore === undefined || reportScore === undefined || companyScore === undefined) {
      return { error: 'Điểm phải nằm trong khoảng 0 đến 10.', status: 400 };
    }
    if (submit && (progressScore === null || reportScore === null || companyScore === null)) {
      return { error: 'Cần nhập đủ 3 đầu điểm trước khi nộp.', status: 400 };
    }
    const finalScore = calculateFinalScore(progressScore, reportScore, companyScore);
    const status = submit ? 'submitted' : 'draft';
    await db.execute({
      sql: `INSERT INTO grades (user_id, lecturer_id, progress_score, report_score, company_score, final_score, status, comment, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${submit ? "datetime('now', '+7 hours')" : 'NULL'}, datetime('now', '+7 hours'))
            ON CONFLICT(user_id) DO UPDATE SET
              lecturer_id = excluded.lecturer_id,
              progress_score = excluded.progress_score,
              report_score = excluded.report_score,
              company_score = excluded.company_score,
              final_score = excluded.final_score,
              status = excluded.status,
              comment = excluded.comment,
              submitted_at = ${submit ? "datetime('now', '+7 hours')" : 'grades.submitted_at'},
              updated_at = datetime('now', '+7 hours')`,
      args: [userId, lecturerId, progressScore, reportScore, companyScore, finalScore, status, body.comment || null],
    });
    if (submit) {
      await db.execute({
        sql: `UPDATE final_reports 
              SET status = 'accepted', updated_at = datetime('now', '+7 hours') 
              WHERE user_id = ? AND (status IS NULL OR status != 'accepted')`,
        args: [userId],
      });
    }
    return { row: (await db.execute({ sql: 'SELECT * FROM grades WHERE user_id = ?', args: [userId] })).rows[0] };
  }

  app.get('/api/lecturer/grades', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
    if (!lecturer) return res.json([]);
    const rows = (await db.execute({
      sql: `SELECT aa.user_id, aa.role as advisor_role, u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
                   CASE
                     WHEN c.name = 'Công ty khác' THEN r.other_company_name
                     WHEN c.name IS NOT NULL THEN c.name
                     ELSE sr.school_place
                   END as internship_place,
                   fr.status as report_status, fr.original_filename, fr.file_size, fr.submitted_at as report_submitted_at,
                   g.progress_score, g.report_score, g.company_score, g.final_score, g.status as grade_status,
                   g.comment, g.submitted_at as grade_submitted_at, g.locked_at
            FROM advisor_assignments aa
            JOIN users u ON u.id = aa.user_id
            LEFT JOIN final_internships f ON f.user_id = aa.user_id
            LEFT JOIN companies c ON c.id = f.company_id
            LEFT JOIN registrations r ON r.id = f.registration_id
            LEFT JOIN (
              SELECT r.user_id,
                     'Trường Đại học Công nghệ' as school_place
              FROM registrations r
              JOIN companies c2 ON c2.id = r.company_id
              WHERE r.status != 'rejected'
                AND c2.name = 'Trường Đại học Công nghệ'
              GROUP BY r.user_id
            ) sr ON sr.user_id = aa.user_id
            LEFT JOIN final_reports fr ON fr.user_id = aa.user_id
            LEFT JOIN grades g ON g.user_id = aa.user_id
            WHERE aa.lecturer_id = ?
            ORDER BY u.student_id ASC`,
      args: [Number(lecturer.id)],
    })).rows;
    res.json(rows);
  });

  app.get('/api/grades/my', requireAuth, requireStudent, async (req: any, res: any) => {
    try {
      const row = (await db.execute({
        sql: `WITH school_registration AS (
                SELECT r.user_id,
                       'Trường Đại học Công nghệ' as school_place
                FROM registrations r
                JOIN companies c ON c.id = r.company_id
                WHERE r.status != 'rejected' AND c.name = 'Trường Đại học Công nghệ'
                GROUP BY r.user_id
              )
              SELECT u.id as user_id, u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
                     f.internship_type, f.confirmed_at,
                     CASE
                       WHEN f.id IS NULL THEN sr.school_place
                       WHEN c.name = 'Công ty khác' THEN r.other_company_name
                       ELSE c.name
                     END as internship_place,
                     GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN l.name END) as primary_advisors,
                     GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN l.email END) as primary_advisor_emails,
                     GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN l.name END) as co_advisors,
                     GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN l.email END) as co_advisor_emails,
                     g.progress_score, g.report_score, g.company_score, g.final_score,
                     COALESCE(g.status, 'missing') as grade_status, g.comment,
                     g.submitted_at as grade_submitted_at, g.locked_at,
                     gl.name as grading_lecturer_name
              FROM users u
              LEFT JOIN final_internships f ON f.user_id = u.id
              LEFT JOIN school_registration sr ON sr.user_id = u.id
              LEFT JOIN companies c ON c.id = f.company_id
              LEFT JOIN registrations r ON r.id = f.registration_id
              LEFT JOIN advisor_assignments aa ON aa.user_id = u.id
              LEFT JOIN lecturers l ON l.id = aa.lecturer_id
              LEFT JOIN grades g ON g.user_id = u.id
              LEFT JOIN lecturers gl ON gl.id = g.lecturer_id
              WHERE u.id = ?
              GROUP BY u.id`,
        args: [req.user.id],
      })).rows[0] as any;
      res.json(row || null);
    } catch (e: any) {
      res.status(500).json({ error: 'Không tải được điểm thực tập.', detail: e.message });
    }
  });

  app.get('/api/lecturer/grades/:userId', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const userId = Number(req.params.userId);
    const lecturer = (await db.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [req.user.email, req.user.name] })).rows[0] as any;
    if (!lecturer && req.user.role !== 'admin') return res.json(null);
    const row = (await db.execute({
      sql: `SELECT g.* FROM grades g
            JOIN advisor_assignments aa ON aa.user_id = g.user_id
            WHERE g.user_id = ? AND (aa.lecturer_id = ? OR ? = 'admin')
            LIMIT 1`,
      args: [userId, lecturer ? Number(lecturer.id) : 0, req.user.role],
    })).rows[0] || null;
    res.json(row);
  });

  app.put('/api/lecturer/grades/:userId', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const userId = Number(req.params.userId);
    let lecturerId = await getPrimaryLecturerForUser(req.user, userId);
    if (req.user.role === 'admin' && req.body.lecturer_id) lecturerId = Number(req.body.lecturer_id);
    if (!lecturerId) return res.status(403).json({ error: 'Chỉ GVHD chính được nhập điểm cho sinh viên này.' });
    const result = await saveGradeForStudent(userId, lecturerId, req.body, false);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result.row);
  });

  app.post('/api/lecturer/grades/:userId/submit', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'lecturer' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const userId = Number(req.params.userId);
    let lecturerId = await getPrimaryLecturerForUser(req.user, userId);
    if (req.user.role === 'admin' && req.body.lecturer_id) lecturerId = Number(req.body.lecturer_id);
    if (!lecturerId) return res.status(403).json({ error: 'Chỉ GVHD chính được nộp điểm cho sinh viên này.' });
    const result = await saveGradeForStudent(userId, lecturerId, req.body, true);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const student = (await db.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
    await createNotification({
      user_id: userId,
      recipient_email: student?.personal_email || student?.email,
      type: 'grade_submitted',
      subject: 'GVHD đã nộp điểm thực tập',
      body: `GVHD đã nộp điểm thực tập của bạn về Khoa. Điểm tổng kết tạm tính: ${result.row?.final_score ?? '-'}.`,
    });
    res.json(result.row);
  });

  app.post('/api/internships/final/confirm', requireAuth, requireStudent, async (req: any, res: any) => {
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
  app.post('/api/registrations', requireAuth, requireStudent, async (req: any, res: any) => {
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
        // Values stored as 'YYYY-MM-DDTHH:mm' in GMT+7, convert to UTC for comparison
        const toUTC = (localStr: string) => {
          if (!localStr) return null;
          // localStr is GMT+7, subtract 7h to get UTC
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

  app.put('/api/registrations/my/preferences', requireAuth, requireStudent, async (req: any, res: any) => {
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
  app.delete('/api/registrations/my', requireAuth, requireStudent, async (req: any, res: any) => {
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
  app.delete('/api/registrations/:id', requireAuth, requireStudent, async (req: any, res: any) => {
    const { id } = req.params;
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('registration_open_at', 'registration_close_at')
    `)).rows as any[]);
    const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
    if (!windowStatus.ok) {
      return res.status(403).json({ error: 'Chỉ được hủy đăng ký trong thời gian Khoa mở đăng ký.' });
    }
    // Only allow deleting own registration
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

  app.get('/api/admin/dashboard-stats', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const stats = (await db.execute(`
        SELECT
          (SELECT COUNT(DISTINCT user_id) FROM (SELECT user_id FROM registrations UNION SELECT user_id FROM final_internships)) AS registeredCount,
          (SELECT COUNT(DISTINCT user_id) FROM final_internships) AS confirmedCount,
          (SELECT COUNT(DISTINCT user_id) FROM final_reports WHERE status = 'submitted' OR object_key IS NOT NULL) AS reportCount,
          (SELECT COUNT(DISTINCT user_id)
             FROM grades
            WHERE status IN ('submitted', 'draft') OR final_score IS NOT NULL) AS gradedCount
      `)).rows[0] as any;
      res.json({
        registeredCount: Number(stats?.registeredCount || 0),
        confirmedCount: Number(stats?.confirmedCount || 0),
        reportCount: Number(stats?.reportCount || 0),
        gradedCount: Number(stats?.gradedCount || 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 12. Admin: Get Students (exclude admins)
  app.get('/api/admin/students', requireAuth, requireAdmin, async (req: any, res: any) => {
    const students = (await db.execute("SELECT id, email, name, student_id, dob, class_name, course_code, phone, personal_email FROM users WHERE role = 'student' ORDER BY student_id ASC")).rows;
    res.json(students);
  });

  // 12b. Admin: Get Admins list
  app.get('/api/admin/admins', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const admins = (await db.execute("SELECT id, email, name, picture, is_lecturer FROM users WHERE role = 'admin' ORDER BY name ASC")).rows;
      res.json(admins);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 12c. Admin: Toggle is_lecturer for an admin
  app.put('/api/admin/admins/:id/lecturer', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { is_lecturer } = req.body;
      const adminUser = (await db.execute({ sql: "SELECT * FROM users WHERE id = ? AND role = 'admin'", args: [req.params.id] })).rows[0] as any;
      if (!adminUser) return res.status(404).json({ error: 'Admin not found' });

      await db.execute({ sql: 'UPDATE users SET is_lecturer = ? WHERE id = ?', args: [is_lecturer ? 1 : 0, req.params.id] });
      await syncLecturerUsers();

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 13. Admin: Bulk Import Students
  app.post('/api/admin/students/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { students, override } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'Expected array of students' });
    try {
      const statements = students
        .filter((s: any) => s?.student_id && s?.name)
        .map((s: any) => {
          const email = `${s.student_id}@vnu.edu.vn`;
          if (override) {
            return {
              sql: `INSERT INTO users (email, name, role, student_id, dob, class_name) 
                    VALUES (?, ?, 'student', ?, ?, ?) 
                    ON CONFLICT(email) DO UPDATE SET 
                    name=excluded.name, dob=excluded.dob, class_name=excluded.class_name, student_id=excluded.student_id`,
              args: [email, s.name, s.student_id, s.dob || '', s.class_name || '']
            };
          }
          return {
            sql: `INSERT OR IGNORE INTO users (email, name, role, student_id, dob, class_name) 
                  VALUES (?, ?, 'student', ?, ?, ?)`,
            args: [email, s.name, s.student_id, s.dob || '', s.class_name || '']
          };
        });
      if (statements.length > 0) {
        await executeBatch(statements);
      }
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 14. Admin: Add/Update Single Student
  app.post('/api/admin/students', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { student_id, name, dob, class_name, phone, personal_email } = req.body;
    if (!student_id || !name) return res.status(400).json({ error: 'Mã SV và Họ tên là bắt buộc' });
    try {
      await db.execute({
        sql: `INSERT INTO users (email, name, role, student_id, dob, class_name, phone, personal_email)
              VALUES (?, ?, 'student', ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET
              name=excluded.name, dob=excluded.dob, class_name=excluded.class_name, student_id=excluded.student_id,
              phone=excluded.phone, personal_email=excluded.personal_email`,
        args: [`${student_id}@vnu.edu.vn`, name, student_id, dob || '', class_name || '', phone || '', personal_email || '']
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 14b. Admin: Edit Single Student
  app.put('/api/admin/students/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const selector = decodeURIComponent(req.params.id || '').trim();
      if (!selector) return res.status(400).json({ error: 'Thiếu mã sinh viên cần sửa.' });

      const isUserIdSelector = selector.startsWith('user:');
      const userId = isUserIdSelector ? Number(selector.slice(5)) : null;
      if (isUserIdSelector && (!Number.isInteger(userId) || userId <= 0)) {
        return res.status(400).json({ error: 'Mã định danh sinh viên không hợp lệ.' });
      }

      const current = (await db.execute({
        sql: isUserIdSelector
          ? "SELECT id FROM users WHERE id = ? AND role = 'student'"
          : "SELECT id FROM users WHERE student_id = ? AND role = 'student'",
        args: [isUserIdSelector ? userId : selector],
      })).rows[0] as any;
      if (!current) return res.status(404).json({ error: 'Không tìm thấy sinh viên.' });

      const studentId = String(req.body.student_id || '').trim();
      const name = String(req.body.name || '').trim();
      const dob = String(req.body.dob || '').trim();
      const className = String(req.body.class_name || '').trim();
      const phone = String(req.body.phone || '').trim();
      const personalEmail = String(req.body.personal_email || '').trim();

      if (!studentId || !name) return res.status(400).json({ error: 'Mã SV và Họ tên là bắt buộc.' });
      if (!/^\d{8}$/.test(studentId)) return res.status(400).json({ error: 'Mã SV phải gồm 8 chữ số.' });
      if (phone) {
        const cleanPhone = phone.replace(/[\s\-\.]/g, '');
        if (!/^(0|\+84)[35789]\d{8}$/.test(cleanPhone)) {
          return res.status(400).json({ error: 'Số điện thoại cá nhân không hợp lệ (phải bắt đầu bằng 0 hoặc +84 và có 10 chữ số).' });
        }
      }
      if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
        return res.status(400).json({ error: 'Email cá nhân không hợp lệ.' });
      }

      const email = `${studentId}@vnu.edu.vn`;
      await db.execute({
        sql: `UPDATE users
              SET email = ?, name = ?, student_id = ?, dob = ?, class_name = ?, phone = ?, personal_email = ?
              WHERE id = ? AND role = 'student'`,
        args: [email, name, studentId, dob || '', className || '', phone || '', personalEmail || '', current.id],
      });
      res.json({ success: true });
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('unique')) return res.status(400).json({ error: 'Mã SV hoặc email VNU đã tồn tại ở tài khoản khác.' });
      res.status(500).json({ error: 'Database error: ' + message });
    }
  });

  // 15. Admin: Delete Single Student
  app.delete('/api/admin/students/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const selector = decodeURIComponent(req.params.id || '').trim();
      if (!selector) return res.status(400).json({ error: 'Thiếu mã sinh viên cần xoá.' });

      const isUserIdSelector = selector.startsWith('user:');
      const userId = isUserIdSelector ? Number(selector.slice(5)) : null;
      if (isUserIdSelector && (!Number.isInteger(userId) || userId <= 0)) {
        return res.status(400).json({ error: 'Mã định danh sinh viên không hợp lệ.' });
      }

      const user = (await db.execute({
        sql: isUserIdSelector
          ? "SELECT id, email, student_id FROM users WHERE id = ? AND role = 'student'"
          : "SELECT id, email, student_id FROM users WHERE student_id = ? AND role = 'student'",
        args: [isUserIdSelector ? userId : selector]
      })).rows[0] as any;
      if (user) {
        const reports = (await db.execute({
          sql: 'SELECT object_key FROM final_reports WHERE user_id = ?',
          args: [user.id],
        })).rows as any[];
        await cleanupChatAttachments('SELECT attachment_key FROM chat_messages WHERE (student_user_id = ? OR sender_user_id = ?) AND attachment_key IS NOT NULL', [user.id, user.id]);
        await cleanupChatAttachments('SELECT attachment_key FROM chat_group_messages WHERE sender_user_id = ? AND attachment_key IS NOT NULL', [user.id]);
        await executeBatch([
          { sql: 'DELETE FROM advisor_assignment_history WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM advisor_requests WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM final_reports WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM grades WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM chat_messages WHERE student_user_id = ? OR sender_user_id = ?', args: [user.id, user.id] },
          { sql: 'DELETE FROM chat_group_message_reads WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM chat_group_message_reads WHERE message_id IN (SELECT id FROM chat_group_messages WHERE sender_user_id = ?)', args: [user.id] },
          { sql: 'DELETE FROM chat_group_messages WHERE sender_user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM notifications WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM final_internships WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [user.id] },
          { sql: 'DELETE FROM users WHERE id = ?', args: [user.id] },
        ]);
        await Promise.all(reports.map(report => deleteReportObject(report.object_key).catch(() => undefined)));
      }
      const studentId = user?.student_id || (!isUserIdSelector ? selector : '');
      const deletedLegacyStudent = studentId
        ? await deleteLegacyStudentRow(studentId, user?.email || `${studentId}@vnu.edu.vn`)
        : false;
      res.json({ success: true, deleted_user: Boolean(user), deleted_legacy_student: deletedLegacyStudent });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 16. Admin: Get Lecturers
  app.get('/api/admin/lecturers', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const lecturers = (await db.execute("SELECT * FROM lecturers ORDER BY name ASC")).rows;
      res.json(lecturers);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.get('/api/admin/lecturers/student-assignments', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        WITH participants AS (
          SELECT user_id FROM final_internships
          UNION
          SELECT user_id FROM advisor_requests
          UNION
          SELECT user_id FROM registrations WHERE status != 'rejected'
        ),
        registration_places AS (
          SELECT r.user_id,
                 GROUP_CONCAT(
                   CASE
                     WHEN c.name = 'Công ty khác' THEN COALESCE(NULLIF(trim(r.other_company_name), ''), c.name)
                     ELSE c.name
                   END,
                   '; '
                 ) as registered_places
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.status != 'rejected'
          GROUP BY r.user_id
        )
        SELECT p.user_id, f.internship_type, f.school_assignment_request, f.confirmed_at,
               ar.id as advisor_request_id, ar.request_type as advisor_request_type, ar.status as advisor_request_status, ar.quota_status as advisor_request_quota_status,
               u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
               CASE
                 WHEN f.id IS NULL THEN COALESCE(rp.registered_places, 'Chưa xác nhận nơi thực tập')
                 WHEN c.name = 'Công ty khác' THEN r.other_company_name
                 ELSE c.name
               END as internship_place,
               GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN aa.lecturer_id || '|' || l.name || '|' || COALESCE(l.email, '') END) as primary_assignments,
               GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN aa.lecturer_id || '|' || l.name || '|' || COALESCE(l.email, '') END) as co_assignments,
               CASE WHEN ar.status IN ('pending', 'approved') AND ar.lecturer_id IS NOT NULL
                    THEN ar.lecturer_id || '|' || COALESCE(rl.name, ar.lecturer_name_text, '') || '|' || COALESCE(rl.email, '')
               END as primary_requests,
               CASE WHEN ar.status IN ('pending', 'approved') AND ar.co_lecturer_id IS NOT NULL
                    THEN ar.co_lecturer_id || '|' || COALESCE(rcl.name, ar.co_lecturer_name_text, '') || '|' || COALESCE(rcl.email, '')
               END as co_requests
        FROM participants p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN final_internships f ON f.user_id = p.user_id
        LEFT JOIN advisor_requests ar ON ar.user_id = p.user_id
        LEFT JOIN registration_places rp ON rp.user_id = p.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = p.user_id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        LEFT JOIN lecturers rl ON rl.id = ar.lecturer_id
        LEFT JOIN lecturers rcl ON rcl.id = ar.co_lecturer_id
        GROUP BY p.user_id
        ORDER BY u.student_id ASC
      `)).rows;
      res.json({ rows });
    } catch (e: any) {
      res.status(isTransientLibsqlError(e) ? 503 : 500).json({ error: 'Không tải được danh sách sinh viên theo giảng viên.', detail: e?.message || String(e) });
    }
  });

  // 17. Admin: Bulk Import Lecturers
  app.post('/api/admin/lecturers/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { lecturers, override } = req.body;
    if (!Array.isArray(lecturers)) return res.status(400).json({ error: 'Expected array' });
    try {
      const statements = lecturers
        .map((item: any) => {
          const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
          const email = typeof item === 'string' ? null : item?.email?.trim() || null;
          const workUnit = typeof item === 'string' ? null : item?.work_unit?.trim() || null;
          if (!name) return null;
          return {
            sql: `
              INSERT INTO lecturers (name, email, work_unit)
              VALUES (?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET
                email = CASE
                  WHEN ? = 1 AND excluded.email IS NOT NULL AND excluded.email != '' THEN excluded.email
                  WHEN excluded.email IS NOT NULL AND excluded.email != '' AND (lecturers.email IS NULL OR lecturers.email = '')
                  THEN excluded.email
                  ELSE lecturers.email
                END,
                work_unit = CASE
                  WHEN ? = 1 AND excluded.work_unit IS NOT NULL AND excluded.work_unit != '' THEN excluded.work_unit
                  WHEN excluded.work_unit IS NOT NULL AND excluded.work_unit != '' AND (lecturers.work_unit IS NULL OR lecturers.work_unit = '')
                  THEN excluded.work_unit
                  ELSE lecturers.work_unit
                END
            `,
            args: [name, email, workUnit, override ? 1 : 0, override ? 1 : 0]
          };
        })
        .filter(Boolean);
      if (statements.length > 0) {
        await executeBatch(statements);
      }
      await syncLecturerUsers();
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 17b. Admin: Add Single Lecturer
  app.post('/api/admin/lecturers', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, email, work_unit } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên không được để trống' });
      const result = await db.execute({ sql: "INSERT INTO lecturers (name, email, work_unit) VALUES (?, ?, ?)", args: [name.trim(), email?.trim() || null, work_unit?.trim() || null] });
      if (email?.trim()) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 1, name = ? WHERE email = ? AND role = 'admin'",
          args: [name.trim(), email.trim()]
        });
      }
      await syncLecturerUsers();
      const newLec = (await db.execute({ sql: "SELECT * FROM lecturers WHERE id = ?", args: [Number(result.lastInsertRowid)] })).rows[0];
      res.json(newLec);
    } catch (e: any) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Giảng viên đã tồn tại' });
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 17c. Admin: Update Single Lecturer
  app.put('/api/admin/lecturers/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, email, work_unit } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên không được để trống' });
      const oldLecturer = (await db.execute({ sql: "SELECT email FROM lecturers WHERE id = ?", args: [req.params.id] })).rows[0] as any;
      await db.execute({ sql: "UPDATE lecturers SET name = ?, email = ?, work_unit = ? WHERE id = ?", args: [name.trim(), email?.trim() || null, work_unit?.trim() || null, req.params.id] });
      if (oldLecturer?.email && oldLecturer.email !== email?.trim()) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 0 WHERE email = ? AND role = 'admin'",
          args: [oldLecturer.email]
        });
      }
      if (email?.trim()) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 1, name = ? WHERE email = ? AND role = 'admin'",
          args: [name.trim(), email.trim()]
        });
      }
      await syncLecturerUsers();
      res.json({ success: true });
    } catch (e: any) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Tên giảng viên đã tồn tại' });
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.put('/api/admin/lecturers/:id/students-drive-link', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const link = String(req.body?.students_drive_link || '').trim();
      if (!link) return res.status(400).json({ error: 'Link Drive không được để trống.' });
      await db.execute({
        sql: 'UPDATE lecturers SET students_drive_link = ? WHERE id = ?',
        args: [link, req.params.id],
      });
      res.json({ success: true, students_drive_link: link });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.post('/api/admin/lecturers/send-students-email', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const lecturerName = String(req.body.lecturer_name || '').trim();
      const recipientEmail = String(req.body.recipient_email || '').trim();
      const ccEmails = Array.isArray(req.body.cc_emails)
        ? req.body.cc_emails.map((email: any) => String(email || '').trim()).filter(Boolean)
        : String(req.body.cc_emails || '').split(/[,\s;]+/).map((email: string) => email.trim()).filter(Boolean);
      const subject = String(req.body.subject || '').trim();
      const body = String(req.body.body || '').trim();
      if (!lecturerName) return res.status(400).json({ error: 'Thiếu tên giảng viên.' });
      if (!recipientEmail) return res.status(400).json({ error: 'Thiếu email giảng viên.' });
      if (!subject) return res.status(400).json({ error: 'Thiếu tiêu đề email.' });
      if (!body) return res.status(400).json({ error: 'Thiếu nội dung email.' });
      const notificationStatus = await createNotification({
        recipient_email: recipientEmail,
        cc_emails: ccEmails,
        type: 'lecturer_students_mail_merge',
        subject,
        body,
        send_now: true,
      });
      if (notificationStatus !== 'sent') {
        return res.status(400).json({
          error: notificationStatus === 'queued'
            ? 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY/EMAIL_FROM nên email chỉ được ghi vào hàng đợi, chưa gửi thật.'
            : 'Gửi email thất bại. Vui lòng xem trang Thông báo để biết lỗi chi tiết.',
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 18. Admin: Delete Single Lecturer
  app.delete('/api/admin/lecturers/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const idVal = Number(req.params.id);
      const lecturer = (await db.execute({ sql: "SELECT email FROM lecturers WHERE id = ?", args: [idVal] })).rows[0] as any;
      await cleanupChatAttachments('SELECT attachment_key FROM chat_messages WHERE lecturer_id = ? AND attachment_key IS NOT NULL', [idVal]);
      await cleanupChatAttachments('SELECT attachment_key FROM chat_group_messages WHERE lecturer_id = ? AND attachment_key IS NOT NULL', [idVal]);
      await executeBatch([
        { sql: 'DELETE FROM advisor_assignments WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM lecturer_quotas WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM chat_messages WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM chat_group_message_reads WHERE message_id IN (SELECT id FROM chat_group_messages WHERE lecturer_id = ?)', args: [idVal] },
        { sql: 'DELETE FROM chat_group_messages WHERE lecturer_id = ?', args: [idVal] },
        { sql: 'DELETE FROM lecturers WHERE id = ?', args: [idVal] }
      ]);
      if (lecturer?.email) {
        await db.execute({
          sql: "UPDATE users SET is_lecturer = 0 WHERE email = ? AND role = 'admin'",
          args: [lecturer.email]
        });
        await syncLecturerUsers();
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // ── Admin: Company CRUD ──

  // 19a. Admin: Add Single Company
  app.post('/api/admin/companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, description, slots, contact_email, address, recruitment_link, phone, contact_name } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên công ty không được để trống' });
      const result = await db.execute({
        sql: `INSERT INTO companies (name, description, slots, contact_email, address, recruitment_link, phone, contact_name, history, qualifications)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '')`,
        args: [name.trim(), description || 'Chưa rõ', parseInt(slots) || 5, contact_email || '', address || '', recruitment_link || '', phone || '', contact_name || '']
      });
      const newComp = (await db.execute({ sql: 'SELECT * FROM companies WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0];
      res.json(newComp);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 19b. Admin: Update Single Company
  app.put('/api/admin/companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { name, description, slots, contact_email, address, recruitment_link, phone, contact_name, history, qualifications } = req.body;
      if (!name) return res.status(400).json({ error: 'Tên công ty không được để trống' });
      await db.execute({
        sql: `UPDATE companies SET name = ?, description = ?, slots = ?, contact_email = ?, address = ?, recruitment_link = ?, phone = ?, contact_name = ?, history = ?, qualifications = ? WHERE id = ?`,
        args: [name.trim(), description || 'Chưa rõ', parseInt(slots) || 5, contact_email || '', address || '', recruitment_link || '', phone || '', contact_name || '', history || '', qualifications || '', req.params.id]
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.put('/api/admin/companies/:id/applicants-drive-link', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const link = String(req.body?.applicants_drive_link || '').trim();
      if (!link) return res.status(400).json({ error: 'Link Drive không được để trống.' });
      await db.execute({
        sql: 'UPDATE companies SET applicants_drive_link = ? WHERE id = ?',
        args: [link, req.params.id],
      });
      res.json({ success: true, applicants_drive_link: link });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  app.get('/api/admin/companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const officialRows = (await db.execute(`
        SELECT c.*,
               'company' as record_type,
               CAST(c.id AS TEXT) as company_key,
               c.name as display_name,
               COALESCE(rc.applicant_count, 0) as applicant_count,
               COALESCE(rc.approved_count, 0) as approved_applicant_count,
               COALESCE(rc.sent_count, 0) as sent_count,
               rc.last_sent_at,
               c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots
        FROM companies c
        LEFT JOIN (
          SELECT c2.id as company_id,
                 COUNT(r.id) as applicant_count,
                 SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
                 SUM(CASE WHEN r.sent_to_company_at IS NOT NULL THEN 1 ELSE 0 END) as sent_count,
                 MAX(r.sent_to_company_at) as last_sent_at
          FROM companies c2
          LEFT JOIN registrations r
            ON (r.company_id = c2.id AND COALESCE(r.other_company_name, '') = '')
            OR lower(trim(r.other_company_name)) = lower(trim(c2.name))
          WHERE c2.name != 'Công ty khác'
          GROUP BY c2.id
        ) rc ON rc.company_id = c.id
        WHERE c.name != 'Công ty khác'
        ORDER BY c.name ASC
      `)).rows;
      const officialNormalizedNames = new Set(officialRows.map((row: any) => normalizeCompanyName(row.name)).filter(Boolean));
      const rawOtherRows = (await db.execute(`
        SELECT other_company_name, other_company_role, other_company_contact, status, sent_to_company_at
        FROM registrations
        WHERE other_company_name IS NOT NULL AND trim(other_company_name) != ''
      `)).rows as any[];
      const otherMap = new Map<string, any>();
      for (const row of rawOtherRows) {
        const normalized = normalizeCompanyName(row.other_company_name || '');
        if (!normalized || officialNormalizedNames.has(normalized)) continue;
        const current = otherMap.get(normalized) || {
          id: null,
          record_type: 'other',
          company_key: `other:${normalized}`,
          name: String(row.other_company_name || '').trim(),
          display_name: String(row.other_company_name || '').trim(),
          description: '',
          slots: 0,
          contact_email: '',
          contact_name: '',
          history: '',
          qualifications: '',
          address: '',
          recruitment_link: '',
          phone: '',
          applicant_count: 0,
          approved_applicant_count: 0,
          sent_count: 0,
          last_sent_at: null,
          remaining_slots: 0,
          roles_set: new Set<string>(),
          contacts_set: new Set<string>(),
        };
        current.applicant_count += 1;
        if (row.status === 'approved') current.approved_applicant_count += 1;
        if (row.sent_to_company_at) {
          current.sent_count += 1;
          if (!current.last_sent_at || row.sent_to_company_at > current.last_sent_at) current.last_sent_at = row.sent_to_company_at;
        }
        if (row.other_company_role) current.roles_set.add(row.other_company_role);
        if (row.other_company_contact) current.contacts_set.add(row.other_company_contact);
        otherMap.set(normalized, current);
      }
      const otherRows = Array.from(otherMap.values())
        .map(row => ({
          ...row,
          roles: Array.from(row.roles_set).join(','),
          contacts: Array.from(row.contacts_set).join(','),
          roles_set: undefined,
          contacts_set: undefined,
        }))
        .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'vi'));
      res.json([...officialRows, ...otherRows]);
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 19c. Admin: Delete Single Company
  app.delete('/api/admin/companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      // Also delete dependent internship/registration records for this company
      await executeBatch([
        { sql: 'DELETE FROM final_internships WHERE company_id = ?', args: [req.params.id] },
        { sql: 'DELETE FROM registrations WHERE company_id = ?', args: [req.params.id] },
        { sql: 'DELETE FROM companies WHERE id = ?', args: [req.params.id] },
      ]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 19d. Admin: Bulk Import Companies from CSV
  app.post('/api/admin/companies/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { companies, override } = req.body;
    if (!Array.isArray(companies)) return res.status(400).json({ error: 'Expected array' });
    try {
      if (override) {
        await db.executeMultiple('DELETE FROM final_internships');
        await db.executeMultiple('DELETE FROM registrations');
        await db.executeMultiple('DELETE FROM companies');
      }
      const statements = companies
        .map((item: any) => {
          const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
          if (!name) return null;
          const slots = parseInt(item?.slots) || 5;
          const contact_email = item?.contact_email || '';
          const address = item?.address || '';
          const phone = item?.phone || '';
          const contact_name = item?.contact_name || '';
          return {
            sql: `INSERT OR IGNORE INTO companies (name, description, slots, contact_email, address, phone, contact_name, history, qualifications, recruitment_link) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '')`,
            args: [name, 'Chưa rõ', slots, contact_email, address, phone, contact_name]
          };
        })
        .filter(Boolean);
      if (statements.length > 0) {
        await executeBatch(statements);
      }
      await ensureSpecialCompanies();
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });

  // 6. Admin: Get all registrations
  app.get('/api/admin/registrations', requireAuth, requireAdmin, async (req, res) => {
    const data = (await db.execute(`
      SELECT 
        r.id as registration_id,
        r.user_id,
        r.company_id,
        u.email,
        u.name as student_name,
        u.student_id,
        u.dob,
        u.class_name,
        r.note,
        r.review_comment,
        r.preference_order,
        COALESCE(c.name, 'Không rõ/đã bị xoá') as company_name,
        r.status,
        r.created_at,
        r.other_company_name,
        r.other_company_role,
        r.other_company_contact,
        r.sent_to_company_at,
        r.sent_to_company_note,
        u.course_code,
        c.contact_email,
        u.phone,
        u.personal_email
      FROM registrations r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN companies c ON r.company_id = c.id
      ORDER BY r.created_at DESC
    `)).rows;
    res.json(data);
  });

  app.post('/api/admin/registrations', requireAuth, requireAdmin, async (req: any, res: any) => {
    const userId = Number(req.body?.user_id);
    const companyId = Number(req.body?.company_id);
    const status = String(req.body?.status || 'approved');
    const note = String(req.body?.note || '').trim();
    const reviewComment = String(req.body?.review_comment || '').trim();
    const courseCode = String(req.body?.course_code || '').trim();
    const requestedOrder = req.body?.preference_order === '' || req.body?.preference_order === undefined || req.body?.preference_order === null
      ? null
      : Number(req.body.preference_order);

    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Sinh viên không hợp lệ.' });
    if (!Number.isInteger(companyId) || companyId <= 0) return res.status(400).json({ error: 'Nơi thực tập không hợp lệ.' });
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    if (requestedOrder !== null && (!Number.isInteger(requestedOrder) || requestedOrder < 1)) return res.status(400).json({ error: 'Thứ tự nguyện vọng không hợp lệ.' });

    try {
      const student = (await db.execute({
        sql: "SELECT id, email, personal_email, name FROM users WHERE id = ? AND role = 'student'",
        args: [userId],
      })).rows[0] as any;
      if (!student) return res.status(404).json({ error: 'Không tìm thấy sinh viên.' });

      const company = (await db.execute({ sql: 'SELECT id, name FROM companies WHERE id = ?', args: [companyId] })).rows[0] as any;
      if (!company) return res.status(400).json({ error: 'Không tìm thấy nơi thực tập.' });

      const existingRows = (await db.execute({
        sql: 'SELECT id, company_id, other_company_name, preference_order FROM registrations WHERE user_id = ? ORDER BY COALESCE(preference_order, 999), created_at ASC',
        args: [userId],
      })).rows as any[];
      if (existingRows.length >= 5) return res.status(400).json({ error: 'Sinh viên đã có đủ 5 nguyện vọng. Vui lòng sửa/xóa nguyện vọng hiện có nếu cần thay đổi.' });
      for (let index = 0; index < existingRows.length; index++) {
        const normalizedOrder = index + 1;
        if (Number(existingRows[index].preference_order || 0) !== normalizedOrder) {
          await db.execute({
            sql: 'UPDATE registrations SET preference_order = ? WHERE id = ?',
            args: [normalizedOrder, Number(existingRows[index].id)],
          });
          existingRows[index].preference_order = normalizedOrder;
        }
      }

      const isOtherCompany = company.name === 'Công ty khác';
      const isSchoolInternship = company.name === 'Trường Đại học Công nghệ';
      const otherCompanyName = isOtherCompany ? String(req.body?.other_company_name || '').trim() : '';
      const otherCompanyRole = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_role || '').trim() : '';
      const otherCompanyContact = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_contact || '').trim() : '';
      if (isOtherCompany && !otherCompanyName) return res.status(400).json({ error: 'Vui lòng nhập tên công ty tự liên hệ.' });

      const normalizedOtherName = normalizeCompanyName(otherCompanyName);
      const duplicate = existingRows.some((row: any) => {
        if (isOtherCompany) {
          return Number(row.company_id) === companyId && normalizeCompanyName(row.other_company_name || '') === normalizedOtherName;
        }
        return Number(row.company_id) === companyId;
      });
      if (duplicate) return res.status(400).json({ error: 'Sinh viên đã có nguyện vọng này trong danh sách đăng ký.' });

      const preferenceOrder = requestedOrder === null
        ? existingRows.length + 1
        : Math.min(requestedOrder, existingRows.length + 1);

      await db.execute({
        sql: 'UPDATE registrations SET preference_order = preference_order + 1 WHERE user_id = ? AND preference_order >= ?',
        args: [userId, preferenceOrder],
      });

      const result = await db.execute({
        sql: `INSERT INTO registrations (user_id, company_id, note, status, review_comment, other_company_name, other_company_role, other_company_contact, preference_order, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
        args: [
          userId,
          companyId,
          note || null,
          status,
          reviewComment || null,
          otherCompanyName || null,
          otherCompanyRole || null,
          otherCompanyContact || null,
          preferenceOrder,
        ],
      });

      if (courseCode) {
        await db.execute({ sql: 'UPDATE users SET course_code = ? WHERE id = ?', args: [courseCode, userId] });
      }

      const inserted = (await db.execute({
        sql: `SELECT r.*, c.name as company_name
              FROM registrations r
              LEFT JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [Number(result.lastInsertRowid)],
      })).rows[0] as any;
      if (status === 'approved') {
        await addApprovedCompanyFromRegistration(inserted);
      }
      await ensureSchoolFinalInternshipFromRegistration(userId, req.user.id);

      await createNotification({
        user_id: userId,
        recipient_email: student.personal_email || student.email,
        type: 'registration_status_changed',
        subject: 'Khoa đã bổ sung đăng ký thực tập cho bạn',
        body: `Khoa đã bổ sung nguyện vọng thực tập: ${isOtherCompany ? otherCompanyName : company.name}. Trạng thái hiện tại: ${status === 'approved' ? 'Đã duyệt' : status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}.${reviewComment ? `\n\nNhận xét: ${reviewComment}` : ''}`,
        status: 'website_only',
      });

      res.json({ success: true, registration_id: Number(result.lastInsertRowid) });
    } catch (error: any) {
      if (String(error?.message || '').includes('UNIQUE')) {
        return res.status(400).json({ error: 'Sinh viên đã có nguyện vọng này trong danh sách đăng ký.' });
      }
      console.error('[admin registrations] add failed:', error);
      res.status(500).json({ error: 'Không thể thêm đăng ký thực tập.' });
    }
  });

  app.put('/api/admin/registrations/:id(\\d+)', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const companyId = Number(req.body?.company_id);
    const note = String(req.body?.note || '').trim();
    const courseCode = String(req.body?.course_code || '').trim();
    const preferenceOrder = req.body?.preference_order === '' || req.body?.preference_order === undefined || req.body?.preference_order === null
      ? null
      : Number(req.body.preference_order);

    if (!Number.isInteger(companyId) || companyId <= 0) return res.status(400).json({ error: 'Nơi thực tập không hợp lệ.' });
    if (preferenceOrder !== null && (!Number.isInteger(preferenceOrder) || preferenceOrder < 1)) return res.status(400).json({ error: 'Thứ tự nguyện vọng không hợp lệ.' });

    try {
      const current = (await db.execute({
        sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [id],
      })).rows[0] as any;
      if (!current) return res.status(404).json({ error: 'Không tìm thấy đăng ký.' });

      const company = (await db.execute({ sql: 'SELECT id, name FROM companies WHERE id = ?', args: [companyId] })).rows[0] as any;
      if (!company) return res.status(400).json({ error: 'Không tìm thấy nơi thực tập.' });

      const isOtherCompany = company.name === 'Công ty khác';
      const isSchoolInternship = company.name === 'Trường Đại học Công nghệ';
      const otherCompanyName = isOtherCompany ? String(req.body?.other_company_name || '').trim() : '';
      const otherCompanyRole = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_role || '').trim() : '';
      const otherCompanyContact = isOtherCompany || isSchoolInternship ? String(req.body?.other_company_contact || '').trim() : '';
      if (isOtherCompany && !otherCompanyName) return res.status(400).json({ error: 'Vui lòng nhập tên công ty tự liên hệ.' });
      const approvedCompany = isOtherCompany
        ? (await db.execute({
            sql: 'SELECT id FROM approved_company_names WHERE normalized_name = ? LIMIT 1',
            args: [normalizeCompanyName(otherCompanyName)],
          })).rows[0]
        : company;
      const status = approvedCompany ? 'approved' : 'pending';
      const reviewComment = current.status === status ? String(current.review_comment || '').trim() : '';
      const targetChanged =
        Number(current.company_id) !== companyId ||
        String(current.other_company_name || '').trim() !== otherCompanyName;

      await db.execute({
        sql: `UPDATE registrations
              SET company_id = ?, note = ?, status = ?,
                  review_comment = CASE WHEN status != ? THEN NULL ELSE review_comment END,
                  preference_order = ?,
                  other_company_name = ?, other_company_role = ?, other_company_contact = ?,
                  created_at = datetime('now', '+7 hours')
              WHERE id = ?`,
        args: [companyId, note || null, status, status, preferenceOrder, otherCompanyName || null, otherCompanyRole || null, otherCompanyContact || null, id],
      });
      await db.execute({
        sql: 'UPDATE users SET course_code = ? WHERE id = ?',
        args: [courseCode || null, current.user_id],
      });
      if (targetChanged) {
        await db.execute({
          sql: 'UPDATE registrations SET sent_to_company_at = NULL, sent_to_company_note = NULL WHERE id = ?',
          args: [id],
        });
      }

      const updated = {
        ...current,
        company_id: companyId,
        company_name: company.name,
        other_company_name: otherCompanyName,
        other_company_role: otherCompanyRole,
        other_company_contact: otherCompanyContact,
      };
      if (status === 'approved') {
        await addApprovedCompanyFromRegistration(updated);
        const autoApproved = await approveMatchingOtherCompanyRegistrations(updated, reviewComment);
        for (const item of autoApproved) {
          await createNotification({
            user_id: Number(item.user_id),
            recipient_email: item.personal_email || item.email,
            type: 'registration_status_changed',
            subject: 'Đăng ký thực tập đã được duyệt',
            body: `Đăng ký thực tập tại ${item.other_company_name || 'Công ty tự liên hệ'} đã được tự động duyệt vì công ty này đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
            send_now: true,
          });
        }
      }

      if (current.status !== status) {
        await createNotification({
          user_id: Number(current.user_id),
          recipient_email: current.personal_email || current.email,
          type: 'registration_status_changed',
          subject: `Đăng ký thực tập ${status === 'approved' ? 'đã được duyệt' : 'đang chờ duyệt'}`,
          body: `Đăng ký thực tập tại ${company.name === 'Công ty khác' ? otherCompanyName || 'Công ty khác' : company.name} hiện có trạng thái: ${status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
          send_now: true,
        });
      }
      if (company.name !== 'Trường Đại học Công nghệ' && current.company_name === 'Trường Đại học Công nghệ') {
        await db.execute({
          sql: "DELETE FROM final_internships WHERE user_id = ? AND registration_id = ? AND internship_type = 'school' AND locked_at IS NULL",
          args: [Number(current.user_id), Number(id)],
        });
      } else {
        await ensureSchoolFinalInternshipFromRegistration(Number(current.user_id), req.user.id);
        // Đồng bộ advisor_assignments khi GVHD thay đổi (chỉ áp dụng với đăng ký Trường Đại học Công nghệ)
        if (isSchoolInternship) {
          const syncResult = await syncAdvisorFromSchoolRegistration(
            Number(current.user_id),
            otherCompanyContact,
            otherCompanyRole,
            Number(req.user.id),
          );
          if (syncResult.warning) console.warn(`[syncAdvisor] userId=${current.user_id}: ${syncResult.warning}`);
        }
      }

      res.json({ success: true, status });
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('unique')) return res.status(400).json({ error: 'Sinh viên đã có đăng ký trùng nơi thực tập này.' });
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/registrations/:id(\\d+)', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const registrationId = Number(id);
    if (!Number.isInteger(registrationId) || registrationId <= 0) {
      return res.status(400).json({ error: 'Mã đăng ký không hợp lệ.' });
    }

    try {
      const reg = (await db.execute({
        sql: `SELECT r.*, u.name as student_name, u.student_id, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              LEFT JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [registrationId],
      })).rows[0] as any;

      if (!reg) {
        return res.status(404).json({ error: 'Không tìm thấy đăng ký cần xóa.' });
      }

      const lockedFinal = (await db.execute({
        sql: 'SELECT id, locked_at FROM final_internships WHERE registration_id = ? AND locked_at IS NOT NULL LIMIT 1',
        args: [registrationId],
      })).rows[0] as any;

      if (lockedFinal) {
        return res.status(400).json({
          error: 'Không thể xóa đăng ký đã được chốt và khóa nơi thực tập chính thức.',
        });
      }

      await executeBatch([
        { sql: 'DELETE FROM final_internships WHERE (registration_id = ? OR (user_id = ? AND registration_id IS NULL)) AND locked_at IS NULL', args: [registrationId, reg.user_id] },
        { sql: 'UPDATE advisor_requests SET source_registration_id = NULL WHERE source_registration_id = ?', args: [registrationId] },
        { sql: 'DELETE FROM registrations WHERE id = ?', args: [registrationId] },
      ]);

      res.json({ success: true, message: 'Đã xóa đăng ký thành công.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Lỗi khi xóa đăng ký.' });
    }
  });

  app.get('/api/admin/approved-companies', requireAuth, requireAdmin, async (req, res) => {
    const rows = (await db.execute('SELECT * FROM approved_company_names ORDER BY name ASC')).rows;
    res.json(rows);
  });

  app.post('/api/admin/approved-companies/import', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const items = Array.isArray(req.body.companies) ? req.body.companies : [];
      if (req.body.override) await db.execute('DELETE FROM approved_company_names');
      const statements = items.map((item: any) => {
        const name = typeof item === 'string' ? item.trim() : String(item?.name || '').trim();
        const normalized = normalizeCompanyName(name);
        if (!name || !normalized) return null;
        return {
          sql: `INSERT INTO approved_company_names (name, normalized_name, source)
                VALUES (?, ?, ?)
                ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name, source = excluded.source`,
          args: [name, normalized, req.body.source || 'manual'],
        };
      }).filter(Boolean);
      await executeBatch(statements);
      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/approved-companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const name = String(req.body.name || '').trim();
      const normalized = normalizeCompanyName(name);
      if (!name || !normalized) return res.status(400).json({ error: 'Tên công ty không được để trống.' });
      const result = await db.execute({
        sql: `INSERT INTO approved_company_names (name, normalized_name, source) VALUES (?, ?, ?)`,
        args: [name, normalized, req.body.source || 'manual'],
      });
      const row = (await db.execute({ sql: 'SELECT * FROM approved_company_names WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0];
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: 'Công ty này đã có trong danh sách thẩm định.' });
    }
  });

  app.put('/api/admin/approved-companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const name = String(req.body.name || '').trim();
      const normalized = normalizeCompanyName(name);
      if (!name || !normalized) return res.status(400).json({ error: 'Tên công ty không được để trống.' });
      await db.execute({
        sql: `UPDATE approved_company_names SET name = ?, normalized_name = ?, source = ? WHERE id = ?`,
        args: [name, normalized, req.body.source || 'manual', Number(req.params.id)],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: 'Tên công ty bị trùng với một mục đã có.' });
    }
  });

  app.delete('/api/admin/approved-companies/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({ sql: 'DELETE FROM approved_company_names WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ success: true });
  });

  app.put('/api/admin/registrations/mark-sent', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const note = req.body.note || null;
      if (Array.isArray(req.body.registration_ids) && req.body.registration_ids.length > 0) {
        const ids = req.body.registration_ids.map((id: any) => Number(id)).filter(Boolean);
        if (ids.length === 0) return res.status(400).json({ error: 'Danh sách đăng ký không hợp lệ' });
        await db.execute({
          sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
                WHERE id IN (${ids.map(() => '?').join(',')})`,
          args: [note, ...ids],
        });
        return res.json({ success: true, count: ids.length });
      }
      if (req.body.company_name) {
        await db.execute({
          sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
                WHERE status = 'approved'
                  AND (
                    company_id IN (SELECT id FROM companies WHERE name = ?)
                    OR lower(trim(other_company_name)) = lower(trim(?))
                  )`,
          args: [note, req.body.company_name, req.body.company_name],
        });
        return res.json({ success: true });
      }
      if (req.body.other_company_name) {
        await db.execute({
          sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
                WHERE status = 'approved'
                  AND lower(trim(other_company_name)) = lower(trim(?))`,
          args: [note, req.body.other_company_name],
        });
        return res.json({ success: true });
      }
      res.status(400).json({ error: 'Vui lòng chọn đăng ký hoặc công ty cần đánh dấu đã gửi.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/companies/send-applicants-email', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const companyName = String(req.body.company_name || req.body.other_company_name || '').trim();
      const recipientEmail = String(req.body.recipient_email || '').trim();
      const ccEmails = Array.isArray(req.body.cc_emails)
        ? req.body.cc_emails.map((email: any) => String(email || '').trim()).filter(Boolean)
        : String(req.body.cc_emails || '').split(/[,\s;]+/).map((email: string) => email.trim()).filter(Boolean);
      if (!companyName) return res.status(400).json({ error: 'Thiếu tên công ty.' });
      if (!recipientEmail) return res.status(400).json({ error: 'Thiếu email doanh nghiệp.' });
      const isOther = Boolean(req.body.other_company_name);
      if (isOther) return res.status(400).json({ error: 'Chỉ hỗ trợ gửi email thật cho doanh nghiệp chính thức.' });
      const rows = (await db.execute({
        sql: `SELECT r.id, u.student_id, u.name, u.phone, u.personal_email, u.class_name, u.course_code, r.note
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.status = 'approved'
                AND ${isOther ? 'lower(trim(r.other_company_name)) = lower(trim(?))' : '(c.name = ? OR lower(trim(r.other_company_name)) = lower(trim(?)))'}
              ORDER BY u.student_id ASC`,
        args: isOther ? [companyName] : [companyName, companyName],
      })).rows as any[];
      if (rows.length === 0) return res.status(400).json({ error: 'Công ty này chưa có đăng ký đã duyệt để gửi.' });
      const body = String(req.body.body || '').trim() || [
        'Kính gửi Quý Công ty,',
        '',
        `Khoa CNTT gửi danh sách sinh viên đăng ký thực tập tại ${companyName}.`,
        '',
        ...rows.map((row, idx) => `${idx + 1}. ${row.student_id || ''} - ${row.name || ''} - ${row.class_name || ''} - ${row.course_code || ''} - ${row.phone || ''} - ${row.personal_email || ''}${row.note ? ` - Ghi chú: ${row.note}` : ''}`),
        '',
        'Trân trọng.',
      ].join('\n');
      const subject = String(req.body.subject || '').trim() || `Danh sách sinh viên đăng ký thực tập - ${companyName}`;
      const notificationStatus = await createNotification({
        recipient_email: recipientEmail,
        cc_emails: ccEmails,
        type: 'company_applicants_sent',
        subject,
        body,
        send_now: true,
      });
      if (notificationStatus !== 'sent') {
        return res.status(400).json({
          error: notificationStatus === 'queued'
            ? 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY/EMAIL_FROM nên email chỉ được ghi vào hàng đợi, chưa gửi thật.'
            : 'Gửi email thất bại. Vui lòng xem trang Thông báo để biết lỗi chi tiết.',
        });
      }
      await db.execute({
        sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = 'Gửi email thật qua hệ thống'
              WHERE status = 'approved'
                AND ${isOther ? 'lower(trim(other_company_name)) = lower(trim(?))' : '(company_id IN (SELECT id FROM companies WHERE name = ?) OR lower(trim(other_company_name)) = lower(trim(?)))'}`,
        args: isOther ? [companyName] : [companyName, companyName],
      });
      res.json({ success: true, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/final-internships', requireAuth, requireAdmin, async (req, res) => {
    await backfillSchoolFinalInternshipsFromRegistrations((req as any).user?.id);
    const rows = (await db.execute(`
      SELECT f.*, u.email, u.name as student_name, u.student_id, u.class_name, u.course_code, u.phone, u.personal_email,
             c.name as company_name, r.other_company_name, r.other_company_role, r.other_company_contact
      FROM final_internships f
      JOIN users u ON f.user_id = u.id
      LEFT JOIN companies c ON f.company_id = c.id
      LEFT JOIN registrations r ON f.registration_id = r.id
      ORDER BY f.confirmed_at DESC
    `)).rows;
    res.json(rows);
  });

  app.get('/api/admin/unconfirmed-internships', requireAuth, requireAdmin, async (req, res) => {
    try {
      await backfillSchoolFinalInternshipsFromRegistrations((req as any).user?.id);
      const rows = (await db.execute(`
        WITH confirmed_students AS (
          SELECT DISTINCT user_id FROM final_internships
        ),
        student_regs AS (
          SELECT 
            r.user_id,
            COUNT(r.id) as reg_count,
            GROUP_CONCAT(
              (CASE WHEN r.preference_order IS NOT NULL THEN 'NV' || r.preference_order || ': ' ELSE '' END) ||
              (CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || COALESCE(r.other_company_name, '')
                    WHEN c.name = 'Trường Đại học Công nghệ' THEN 'Trường Đại học Công nghệ'
                    ELSE COALESCE(c.name, 'Chưa rõ') END) ||
              ' (' || (CASE WHEN r.status = 'approved' THEN 'Đã duyệt' WHEN r.status = 'rejected' THEN 'Từ chối' ELSE 'Chờ duyệt' END) || ')',
              '; '
            ) as registered_places_summary
          FROM registrations r
          LEFT JOIN companies c ON r.company_id = c.id
          GROUP BY r.user_id
        )
        SELECT 
          u.id as user_id,
          u.student_id,
          u.name as student_name,
          u.dob,
          u.class_name,
          u.course_code,
          u.phone,
          u.email,
          u.personal_email,
          COALESCE(sr.reg_count, 0) as registered_count,
          COALESCE(sr.registered_places_summary, 'Chưa đăng ký') as registered_places,
          'Chưa xác nhận' as confirmation_status
        FROM registrations r
        JOIN users u ON r.user_id = u.id
        LEFT JOIN student_regs sr ON sr.user_id = u.id
        WHERE u.id NOT IN (SELECT user_id FROM confirmed_students)
        GROUP BY u.id
        ORDER BY u.class_name ASC, u.student_id ASC
      `)).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/registered-students-export', requireAuth, requireAdmin, async (req, res) => {
    try {
      await backfillSchoolFinalInternshipsFromRegistrations((req as any).user?.id);
      const rows = (await db.execute(`
        WITH registered_students AS (
          SELECT DISTINCT user_id FROM registrations
        ),
        school_proposals AS (
          SELECT r.user_id,
                 MAX(CASE WHEN NULLIF(TRIM(r.other_company_contact), '') IS NOT NULL THEN r.other_company_contact END) as school_primary,
                 MAX(CASE WHEN NULLIF(TRIM(r.other_company_role), '') IS NOT NULL THEN r.other_company_role END) as school_co
          FROM registrations r
          JOIN companies sc ON sc.id = r.company_id
          WHERE sc.name = 'Trường Đại học Công nghệ' AND r.status != 'rejected'
          GROUP BY r.user_id
        )
        SELECT 
          u.id as user_id,
          u.student_id,
          u.name as student_name,
          u.dob,
          u.class_name,
          CASE
            WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
            ELSE COALESCE(u.course_code, '')
          END as course_code,
          u.phone,
          u.personal_email,
          u.email,
          CASE
            WHEN f.id IS NULL THEN 'Chưa xác nhận'
            WHEN fc.name = 'Công ty khác' THEN COALESCE(NULLIF(TRIM(fr.other_company_name), ''), 'Công ty khác')
            ELSE COALESCE(fc.name, 'Chưa rõ')
          END as final_internship_place,
          COALESCE(
            NULLIF(GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN l.name END, '; '), ''),
            NULLIF(TRIM(f.school_lecturer), ''),
            NULLIF(TRIM(sp.school_primary), ''),
            ''
          ) as primary_advisors,
          COALESCE(
            NULLIF(GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN l.name END, '; '), ''),
            NULLIF(TRIM(sp.school_co), ''),
            ''
          ) as co_advisors
        FROM registered_students rs
        JOIN users u ON u.id = rs.user_id
        LEFT JOIN final_internships f ON f.user_id = u.id
        LEFT JOIN companies fc ON fc.id = f.company_id
        LEFT JOIN registrations fr ON fr.id = f.registration_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = u.id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        LEFT JOIN school_proposals sp ON sp.user_id = u.id
        GROUP BY u.id
        ORDER BY u.class_name ASC, u.student_id ASC
      `)).rows as any[];
      res.json(rows.map(r => ({ ...r, student_name: cleanStudentName(r.student_name, r.student_id, r.email) })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/final-internships/:userId', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const targetUserId = Number(req.params.userId);
      if (!targetUserId) return res.status(400).json({ error: 'User không hợp lệ' });
      const type = req.body.internship_type === 'school' || req.body.internship_type === 'partner' ? req.body.internship_type : 'company';
      let registrationId = req.body.registration_id ? Number(req.body.registration_id) : null;
      let companyId = req.body.company_id ? Number(req.body.company_id) : null;
      if (registrationId) {
        const reg = (await db.execute({ sql: 'SELECT * FROM registrations WHERE id = ? AND user_id = ?', args: [registrationId, targetUserId] })).rows[0] as any;
        if (!reg) return res.status(404).json({ error: 'Không tìm thấy đăng ký của sinh viên.' });
        if (reg.status !== 'approved') return res.status(400).json({ error: 'Chỉ có thể tạo nơi thực tập từ đăng ký đã duyệt.' });
        companyId = reg.company_id;
      }
      if (!companyId && type !== 'partner') {
        const school = (await db.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
        companyId = school?.id || null;
      }
      const schoolAssignmentRequest = req.body.school_assignment_request ? 1 : 0;
      await db.execute({
        sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
              VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))
              ON CONFLICT(user_id) DO UPDATE SET registration_id = excluded.registration_id, company_id = excluded.company_id,
                internship_type = excluded.internship_type, status = 'confirmed', student_attested = excluded.student_attested,
                attestation_text = excluded.attestation_text, school_lecturer = excluded.school_lecturer,
                school_assignment_request = excluded.school_assignment_request, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
        args: [targetUserId, registrationId, companyId, type, req.body.student_attested ? 1 : 0, req.body.attestation_text || null, req.body.school_lecturer || null, schoolAssignmentRequest, req.user.id, req.body.note || null],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/final-internships/:userId', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const targetUserId = Number(req.params.userId);
      if (!targetUserId) return res.status(400).json({ error: 'User không hợp lệ' });
      const locked = (await db.execute({
        sql: 'SELECT locked_at FROM final_internships WHERE user_id = ? AND locked_at IS NOT NULL',
        args: [targetUserId],
      })).rows[0];
      if (locked) {
        return res.status(400).json({ error: 'Không thể xóa nơi thực tập chính thức đã bị khóa.' });
      }
      await executeBatch([
        { sql: 'DELETE FROM grades WHERE user_id = ? AND locked_at IS NULL', args: [targetUserId] },
        { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [targetUserId] },
        { sql: 'DELETE FROM final_reports WHERE user_id = ?', args: [targetUserId] },
        { sql: 'DELETE FROM final_internships WHERE user_id = ?', args: [targetUserId] },
      ]);
      res.json({ success: true, message: 'Đã xóa sinh viên khỏi danh sách thực tập chính thức và bảng điểm.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/final-internships/:userId/lock', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      await db.execute({
        sql: `UPDATE final_internships SET locked_at = ${req.body.locked === false ? 'NULL' : "datetime('now', '+7 hours')"} WHERE user_id = ?`,
        args: [Number(req.params.userId)],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  async function resolveLecturerId(body: any) {
    if (body.lecturer_id) return Number(body.lecturer_id);
    const key = String(body.lecturer_email_or_name || body.lecturer || '').trim();
    if (!key) return 0;
    const row = (await db.execute({
      sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1',
      args: [key, key],
    })).rows[0] as any;
    return row ? Number(row.id) : 0;
  }

  async function advisorQuotaLimit(lecturer: any) {
    const quotaRow = (await db.execute({ sql: 'SELECT max_total_students FROM lecturer_quotas WHERE lecturer_id = ?', args: [Number(lecturer.id)] })).rows[0] as any;
    if (quotaRow && quotaRow.max_total_students != null) return Number(quotaRow.max_total_students);
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')")).rows as any[]);
    const upper = String(lecturer.name || '').toUpperCase();
    if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return Number(settings.advisor_quota_pgs || 5);
    if (/\bTS\b/.test(upper) || upper.includes('TS.')) return Number(settings.advisor_quota_ts || 8);
    return Number(settings.advisor_quota_ths || 10);
  }

  async function advisorQuotaStatus(lecturerId: number | null) {
    if (!lecturerId) return 'unknown';
    const lecturer = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE id = ?', args: [lecturerId] })).rows[0] as any;
    if (!lecturer) return 'unknown';
    const maxTotal = await advisorQuotaLimit(lecturer);
    const current = (await db.execute({ sql: 'SELECT COUNT(DISTINCT user_id) as count FROM advisor_assignments WHERE lecturer_id = ?', args: [lecturerId] })).rows[0] as any;
    return Number(current?.count || 0) >= maxTotal ? 'over_quota' : 'within_quota';
  }

  async function findLecturerByNameText(name: string) {
    const key = String(name || '').trim();
    if (!key) return null;
    return (await db.execute({
      sql: 'SELECT * FROM lecturers WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1',
      args: [key],
    })).rows[0] as any || null;
  }

  async function approveAgreedAdvisorRequest(request: any, actorId: number) {
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

  async function ensureAdvisorRequestFromSchoolRegistration(userId: number) {
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

  async function advisorRequestWithNames(userId: number) {
    return (await db.execute({
      sql: `SELECT ar.*, l.name as lecturer_name, l.email as lecturer_email, cl.name as co_lecturer_name, cl.email as co_lecturer_email
            FROM advisor_requests ar
            LEFT JOIN lecturers l ON l.id = ar.lecturer_id
            LEFT JOIN lecturers cl ON cl.id = ar.co_lecturer_id
            WHERE ar.user_id = ?`,
      args: [userId],
    })).rows[0] || null;
  }

  async function ensureAdvisorRequestsFromLegacySchoolRegistrations() {
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

  async function approvePendingAgreedAdvisorRequests(actorId: number) {
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

  async function createAdvisorAssignment(body: any, adminUserId: number) {
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

  async function autoAssignPrimaryAdvisors(adminUserId: number) {
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

  async function autoAssignAfterAdvisorWindow(adminUserId: number) {
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

  app.get('/api/admin/advisor-assignments', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        WITH participants AS (
          SELECT user_id FROM final_internships
          UNION
          SELECT user_id FROM advisor_requests
          UNION
          SELECT user_id FROM registrations WHERE status != 'rejected'
          UNION
          SELECT user_id FROM advisor_assignments
        ),
        registration_places AS (
          SELECT r.user_id,
                 GROUP_CONCAT(
                   CASE
                     WHEN c.name = 'Công ty khác' THEN COALESCE(NULLIF(trim(r.other_company_name), ''), c.name)
                     ELSE c.name
                   END,
                   '; '
                 ) as registered_places
          FROM registrations r
          JOIN companies c ON c.id = r.company_id
          WHERE r.status != 'rejected'
          GROUP BY r.user_id
        )
        SELECT p.user_id, f.internship_type, f.school_assignment_request, f.confirmed_at,
               ar.request_type as advisor_request_type, ar.status as advisor_request_status,
               u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
               CASE
                 WHEN f.id IS NULL THEN 'Chưa xác nhận nơi thực tập'
                 WHEN c.name = 'Công ty khác' THEN r.other_company_name
                 ELSE c.name
               END as final_internship_place,
               CASE
                 WHEN f.id IS NULL THEN COALESCE(rp.registered_places, 'Chưa xác nhận nơi thực tập')
                 WHEN c.name = 'Công ty khác' THEN r.other_company_name
                 ELSE c.name
               END as internship_place,
               GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN aa.id || '|' || COALESCE(l.name, 'Giảng viên đã bị xóa') || '|' || COALESCE(l.email, '') || '|' || COALESCE(aa.note, '') END) as primary_assignments,
               GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN aa.id || '|' || COALESCE(l.name, 'Giảng viên đã bị xóa') || '|' || COALESCE(l.email, '') || '|' || COALESCE(aa.note, '') END) as co_assignments
        FROM participants p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN final_internships f ON f.user_id = p.user_id
        LEFT JOIN advisor_requests ar ON ar.user_id = p.user_id
        LEFT JOIN registration_places rp ON rp.user_id = p.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = p.user_id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        GROUP BY p.user_id
        ORDER BY u.student_id ASC
      `)).rows;
      const quotaSettings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')")).rows as any[]);
      const lecturersRaw = (await db.execute(`
        SELECT l.*, q.max_total_students as quota_override,
               COALESCE(ac.assignment_count, 0) as assignment_count
        FROM lecturers l
        LEFT JOIN lecturer_quotas q ON q.lecturer_id = l.id
        LEFT JOIN (SELECT lecturer_id, COUNT(DISTINCT user_id) as assignment_count FROM advisor_assignments GROUP BY lecturer_id) ac ON ac.lecturer_id = l.id
        ORDER BY l.name ASC
      `)).rows as any[];
      const lecturers = lecturersRaw.map((lecturer: any) => {
        const upper = String(lecturer.name || '').toUpperCase();
        const defaultQuota = /\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')
          ? Number(quotaSettings.advisor_quota_pgs || 5)
          : /\bTS\b/.test(upper) || upper.includes('TS.')
            ? Number(quotaSettings.advisor_quota_ts || 8)
            : Number(quotaSettings.advisor_quota_ths || 10);
        return { ...lecturer, max_total_students: lecturer.quota_override !== null && lecturer.quota_override !== undefined ? Number(lecturer.quota_override) : defaultQuota, assignment_count: Number(lecturer.assignment_count || 0) };
      });
      res.json({ rows, lecturers });
      setTimeout(() => {
        if (advisorAutoAssignRunning) return;
        advisorAutoAssignRunning = true;
        autoAssignAfterAdvisorWindow(req.user.id)
          .catch((autoAssignError: any) => {
            console.error('[advisor] auto-assign after window failed:', autoAssignError);
          })
          .finally(() => {
            advisorAutoAssignRunning = false;
          });
      }, 0);
    } catch (error: any) {
      console.error('[advisor] failed to load advisor assignments:', error);
      res.status(isTransientLibsqlError(error) ? 503 : 500).json({ error: 'Không tải được danh sách phân công.', detail: error?.message || String(error) });
    }
  });

  app.post('/api/admin/advisor-assignments', requireAuth, requireAdmin, async (req: any, res: any) => {
    const result = await createAdvisorAssignment({ ...req.body, allow_without_final: true, allow_over_quota: true, replace_existing: true }, req.user.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result.row);
  });

  app.post('/api/admin/advisor-assignments/bulk', requireAuth, requireAdmin, async (req: any, res: any) => {
    const items = Array.isArray(req.body.assignments) ? req.body.assignments : [];
    let count = 0;
    const errors: string[] = [];
    for (const item of items) {
      const studentId = String(item.student_id || '').trim();
      const student = (await db.execute({ sql: "SELECT id FROM users WHERE student_id = ? AND role = 'student'", args: [studentId] })).rows[0] as any;
      if (!student) {
        errors.push(`${studentId}: không tìm thấy sinh viên`);
        continue;
      }
      const result = await createAdvisorAssignment({ ...item, user_id: student.id, allow_without_final: true }, req.user.id);
      if (result.error) errors.push(`${studentId}: ${result.error}`);
      else count++;
    }
    res.json({ success: true, count, errors });
  });

  app.post('/api/admin/advisor-assignments/auto-primary', requireAuth, requireAdmin, async (req: any, res: any) => {
    const result = await autoAssignPrimaryAdvisors(req.user.id);
    res.json({ success: true, ...result });
  });

  app.post('/api/admin/advisor-requests/sync-legacy', requireAuth, requireAdmin, async (req: any, res: any) => {
    if (advisorRequestBackfillRunning) return res.status(409).json({ error: 'Đang có tiến trình đồng bộ dữ liệu GVHD cũ. Vui lòng thử lại sau.' });
    advisorRequestBackfillRunning = true;
    try {
      const legacy = await ensureAdvisorRequestsFromLegacySchoolRegistrations();
      const pending = await approvePendingAgreedAdvisorRequests(req.user.id);
      res.json({ success: true, legacy, pending });
    } catch (error: any) {
      console.error('[advisor] manual legacy sync failed:', error);
      res.status(isTransientLibsqlError(error) ? 503 : 500).json({ error: 'Không đồng bộ được dữ liệu GVHD cũ.', detail: error?.message || String(error) });
    } finally {
      advisorRequestBackfillRunning = false;
    }
  });

  app.get('/api/admin/advisor-requests', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        SELECT ar.*, u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
               l.name as lecturer_name, l.email as lecturer_email,
               cl.name as co_lecturer_name, cl.email as co_lecturer_email,
               CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place
        FROM advisor_requests ar
        JOIN users u ON u.id = ar.user_id
        LEFT JOIN lecturers l ON l.id = ar.lecturer_id
        LEFT JOIN lecturers cl ON cl.id = ar.co_lecturer_id
        LEFT JOIN final_internships f ON f.user_id = ar.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        WHERE NOT (ar.request_type = 'agreed' AND ar.status = 'approved')
        ORDER BY CASE ar.status WHEN 'pending' THEN 0 ELSE 1 END, ar.updated_at DESC
      `)).rows;
      res.json(rows);
    } catch (error: any) {
      console.error('[advisor] failed to load advisor requests:', error);
      res.status(isTransientLibsqlError(error) ? 503 : 500).json({ error: 'Không tải được danh sách đăng ký GVHD.', detail: error?.message || String(error) });
    }
  });

  app.put('/api/admin/advisor-requests/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const action = String(req.body.action || '').trim();
    const request = (await db.execute({ sql: 'SELECT * FROM advisor_requests WHERE id = ?', args: [id] })).rows[0] as any;
    if (!request) return res.status(404).json({ error: 'Không tìm thấy đăng ký GVHD.' });
    if (action === 'reject') {
      await db.execute({
        sql: `UPDATE advisor_requests SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours') WHERE id = ?`,
        args: [req.body.admin_note || null, req.user.id, id],
      });
      const student = (await db.execute({ sql: 'SELECT email, personal_email FROM users WHERE id = ?', args: [Number(request.user_id)] })).rows[0] as any;
      await createNotification({
        user_id: Number(request.user_id),
        recipient_email: student?.personal_email || student?.email,
        type: 'advisor_request_rejected',
        subject: 'Đăng ký GVHD chưa được duyệt',
        body: `Khoa chưa duyệt đăng ký GVHD của bạn.${req.body.admin_note ? `\nNhận xét: ${req.body.admin_note}` : ''}`,
      });
      return res.json({ success: true });
    }
    if (action !== 'approve') return res.status(400).json({ error: 'Thao tác không hợp lệ.' });
    const lecturerId = req.body.lecturer_id ? Number(req.body.lecturer_id) : Number(request.lecturer_id);
    const coLecturerId = req.body.co_lecturer_id ? Number(req.body.co_lecturer_id) : Number(request.co_lecturer_id || 0);
    if (!lecturerId) return res.status(400).json({ error: 'Đăng ký chưa có GVHD chính để duyệt.' });
    const primaryResult = await createAdvisorAssignment({
      user_id: Number(request.user_id),
      lecturer_id: lecturerId,
      role: 'primary',
      note: req.body.admin_note || 'Duyệt đăng ký GVHD từ sinh viên',
      allow_over_quota: true,
      allow_without_final: true,
      suppress_student_notification: request.request_type === 'agreed',
    }, req.user.id);
    if (primaryResult.error) return res.status(primaryResult.status || 400).json({ error: primaryResult.error });
    if (coLecturerId) {
      await createAdvisorAssignment({
        user_id: Number(request.user_id),
        lecturer_id: coLecturerId,
        role: 'co',
        note: req.body.admin_note || 'Duyệt đăng ký đồng hướng dẫn từ sinh viên',
        allow_over_quota: true,
        allow_without_final: true,
        suppress_student_notification: request.request_type === 'agreed',
      }, req.user.id);
    }
    await db.execute({
      sql: `UPDATE advisor_requests SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now', '+7 hours'), updated_at = datetime('now', '+7 hours') WHERE id = ?`,
      args: [req.body.admin_note || null, req.user.id, id],
    });
    const adminNote = String(req.body.admin_note || '').trim();
    if (adminNote) {
      const student = (await db.execute({ sql: 'SELECT email, personal_email FROM users WHERE id = ?', args: [Number(request.user_id)] })).rows[0] as any;
      await createNotification({
        user_id: Number(request.user_id),
        recipient_email: student?.personal_email || student?.email,
        type: 'advisor_request_approved_comment',
        subject: 'Nhận xét về đăng ký GVHD',
        body: `Khoa đã duyệt đăng ký GVHD của bạn.\nNhận xét: ${adminNote}`,
        send_now: true,
        no_queue_on_send_skip: true,
      });
    }
    res.json({ success: true });
  });

  app.delete('/api/admin/advisor-assignments/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const existing = (await db.execute({ sql: 'SELECT * FROM advisor_assignments WHERE id = ?', args: [Number(req.params.id)] })).rows[0] as any;
    if (existing) {
      await db.execute({
        sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
              VALUES (?, ?, ?, ?, 'deleted', ?, ?, datetime('now', '+7 hours'))`,
        args: [Number(existing.id), Number(existing.user_id), Number(existing.lecturer_id), existing.role, req.user.id, existing.note || null],
      });
    }
    await db.execute({ sql: 'DELETE FROM advisor_assignments WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ success: true });
  });

  app.put('/api/admin/lecturer-quotas/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const maxTotal = Number(req.body.max_total_students);
    if (!Number.isInteger(maxTotal) || maxTotal < 0) return res.status(400).json({ error: 'Chỉ tiêu không hợp lệ.' });
    await db.execute({
      sql: `INSERT INTO lecturer_quotas (lecturer_id, max_total_students, note)
            VALUES (?, ?, ?)
            ON CONFLICT(lecturer_id) DO UPDATE SET max_total_students = excluded.max_total_students, note = excluded.note`,
      args: [Number(req.params.id), maxTotal, req.body.note || null],
    });
    res.json({ success: true });
  });

  app.get('/api/admin/reports/final', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT f.user_id, f.internship_type, f.confirmed_at,
             u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
             fr.id as report_id, fr.original_filename, fr.file_size, fr.status as report_status,
             fr.submitted_at as report_submitted_at, fr.updated_at as report_updated_at, fr.lecturer_comment,
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as primary_advisors,
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as co_advisors
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows;
    res.json(rows);
  });

  app.get('/api/admin/grades', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT f.user_id, f.internship_type, f.confirmed_at,
             u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
             fr.status as report_status,
             g.progress_score, g.report_score, g.company_score, g.final_score,
             COALESCE(g.status, 'missing') as grade_status, g.comment, g.submitted_at as grade_submitted_at, g.locked_at,
             CASE
               WHEN g.id IS NULL THEN NULL
               ELSE gl.name
             END as grading_lecturer_name,
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as primary_advisors,
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as co_advisors
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      LEFT JOIN grades g ON g.user_id = f.user_id
      LEFT JOIN lecturers gl ON gl.id = g.lecturer_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows as any[];

    for (const r of rows) {
      const clean = cleanStudentName(r.student_name, r.student_id, r.email);
      if (clean && clean !== r.student_name) {
        db.execute({ sql: 'UPDATE users SET name = ? WHERE id = ?', args: [clean, r.user_id] }).catch(() => {});
      }
    }

    res.json(rows.map(r => ({
      ...r,
      student_name: cleanStudentName(r.student_name, r.student_id, r.email),
    })));
  });

  app.put('/api/admin/grades/:userId/lock', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({
      sql: `UPDATE grades SET locked_at = ${req.body.locked === false ? 'NULL' : "datetime('now', '+7 hours')"}, updated_at = datetime('now', '+7 hours') WHERE user_id = ?`,
      args: [Number(req.params.userId)],
    });
    if (req.body.locked !== false) {
      const row = (await db.execute({
        sql: `SELECT u.email, u.personal_email, g.final_score
              FROM users u LEFT JOIN grades g ON g.user_id = u.id
              WHERE u.id = ?`,
        args: [Number(req.params.userId)],
      })).rows[0] as any;
      await createNotification({
        user_id: Number(req.params.userId),
        recipient_email: row?.personal_email || row?.email,
        type: 'grade_submitted',
        subject: 'Khoa đã khóa điểm thực tập',
        body: `Khoa đã khóa điểm thực tập của bạn. Điểm tổng kết: ${row?.final_score ?? '-'}.`,
      });
    }
    res.json({ success: true });
  });

  app.get('/api/admin/grades/export.csv', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT u.student_id as "Mã SV", u.name as "Họ và tên", u.class_name as "Lớp",
             CASE
               WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
               ELSE COALESCE(u.course_code, '')
             END as "Mã học phần",
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as "Nơi thực tập",
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as "GVHD chính",
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN COALESCE(l.name, 'Giảng viên đã bị xóa') END) as "Đồng hướng dẫn",
             g.progress_score as "Điểm báo cáo định kỳ",
             g.report_score as "Điểm báo cáo",
             g.company_score as "Điểm đánh giá công ty/GVHD",
             g.final_score as "Điểm tổng kết",
             COALESCE(g.status, 'missing') as "Trạng thái điểm",
             gl.name as "Người nhập",
             g.submitted_at as "Thời gian nộp điểm",
             g.comment as "Ghi chú"
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN grades g ON g.user_id = f.user_id
      LEFT JOIN lecturers gl ON gl.id = g.lecturer_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows as any[];
    const headers = rows.length ? Object.keys(rows[0]) : ['Mã SV', 'Họ và tên', 'Điểm tổng kết'];
    const csv = [headers, ...rows.map(row => {
      const copy = { ...row };
      if (copy['Họ và tên']) copy['Họ và tên'] = cleanStudentName(copy['Họ và tên'], copy['Mã SV']);
      return headers.map(header => copy[header] ?? '');
    })]
      .map(items => items.map(item => `"${String(item ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment('bang_diem_thuc_tap.csv');
    res.send('\uFEFF' + csv);
  });

  app.get('/api/admin/notifications', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rows = (await db.execute(`
      SELECT n.*, u.name as user_name, u.student_id
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
      LIMIT 500
    `)).rows;
    res.json(rows);
  });

  app.get('/api/admin/notifications/stats', requireAuth, requireAdmin, async (req: any, res: any) => {
    const statusRows = (await db.execute(`
      SELECT status, COUNT(*) as count
      FROM notifications
      GROUP BY status
    `)).rows as any[];
    const sentToday = await emailSentTodayCount();
    res.json({
      provider: process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : 'none'),
      daily_cap: emailDailySendCap(),
      sent_today: sentToday,
      remaining_today: Math.max(0, emailDailySendCap() - sentToday),
      batch_size: emailBatchSize(),
      statuses: Object.fromEntries(statusRows.map(row => [row.status, Number(row.count || 0)])),
    });
  });

  app.post('/api/admin/notifications/send-queued', requireAuth, requireAdmin, async (req: any, res: any) => {
    const provider = process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '');
    if (!provider || provider === 'none') return res.status(400).json({ error: 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY hoặc RESEND_API_KEY.' });
    if (provider === 'brevo' && !process.env.BREVO_API_KEY) return res.status(400).json({ error: 'Chưa cấu hình BREVO_API_KEY.' });
    if (provider === 'resend' && !process.env.RESEND_API_KEY) return res.status(400).json({ error: 'Chưa cấu hình RESEND_API_KEY.' });
    if (!process.env.EMAIL_FROM && !process.env.NOTIFICATION_EMAIL_FROM) return res.status(400).json({ error: 'Chưa cấu hình EMAIL_FROM.' });
    const notificationIds = Array.isArray(req.body?.notification_ids)
      ? req.body.notification_ids
      : Array.isArray(req.body?.ids)
        ? req.body.ids
        : undefined;
    const result = await sendQueuedNotificationBatch({
      requestedLimit: Number(req.body?.limit || 0) || undefined,
      notificationIds,
      ignoreBatchSize: req.body?.mode === 'quota',
    });
    res.json({ success: true, ...result });
  });

  app.delete('/api/admin/notifications/queued', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rawIds = Array.isArray(req.body?.notification_ids) ? req.body.notification_ids : [];
    const notificationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (notificationIds.length > 0) {
      const placeholders = notificationIds.map(() => '?').join(',');
      const result = await db.execute({
        sql: `DELETE FROM notifications WHERE status = 'queued' AND id IN (${placeholders})`,
        args: notificationIds,
      });
      return res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    const result = await db.execute("DELETE FROM notifications WHERE status = 'queued'");
    res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
  });

  app.delete('/api/admin/notifications', requireAuth, requireAdmin, async (req: any, res: any) => {
    const rawIds = Array.isArray(req.body?.notification_ids) ? req.body.notification_ids : [];
    const notificationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    const status = String(req.body?.status || '').trim();
    if (notificationIds.length > 0) {
      const placeholders = notificationIds.map(() => '?').join(',');
      const result = await db.execute({
        sql: `DELETE FROM notifications WHERE id IN (${placeholders})`,
        args: notificationIds,
      });
      return res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    if (status) {
      if (!['queued', 'sent', 'failed', 'website_only'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
      const result = await db.execute({ sql: 'DELETE FROM notifications WHERE status = ?', args: [status] });
      return res.json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    res.status(400).json({ error: 'Cần chọn thông báo hoặc trạng thái cần xoá.' });
  });

  app.put('/api/admin/notifications/:id/status', requireAuth, requireAdmin, async (req: any, res: any) => {
    const status = String(req.body.status || 'queued');
    if (!['queued', 'sent', 'failed', 'website_only'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    await db.execute({
      sql: `UPDATE notifications SET status = ?, error = ?, sent_at = ${status === 'sent' ? "datetime('now', '+7 hours')" : 'NULL'} WHERE id = ?`,
      args: [status, req.body.error || null, Number(req.params.id)],
    });
    res.json({ success: true });
  });

  app.post('/api/admin/notifications/final-report-reminders', requireAuth, requireAdmin, async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('final_report_close_at')")).rows);
    const rows = (await db.execute(`
      SELECT u.id, u.email, u.personal_email, u.name, u.student_id
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      WHERE fr.id IS NULL OR fr.status = 'needs_revision'
      ORDER BY u.student_id ASC
    `)).rows as any[];
    for (const row of rows) {
      await createNotification({
        user_id: Number(row.id),
        recipient_email: row.personal_email || row.email,
        type: 'final_report_due_reminder',
        subject: 'Nhắc nộp báo cáo',
        body: `Bạn cần nộp báo cáo${settings.final_report_close_at ? ` trước ${settings.final_report_close_at} (GMT+7)` : ''}. File PDF tối đa 10 MB.`,
      });
    }
    res.json({ success: true, count: rows.length });
  });

  app.post('/api/admin/notifications/final-confirmation-open', requireAuth, requireAdmin, async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute("SELECT key, value FROM settings WHERE key IN ('confirmation_open_at', 'confirmation_close_at')")).rows);
    const rows = (await db.execute(`
      SELECT DISTINCT u.id, u.email, u.personal_email, u.name, u.student_id
      FROM registrations r
      JOIN users u ON u.id = r.user_id
      WHERE NOT EXISTS (SELECT 1 FROM final_internships f WHERE f.user_id = u.id)
      ORDER BY u.student_id ASC
    `)).rows as any[];
    for (const row of rows) {
      await createNotification({
        user_id: Number(row.id),
        recipient_email: row.personal_email || row.email,
        type: 'final_confirmation_open',
        subject: 'Mở xác nhận nơi thực tập chính thức',
        body: `Khoa đã mở giai đoạn xác nhận nơi thực tập chính thức${settings.confirmation_close_at ? ` đến ${settings.confirmation_close_at} (GMT+7)` : ''}. Vui lòng đăng nhập hệ thống để xác nhận một nơi thực tập đã trúng tuyển hoặc đăng ký thực tập tại trường nếu không trúng tuyển doanh nghiệp nào.`,
      });
    }
    res.json({ success: true, count: rows.length });
  });

  app.post('/api/admin/notifications/manual', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const target = String(req.body.target || '').trim();
      const recipientInput = String(req.body.recipient || req.body.recipient_email || '').trim();
      const deliveryMode = String(req.body.delivery_mode || 'website_and_email').trim();
      const subject = String(req.body.subject || '').trim();
      const body = String(req.body.body || '').trim();
      if (!subject) return res.status(400).json({ error: 'Tiêu đề không được để trống.' });
      if (!body) return res.status(400).json({ error: 'Nội dung không được để trống.' });
      if (!['website_and_email', 'website_only'].includes(deliveryMode)) return res.status(400).json({ error: 'Kiểu gửi thông báo không hợp lệ.' });

      const notificationIds: number[] = [];
      const persistManualNotification = async (data: NotificationInput) => {
        const notification = await insertNotification(data);
        if (notification) notificationIds.push(notification.id);
      };
      const manualDeliveryResult = async () => {
        if (deliveryMode === 'website_only') {
          return { created: notificationIds.length, sent: 0, queued: 0, failed: 0 };
        }
        const delivery = await sendQueuedNotificationBatch({
          requestedLimit: notificationIds.length,
          notificationIds,
          ignoreBatchSize: true,
        });
        return {
          created: notificationIds.length,
          sent: delivery.sent,
          queued: Math.max(0, notificationIds.length - delivery.sent - delivery.failed),
          failed: delivery.failed,
        };
      };

      if (target === 'system_all') {
        const result = await db.execute({
          sql: `
            INSERT INTO system_notifications (type, subject, body, target_role, active, created_by, created_at)
            VALUES ('system_announcement', ?, ?, 'all', 1, ?, datetime('now', '+7 hours'))
          `,
          args: [subject, body, req.user.id],
        });
        if (deliveryMode === 'website_only') {
          return res.json({
            success: true,
            count: 1,
            created: 1,
            sent: 0,
            queued: 0,
            failed: 0,
            id: Number(result.lastInsertRowid),
          });
        }

        const users = (await db.execute(`
          SELECT id as user_id, email, personal_email, role
          FROM users
          WHERE email IS NOT NULL AND trim(email) != ''
          ORDER BY role ASC, name ASC
        `)).rows as any[];
        for (const row of users) {
          const recipient = row.personal_email || row.email;
          if (!recipient) continue;
          await persistManualNotification({
            user_id: Number(row.user_id),
            recipient_email: recipient,
            type: row.role === 'lecturer' ? 'manual_lecturer_notice' : 'manual_student_notice',
            subject,
            body,
            status: 'queued',
          });
        }
        const delivery = await manualDeliveryResult();
        return res.json({
          success: true,
          count: delivery.created,
          ...delivery,
          system_notification_id: Number(result.lastInsertRowid),
        });
      }

      let rows: any[] = [];
      if (target === 'lecturers') {
        rows = (await db.execute(`
          SELECT NULL as user_id, email, name, NULL as student_id
          FROM lecturers
          WHERE email IS NOT NULL AND trim(email) != ''
          ORDER BY name ASC
        `)).rows as any[];
      } else if (target === 'students_approved' || target === 'students_rejected' || target === 'students_pending') {
        const status = target.replace('students_', '');
        rows = (await db.execute({
          sql: `
            SELECT DISTINCT u.id as user_id, u.email, u.personal_email, u.name, u.student_id
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            WHERE r.status = ?
            ORDER BY u.student_id ASC
          `,
          args: [status],
        })).rows as any[];
      } else if (target === 'students_with_registration') {
        rows = (await db.execute(`
          SELECT DISTINCT u.id as user_id, u.email, u.personal_email, u.name, u.student_id
          FROM registrations r
          JOIN users u ON u.id = r.user_id
          ORDER BY u.student_id ASC
        `)).rows as any[];
      } else if (target === 'all_students') {
        rows = (await db.execute(`
          SELECT id as user_id, email, personal_email, name, student_id
          FROM users
          WHERE role = 'student'
          ORDER BY student_id ASC
        `)).rows as any[];
      } else if (target === 'single_account') {
        if (!recipientInput) return res.status(400).json({ error: 'Vui lòng nhập email hoặc mã sinh viên/giảng viên.' });
        const userRows = (await db.execute({
          sql: `
            SELECT id as user_id, email, personal_email, name, student_id, role
            FROM users
            WHERE lower(email) = lower(?)
               OR lower(coalesce(personal_email, '')) = lower(?)
               OR student_id = ?
            LIMIT 1
          `,
          args: [recipientInput, recipientInput, recipientInput],
        })).rows as any[];
        if (userRows.length) {
          rows = userRows;
        } else {
          const lecturerRows = (await db.execute({
            sql: `
              SELECT NULL as user_id, email, name, NULL as student_id, 'lecturer' as role
              FROM lecturers
              WHERE lower(email) = lower(?)
              LIMIT 1
            `,
            args: [recipientInput],
          })).rows as any[];
          if (lecturerRows.length) {
            rows = lecturerRows;
          } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientInput)) {
            rows = [{ user_id: null, email: recipientInput, personal_email: '', name: recipientInput, student_id: null, role: 'external' }];
          } else {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản theo email hoặc mã đã nhập.' });
          }
        }
      } else {
        return res.status(400).json({ error: 'Nhóm nhận thông báo không hợp lệ.' });
      }

      for (const row of rows) {
        const recipient = row.personal_email || row.email;
        if (!recipient) continue;
        await persistManualNotification({
          user_id: row.user_id ? Number(row.user_id) : null,
          recipient_email: recipient,
          type: target === 'lecturers' || row.role === 'lecturer' ? 'manual_lecturer_notice' : target === 'single_account' ? 'manual_direct_notice' : 'manual_student_notice',
          subject,
          body,
          status: deliveryMode === 'website_only' ? 'website_only' : 'queued',
        });
      }
      const delivery = await manualDeliveryResult();
      res.json({ success: true, count: delivery.created, ...delivery });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 7. Admin: Export CSV
  app.get('/api/admin/export.csv', requireAuth, requireAdmin, async (req, res) => {
    const data = (await db.execute(`
      SELECT 
        u.student_id as "Mã SV",
        u.name as "Họ và tên",
        u.dob as "Ngày sinh",
        u.class_name as "Lớp KH",
        CASE
          WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
          ELSE COALESCE(u.course_code, '')
        END as "Mã môn học",
        CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || coalesce(r.other_company_name, '') ELSE c.name END as "Nơi thực tập",
        CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_role, '') ELSE 'Thực tập sinh' END as "Vị trí",
        CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_contact, '') ELSE c.contact_email END as "Liên hệ",
        CASE WHEN c.name = 'Trường Đại học Công nghệ' THEN 'GVHD: ' || coalesce(r.other_company_contact, '') || CASE WHEN coalesce(r.note, '') != '' THEN ' - ' || r.note ELSE '' END ELSE r.note END as "Ghi chú",
        r.review_comment as "Nhận xét duyệt",
        r.status as "Trạng thái",
        r.created_at as "Thời gian đăng ký"
      FROM registrations r
      JOIN users u ON r.user_id = u.id
      JOIN companies c ON r.company_id = c.id
      ORDER BY r.created_at DESC
    `)).rows as any[];

    if (data.length === 0) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="thuctap_cntt_uet.csv"');
      return res.send('\uFEFF"STT","Mã SV","Họ và tên","Ngày sinh","Lớp KH","Mã môn học","Nơi thực tập","Vị trí","Liên hệ","Ghi chú","Nhận xét duyệt","Trạng thái","Thời gian đăng ký"\n');
    }

    const headers = Object.keys(data[0]);
    const csvRows = [];
    csvRows.push('"STT",' + headers.map(h => `"${h}"`).join(','));

    let stt = 1;
    for (const row of data) {
      const values = headers.map(header => {
        const val = row[header] || '';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvRows.push(`"${stt++}",` + values.join(','));
    }

    const csvStr = '\uFEFF' + csvRows.join('\n'); // BOM for Excel UTF-8 UTF16
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="thuctap_cntt_uet_2026.csv"');
    res.send(csvStr);
  });


  // 7a. Admin: Save to Google Sheets
  app.post('/api/admin/export-to-sheet', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const result = await exportRegistrationsToGoogleSheets();
      res.json({ success: true, message: 'Đã lưu dữ liệu vào Google Sheets thành công!', ...result });
    } catch (error: any) {
      console.error(error);
      res.status(error.status || 500).json({ error: 'Lỗi khi lưu vào Google Sheets: ' + error.message });
    }
  });

  app.post('/api/cron/export-to-sheet', async (req: any, res: any) => {
    const expectedSecret = process.env.CRON_SECRET;
    const providedSecret = req.headers['x-cron-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!expectedSecret) return res.status(500).json({ error: 'Chưa cấu hình CRON_SECRET trên Render.' });
    if (providedSecret !== expectedSecret) return res.status(403).json({ error: 'Forbidden' });

    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('registration_open_at', 'registration_close_at')
    `)).rows);
    if (!settings.registration_open_at && !settings.registration_close_at) {
      return res.json({ success: true, skipped: true, message: 'Bỏ qua vì chưa cấu hình thời gian mở/đóng đăng ký.' });
    }
    const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
    if (!windowStatus.ok) {
      return res.json({ success: true, skipped: true, message: `Bỏ qua vì ngoài đợt đăng ký: ${windowStatus.error}` });
    }

    try {
      const result = await exportRegistrationsToGoogleSheets();
      res.json({ success: true, skipped: false, message: 'Đã tự động lưu dữ liệu đăng ký vào Google Sheets.', ...result });
    } catch (error: any) {
      console.error(error);
      res.status(error.status || 500).json({ error: 'Lỗi cron lưu vào Google Sheets: ' + error.message });
    }
  });

  app.post('/api/cron/process-email-queue', async (req: any, res: any) => {
    const expectedSecret = process.env.CRON_SECRET;
    const providedSecret = req.headers['x-cron-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!expectedSecret) return res.status(500).json({ error: 'Chưa cấu hình CRON_SECRET trên Render.' });
    if (providedSecret !== expectedSecret) return res.status(403).json({ error: 'Forbidden' });

    try {
      const provider = process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '');
      if (!provider || provider === 'none') {
        return res.json({ success: true, skipped: true, message: 'Bỏ qua vì chưa cấu hình provider email.' });
      }
      const result = await sendQueuedNotificationBatch({ ignoreBatchSize: true });
      res.json({ success: true, skipped: false, message: 'Đã tự động xử lý hàng đợi email theo quota ngày.', ...result });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: 'Lỗi cron tự động xử lý hàng đợi email: ' + error.message });
    }
  });


  // 7b. Admin: Approve all pending registrations
  app.put('/api/admin/registrations/approve-all', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const reviewComment = String(req.body?.review_comment || '').trim();
      const pending = (await db.execute(`
        SELECT r.id, u.id as user_id, u.email, u.personal_email, c.name as company_name, r.other_company_name
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        JOIN companies c ON c.id = r.company_id
        WHERE r.status = 'pending'
      `)).rows as any[];
      await db.execute({
        sql: "UPDATE registrations SET status = 'approved', review_comment = ? WHERE status = 'pending'",
        args: [reviewComment || null],
      });
      for (const row of pending) {
        await addApprovedCompanyFromRegistration(row);
        await createNotification({
          user_id: Number(row.user_id),
          recipient_email: row.personal_email || row.email,
          type: 'registration_status_changed',
          subject: 'Đăng ký thực tập đã được duyệt',
          body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
          send_now: true,
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 8. Admin: Update registration status
  app.put('/api/admin/registrations/:id/status', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const { status } = req.body;
    const reviewComment = String(req.body?.review_comment || '').trim();

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    try {
      const row = (await db.execute({
        sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [id],
      })).rows[0] as any;
      await db.execute({ sql: 'UPDATE registrations SET status = ?, review_comment = ? WHERE id = ?', args: [status, reviewComment || null, id] });
      if (row && status === 'approved') {
        await addApprovedCompanyFromRegistration(row);
        const autoApproved = await approveMatchingOtherCompanyRegistrations(row, reviewComment);
        for (const item of autoApproved) {
          await createNotification({
            user_id: Number(item.user_id),
            recipient_email: item.personal_email || item.email,
            type: 'registration_status_changed',
            subject: 'Đăng ký thực tập đã được duyệt',
            body: `Đăng ký thực tập tại ${item.other_company_name || 'Công ty tự liên hệ'} đã được tự động duyệt vì công ty này đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
            send_now: true,
          });
        }
      }
      if (row && row.status !== status) {
        await createNotification({
          user_id: Number(row.user_id),
          recipient_email: row.personal_email || row.email,
          type: 'registration_status_changed',
          subject: `Đăng ký thực tập ${status === 'approved' ? 'đã được duyệt' : status === 'rejected' ? 'đã bị từ chối' : 'đang chờ duyệt'}`,
          body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} hiện có trạng thái: ${status === 'approved' ? 'Đã duyệt' : status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
          send_now: true,
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/registrations/:id/comment', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const reviewComment = String(req.body?.review_comment || '').trim();
    if (!reviewComment) return res.status(400).json({ error: 'Nội dung nhận xét không được để trống.' });

    try {
      const row = (await db.execute({
        sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
              FROM registrations r
              JOIN users u ON u.id = r.user_id
              JOIN companies c ON c.id = r.company_id
              WHERE r.id = ?`,
        args: [id],
      })).rows[0] as any;
      if (!row) return res.status(404).json({ error: 'Không tìm thấy đăng ký.' });

      await db.execute({
        sql: 'UPDATE registrations SET review_comment = ? WHERE id = ?',
        args: [reviewComment, id],
      });
      await createNotification({
        user_id: Number(row.user_id),
        recipient_email: row.personal_email || row.email,
        type: 'registration_review_comment',
        subject: 'Khoa gửi nhận xét về đăng ký thực tập',
        body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} có nhận xét từ Khoa:\n${reviewComment}`,
        send_now: true,
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/registrations/comments', requireAuth, requireAdmin, async (req: any, res: any) => {
    const reviewComment = String(req.body?.review_comment || '').trim();
    const rawIds = Array.isArray(req.body?.registration_ids) ? req.body.registration_ids : [];
    const registrationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (!reviewComment) return res.status(400).json({ error: 'Nội dung nhận xét không được để trống.' });
    if (registrationIds.length === 0) return res.status(400).json({ error: 'Danh sách đăng ký cần gửi nhận xét đang trống.' });

    try {
      const placeholders = registrationIds.map(() => '?').join(',');
      const rows = (await db.execute({
        sql: `
          SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
          FROM registrations r
          JOIN users u ON u.id = r.user_id
          JOIN companies c ON c.id = r.company_id
          WHERE r.id IN (${placeholders})
        `,
        args: registrationIds,
      })).rows as any[];
      await db.execute({
        sql: `UPDATE registrations SET review_comment = ? WHERE id IN (${placeholders})`,
        args: [reviewComment, ...registrationIds],
      });
      for (const row of rows) {
        await createNotification({
          user_id: Number(row.user_id),
          recipient_email: row.personal_email || row.email,
          type: 'registration_review_comment',
          subject: 'Khoa gửi nhận xét về đăng ký thực tập',
          body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} có nhận xét từ Khoa:\n${reviewComment}`,
          send_now: true,
        });
      }
      res.json({ success: true, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/settings/campaign', async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('campaign_year', 'campaign_start', 'campaign_end', 'classes_list', 'allowed_registration_cohorts', 'registration_rules_md', 'faq_student_md', 'faq_lecturer_md', 'registration_open_at', 'registration_close_at', 'confirmation_open_at', 'confirmation_close_at', 'final_report_open_at', 'final_report_close_at', 'advisor_request_open_at', 'advisor_request_close_at', 'advisor_quota_pgs', 'advisor_quota_ts', 'advisor_quota_ths')
    `)).rows);

    res.json({
      year: settings.campaign_year || '2026',
      start: settings.campaign_start || '22/05/2026',
      end: settings.campaign_end || '15/06/2026',
      classes_list: settings.classes_list || 'QH-2023-I/CQ-I-IT1, QH-2023-I/CQ-I-IT2, QH-2023-I/CQ-I-IT3, QH-2023-I/CQ-I-IS, QH-2023-I/CQ-I-CS1, QH-2023-I/CQ-I-CS2, QH-2023-I/CQ-I-CS3, QH-2023-I/CQ-I-CS4, QH-2023-I/CQ-I-CN',
      allowed_registration_cohorts: settings.allowed_registration_cohorts || DEFAULT_ALLOWED_REGISTRATION_COHORTS,
      registration_rules_md: settings.registration_rules_md || DEFAULT_REGISTRATION_RULES,
      faq_student_md: settings.faq_student_md || DEFAULT_STUDENT_FAQ,
      faq_lecturer_md: settings.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
      registration_open_at: settings.registration_open_at || '',
      registration_close_at: settings.registration_close_at || '',
      confirmation_open_at: settings.confirmation_open_at || '',
      confirmation_close_at: settings.confirmation_close_at || '',
      final_report_open_at: settings.final_report_open_at || '',
      final_report_close_at: settings.final_report_close_at || '',
      advisor_request_open_at: settings.advisor_request_open_at || '',
      advisor_request_close_at: settings.advisor_request_close_at || '',
      advisor_quota_pgs: settings.advisor_quota_pgs || '5',
      advisor_quota_ts: settings.advisor_quota_ts || '8',
      advisor_quota_ths: settings.advisor_quota_ths || '10'
    });
  });

  app.put('/api/settings/campaign', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { year, start, end, classes_list, allowed_registration_cohorts, registration_open_at, registration_close_at, confirmation_open_at, confirmation_close_at, final_report_open_at, final_report_close_at, advisor_request_open_at, advisor_request_close_at, advisor_quota_pgs, advisor_quota_ts, advisor_quota_ths } = req.body;
      const currentAdvisorCloseAt = (((await db.execute("SELECT value FROM settings WHERE key = 'advisor_request_close_at'")).rows as any[])[0]?.value || '').toString();
      const statements: any[] = [
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_year', ?)", args: [year || null] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_start', ?)", args: [start || null] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_end', ?)", args: [end || null] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_open_at', ?)", args: [registration_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_close_at', ?)", args: [registration_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('confirmation_open_at', ?)", args: [confirmation_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('confirmation_close_at', ?)", args: [confirmation_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('final_report_open_at', ?)", args: [final_report_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('final_report_close_at', ?)", args: [final_report_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_request_open_at', ?)", args: [advisor_request_open_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_request_close_at', ?)", args: [advisor_request_close_at || ''] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('allowed_registration_cohorts', ?)", args: [Array.isArray(allowed_registration_cohorts) ? allowed_registration_cohorts.join(',') : String(allowed_registration_cohorts || '')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_quota_pgs', ?)", args: [String(advisor_quota_pgs || '5')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_quota_ts', ?)", args: [String(advisor_quota_ts || '8')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_quota_ths', ?)", args: [String(advisor_quota_ths || '10')] }
      ];
      if (currentAdvisorCloseAt !== String(advisor_request_close_at || '')) {
        statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('advisor_auto_assigned_at', '')", args: [] });
      }
      if (classes_list) {
        statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('classes_list', ?)", args: [classes_list] });
      }
      await executeBatch(statements);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[settings] failed to update campaign settings:', error);
      res.status(500).json({ error: 'Không thể lưu cài đặt hệ thống. Vui lòng thử lại sau.', detail: error?.message || String(error) });
    }
  });

  app.get('/api/settings/registration-rules', requireAuth, requireAdmin, async (req: any, res: any) => {
    const setting = (await db.execute("SELECT value FROM settings WHERE key = 'registration_rules_md'")).rows[0] as unknown as { value: string };
    res.json({ registration_rules_md: setting?.value || DEFAULT_REGISTRATION_RULES });
  });

  app.put('/api/settings/registration-rules', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_rules_md', ?)",
      args: [String(req.body.registration_rules_md || '')],
    });
    res.json({ success: true });
  });

  app.get('/api/settings/faq', requireAuth, async (req: any, res: any) => {
    try {
      const settings = rowsToSettings((await db.execute(`
        SELECT key, value FROM settings
        WHERE key IN ('faq_student_md', 'faq_lecturer_md')
      `)).rows);
      res.json({
        faq_student_md: settings.faq_student_md || DEFAULT_STUDENT_FAQ,
        faq_lecturer_md: settings.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
      });
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.put('/api/settings/faq', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      await executeBatch([
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('faq_student_md', ?)", args: [String(req.body.faq_student_md || '')] },
        { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('faq_lecturer_md', ?)", args: [String(req.body.faq_lecturer_md || '')] },
      ]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(503).json({ error: 'Không lưu được FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.get('/api/lecturer-guide', requireAuth, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'lecturer' && !req.user.is_lecturer) {
        return res.status(403).json({ error: 'Chỉ giảng viên hoặc quản trị viên được xem hướng dẫn này.' });
      }
      const setting = (await db.execute("SELECT value FROM settings WHERE key = 'lecturer_guide_md'")).rows[0] as unknown as { value: string };
      res.json({ guide: setting?.value || DEFAULT_LECTURER_GUIDE });
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được hướng dẫn sử dụng. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.get('/api/settings/lecturer-guide', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const setting = (await db.execute("SELECT value FROM settings WHERE key = 'lecturer_guide_md'")).rows[0] as unknown as { value: string };
      res.json({ guide: setting?.value || DEFAULT_LECTURER_GUIDE });
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được cài đặt hướng dẫn sử dụng. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.put('/api/settings/lecturer-guide', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      await db.execute({
        sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('lecturer_guide_md', ?)",
        args: [String(req.body.guide || '')],
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(503).json({ error: 'Không lưu được hướng dẫn sử dụng. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.get('/api/faq/questions/my', requireAuth, async (req: any, res: any) => {
    try {
      const rows = (await db.execute({
        sql: `
          SELECT id, role, question, answer, status, created_at, answered_at
          FROM faq_questions
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 100
        `,
        args: [req.user.id],
      })).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được câu hỏi FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.post('/api/faq/questions', requireAuth, async (req: any, res: any) => {
    try {
      const question = String(req.body.question || '').trim();
      if (!question) return res.status(400).json({ error: 'Vui lòng nhập câu hỏi.' });
      if (question.length > 2000) return res.status(400).json({ error: 'Câu hỏi không được vượt quá 2000 ký tự.' });
      const role = req.user.role === 'lecturer' ? 'lecturer' : 'student';
      const result = await db.execute({
        sql: `
          INSERT INTO faq_questions (user_id, role, question, status, created_at)
          VALUES (?, ?, ?, 'pending', datetime('now', '+7 hours'))
        `,
        args: [req.user.id, role, question],
      });
      const admins = (await db.execute(`
        SELECT id, email, personal_email, name
        FROM users
        WHERE role = 'admin'
          AND email IS NOT NULL
          AND trim(email) != ''
      `)).rows as any[];
      const askerName = req.user.name || req.user.email || (role === 'lecturer' ? 'Giảng viên' : 'Sinh viên');
      const seenAdminEmails = new Set<string>();
      const uniqueAdmins: any[] = [];
      for (const admin of admins) {
        const targetEmail = String(admin.personal_email || admin.email || '').trim().toLowerCase();
        if (targetEmail && seenAdminEmails.has(targetEmail)) continue;
        if (targetEmail) seenAdminEmails.add(targetEmail);
        uniqueAdmins.push(admin);
      }
      for (const admin of uniqueAdmins) {
        await createNotification({
          user_id: Number(admin.id),
          recipient_email: admin.personal_email || admin.email,
          type: 'faq_question_created',
          subject: 'Có câu hỏi FAQ mới cần trả lời',
          body: `${askerName} vừa gửi câu hỏi FAQ:\n\n${question}\n\nVui lòng vào trang Trả lời câu hỏi FAQ để xử lý.`,
          status: 'website_only',
        });
      }
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (e: any) {
      res.status(503).json({ error: 'Không gửi được câu hỏi FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.get('/api/admin/faq/questions', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const rows = (await db.execute(`
        SELECT q.*, u.name as user_name, u.email as user_email, u.student_id, a.name as answered_by_name
        FROM faq_questions q
        JOIN users u ON u.id = q.user_id
        LEFT JOIN users a ON a.id = q.answered_by
        ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END, q.created_at DESC
        LIMIT 500
      `)).rows;
      res.json(rows);
    } catch (e: any) {
      res.status(503).json({ error: 'Không tải được danh sách câu hỏi FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.put('/api/admin/faq/questions/:id/answer', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const answer = String(req.body.answer || '').trim();
      if (!answer) return res.status(400).json({ error: 'Vui lòng nhập câu trả lời.' });
      const existing = (await db.execute({
        sql: `
          SELECT q.*, u.email, u.personal_email
          FROM faq_questions q
          JOIN users u ON u.id = q.user_id
          WHERE q.id = ?
        `,
        args: [Number(req.params.id)],
      })).rows[0] as any;
      if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
      await db.execute({
        sql: `
          UPDATE faq_questions
          SET answer = ?, status = 'answered', answered_at = datetime('now', '+7 hours'), answered_by = ?
          WHERE id = ?
        `,
        args: [answer, req.user.id, Number(req.params.id)],
      });
      await createNotification({
        user_id: Number(existing.user_id),
        recipient_email: existing.personal_email || existing.email,
        type: 'faq_answered',
        subject: 'Câu hỏi FAQ của bạn đã được trả lời',
        body: `Câu hỏi:\n${existing.question}\n\nTrả lời:\n${answer}`,
        status: 'website_only',
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(503).json({ error: 'Không lưu được câu trả lời FAQ. Vui lòng thử lại sau.', detail: e.message });
    }
  });

  app.get('/api/settings/plan', requireAuth, requireAdmin, async (req: any, res: any) => {
    const planSetting = (await db.execute("SELECT value FROM settings WHERE key = 'implementation_plan_md'")).rows[0] as unknown as { value: string };
    res.json({ plan: planSetting ? planSetting.value : '' });
  });

  app.put('/api/settings/plan', requireAuth, requireAdmin, async (req: any, res: any) => {
    await db.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('implementation_plan_md', ?)",
      args: [String(req.body.plan || '')],
    });
    res.json({ success: true });
  });

  // 9. Admin: Settings
  app.get('/api/settings/google-sheet', requireAuth, requireAdmin, async (req: any, res: any) => {
    const settings = rowsToSettings((await db.execute(`
      SELECT key, value FROM settings
      WHERE key IN ('google_sheet_url', 'export_google_sheet_url', 'implementation_plan_md')
    `)).rows);
    res.json({
      url: settings.google_sheet_url || '',
      export_url: settings.export_google_sheet_url || '',
      plan: settings.implementation_plan_md || ''
    });
  });

  app.put('/api/settings/google-sheet', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { url, export_url, plan } = req.body;
    const statements: any[] = [];
    if (url !== undefined) {
      statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)", args: [url] });
    }
    if (export_url !== undefined) {
      statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('export_google_sheet_url', ?)", args: [export_url] });
    }
    if (plan !== undefined) {
      statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('implementation_plan_md', ?)", args: [plan] });
    }
    if (statements.length > 0) {
      await executeBatch(statements);
    }
    res.json({ success: true });
  });

  // Public endpoint for students to view the plan
  app.get('/api/plan', async (req: any, res: any) => {
    const planSetting = (await db.execute("SELECT value FROM settings WHERE key = 'implementation_plan_md'")).rows[0] as unknown as { value: string };
    res.json({ plan: planSetting ? planSetting.value : '' });
  });

  app.post('/api/admin/admins', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { email } = req.body;
    if (!email || (!email.endsWith('@vnu.edu.vn') && email !== process.env.ADMIN_EMAIL)) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ email @vnu.edu.vn' });
    }
    try {
      // Check if this email exists in the lecturers table
      const lecturerRecord = (await db.execute({ sql: 'SELECT * FROM lecturers WHERE email = ?', args: [email] })).rows[0] as any;
      const nameFromLecturer = lecturerRecord?.name || null;
      const isLecturer = !!lecturerRecord;

      await db.execute({
        sql: `
          INSERT INTO users (email, name, role, is_lecturer)
          VALUES (?, ?, 'admin', ?)
          ON CONFLICT(email) DO UPDATE SET
            role = 'admin',
            name = CASE WHEN ? IS NOT NULL THEN ? ELSE name END,
            is_lecturer = CASE WHEN ? = 1 THEN 1 ELSE is_lecturer END
        `,
        args: [email, nameFromLecturer || 'Admin', isLecturer ? 1 : 0, nameFromLecturer, nameFromLecturer, isLecturer ? 1 : 0]
      });
      await syncLecturerUsers();
      res.json({
        success: true,
        isLecturer,
        message: isLecturer
          ? `Đã thêm admin. Email này tồn tại trong danh sách Giảng viên nên đã tự động bật "Là Giảng viên" và dùng tên "${nameFromLecturer}".`
          : 'Đã thêm admin thành công.'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/admins/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Không thể tự hủy quyền của chính mình' });
    }
    try {
      await db.execute({ sql: "UPDATE users SET role = 'student', is_lecturer = 0 WHERE id = ?", args: [id] });
      await syncLecturerUsers();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 10. Admin: Import companies from Google Sheet
  app.post('/api/settings/import-companies', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const setting = (await db.execute("SELECT value FROM settings WHERE key = 'google_sheet_url'")).rows[0] as unknown as { value: string };
      if (!setting || !setting.value) {
        return res.status(400).json({ error: 'Spreadsheet URL not set' });
      }

      let fetchUrl = setting.value;
      if (!fetchUrl.includes('export?format=csv')) {
        if (fetchUrl.includes('edit?usp=sharing')) {
          fetchUrl = fetchUrl.replace('edit?usp=sharing', 'export?format=csv');
        } else if (fetchUrl.includes('edit')) {
          fetchUrl = fetchUrl.split('edit')[0] + 'export?format=csv';
        }
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch from Google Sheets');
      }

      const csvData = await response.text();
      const records = parse(csvData, {
        columns: true,
        skip_empty_lines: true
      });

      if (records.length === 0) {
        return res.status(400).json({ error: 'No records found in CSV' });
      }

      // Clear companies and optionally registrations
      const { keepRegistrations } = req.body || {};

      // If NOT keeping registrations, clear everything (old behavior)
      if (!keepRegistrations) {
        await db.executeMultiple('DELETE FROM final_internships');
        await db.executeMultiple('DELETE FROM registrations');
        await db.executeMultiple('DELETE FROM companies');
      }

      const statements = records
        .map((record: any) => {
          if (!record["Timestamp"]) return null;

          const name = record["Tên doanh nghiệp"]?.trim();
          if (!name) return null;

          const slotsStr = record["Số lượng sinh viên cần tuyển  "]?.trim() || record["Số lượng sinh viên cần tuyển"]?.trim() || "0";
          const slots = parseInt(slotsStr) || 5;
          let contactEmail = record["Email liên hệ"]?.trim() || record["Email Address"]?.trim() || '';
          const contactName = record["Họ và tên người liên hệ phụ trách thực tập"]?.trim() || '';
          let phone = record["Điện thoại liên hệ"]?.trim() || '';
          const address = record["Địa chỉ nơi thực tập"]?.trim() || '';
          const infoLink = record["Thông tin vị trí tuyển thực tập"]?.trim() || '';

          // Clean up email/phone if they are combined in the email field
          if (contactEmail && !phone) {
            const parts = contactEmail.split(/[\/,;\s]+/);
            const emails: string[] = [];
            const phones: string[] = [];
            for (const p of parts) {
              if (p.includes('@')) emails.push(p);
              else if (p.match(/[\d]{8,}/)) phones.push(p);
            }
            if (emails.length > 0) contactEmail = emails.join(', ');
            if (phones.length > 0) phone = phones.join(', ');
          }

          const qualifications = '';
          const description = 'Chưa rõ';
          const history = `Công ty ${name} tuyển dụng thực tập sinh.`;

          return {
            sql: `
              INSERT INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                slots = excluded.slots,
                contact_email = excluded.contact_email,
                history = excluded.history,
                qualifications = excluded.qualifications,
                address = excluded.address,
                recruitment_link = excluded.recruitment_link,
                phone = excluded.phone,
                contact_name = excluded.contact_name
            `,
            args: [name, description, slots, contactEmail, history, qualifications, address, infoLink, phone, contactName]
          };
        })
        .filter(Boolean);

      if (statements.length > 0) {
        await executeBatch(statements);
      }

      await ensureSpecialCompanies();

      res.json({ success: true, count: statements.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use((err: any, req: any, res: any, next: any) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'File PDF vượt quá 10 MB. Vui lòng nén lại trước khi nộp.' });
    }
    if (err?.message === 'Not allowed by CORS') {
      return res.status(403).json({ error: 'Origin không được phép gọi API. Vui lòng kiểm tra CORS_ORIGIN trên Render.' });
    }
    if (isTransientLibsqlError(err)) {
      return res.status(503).json({ error: 'Cơ sở dữ liệu Turso tạm thời không phản hồi. Vui lòng thử lại sau.' });
    }
    if (req.path?.startsWith('/api/')) {
      return res.status(500).json({ error: err?.message || 'Internal server error' });
    }
    next(err);
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Tự động kiểm tra và xả hàng đợi email theo quota ngày (mỗi 30 phút và 10 giây sau khi khởi động)
  const runAutoQueueDrain = async () => {
    try {
      const provider = process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '');
      if (!provider || provider === 'none') return;
      const sentToday = await emailSentTodayCount();
      const remainingToday = Math.max(0, emailDailySendCap() - sentToday);
      if (remainingToday <= 0) return;

      const queuedCount = Number((await db.execute("SELECT COUNT(*) as count FROM notifications WHERE status = 'queued'")).rows[0]?.count || 0);
      if (queuedCount > 0) {
        console.log(`[AutoQueue] Có ${queuedCount} email trong hàng đợi, quota còn lại hôm nay: ${remainingToday}. Đang tự động gửi...`);
        const result = await sendQueuedNotificationBatch({ ignoreBatchSize: true });
        console.log(`[AutoQueue] Kết quả tự động xả hàng đợi: đã gửi ${result.sent}, lỗi ${result.failed}, còn lại trong ngày ${result.remaining_today}.`);
      }
    } catch (e: any) {
      console.error('[AutoQueue] Lỗi khi tự động xử lý hàng đợi email:', e?.message || e);
    }
  };

  setTimeout(runAutoQueueDrain, 10000);
  setInterval(runAutoQueueDrain, 30 * 60 * 1000);
}

startServer().catch(console.error);
