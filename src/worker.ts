import { createClient as createTursoClient } from '@libsql/client/web';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

type Env = {
  DB: D1Database;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  JWT_SECRET: string;
  VITE_GOOGLE_CLIENT_ID: string;
  ADMIN_EMAIL?: string;
  CORS_ORIGIN?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_DAILY_SEND_CAP?: string;
  EMAIL_BATCH_SIZE?: string;
  EMAIL_SEND_IMMEDIATE?: string;
  CRON_SECRET?: string;
  REPORTS_BUCKET?: R2Bucket;
};

const encoder = new TextEncoder();
const DB_BATCH_SIZE = 100;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const DEFAULT_ALLOWED_REGISTRATION_COHORTS = 'K66,K67,K68';
const DEFAULT_CLASSES = 'QH-2023-I/CQ-I-IT1, QH-2023-I/CQ-I-IT2, QH-2023-I/CQ-I-IT3, QH-2023-I/CQ-I-IS, QH-2023-I/CQ-I-CS1, QH-2023-I/CQ-I-CS2, QH-2023-I/CQ-I-CS3, QH-2023-I/CQ-I-CS4, QH-2023-I/CQ-I-CN';
const DEFAULT_PLAN = `## KẾ HOẠCH TRIỂN KHAI HỌC PHẦN THỰC TẬP

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

1. **Phiếu đánh giá kết quả thực tập (Có chữ ký & dấu công ty - 60%):**
   - Trong mẫu báo cáo thực tập của Khoa có sẵn **Trang nhận xét / Phiếu đánh giá kết quả thực tập**.
   - **Nếu thực tập tại Doanh nghiệp:** Sinh viên chỉ cần in riêng trang Phiếu đánh giá này để xin điểm số, nhận xét chi tiết và chữ ký của người hướng dẫn tại doanh nghiệp, kèm **dấu tròn xác nhận của công ty/doanh nghiệp**.
   - Sau đó, sinh viên scan (hoặc chụp rõ nét) trang Phiếu đánh giá này và **gộp (merge) trực tiếp vào trong bản mềm (file PDF)** của báo cáo thực tập.
   - **Nếu thực tập tại Trường:** Giảng viên hướng dẫn tại trường sẽ trực tiếp theo dõi, nhận xét và đánh giá cho điểm phần này.

2. **Nộp Báo cáo thực tập hoàn chỉnh (Bản mềm - 01 file PDF duy nhất):**
   - Sinh viên nộp bản báo cáo hoàn chỉnh (định dạng **PDF, tối đa 10 MB**, đã bao gồm trang Phiếu đánh giá có chữ ký và con dấu) trực tiếp trên hệ thống trong thời gian mở nộp (**01/10 – 10/10**).
   - Bản báo cáo này là cơ sở để Giảng viên hướng dẫn đánh giá và nhập đầy đủ cả 3 đầu điểm trên hệ thống: **Điểm tiến độ (20%)**, **Điểm báo cáo (20%)** và **Điểm đánh giá doanh nghiệp (60%)**. Sinh viên không cần nộp thêm phiếu giấy riêng.

---

### 📊 Cơ cấu điểm đánh giá học phần

- **20%:** Điểm báo cáo định kỳ / tiến độ (sinh viên chủ động liên hệ và báo cáo tiến độ với GVHD).
- **20%:** Điểm nội dung của bản báo cáo thực tập theo mẫu quy định (nộp bản mềm trên hệ thống).
- **60%:** Điểm đánh giá của phía doanh nghiệp (theo Phiếu đánh giá có chữ ký & dấu công ty được scan gộp trong file báo cáo) hoặc của Giảng viên hướng dẫn (nếu thực tập tại trường).`;
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

### 2. Sau khi có kết quả phỏng vấn, em cần làm gì?
Em cần đăng nhập hệ thống và xác nhận đúng một nơi thực tập chính thức đã trúng tuyển trong thời hạn Khoa cho phép.

### 3. Nếu không trúng tuyển công ty nào thì sao?
Em có thể đăng ký thực tập tại trường hoặc nhờ Khoa phân công giảng viên hướng dẫn.

### 4. Báo cáo nộp ở đâu và cần nộp những gì để hoàn thành học phần?
- **Phiếu đánh giá doanh nghiệp:** Sinh viên chỉ cần in riêng trang Phiếu đánh giá trong mẫu báo cáo của Khoa để xin điểm, nhận xét, chữ ký của người hướng dẫn và dấu của công ty. Sau đó scan và gộp trực tiếp vào file báo cáo PDF.
- **Nộp bản mềm trên hệ thống:** Nộp 01 file báo cáo PDF hoàn chỉnh (đã kèm trang Phiếu đánh giá) trực tiếp trên hệ thống để GVHD chấm cả 3 đầu điểm (20% tiến độ, 20% báo cáo, 60% doanh nghiệp). Không cần nộp phiếu giấy riêng.`;
const DEFAULT_LECTURER_FAQ = `## FAQ cho giảng viên

### 1. Giảng viên xem danh sách sinh viên ở đâu?
Trang chủ giảng viên hiển thị danh sách sinh viên được Khoa phân công.

### 2. Giảng viên cần đánh giá gì?
Giảng viên nhập điểm, nhận xét và xử lý báo cáo của sinh viên.

### 3. Giảng viên có nhận thông báo trên website không?
Có. Thông báo hiển thị ở biểu tượng chuông và trang Thông báo.`;

let initPromise: Promise<void> | null = null;

type SqlStatement = { sql: string; args?: unknown[] };
type DatabaseResult = { rows: any[]; lastInsertRowid?: number; rowsAffected?: number };
type DatabaseClient = {
  execute(input: string | SqlStatement): Promise<DatabaseResult>;
  executeMultiple(sql: string): Promise<void>;
  batch(statements: SqlStatement[]): Promise<DatabaseResult[]>;
};

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let statement = '';
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (!quote && ch === '-' && next === '-') {
      lineComment = true;
      i++;
      continue;
    }
    if (!quote && ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    statement += ch;
    if (quote) {
      if (ch === quote && next === quote) {
        statement += next;
        i++;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === ';') {
      const trimmed = statement.trim().replace(/;$/, '').trim();
      if (trimmed) statements.push(trimmed);
      statement = '';
    }
  }
  const trimmed = statement.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

function db(env: Env) {
  if (!env.DB) throw new Error('Missing Cloudflare D1 binding: DB');
  const toResult = (result: any): DatabaseResult => ({
    rows: result?.results || [],
    lastInsertRowid: result?.meta?.last_row_id,
    rowsAffected: result?.meta?.changes,
  });
  return {
    async execute(input: string | SqlStatement) {
      const sql = typeof input === 'string' ? input : input.sql;
      const args = typeof input === 'string' ? [] : (input.args || []);
      const statement = env.DB.prepare(sql).bind(...args);
      return toResult(await statement.all());
    },
    async executeMultiple(sql: string) {
      const statements = splitSqlStatements(sql);
      for (let i = 0; i < statements.length; i += DB_BATCH_SIZE) {
        const prepared = statements.slice(i, i + DB_BATCH_SIZE).map(statement => env.DB.prepare(statement));
        await env.DB.batch(prepared);
      }
    },
    async batch(statements: SqlStatement[]) {
      const prepared = statements.map(statement => env.DB.prepare(statement.sql).bind(...(statement.args || [])));
      const results = await env.DB.batch(prepared);
      return results.map(toResult);
    },
  } satisfies DatabaseClient;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function corsHeaders(request: Request, env: Env) {
  const allowed = (env.CORS_ORIGIN || 'https://fit-uet.github.io')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get('origin') || '';
  const isAllowedOrigin = origin && (
    allowed.includes(origin) ||
    allowed.includes('*') ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  );
  const requestedHeaders = request.headers.get('access-control-request-headers');
  return {
    'access-control-allow-origin': isAllowedOrigin ? origin : allowed[0] || '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': requestedHeaders || 'content-type, authorization, x-filename, x-message-body, x-cron-secret, accept, cache-control, x-requested-with',
    'access-control-expose-headers': 'content-disposition, content-type, content-length',
    'access-control-max-age': '86400',
  };
}

async function readBody<T = any>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) return {} as T;
  return request.json();
}

function b64url(input: string | ArrayBuffer) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${b64url(signature)}`;
}

async function verifyJwt(token: string, secret: string) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('Invalid token');
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, fromB64url(signature), encoder.encode(signingInput));
  if (!ok) throw new Error('Invalid token');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (claims.exp && Date.now() / 1000 > claims.exp) throw new Error('Token expired');
  return claims;
}

async function executeBatch(database: DatabaseClient, statements: SqlStatement[]) {
  for (let i = 0; i < statements.length; i += DB_BATCH_SIZE) {
    await database.batch(statements.slice(i, i + DB_BATCH_SIZE));
  }
}

async function getSqliteObjectType(database: DatabaseClient, name: string) {
  const row = (await database.execute({
    sql: "SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
    args: [name],
  })).rows[0] as { type?: string } | undefined;
  return row?.type || null;
}

async function deleteLegacyStudentRow(database: DatabaseClient, studentId: string, email?: string | null) {
  const studentsType = await getSqliteObjectType(database, 'students');
  if (studentsType !== 'table') return false;

  const columns = new Set(
    ((await database.execute('PRAGMA table_info(students)')).rows as any[])
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

  await database.execute({
    sql: `DELETE FROM students WHERE ${clauses.join(' OR ')}`,
    args,
  });
  return true;
}

function rowsToSettings(rows: any[]) {
  return Object.fromEntries(rows.map(row => [row.key, row.value])) as Record<string, string>;
}

function cohortFromVnuEmail(email: string) {
  const localPart = String(email || '').toLowerCase().split('@')[0] || '';
  const prefix = localPart.match(/^\d{4}/)?.[0] || '';
  const yearCode = Number(prefix.slice(0, 2));
  if (!Number.isInteger(yearCode) || yearCode < 0) return null;
  return `K${yearCode + 45}`;
}

async function assertStudentCohortAllowed(database: DatabaseClient, email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const studentId = normalizedEmail.split('@')[0] || '';
  const settings = rowsToSettings((await database.execute({
    sql: "SELECT key, value FROM settings WHERE key IN ('allowed_registration_cohorts')",
    args: [],
  })).rows);
  const cohort = cohortFromVnuEmail(normalizedEmail);
  const allowed = new Set(String(settings.allowed_registration_cohorts || DEFAULT_ALLOWED_REGISTRATION_COHORTS).split(',').map(item => item.trim()).filter(Boolean));
  if (cohort && allowed.has(cohort)) return;
  if (studentId) {
    const listed = (await database.execute({
      sql: `SELECT id FROM users
            WHERE role = 'student'
              AND (lower(email) = ? OR student_id = ?)
            LIMIT 1`,
      args: [normalizedEmail, studentId],
    })).rows[0];
    if (listed) return;
  }
  const allowedText = Array.from(allowed).join(', ') || 'không có khóa nào';
  throw new Error(`Khóa ${cohort || 'không xác định'} không được phép đăng nhập/đăng ký học phần trong đợt này. Các khóa đang mở: ${allowedText}.`);
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

async function addApprovedCompanyFromRegistration(database: DatabaseClient, row: any) {
  if (!row || row.company_name !== 'Công ty khác') return false;
  const name = String(row.other_company_name || '').trim();
  const normalized = normalizeCompanyName(name);
  if (!name || !normalized) return false;

  await database.execute({
    sql: `INSERT OR IGNORE INTO approved_company_names (name, normalized_name, source)
          VALUES (?, ?, 'registration_approval')`,
    args: [name, normalized],
  });
  return true;
}

async function approveMatchingOtherCompanyRegistrations(database: DatabaseClient, row: any, reviewComment: string) {
  if (!row || row.company_name !== 'Công ty khác') return [];
  const normalized = normalizeCompanyName(row.other_company_name || '');
  if (!normalized) return [];
  const pending = (await database.execute(`
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
  await executeBatch(database, matched.map(item => ({
    sql: 'UPDATE registrations SET status = ?, review_comment = ? WHERE id = ?',
    args: ['approved', reviewComment || 'Tự động duyệt do công ty tự liên hệ đã được Khoa duyệt.', item.id],
  })));
  return matched;
}

async function approvePendingOtherRegistrationsFromApprovedNames(database: DatabaseClient) {
  const approvedRows = (await database.execute('SELECT normalized_name FROM approved_company_names')).rows as any[];
  const approvedNames = new Set(approvedRows.map(row => String(row.normalized_name || '').trim()).filter(Boolean));
  if (approvedNames.size === 0) return;
  const pendingRows = (await database.execute(`
    SELECT r.id, r.other_company_name
    FROM registrations r
    JOIN companies c ON c.id = r.company_id
    WHERE c.name = 'Công ty khác'
      AND r.status = 'pending'
      AND r.other_company_name IS NOT NULL
  `)).rows as any[];
  const matched = pendingRows.filter(row => approvedNames.has(normalizeCompanyName(row.other_company_name || '')));
  if (matched.length === 0) return;
  await executeBatch(database, matched.map(row => ({
    sql: `UPDATE registrations
          SET status = 'approved',
              review_comment = COALESCE(review_comment, 'Tự động duyệt do công ty tự liên hệ đã có trong danh sách thẩm định.')
          WHERE id = ?`,
    args: [row.id],
  })));
}

const MIGRATION_TABLES = [
  'settings',
  'users',
  'companies',
  'lecturers',
  'approved_company_names',
  'registrations',
  'final_internships',
  'lecturer_quotas',
  'advisor_assignments',
  'advisor_assignment_history',
  'final_reports',
  'grades',
  'notifications',
];

function quoteIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function getTableColumns(database: { execute(input: string | SqlStatement): Promise<DatabaseResult> }, table: string) {
  const rows = (await database.execute(`PRAGMA table_info(${quoteIdentifier(table)})`)).rows as any[];
  return rows.map(row => String(row.name)).filter(Boolean);
}

async function tableExists(database: { execute(input: string | SqlStatement): Promise<DatabaseResult> }, table: string) {
  try {
    return (await getTableColumns(database, table)).length > 0;
  } catch (e) {
    return false;
  }
}

async function migrateTursoToD1(env: Env, database: DatabaseClient, options: { dryRun?: boolean; truncate?: boolean; truncateOnly?: boolean; table?: string; offset?: number; limit?: number } = {}) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error('Missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN. Add the old Turso secrets in Cloudflare Dashboard before migration.');
  }
  const turso = createTursoClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
  const summary: { table: string; count: number; inserted: number; skipped?: string }[] = [];
  const tables = MIGRATION_TABLES;

  if (options.truncateOnly) {
    await executeBatch(database, [...tables].reverse().map(table => ({ sql: `DELETE FROM ${quoteIdentifier(table)}` })));
    await ensureSpecialCompanies(database);
    return { success: true, truncated: true };
  }

  for (const table of tables) {
    if (!(await tableExists(turso as any, table))) {
      summary.push({ table, count: 0, inserted: 0, skipped: 'missing_in_turso' });
      continue;
    }
    const countRow = (await (turso as any).execute(`SELECT COUNT(*) as count FROM ${quoteIdentifier(table)}`)).rows[0] as any;
    summary.push({ table, count: Number(countRow?.count || 0), inserted: 0 });
  }

  if (options.dryRun) return { success: true, dryRun: true, tables: summary };

  if (options.table) {
    if (!tables.includes(options.table)) throw new Error('Invalid migration table.');
    const item = summary.find(row => row.table === options.table);
    if (!item || item.skipped) return { success: true, table: options.table, inserted: 0, nextOffset: options.offset || 0, done: true, skipped: item?.skipped || 'missing' };
    const d1Columns = await getTableColumns(database, options.table);
    const tursoColumns = await getTableColumns(turso as any, options.table);
    const columns = d1Columns.filter(column => tursoColumns.includes(column));
    if (columns.length === 0) return { success: true, table: options.table, inserted: 0, nextOffset: options.offset || 0, done: true, skipped: 'no_common_columns' };
    const offset = Math.max(0, Number(options.offset || 0));
    const limit = Math.min(100, Math.max(1, Number(options.limit || DB_BATCH_SIZE)));
    const selectSql = `SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(options.table)} LIMIT ? OFFSET ?`;
    const rows = ((await (turso as any).execute({ sql: selectSql, args: [limit, offset] })).rows || []) as Record<string, unknown>[];
    const placeholders = columns.map(() => '?').join(', ');
    const insertSql = `INSERT OR REPLACE INTO ${quoteIdentifier(options.table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;
    await executeBatch(database, rows.map(row => ({
      sql: insertSql,
      args: columns.map(column => row[column] ?? null),
    })));
    return {
      success: true,
      table: options.table,
      inserted: rows.length,
      offset,
      nextOffset: offset + rows.length,
      total: item.count,
      done: rows.length < limit || offset + rows.length >= item.count,
    };
  }

  for (const item of summary) {
    if (item.skipped) continue;
    const d1Columns = await getTableColumns(database, item.table);
    const tursoColumns = await getTableColumns(turso as any, item.table);
    const columns = d1Columns.filter(column => tursoColumns.includes(column));
    if (columns.length === 0) {
      item.skipped = 'no_common_columns';
      continue;
    }
    const selectSql = `SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(item.table)}`;
    const rows = ((await (turso as any).execute(selectSql)).rows || []) as Record<string, unknown>[];
    const placeholders = columns.map(() => '?').join(', ');
    const insertSql = `INSERT OR REPLACE INTO ${quoteIdentifier(item.table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;
    for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
      await executeBatch(database, rows.slice(i, i + DB_BATCH_SIZE).map(row => ({
        sql: insertSql,
        args: columns.map(column => row[column] ?? null),
      })));
    }
    item.inserted = rows.length;
  }
  await ensureSpecialCompanies(database);
  return { success: true, dryRun: false, tables: summary };
}

function lecturerDefaultQuota(name: string) {
  const upper = String(name || '').toUpperCase();
  if (/\b(PGS|GS)\b/.test(upper) || upper.includes('PGS.') || upper.includes('GS.')) return 10;
  return 15;
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

function reportObjectKey(year: string, studentId: string | null | undefined) {
  const cleanYear = String(year || new Date().getFullYear()).replace(/[^0-9A-Za-z_-]/g, '_');
  const cleanStudent = String(studentId || 'unknown').replace(/[^0-9A-Za-z_-]/g, '_');
  return `reports/${cleanYear}/${cleanStudent}/final.pdf`;
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

async function getCampaignSettings(database: DatabaseClient) {
  const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('campaign_year', 'campaign_start', 'campaign_end', 'classes_list', 'allowed_registration_cohorts', 'registration_rules_md', 'registration_open_at', 'registration_close_at', 'confirmation_open_at', 'confirmation_close_at', 'final_report_open_at', 'final_report_close_at', 'faq_student_md', 'faq_lecturer_md')")).rows);
  return {
    year: settings.campaign_year || '2026',
    start: settings.campaign_start || '22/05/2026',
    end: settings.campaign_end || '15/06/2026',
    classes_list: settings.classes_list || DEFAULT_CLASSES,
    allowed_registration_cohorts: settings.allowed_registration_cohorts || DEFAULT_ALLOWED_REGISTRATION_COHORTS,
    registration_rules_md: settings.registration_rules_md || DEFAULT_REGISTRATION_RULES,
    registration_open_at: settings.registration_open_at || '',
    registration_close_at: settings.registration_close_at || '',
    confirmation_open_at: settings.confirmation_open_at || '',
    confirmation_close_at: settings.confirmation_close_at || '',
    final_report_open_at: settings.final_report_open_at || '',
    final_report_close_at: settings.final_report_close_at || '',
    faq_student_md: settings.faq_student_md || DEFAULT_STUDENT_FAQ,
    faq_lecturer_md: settings.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
  };
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
};

function emailDailySendCap(env: Env) {
  const configured = Number(env.EMAIL_DAILY_SEND_CAP || 250);
  if (!Number.isFinite(configured) || configured < 1) return 250;
  return Math.min(Math.floor(configured), 300);
}

function emailBatchSize(env: Env) {
  const configured = Number(env.EMAIL_BATCH_SIZE || 25);
  if (!Number.isFinite(configured) || configured < 1) return 25;
  return Math.min(Math.floor(configured), 100);
}

async function emailSentTodayCount(database: DatabaseClient) {
  const row = (await database.execute(`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE status = 'sent'
      AND date(sent_at) = date('now', '+7 hours')
  `)).rows[0] as any;
  return Number(row?.count || 0);
}

async function insertNotification(database: DatabaseClient, data: NotificationInput) {
  if (!data.recipient_email) return null;
  const status = data.status === 'website_only' ? 'website_only' : 'queued';
  const result = await database.execute({
    sql: `INSERT INTO notifications (user_id, recipient_email, type, subject, body, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
    args: [data.user_id || null, data.recipient_email, data.type, data.subject, data.body, status],
  });
  return { id: Number(result.lastInsertRowid), status } as const;
}

async function createNotification(database: DatabaseClient, data: NotificationInput, env?: Env) {
  try {
    const notification = await insertNotification(database, data);
    if (!notification) return;
    if (env && notification.status === 'queued' && (data.send_now || env.EMAIL_SEND_IMMEDIATE === 'true')) {
      return await sendNotificationEmail(database, env, notification.id, data);
    }
    return notification.status;
  } catch (e) {
    // Notification failures must not block the main business flow.
  }
}

async function sendNotificationEmail(database: DatabaseClient, env: Env, notificationId: number, data: {
  recipient_email: string;
  cc_emails?: string[];
  subject: string;
  body: string;
}) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from || !notificationId) return 'queued';
  if ((await emailSentTodayCount(database)) >= emailDailySendCap(env)) return 'queued';
  try {
    const response = await fetch('https://api.resend.com/emails', {
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
    const responseText = await response.text();
    if (response.status === 429) {
      await database.execute({
        sql: 'UPDATE notifications SET error = ? WHERE id = ?',
        args: ['Provider rate limit exceeded; giữ trong hàng đợi để gửi lại sau.', notificationId],
      });
      return 'queued';
    }
    if (!response.ok) throw new Error(responseText.slice(0, 1000));
    await database.execute({
      sql: `UPDATE notifications SET status = 'sent', sent_at = datetime('now', '+7 hours'), error = NULL WHERE id = ?`,
      args: [notificationId],
    });
    return 'sent';
  } catch (e: any) {
    await database.execute({
      sql: `UPDATE notifications SET status = 'failed', error = ? WHERE id = ?`,
      args: [String(e?.message || e).slice(0, 1000), notificationId],
    });
    return 'failed';
  }
}

async function sendQueuedNotificationBatch(
  database: DatabaseClient,
  env: Env,
  options: { requestedLimit?: number; notificationIds?: number[]; ignoreBatchSize?: boolean } = {},
) {
  const sentToday = await emailSentTodayCount(database);
  const remainingToday = Math.max(0, emailDailySendCap(env) - sentToday);
  const batchLimit = options.ignoreBatchSize ? remainingToday : emailBatchSize(env);
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
      const chunkRows = (await database.execute({
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
    rows = (await database.execute({
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
    const result = await sendNotificationEmail(database, env, Number(row.id), {
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

async function ensureSpecialCompanies(database: DatabaseClient) {
  await executeBatch(database, [
    {
      sql: `INSERT OR IGNORE INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['Công ty khác', 'Đăng ký công ty ngoài danh sách phải đảm bảo công ty đó đáp ứng được chất lượng thực tập.', 9999, '', '', '', '', '', '', ''],
    },
    {
      sql: `INSERT OR IGNORE INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['Trường Đại học Công nghệ', 'Sinh viên thực tập tại các Lab/Dự án trong trường.', 9999, '', '', '', '', '', '', ''],
    },
  ]);
}

async function syncLecturerUsers(database: DatabaseClient) {
  await database.executeMultiple(`
    DELETE FROM lecturers
    WHERE email IN (SELECT email FROM users WHERE role = 'admin' AND COALESCE(is_lecturer, 0) = 0);

    UPDATE users
    SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'lecturer' END,
        is_lecturer = 1,
        name = (SELECT lecturers.name FROM lecturers WHERE lecturers.email = users.email LIMIT 1)
    WHERE email IN (SELECT email FROM lecturers WHERE email IS NOT NULL AND email != '');

    UPDATE users
    SET role = 'student', is_lecturer = 0
    WHERE role = 'lecturer'
      AND email NOT IN (SELECT email FROM lecturers WHERE email IS NOT NULL AND email != '');

    INSERT OR IGNORE INTO lecturers (name, email)
    SELECT name, email
    FROM users
    WHERE role = 'admin' AND COALESCE(is_lecturer, 0) = 1 AND email IS NOT NULL;
  `);
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

async function normalizeExistingStudentNames(database: DatabaseClient) {
  try {
    const students = (await database.execute(`
      SELECT id, student_id, name, email FROM users
      WHERE role = 'student' AND name IS NOT NULL AND name != ''
    `)).rows as any[];
    for (const s of students) {
      const clean = cleanStudentName(s.name, s.student_id, s.email);
      if (clean && clean !== s.name) {
        await database.execute({
          sql: 'UPDATE users SET name = ? WHERE id = ?',
          args: [clean, s.id],
        });
      }
    }
  } catch (e) {
    console.error('Failed to normalize existing student names:', e);
  }
}

let isDbInitialized = false;

async function initDb(env: Env, force = false) {
  if (!force && isDbInitialized) return;
  if (!force && initPromise) return initPromise;
  initPromise = (async () => {
    const database = db(env);
    if (!force) {
      try {
        const check = await database.execute('SELECT 1 FROM settings LIMIT 1');
        if (check.rows && check.rows.length > 0) {
          isDbInitialized = true;
          return;
        }
      } catch (e) {
        // Table settings doesn't exist, proceed with full schema creation below
      }
    }
    await database.executeMultiple(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        picture TEXT,
        role TEXT NOT NULL DEFAULT 'student',
        is_lecturer INTEGER DEFAULT 0,
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
        contact_name TEXT,
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
        status TEXT NOT NULL DEFAULT 'pending',
        preference_order INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        other_company_name TEXT,
        other_company_role TEXT,
        other_company_contact TEXT,
        sent_to_company_at DATETIME,
        sent_to_company_note TEXT
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
        UNIQUE(user_id, lecturer_id, role)
      );
      CREATE TABLE IF NOT EXISTS lecturer_quotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lecturer_id INTEGER UNIQUE NOT NULL,
        max_total_students INTEGER,
        note TEXT
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
        read_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_user_id INTEGER NOT NULL,
        lecturer_id INTEGER NOT NULL,
        sender_user_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME
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
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS lecturers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, email TEXT, work_unit TEXT);
    `);

    await database.executeMultiple(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('google_sheet_url', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('export_google_sheet_url', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('campaign_year', '2026');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('campaign_start', '22/05/2026');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('campaign_end', '15/06/2026');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('allowed_registration_cohorts', '${DEFAULT_ALLOWED_REGISTRATION_COHORTS}');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_open_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_close_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('confirmation_open_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('confirmation_close_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('final_report_open_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('final_report_close_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('classes_list', '${DEFAULT_CLASSES}');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('implementation_plan_md', '${DEFAULT_PLAN.replace(/'/g, "''")}');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_rules_md', '${DEFAULT_REGISTRATION_RULES.replace(/'/g, "''")}');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('faq_student_md', '${DEFAULT_STUDENT_FAQ.replace(/'/g, "''")}');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('faq_lecturer_md', '${DEFAULT_LECTURER_FAQ.replace(/'/g, "''")}');
    `);

    const migrations = [
      'ALTER TABLE registrations ADD COLUMN sent_to_company_at DATETIME',
      'ALTER TABLE registrations ADD COLUMN sent_to_company_note TEXT',
      'ALTER TABLE registrations ADD COLUMN review_comment TEXT',
      'ALTER TABLE registrations ADD COLUMN preference_order INTEGER',
      'ALTER TABLE final_internships ADD COLUMN school_lecturer TEXT',
      'ALTER TABLE final_internships ADD COLUMN school_assignment_request INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE lecturer_quotas ADD COLUMN max_total_students INTEGER',
      'ALTER TABLE final_reports ADD COLUMN lecturer_comment TEXT',
      'ALTER TABLE grades ADD COLUMN locked_at DATETIME',
      'ALTER TABLE notifications ADD COLUMN read_at DATETIME',
      'ALTER TABLE lecturers ADD COLUMN work_unit TEXT',
      'ALTER TABLE companies ADD COLUMN applicants_drive_link TEXT',
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_user_id INTEGER NOT NULL,
        lecturer_id INTEGER NOT NULL,
        sender_user_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME
      )`,
    ];
    for (const sql of migrations) {
      try { await database.execute(sql); } catch (e) { }
    }
    try {
      await database.execute({
        sql: `UPDATE notifications
              SET status = 'website_only', error = 'Đã ngừng gửi thông báo vượt quota GVHD theo chính sách hiện tại.'
              WHERE type = 'advisor_quota_exceeded' AND status = 'queued'`,
        args: [],
      });
    } catch (e) { }

    await database.executeMultiple(`
      DELETE FROM registrations
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM registrations
        GROUP BY user_id, company_id, COALESCE(other_company_name, '')
      );
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id_unique ON users(student_id)
        WHERE role = 'student' AND student_id IS NOT NULL AND student_id != '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_unique ON companies(name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lecturers_email_unique ON lecturers(email)
        WHERE email IS NOT NULL AND email != '';
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_assignments_primary_unique
        ON advisor_assignments(user_id)
        WHERE role = 'primary';
      CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(student_user_id, lecturer_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(student_user_id, lecturer_id, sender_user_id, read_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_student_lecturer_id ON chat_messages(student_user_id, lecturer_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_nocase ON notifications(recipient_email COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
      CREATE INDEX IF NOT EXISTS idx_system_notifications_active_role ON system_notifications(active, target_role, created_at);
    `);
    if (force) {
      await ensureSpecialCompanies(database);
      await approvePendingOtherRegistrationsFromApprovedNames(database);
      await normalizeExistingStudentNames(database);
    }
    isDbInitialized = true;
  })().catch(error => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

async function requireUser(request: Request, env: Env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const claims: any = await verifyJwt(token, env.JWT_SECRET);
  let user = claims.email
    ? ((await db(env).execute({ sql: 'SELECT * FROM users WHERE LOWER(email) = ?', args: [String(claims.email).toLowerCase().trim()] })).rows[0] as any)
    : null;
  if (!user && claims.id) {
    user = (await db(env).execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [claims.id] })).rows[0] as any;
  }
  if (!user) throw new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });
  if (env.ADMIN_EMAIL && user.email === env.ADMIN_EMAIL && user.role !== 'admin') {
    user.role = 'admin';
  }
  return user;
}

function requireRole(user: any, roles: string[]) {
  if (!roles.includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
}

async function verifyGoogleToken(credential: string, env: Env) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw new Error('Invalid Google token');
  const payload: any = await res.json();
  if (payload.aud !== env.VITE_GOOGLE_CLIENT_ID) throw new Error('Invalid Google client');
  return payload;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function recordsFromCsv(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift() || [];
  return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
}

async function getGoogleAccessToken(env: Env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Missing Google service account configuration');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const assertion = `${signingInput}.${b64url(signature)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google auth failed');
  return data.access_token as string;
}

async function handleAuthGoogle(request: Request, env: Env) {
  const { credential } = await readBody(request);
  if (!credential) return json({ error: 'Thiếu thông tin xác thực Google.' }, 400);
  try {
    const payload = await verifyGoogleToken(credential, env);
    const email = String(payload.email || '').trim().toLowerCase();
    const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (!email || (!email.endsWith('@vnu.edu.vn') && email !== adminEmail)) {
      return json({ error: 'Chỉ chấp nhận email @vnu.edu.vn' }, 403);
    }
    const database = db(env);
    const lecturer = (await database.execute({ sql: 'SELECT * FROM lecturers WHERE email = ?', args: [email] })).rows[0] as any;
    const isLecturer = !!lecturer;
    const defaultRole = email === adminEmail ? 'admin' : isLecturer ? 'lecturer' : 'student';
    const studentId = defaultRole === 'student' ? email.split('@')[0] : null;
    const rawDisplayName = lecturer?.name || payload.name || email;
    const displayName = defaultRole === 'student' ? cleanStudentName(rawDisplayName, studentId, email) : rawDisplayName;
    let user = (await database.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] })).rows[0] as any;
    if (!user && studentId) {
      user = (await database.execute({
        sql: "SELECT * FROM users WHERE role = 'student' AND student_id = ?",
        args: [studentId],
      })).rows[0] as any;
    }
    const effectiveRole = user?.role || defaultRole;
    if (effectiveRole === 'student' && !isLecturer && email !== adminEmail) {
      await assertStudentCohortAllowed(database, email);
    }
    if (!user) {
      const result = await database.execute({
        sql: 'INSERT INTO users (email, name, picture, role, student_id, is_lecturer) VALUES (?, ?, ?, ?, ?, ?)',
        args: [email, displayName, payload.picture || null, defaultRole, studentId, isLecturer ? 1 : 0],
      });
      user = { id: Number(result.lastInsertRowid), email, name: displayName, picture: payload.picture, role: defaultRole, student_id: studentId, is_lecturer: isLecturer ? 1 : 0 };
    } else {
      const nextRole = email === adminEmail ? 'admin' : isLecturer ? (user.role === 'admin' ? 'admin' : 'lecturer') : (user.role === 'lecturer' ? 'student' : user.role);
      await database.execute({
        sql: `UPDATE users SET email = ?, picture = ?, role = ?, name = CASE WHEN ? = 1 THEN ? ELSE name END,
              is_lecturer = CASE WHEN ? = 1 THEN 1 ELSE CASE WHEN ? = 1 THEN 0 ELSE is_lecturer END END,
              student_id = CASE WHEN ? = 'student' THEN COALESCE(NULLIF(student_id, ''), ?) ELSE NULL END
              WHERE id = ?`,
        args: [email, payload.picture || null, nextRole, isLecturer ? 1 : 0, displayName, isLecturer ? 1 : 0, nextRole === 'student' ? 1 : 0, nextRole, studentId, user.id],
      });
      user = (await database.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.id] })).rows[0];
    }
    const token = await signJwt({ id: user.id, email: user.email, role: user.role }, env.JWT_SECRET);
    return json({ token, user });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('không được phép đăng nhập/đăng ký')) {
      return json({ error: message }, 403);
    }
    if (/UNIQUE constraint failed: users\.student_id|idx_users_student_id_unique/i.test(message)) {
      return json({ error: 'Tài khoản này bị trùng mã sinh viên với một hồ sơ khác trong hệ thống. Vui lòng liên hệ quản trị viên để gộp hoặc sửa hồ sơ sinh viên.' }, 409);
    }
    if (/token|client|audience|recipient|issuer|signature/i.test(message)) {
      return json({ error: 'Không xác thực được tài khoản Google. Vui lòng thử đăng nhập lại; nếu vẫn lỗi, cần kiểm tra OAuth Client ID của frontend và API.' }, 401);
    }
    return json({ error: 'Đăng nhập thất bại do lỗi hệ thống. Vui lòng thử lại sau.' }, 500);
  }
}

async function route(request: Request, env: Env) {
  await initDb(env);
  const database = db(env);
  const notify = (data: Parameters<typeof createNotification>[1]) => createNotification(database, data, env);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'POST' && path === '/api/auth/google') return handleAuthGoogle(request, env);
  if (method === 'GET' && path === '/api/plan') {
    const row = (await database.execute("SELECT value FROM settings WHERE key = 'implementation_plan_md'")).rows[0] as any;
    return json({ plan: row?.value || '' });
  }
  if (method === 'GET' && path === '/api/settings/campaign') {
    return json(await getCampaignSettings(database));
  }

  const user = await requireUser(request, env);

  if (method === 'GET' && path === '/api/companies') {
    requireRole(user, ['student', 'admin']);
    const companies = (await database.execute(`
      SELECT c.*, c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots, COALESCE(rc.applicant_count, 0) as applicant_count
      FROM companies c
      LEFT JOIN (
        SELECT company_id, COUNT(*) as applicant_count
        FROM registrations
        WHERE status != 'rejected'
        GROUP BY company_id
      ) rc ON rc.company_id = c.id
    `)).rows;
    return json(companies);
  }

  if (method === 'GET' && path === '/api/companies/it-list') {
    const approvedRows = (await database.execute('SELECT name FROM approved_company_names ORDER BY name ASC')).rows;
    const fallbackRows = approvedRows.length > 0 ? [] : (await database.execute(`
        SELECT name FROM companies
        WHERE name NOT IN ('Công ty khác', 'Trường Đại học Công nghệ')
        ORDER BY name ASC
      `)).rows;
    const list = (approvedRows.length > 0 ? approvedRows : fallbackRows)
      .map((row: any) => String(row.name || '').trim())
      .filter(Boolean);
    return json(list);
  }

  if (method === 'GET' && path === '/api/lecturers') {
    const lecturers = (await database.execute('SELECT name FROM lecturers ORDER BY name ASC')).rows.map((r: any) => r.name);
    return json(lecturers);
  }

  const companyMatch = path.match(/^\/api\/companies\/(\d+)$/);
  if (method === 'GET' && companyMatch) {
    requireRole(user, ['student', 'admin']);
    const company = (await database.execute({
      sql: `SELECT c.*, c.slots - COALESCE(rc.applicant_count, 0) as remaining_slots, COALESCE(rc.applicant_count, 0) as applicant_count
            FROM companies c
            LEFT JOIN (
              SELECT company_id, COUNT(*) as applicant_count FROM registrations WHERE status != 'rejected' GROUP BY company_id
            ) rc ON rc.company_id = c.id
            WHERE c.id = ?`,
      args: [companyMatch[1]],
    })).rows[0];
    return company ? json(company) : json({ error: 'Company not found' }, 404);
  }

  if (method === 'PUT' && path === '/api/users/profile') {
    const body = await readBody(request);
    if (!body.name) return json({ error: 'Họ và tên là bắt buộc.' }, 400);
    const isStaff = user.role === 'admin' || user.role === 'lecturer';
    if (isStaff) {
      await database.execute({ sql: 'UPDATE users SET name = ? WHERE id = ?', args: [body.name, user.id] });
      if (user.role === 'lecturer' || user.is_lecturer) {
        await database.execute({ sql: 'UPDATE lecturers SET name = ? WHERE email = ?', args: [body.name, user.email] });
        await syncLecturerUsers(database);
      }
    } else {
      const studentCleanName = cleanStudentName(body.name, body.student_id, user.email);
      await database.execute({
        sql: 'UPDATE users SET name = ?, student_id = ?, dob = ?, class_name = ?, course_code = ?, phone = ?, personal_email = ? WHERE id = ?',
        args: [studentCleanName, body.student_id || null, body.dob || null, body.class_name || null, body.course_code || null, body.phone || null, body.personal_email || null, user.id],
      });
    }
    const updated = (await database.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.id] })).rows[0];
    return json(updated);
  }

  if (method === 'GET' && path === '/api/notifications/my') {
    const email = String(user.email || '').trim();
    const personalEmail = String(user.personal_email || '').trim();
    const userId = user.id ? Number(user.id) : null;

    const personalRows = (await database.execute({
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
    const systemRows = (await database.execute({
      sql: `
        SELECT s.id, 'system' as source, s.type, s.subject, s.body, 'system' as status, NULL as error, s.created_at, NULL as sent_at, r.read_at
        FROM system_notifications s
        LEFT JOIN system_notification_reads r ON r.system_notification_id = s.id AND r.user_id = ?
        WHERE s.active = 1
          AND (s.target_role = 'all' OR s.target_role = ?)
        ORDER BY s.created_at DESC
        LIMIT 100
      `,
      args: [user.id, user.role || 'student'],
    })).rows as any[];
    const rows = [...personalRows, ...systemRows]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 100);
    return json({ rows, unread: rows.filter(row => !row.read_at).length });
  }

  const mySystemNotificationRead = path.match(/^\/api\/notifications\/my\/system\/(\d+)\/read$/);
  if (method === 'PUT' && mySystemNotificationRead) {
    const id = Number(mySystemNotificationRead[1]);
    const notification = (await database.execute({
      sql: `SELECT id FROM system_notifications WHERE id = ? AND active = 1 AND (target_role = 'all' OR target_role = ?)`,
      args: [id, user.role || 'student'],
    })).rows[0];
    if (!notification) return json({ error: 'Không tìm thấy thông báo hệ thống.' }, 404);
    await database.execute({
      sql: `
        INSERT OR REPLACE INTO system_notification_reads (system_notification_id, user_id, read_at)
        VALUES (?, ?, datetime('now', '+7 hours'))
      `,
      args: [id, user.id],
    });
    return json({ success: true });
  }

  const myNotificationRead = path.match(/^\/api\/notifications\/my\/(\d+)\/read$/);
  if (method === 'PUT' && myNotificationRead) {
    await database.execute({
      sql: `
        UPDATE notifications
        SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
        WHERE id = ?
      `,
      args: [Number(myNotificationRead[1])],
    });
    return json({ success: true });
  }

  if (method === 'PUT' && path === '/api/notifications/my/read-all') {
    const email = String(user.email || '').trim();
    const personalEmail = String(user.personal_email || '').trim();
    const userId = user.id ? Number(user.id) : null;
    await database.execute({
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
    await database.execute({
      sql: `
        INSERT OR REPLACE INTO system_notification_reads (system_notification_id, user_id, read_at)
        SELECT id, ?, datetime('now', '+7 hours')
        FROM system_notifications
        WHERE active = 1 AND (target_role = 'all' OR target_role = ?)
      `,
      args: [user.id, user.role || 'student'],
    });
    return json({ success: true });
  }

  const getActorLecturer = async (actor: any) => {
    if (actor.role !== 'lecturer' && actor.role !== 'admin' && !actor.is_lecturer) return null;
    return (await database.execute({
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
    const assignment = (await database.execute({
      sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
      args: [studentUserId, lecturerId],
    })).rows[0];
    return !!assignment;
  };

  const canAccessChatGroup = async (actor: any, lecturerId: number) => {
    if (!Number.isFinite(lecturerId)) return false;
    if (actor.role === 'student') {
      const assignment = (await database.execute({
        sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
        args: [actor.id, lecturerId],
      })).rows[0];
      return !!assignment;
    }
    const lecturer = await getActorLecturer(actor);
    return !!lecturer && Number(lecturer.id) === lecturerId;
  };

  const chatGroupMessageSelect = `
    SELECT cgm.id, NULL as student_user_id, cgm.lecturer_id, cgm.sender_user_id, cgm.body,
           cgm.attachment_name, cgm.attachment_size, cgm.attachment_mime,
           CASE WHEN cgm.attachment_key IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
           cgm.created_at, NULL as read_at, 1 as is_group,
           u.name as sender_name, u.role as sender_role, u.email as sender_email
    FROM chat_group_messages cgm
    JOIN users u ON u.id = cgm.sender_user_id
  `;

  if (method === 'GET' && path === '/api/chat/threads') {
    if (user.role === 'student') {
      const rows = (await database.execute({
        sql: `
          SELECT 0 as is_group, aa.user_id as student_user_id, aa.lecturer_id, aa.role as advisor_role,
                 l.name as lecturer_name, l.email as lecturer_email,
                 u.name as student_name, u.student_id, NULL as student_count,
                 last_msg.body as last_message, last_msg.attachment_name as last_attachment_name, last_msg.created_at as last_message_at,
                 COALESCE(unread.unread_count, 0) as unread_count
          FROM advisor_assignments aa
          JOIN lecturers l ON l.id = aa.lecturer_id
          JOIN users u ON u.id = aa.user_id
          LEFT JOIN (
            SELECT student_user_id, lecturer_id, body, attachment_name, created_at
            FROM chat_messages cm
            WHERE id IN (
              SELECT MAX(id) FROM chat_messages GROUP BY student_user_id, lecturer_id
            )
          ) last_msg ON last_msg.student_user_id = aa.user_id AND last_msg.lecturer_id = aa.lecturer_id
          LEFT JOIN (
            SELECT student_user_id, lecturer_id, COUNT(*) as unread_count
            FROM chat_messages
            WHERE sender_user_id != ? AND read_at IS NULL
            GROUP BY student_user_id, lecturer_id
          ) unread ON unread.student_user_id = aa.user_id AND unread.lecturer_id = aa.lecturer_id
          WHERE aa.user_id = ?
          ORDER BY CASE aa.role WHEN 'primary' THEN 0 ELSE 1 END, l.name ASC
        `,
        args: [user.id, user.id],
      })).rows;
      const groupRows = (await database.execute({
        sql: `
          SELECT 1 as is_group, NULL as student_user_id, gl.lecturer_id, 'group' as advisor_role,
                 l.name as lecturer_name, l.email as lecturer_email,
                 'Nhóm sinh viên hướng dẫn' as student_name, NULL as student_id,
                 COALESCE(student_counts.student_count, 0) as student_count,
                 last_msg.body as last_message, last_msg.attachment_name as last_attachment_name, last_msg.created_at as last_message_at,
                 COALESCE(unread.unread_count, 0) as unread_count
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
          LEFT JOIN (
            SELECT lecturer_id, body, attachment_name, created_at
            FROM chat_group_messages cgm
            WHERE id IN (
              SELECT MAX(id) FROM chat_group_messages GROUP BY lecturer_id
            )
          ) last_msg ON last_msg.lecturer_id = gl.lecturer_id
          LEFT JOIN (
            SELECT cgm.lecturer_id, COUNT(*) as unread_count
            FROM chat_group_messages cgm
            LEFT JOIN chat_group_message_reads r ON r.message_id = cgm.id AND r.user_id = ?
            WHERE cgm.sender_user_id != ? AND r.message_id IS NULL
            GROUP BY cgm.lecturer_id
          ) unread ON unread.lecturer_id = gl.lecturer_id
          ORDER BY l.name ASC
        `,
        args: [user.id, user.id, user.id],
      })).rows;
      return json([...groupRows, ...rows]);
    }
    const lecturer = await getActorLecturer(user);
    if (!lecturer) return json([]);
    const rows = (await database.execute({
      sql: `
        SELECT 0 as is_group, aa.user_id as student_user_id, aa.lecturer_id, aa.role as advisor_role,
               l.name as lecturer_name, l.email as lecturer_email,
               u.name as student_name, u.student_id, u.email as student_email, u.class_name, u.course_code, NULL as student_count,
               last_msg.body as last_message, last_msg.attachment_name as last_attachment_name, last_msg.created_at as last_message_at,
               COALESCE(unread.unread_count, 0) as unread_count
        FROM advisor_assignments aa
        JOIN lecturers l ON l.id = aa.lecturer_id
        JOIN users u ON u.id = aa.user_id
        LEFT JOIN (
          SELECT student_user_id, lecturer_id, body, attachment_name, created_at
          FROM chat_messages cm
          WHERE id IN (
            SELECT MAX(id) FROM chat_messages GROUP BY student_user_id, lecturer_id
          )
        ) last_msg ON last_msg.student_user_id = aa.user_id AND last_msg.lecturer_id = aa.lecturer_id
        LEFT JOIN (
          SELECT student_user_id, lecturer_id, COUNT(*) as unread_count
          FROM chat_messages
          WHERE sender_user_id != ? AND read_at IS NULL
          GROUP BY student_user_id, lecturer_id
        ) unread ON unread.student_user_id = aa.user_id AND unread.lecturer_id = aa.lecturer_id
        WHERE aa.lecturer_id = ?
        ORDER BY COALESCE(last_msg.created_at, aa.assigned_at) DESC, u.student_id ASC
      `,
      args: [user.id, Number(lecturer.id)],
    })).rows;
    const groupRows = (await database.execute({
      sql: `
        SELECT 1 as is_group, NULL as student_user_id, ? as lecturer_id, 'group' as advisor_role,
               l.name as lecturer_name, l.email as lecturer_email,
               'Nhóm sinh viên hướng dẫn' as student_name, NULL as student_id, NULL as student_email, NULL as class_name, NULL as course_code,
               COALESCE(student_counts.student_count, 0) as student_count,
               last_msg.body as last_message, last_msg.attachment_name as last_attachment_name, last_msg.created_at as last_message_at,
               COALESCE(unread.unread_count, 0) as unread_count
        FROM lecturers l
        LEFT JOIN (
          SELECT lecturer_id, COUNT(DISTINCT user_id) as student_count
          FROM advisor_assignments
          WHERE lecturer_id = ?
          GROUP BY lecturer_id
        ) student_counts ON student_counts.lecturer_id = l.id
        LEFT JOIN (
          SELECT lecturer_id, body, attachment_name, created_at
          FROM chat_group_messages cgm
          WHERE lecturer_id = ?
            AND id IN (SELECT MAX(id) FROM chat_group_messages WHERE lecturer_id = ? GROUP BY lecturer_id)
        ) last_msg ON last_msg.lecturer_id = l.id
        LEFT JOIN (
          SELECT cgm.lecturer_id, COUNT(*) as unread_count
          FROM chat_group_messages cgm
          LEFT JOIN chat_group_message_reads r ON r.message_id = cgm.id AND r.user_id = ?
          WHERE cgm.lecturer_id = ? AND cgm.sender_user_id != ? AND r.message_id IS NULL
          GROUP BY cgm.lecturer_id
        ) unread ON unread.lecturer_id = l.id
        WHERE l.id = ? AND COALESCE(student_counts.student_count, 0) > 0
      `,
      args: [Number(lecturer.id), Number(lecturer.id), Number(lecturer.id), Number(lecturer.id), user.id, Number(lecturer.id), user.id, Number(lecturer.id)],
    })).rows;
    return json([...groupRows, ...rows]);
  }

  const chatMessagesMatch = path.match(/^\/api\/chat\/threads\/(\d+)\/(\d+)\/messages$/);
  if (chatMessagesMatch && method === 'GET') {
    const studentUserId = Number(chatMessagesMatch[1]);
    const lecturerId = Number(chatMessagesMatch[2]);
    if (!(await canAccessChatThread(user, studentUserId, lecturerId))) return json({ error: 'Bạn không có quyền xem cuộc trò chuyện này.' }, 403);
    await database.execute({
      sql: `UPDATE chat_messages
            SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
            WHERE student_user_id = ? AND lecturer_id = ? AND sender_user_id != ? AND read_at IS NULL`,
      args: [studentUserId, lecturerId, user.id],
    });
    const rows = (await database.execute({
      sql: `SELECT cm.id, cm.student_user_id, cm.lecturer_id, cm.sender_user_id, cm.body, cm.created_at, cm.read_at,
                   u.name as sender_name, u.role as sender_role, u.email as sender_email
            FROM chat_messages cm
            JOIN users u ON u.id = cm.sender_user_id
            WHERE cm.student_user_id = ? AND cm.lecturer_id = ?
            ORDER BY cm.created_at ASC, cm.id ASC
            LIMIT 300`,
      args: [studentUserId, lecturerId],
    })).rows;
    return json(rows);
  }

  if (chatMessagesMatch && method === 'POST') {
    const studentUserId = Number(chatMessagesMatch[1]);
    const lecturerId = Number(chatMessagesMatch[2]);
    if (!(await canAccessChatThread(user, studentUserId, lecturerId))) return json({ error: 'Bạn không có quyền gửi tin nhắn trong cuộc trò chuyện này.' }, 403);
    const body = String((await readBody(request)).body || '').trim();
    if (!body) return json({ error: 'Vui lòng nhập nội dung tin nhắn.' }, 400);
    if (body.length > 2000) return json({ error: 'Tin nhắn tối đa 2000 ký tự.' }, 400);
    const result = await database.execute({
      sql: `INSERT INTO chat_messages (student_user_id, lecturer_id, sender_user_id, body, created_at)
            VALUES (?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [studentUserId, lecturerId, user.id, body],
    });
    const message = (await database.execute({
      sql: `SELECT cm.id, cm.student_user_id, cm.lecturer_id, cm.sender_user_id, cm.body, cm.created_at, cm.read_at,
                   u.name as sender_name, u.role as sender_role, u.email as sender_email
            FROM chat_messages cm
            JOIN users u ON u.id = cm.sender_user_id
            WHERE cm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    return json(message);
  }

  const chatGroupMessagesMatch = path.match(/^\/api\/chat\/groups\/(\d+)\/messages$/);
  if (chatGroupMessagesMatch && method === 'GET') {
    const lecturerId = Number(chatGroupMessagesMatch[1]);
    if (!(await canAccessChatGroup(user, lecturerId))) {
      return json({ error: 'Bạn không có quyền xem nhóm trao đổi này.' }, 403);
    }
    await database.execute({
      sql: `
        INSERT OR IGNORE INTO chat_group_message_reads (message_id, user_id, read_at)
        SELECT id, ?, datetime('now', '+7 hours')
        FROM chat_group_messages
        WHERE lecturer_id = ? AND sender_user_id != ?
      `,
      args: [user.id, lecturerId, user.id],
    });
    const rows = (await database.execute({
      sql: `${chatGroupMessageSelect}
            WHERE cgm.lecturer_id = ?
            ORDER BY cgm.created_at ASC, cgm.id ASC
            LIMIT 300`,
      args: [lecturerId],
    })).rows;
    return json(rows);
  }

  if (chatGroupMessagesMatch && method === 'POST') {
    const lecturerId = Number(chatGroupMessagesMatch[1]);
    if (!(await canAccessChatGroup(user, lecturerId))) {
      return json({ error: 'Bạn không có quyền gửi tin nhắn trong nhóm này.' }, 403);
    }
    const body = String((await readBody(request)).body || '').trim();
    if (!body) return json({ error: 'Vui lòng nhập nội dung tin nhắn.' }, 400);
    if (body.length > 2000) return json({ error: 'Tin nhắn tối đa 2000 ký tự.' }, 400);
    const result = await database.execute({
      sql: `INSERT INTO chat_group_messages (lecturer_id, sender_user_id, body, created_at)
            VALUES (?, ?, ?, datetime('now', '+7 hours'))`,
      args: [lecturerId, user.id, body],
    });
    const message = (await database.execute({
      sql: `${chatGroupMessageSelect} WHERE cgm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    return json(message);
  }

  const chatGroupAttachmentUploadMatch = path.match(/^\/api\/chat\/groups\/(\d+)\/attachments$/);
  if (chatGroupAttachmentUploadMatch && method === 'POST') {
    const lecturerId = Number(chatGroupAttachmentUploadMatch[1]);
    if (!(await canAccessChatGroup(user, lecturerId))) {
      return json({ error: 'Bạn không có quyền gửi file trong nhóm này.' }, 403);
    }
    if (!env.REPORTS_BUCKET) return json({ error: 'Chưa cấu hình lưu trữ file.' }, 500);
    const fileBytes = await request.arrayBuffer();
    if (!fileBytes || fileBytes.byteLength === 0) return json({ error: 'File rỗng.' }, 400);
    if (fileBytes.byteLength > 10 * 1024 * 1024) return json({ error: 'File vượt quá 10 MB.' }, 413);
    const filenameHeader = request.headers.get('x-filename') || 'attachment';
    let originalFilename = 'attachment';
    try { originalFilename = decodeURIComponent(filenameHeader); } catch { originalFilename = filenameHeader; }
    const rawMimeType = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const bodyHeader = request.headers.get('x-message-body') || '';
    let body = '';
    try { body = decodeURIComponent(bodyHeader); } catch { body = bodyHeader; }
    const stamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `chat-groups/${lecturerId}/${user.id}/${stamp}-${random}-${safeName}`;
    await env.REPORTS_BUCKET.put(key, fileBytes, {
      httpMetadata: { contentType: rawMimeType },
    });
    const result = await database.execute({
      sql: `INSERT INTO chat_group_messages (lecturer_id, sender_user_id, body, attachment_key, attachment_name, attachment_size, attachment_mime, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [lecturerId, user.id, body || '', key, originalFilename, fileBytes.byteLength, rawMimeType],
    });
    const message = (await database.execute({
      sql: `${chatGroupMessageSelect} WHERE cgm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    return json(message);
  }

  const chatGroupMessageAttachmentMatch = path.match(/^\/api\/chat\/group-messages\/(\d+)\/attachment$/);
  if (chatGroupMessageAttachmentMatch && method === 'GET') {
    const messageId = Number(chatGroupMessageAttachmentMatch[1]);
    const message = (await database.execute({
      sql: 'SELECT * FROM chat_group_messages WHERE id = ?',
      args: [messageId],
    })).rows[0] as any;
    if (!message || !message.attachment_key) return json({ error: 'Không tìm thấy file.' }, 404);
    if (!(await canAccessChatGroup(user, Number(message.lecturer_id)))) {
      return json({ error: 'Bạn không có quyền tải file này.' }, 403);
    }
    if (!env.REPORTS_BUCKET) return json({ error: 'Chưa cấu hình lưu trữ file.' }, 500);
    const object = await env.REPORTS_BUCKET.get(message.attachment_key);
    if (!object) return json({ error: 'Không tìm thấy file lưu trữ.' }, 404);
    const url = new URL(request.url);
    const preview = url.searchParams.get('preview') === '1';
    const mime = String(message.attachment_mime || 'application/octet-stream');
    const disposition = preview && (mime.startsWith('image/') || mime === 'application/pdf') ? 'inline' : 'attachment';
    return new Response(object.body, {
      headers: {
        'content-type': mime,
        'content-length': String(message.attachment_size || object.size),
        'content-disposition': `${disposition}; filename="${encodeURIComponent(message.attachment_name || 'attachment')}"`,
        'access-control-allow-origin': env.CORS_ORIGIN || '*',
        'access-control-allow-credentials': 'true',
      },
    });
  }

  const chatGroupMessageDeleteMatch = path.match(/^\/api\/chat\/group-messages\/(\d+)$/);
  if (chatGroupMessageDeleteMatch && method === 'DELETE') {
    const messageId = Number(chatGroupMessageDeleteMatch[1]);
    if (!Number.isInteger(messageId) || messageId <= 0) return json({ error: 'Tin nhắn không hợp lệ.' }, 400);
    const message = (await database.execute({
      sql: 'SELECT * FROM chat_group_messages WHERE id = ?',
      args: [messageId],
    })).rows[0] as any;
    if (!message) return json({ error: 'Không tìm thấy tin nhắn.' }, 404);
    if (user.role !== 'admin') {
      if (Number(message.sender_user_id) !== Number(user.id)) {
        return json({ error: 'Bạn chỉ có thể thu hồi tin nhắn do mình gửi.' }, 403);
      }
      if (!(await canAccessChatGroup(user, Number(message.lecturer_id)))) {
        return json({ error: 'Bạn không có quyền thu hồi tin nhắn này.' }, 403);
      }
    }
    if (message.attachment_key && env.REPORTS_BUCKET) {
      try { await env.REPORTS_BUCKET.delete(message.attachment_key); } catch {}
    }
    await database.batch([
      { sql: 'DELETE FROM chat_group_message_reads WHERE message_id = ?', args: [messageId] },
      { sql: 'DELETE FROM chat_group_messages WHERE id = ?', args: [messageId] },
    ]);
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/registrations/my') {
    requireRole(user, ['student']);
    const regs = (await database.execute({
      sql: `SELECT r.*, COALESCE(c.name, 'Không rõ/đã bị xoá') as company_name FROM registrations r LEFT JOIN companies c ON r.company_id = c.id WHERE r.user_id = ? ORDER BY COALESCE(r.preference_order, r.id) ASC, r.id ASC`,
      args: [user.id],
    })).rows;
    return json(regs);
  }

  if (method === 'GET' && path === '/api/internships/final/my') {
    requireRole(user, ['student']);
    const final = (await database.execute({
      sql: `SELECT f.*, c.name as company_name, r.other_company_name, r.other_company_role, r.other_company_contact
            FROM final_internships f
            LEFT JOIN companies c ON f.company_id = c.id
            LEFT JOIN registrations r ON f.registration_id = r.id
            WHERE f.user_id = ?`,
      args: [user.id],
    })).rows[0] || null;
    return json(final);
  }

  if (method === 'POST' && path === '/api/internships/final/confirm') {
    requireRole(user, ['student']);
    const body = await readBody(request);
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('confirmation_open_at', 'confirmation_close_at')")).rows);
    const now = new Date();
    if (settings.confirmation_open_at && now < new Date(settings.confirmation_open_at + ':00+07:00')) {
      return json({ error: 'Chưa đến thời gian xác nhận nơi thực tập.' }, 403);
    }
    if (settings.confirmation_close_at && now > new Date(settings.confirmation_close_at + ':00+07:00')) {
      return json({ error: 'Đã hết thời gian xác nhận nơi thực tập.' }, 403);
    }
    const existing = (await database.execute({ sql: 'SELECT * FROM final_internships WHERE user_id = ?', args: [user.id] })).rows[0] as any;
    if (existing?.locked_at) return json({ error: 'Nơi thực tập chính thức đã bị khóa. Vui lòng liên hệ Khoa nếu cần thay đổi.' }, 400);

    const type = body.internship_type === 'school' ? 'school' : 'company';
    const school = (await database.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
    if (type === 'school') {
      const assignedPrimaryLecturer = (await database.execute({
        sql: `SELECT l.* FROM advisor_assignments aa
              JOIN lecturers l ON l.id = aa.lecturer_id
              WHERE aa.user_id = ? AND aa.role = 'primary'
              ORDER BY aa.assigned_at DESC, aa.id DESC LIMIT 1`,
        args: [user.id],
      })).rows[0] as any;
      const requestAssignment = assignedPrimaryLecturer ? false : !!body.school_assignment_request;
      const lecturerName = assignedPrimaryLecturer?.name || String(body.school_lecturer || '').trim();
      let validLecturer: any = assignedPrimaryLecturer || null;
      if (!requestAssignment) {
        if (!lecturerName) return json({ error: 'Vui lòng chọn giảng viên hướng dẫn hoặc chọn Nhờ Khoa phân công.' }, 400);
        if (!validLecturer) validLecturer = (await database.execute({ sql: 'SELECT * FROM lecturers WHERE name = ?', args: [lecturerName] })).rows[0] as any;
        if (!validLecturer) return json({ error: 'Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' }, 400);
        if (isBachelorLecturer(validLecturer.name)) return json({ error: 'Giảng viên CN không được làm hướng dẫn chính. Vui lòng chọn giảng viên khác hoặc nhờ Khoa phân công.' }, 400);
        const quotaRow = (await database.execute({ sql: 'SELECT max_total_students FROM lecturer_quotas WHERE lecturer_id = ?', args: [Number(validLecturer.id)] })).rows[0] as any;
        const maxTotal = quotaRow != null && quotaRow.max_total_students != null ? Number(quotaRow.max_total_students) : lecturerDefaultQuota(validLecturer.name);
        const current = (await database.execute({ sql: 'SELECT COUNT(*) as count FROM advisor_assignments WHERE lecturer_id = ?', args: [Number(validLecturer.id)] })).rows[0] as any;
        const already = (await database.execute({ sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? AND role = ?', args: [user.id, Number(validLecturer.id), 'primary'] })).rows[0];
        if (!already && Number(current?.count || 0) >= maxTotal) return json({ error: `Giảng viên đã đủ chỉ tiêu ${maxTotal} sinh viên. Vui lòng chọn giảng viên khác hoặc nhờ Khoa phân công.` }, 400);
      }
      await database.execute({
        sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
              VALUES (?, NULL, ?, 'school', 'confirmed', 1, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))
              ON CONFLICT(user_id) DO UPDATE SET registration_id = NULL, company_id = excluded.company_id, internship_type = 'school',
                status = 'confirmed', student_attested = 1, attestation_text = excluded.attestation_text, school_lecturer = excluded.school_lecturer,
                school_assignment_request = excluded.school_assignment_request, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
        args: [
          user.id,
          school?.id || null,
          requestAssignment
            ? 'Tôi xác nhận chưa trúng tuyển công ty nào và nhờ Khoa phân công giảng viên hướng dẫn thực tập tại trường.'
            : 'Tôi xác nhận đã được giảng viên đồng ý hướng dẫn thực tập tại trường.',
          requestAssignment ? null : lecturerName,
          requestAssignment ? 1 : 0,
          user.id,
          body.note || null,
        ],
      });
      if (!assignedPrimaryLecturer && !requestAssignment && validLecturer) {
        try {
          const result = await database.execute({
            sql: `INSERT INTO advisor_assignments (user_id, lecturer_id, role, assigned_by, note, assigned_at)
                  VALUES (?, ?, 'primary', ?, 'Sinh viên xác nhận GVHD thực tập tại trường', datetime('now', '+7 hours'))`,
            args: [user.id, Number(validLecturer.id), user.id],
          });
          await database.execute({
            sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
                  VALUES (?, ?, ?, 'primary', 'student_created', ?, 'Sinh viên xác nhận GVHD thực tập tại trường', datetime('now', '+7 hours'))`,
            args: [Number(result.lastInsertRowid), user.id, Number(validLecturer.id), user.id],
          });
        } catch (e) { }
      }
      await notify({
        user_id: user.id,
        recipient_email: user.personal_email || user.email,
        type: 'final_internship_confirmed',
        subject: 'Bạn đã xác nhận nơi thực tập chính thức',
        body: `Hệ thống đã ghi nhận nơi thực tập chính thức của bạn: Thực tập tại trường.${requestAssignment ? '\nBạn đã chọn nhờ Khoa phân công GVHD.' : `\nGVHD đăng ký: ${lecturerName}.`}`,
      });
      return json({ success: true });
    }

    const registrationId = Number(body.registration_id);
    if (!registrationId) return json({ error: 'Vui lòng chọn nơi thực tập cần xác nhận.' }, 400);
    if (!body.attested) return json({ error: 'Vui lòng xác nhận cam kết đã được đơn vị tiếp nhận thực tập.' }, 400);
    const reg = (await database.execute({
      sql: `SELECT r.*, c.name as company_name
            FROM registrations r JOIN companies c ON r.company_id = c.id
            WHERE r.id = ? AND r.user_id = ?`,
      args: [registrationId, user.id],
    })).rows[0] as any;
    if (!reg) return json({ error: 'Không tìm thấy đăng ký này.' }, 404);
    if (reg.status !== 'approved') return json({ error: 'Bạn chỉ có thể xác nhận nơi thực tập đã được Khoa duyệt.' }, 400);
    if (reg.company_name === 'Trường Đại học Công nghệ') return json({ error: 'Vui lòng chọn hình thức thực tập tại trường.' }, 400);
    await database.execute({
      sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_assignment_request, confirmed_by, note, confirmed_at)
            VALUES (?, ?, ?, 'company', 'confirmed', 1, ?, 0, ?, ?, datetime('now', '+7 hours'))
            ON CONFLICT(user_id) DO UPDATE SET registration_id = excluded.registration_id, company_id = excluded.company_id, internship_type = 'company',
              status = 'confirmed', student_attested = 1, attestation_text = excluded.attestation_text, school_lecturer = NULL,
              school_assignment_request = 0, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
      args: [user.id, registrationId, reg.company_id, 'Tôi xác nhận đã được đơn vị này tiếp nhận thực tập và chịu trách nhiệm về thông tin khai báo.', user.id, body.note || null],
    });
    await notify({
      user_id: user.id,
      recipient_email: user.personal_email || user.email,
      type: 'final_internship_confirmed',
      subject: 'Bạn đã xác nhận nơi thực tập chính thức',
      body: `Hệ thống đã ghi nhận nơi thực tập chính thức của bạn: ${reg.company_name === 'Công ty khác' ? reg.other_company_name || 'Công ty khác' : reg.company_name}.`,
    });
    return json({ success: true });
  }

  if (method === 'DELETE' && path === '/api/registrations/my') {
    requireRole(user, ['student']);
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('registration_open_at', 'registration_close_at')")).rows);
    const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
    if (!windowStatus.ok) return json({ error: 'Chỉ được hủy đăng ký trong thời gian Khoa mở đăng ký.' }, 403);
    await executeBatch(database, [
      { sql: 'DELETE FROM final_internships WHERE user_id = ? AND locked_at IS NULL', args: [user.id] },
      { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [user.id] },
    ]);
    return json({ success: true });
  }

  const regDeleteMatch = path.match(/^\/api\/registrations\/(\d+)$/);
  if (method === 'DELETE' && regDeleteMatch) {
    requireRole(user, ['student']);
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('registration_open_at', 'registration_close_at')")).rows);
    const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
    if (!windowStatus.ok) return json({ error: 'Chỉ được hủy đăng ký trong thời gian Khoa mở đăng ký.' }, 403);
    await executeBatch(database, [
      { sql: 'DELETE FROM final_internships WHERE registration_id = ? AND user_id = ? AND locked_at IS NULL', args: [regDeleteMatch[1], user.id] },
      { sql: 'DELETE FROM registrations WHERE id = ? AND user_id = ?', args: [regDeleteMatch[1], user.id] },
    ]);
    return json({ success: true });
  }

  if (method === 'POST' && path === '/api/registrations') {
    requireRole(user, ['student']);
    const body = await readBody(request);
    await assertStudentCohortAllowed(database, user.email);
    const profile = {
      student_id: body.student_id || user.student_id || null,
      dob: body.dob || user.dob || null,
      class_name: body.class_name || user.class_name || null,
      course_code: body.course_code || user.course_code || null,
      phone: body.phone || user.phone || null,
      personal_email: body.personal_email || user.personal_email || null,
    };
    if (!profile.student_id || !profile.dob || !profile.class_name || !profile.course_code || !profile.phone || !profile.personal_email) {
      return json({ error: 'Vui lòng cập nhật đầy đủ thông tin trước khi đăng ký.' }, 400);
    }
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('registration_open_at', 'registration_close_at')")).rows);
    const now = new Date();
    if (settings.registration_open_at && now < new Date(settings.registration_open_at + ':00+07:00')) return json({ error: 'Chưa đến giờ đăng ký.' }, 403);
    if (settings.registration_close_at && now > new Date(settings.registration_close_at + ':00+07:00')) return json({ error: 'Đã hết thời gian đăng ký.' }, 403);

    const khac = (await database.execute("SELECT id FROM companies WHERE name = 'Công ty khác'")).rows[0] as any;
    const school = (await database.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
    const fallbackCompanyIds = Array.isArray(body.company_ids)
      ? Array.from(new Set(body.company_ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id !== khac?.id)))
      : [];
    const fallbackOtherCompanies = Array.isArray(body.other_companies) ? body.other_companies : [];
    const rawPreferences = Array.isArray(body.preferences) ? body.preferences : [];
    const orderedPreferences = rawPreferences.length > 0
      ? rawPreferences.flatMap((item: any) => {
        if (item?.type === 'other') return [{ type: 'other', name: item.name, role: item.role, contact: item.contact, note: item.note }];
        const companyId = Number(item?.company_id);
        if (!Number.isFinite(companyId) || companyId === khac?.id) return [];
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
    const companyIds = dedupedPreferences.filter((item: any) => item.type === 'company').map((item: any) => item.company_id);
    const otherCompanies = dedupedPreferences.filter((item: any) => item.type === 'other');
    const total = dedupedPreferences.length;
    if (total === 0) return json({ error: 'Vui lòng chọn ít nhất 1 nơi thực tập.' }, 400);
    if (total > 5) return json({ error: 'Bạn chỉ được chọn tối đa 5 nơi thực tập.' }, 400);
    const schoolLecturerName = String(body.school_lecturer || '').trim();
    const schoolCoLecturerName = String(body.school_co_lecturer || '').trim();
    if (school && companyIds.includes(school.id)) {
      if (!schoolLecturerName) return json({ error: 'Vui lòng chọn giảng viên hướng dẫn.' }, 400);
      const validLecturer = (await database.execute({ sql: "SELECT id FROM lecturers WHERE name = ?", args: [schoolLecturerName] })).rows[0];
      if (!validLecturer) return json({ error: 'Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' }, 400);
      if (schoolCoLecturerName) {
        if (schoolCoLecturerName === schoolLecturerName) return json({ error: 'Giảng viên đồng hướng dẫn không được trùng với giảng viên hướng dẫn chính.' }, 400);
        const validCoLecturer = (await database.execute({ sql: "SELECT id FROM lecturers WHERE name = ?", args: [schoolCoLecturerName] })).rows[0];
        if (!validCoLecturer) return json({ error: 'Giảng viên đồng hướng dẫn không hợp lệ. Vui lòng chọn trong danh sách.' }, 400);
      }
    }

    const insertSql = "INSERT INTO registrations (user_id, company_id, note, status, other_company_name, other_company_role, other_company_contact, preference_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))";
    const statements: any[] = [
      { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [user.id] },
      { sql: 'UPDATE users SET student_id = ?, dob = ?, class_name = ?, course_code = ?, phone = ?, personal_email = ? WHERE id = ?', args: [profile.student_id, profile.dob, profile.class_name, profile.course_code, profile.phone, profile.personal_email, user.id] },
    ];
    let preferenceOrder = 1;
    const approvedNameRows = otherCompanies.length > 0
      ? (await database.execute('SELECT normalized_name FROM approved_company_names')).rows
      : [];
    const approvedNames = new Set(approvedNameRows.map((row: any) => String(row.normalized_name || '').trim()).filter(Boolean));
    for (const preference of dedupedPreferences) {
      if (preference.type === 'company') {
        const companyId = preference.company_id;
        statements.push({
          sql: insertSql,
          args: [
            user.id,
            companyId,
            body.note || null,
            'approved',
            null,
            companyId === school?.id ? schoolCoLecturerName || null : null,
            companyId === school?.id ? schoolLecturerName : null,
            preferenceOrder,
          ],
        });
        preferenceOrder += 1;
      } else {
        const other = preference;
        if (!other.name || !other.role || !other.contact) return json({ error: 'Vui lòng cung cấp đầy đủ thông tin các công ty ngoài danh sách.' }, 400);
        const status = approvedNames.has(normalizeCompanyName(other.name)) ? 'approved' : 'pending';
        statements.push({ sql: insertSql, args: [user.id, khac.id, String(other.note || '').trim() || body.note || null, status, other.name, other.role, other.contact, preferenceOrder] });
        preferenceOrder += 1;
      }
    }
    await executeBatch(database, statements);
    const updatedUser = (await database.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.id] })).rows[0];
    return json({ success: true, user: updatedUser });
  }

  if (method === 'GET' && path === '/api/advisor/my') {
    requireRole(user, ['student']);
    const rows = (await database.execute({
      sql: `SELECT aa.*, l.name as lecturer_name, l.email as lecturer_email
            FROM advisor_assignments aa
            JOIN lecturers l ON l.id = aa.lecturer_id
            WHERE aa.user_id = ?
            ORDER BY CASE aa.role WHEN 'primary' THEN 0 ELSE 1 END, l.name ASC`,
      args: [user.id],
    })).rows;
    return json(rows);
  }

  if (method === 'GET' && path === '/api/lecturer/students') {
    requireRole(user, ['lecturer', 'admin']);
    const lecturer = (await database.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [user.email, user.name] })).rows[0] as any;
    if (!lecturer) return json([]);
    const rows = (await database.execute({
      sql: `SELECT aa.id as assignment_id, aa.user_id, aa.lecturer_id, aa.role as advisor_role, aa.assigned_at, aa.note as assignment_note,
                   u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
                   f.internship_type, f.confirmed_at,
                   CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
                   r.other_company_role, r.other_company_contact,
                   fr.status as report_status, fr.original_filename as report_filename, fr.file_size as report_file_size, fr.submitted_at as report_submitted_at,
                   g.status as grade_status, g.final_score, g.progress_score, g.report_score, g.company_score, g.comment as grade_comment, g.locked_at as grade_locked_at
            FROM advisor_assignments aa
            JOIN users u ON u.id = aa.user_id
            LEFT JOIN final_internships f ON f.user_id = aa.user_id
            LEFT JOIN companies c ON c.id = f.company_id
            LEFT JOIN registrations r ON r.id = f.registration_id
            LEFT JOIN final_reports fr ON fr.user_id = aa.user_id
            LEFT JOIN grades g ON g.user_id = aa.user_id
            WHERE aa.lecturer_id = ?
            ORDER BY u.student_id ASC`,
      args: [Number(lecturer.id)],
    })).rows;
    return json(rows);
  }

  async function canAccessStudentReport(actor: any, userId: number) {
    if (actor.role === 'admin') return true;
    if (actor.role === 'student' && Number(actor.id) === Number(userId)) return true;
    if (actor.role !== 'lecturer') return false;
    const lecturer = (await database.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [actor.email, actor.name] })).rows[0] as any;
    if (!lecturer) return false;
    const assignment = (await database.execute({
      sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1',
      args: [userId, Number(lecturer.id)],
    })).rows[0];
    return !!assignment;
  }

  if (method === 'GET' && path === '/api/reports/final/my') {
    requireRole(user, ['student']);
    const report = (await database.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [user.id] })).rows[0] || null;
    return json(report);
  }

  if (method === 'POST' && path === '/api/reports/final') {
    requireRole(user, ['student']);
    if (!env.REPORTS_BUCKET) return json({ error: 'Chưa cấu hình R2 REPORTS_BUCKET.' }, 500);
    const final = (await database.execute({ sql: 'SELECT id FROM final_internships WHERE user_id = ?', args: [user.id] })).rows[0];
    if (!final) return json({ error: 'Bạn cần xác nhận nơi thực tập chính thức trước khi nộp báo cáo.' }, 400);
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('campaign_year', 'final_report_open_at', 'final_report_close_at')")).rows);
    const windowStatus = isWithinLocalWindow(settings, 'final_report_open_at', 'final_report_close_at');
    if (!windowStatus.ok) return json({ error: windowStatus.error }, 403);
    const contentType = request.headers.get('content-type') || '';
    const filename = decodeURIComponent(String(request.headers.get('x-filename') || 'final.pdf')).trim();
    if (!contentType.includes('application/pdf') || !filename.toLowerCase().endsWith('.pdf')) return json({ error: 'Chỉ chấp nhận file PDF.' }, 400);
    const sizeHeader = Number(request.headers.get('content-length') || 0);
    if (sizeHeader > MAX_REPORT_BYTES) return json({ error: 'File PDF vượt quá 10 MB. Vui lòng nén lại trước khi nộp.' }, 413);
    const file = await request.arrayBuffer();
    if (file.byteLength === 0) return json({ error: 'File rỗng.' }, 400);
    if (file.byteLength > MAX_REPORT_BYTES) return json({ error: 'File PDF vượt quá 10 MB. Vui lòng nén lại trước khi nộp.' }, 413);
    const header = new TextDecoder().decode(file.slice(0, 4));
    if (header !== '%PDF') return json({ error: 'Nội dung file không phải PDF hợp lệ.' }, 400);
    const key = reportObjectKey(settings.campaign_year, user.student_id || user.email);
    await env.REPORTS_BUCKET.put(key, file, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { original_filename: filename, user_id: String(user.id) },
    });
    await database.execute({
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
      args: [user.id, key, filename, file.byteLength],
    });
    const report = (await database.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [user.id] })).rows[0];
    await notify({
      user_id: user.id,
      recipient_email: user.personal_email || user.email,
      type: 'final_report_status_changed',
      subject: 'Hệ thống đã ghi nhận báo cáo',
      body: `Hệ thống đã ghi nhận file báo cáo: ${filename}. Dung lượng: ${Math.round(file.byteLength / 1024)} KB.`,
    });
    return json(report);
  }

  const reportDownload = path.match(/^\/api\/reports\/final\/(\d+)\/download$/);
  if (reportDownload && method === 'GET') {
    const userId = Number(reportDownload[1]);
    if (!(await canAccessStudentReport(user, userId))) return json({ error: 'Forbidden' }, 403);
    const report = (await database.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [userId] })).rows[0] as any;
    if (!report) return json({ error: 'Chưa có báo cáo.' }, 404);
    if (!env.REPORTS_BUCKET) return json({ error: 'Chưa cấu hình R2 REPORTS_BUCKET.' }, 500);
    const object = await env.REPORTS_BUCKET.get(report.object_key);
    if (!object) return json({ error: 'Không tìm thấy file báo cáo.' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${encodeURIComponent(report.original_filename)}"`,
      },
    });
  }

  const reportView = path.match(/^\/api\/reports\/final\/(\d+)\/view$/);
  if (reportView && method === 'GET') {
    const userId = Number(reportView[1]);
    if (!(await canAccessStudentReport(user, userId))) return json({ error: 'Forbidden' }, 403);
    const report = (await database.execute({ sql: 'SELECT * FROM final_reports WHERE user_id = ?', args: [userId] })).rows[0] as any;
    if (!report) return json({ error: 'Chưa có báo cáo.' }, 404);
    if (!env.REPORTS_BUCKET) return json({ error: 'Chưa cấu hình R2 REPORTS_BUCKET.' }, 500);
    const object = await env.REPORTS_BUCKET.get(report.object_key);
    if (!object) return json({ error: 'Không tìm thấy file báo cáo.' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${encodeURIComponent(report.original_filename)}"`,
        'cache-control': 'private, no-cache',
      },
    });
  }

  const reportStatus = path.match(/^\/api\/reports\/final\/(\d+)\/status$/);
  if (reportStatus && method === 'PUT') {
    requireRole(user, ['lecturer', 'admin']);
    const userId = Number(reportStatus[1]);
    if (!(await canAccessStudentReport(user, userId))) return json({ error: 'Forbidden' }, 403);
    const body = await readBody(request);
    const status = String(body.status || '');
    if (!['submitted', 'accepted', 'needs_revision'].includes(status)) return json({ error: 'Trạng thái không hợp lệ.' }, 400);
    await database.execute({
      sql: `UPDATE final_reports SET status = ?, lecturer_comment = ?, updated_at = datetime('now', '+7 hours') WHERE user_id = ?`,
      args: [status, body.lecturer_comment || null, userId],
    });
    const student = (await database.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
    await notify({
      user_id: userId,
      recipient_email: student?.personal_email || student?.email,
      type: 'final_report_status_changed',
      subject: 'Cập nhật trạng thái báo cáo',
      body: `Báo cáo của bạn đã được cập nhật trạng thái: ${status === 'accepted' ? 'Đã chấp nhận' : status === 'needs_revision' ? 'Cần nộp lại' : 'Đã nộp'}.${body.lecturer_comment ? `\nGhi chú: ${body.lecturer_comment}` : ''}`,
    });
    return json({ success: true });
  }

  async function getPrimaryLecturerForUser(actor: any, userId: number) {
    const lecturer = (await database.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [actor.email, actor.name] })).rows[0] as any;
    if (actor.role === 'admin') {
      return lecturer ? Number(lecturer.id) : 1;
    }
    if (!lecturer) return null;
    const assignment = (await database.execute({
      sql: "SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? LIMIT 1",
      args: [userId, Number(lecturer.id)],
    })).rows[0];
    return assignment ? Number(lecturer.id) : null;
  }

  async function saveGradeForStudent(userId: number, lecturerId: number, body: any, submit = false) {
    const existing = (await database.execute({ sql: 'SELECT * FROM grades WHERE user_id = ?', args: [userId] })).rows[0] as any;
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
    await database.execute({
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
      await database.execute({
        sql: `UPDATE final_reports 
              SET status = 'accepted', updated_at = datetime('now', '+7 hours') 
              WHERE user_id = ? AND (status IS NULL OR status != 'accepted')`,
        args: [userId],
      });
    }
    return { row: (await database.execute({ sql: 'SELECT * FROM grades WHERE user_id = ?', args: [userId] })).rows[0] };
  }

  if (method === 'GET' && path === '/api/lecturer/grades') {
    requireRole(user, ['lecturer', 'admin']);
    const lecturer = (await database.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [user.email, user.name] })).rows[0] as any;
    if (!lecturer) return json([]);
    const rows = (await database.execute({
      sql: `SELECT aa.user_id, aa.role as advisor_role, u.student_id, u.name as student_name, u.email, u.class_name, u.course_code,
                   CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
                   fr.status as report_status, fr.original_filename, fr.file_size, fr.submitted_at as report_submitted_at,
                   g.progress_score, g.report_score, g.company_score, g.final_score, g.status as grade_status,
                   g.comment, g.submitted_at as grade_submitted_at, g.locked_at
            FROM advisor_assignments aa
            JOIN users u ON u.id = aa.user_id
            LEFT JOIN final_internships f ON f.user_id = aa.user_id
            LEFT JOIN companies c ON c.id = f.company_id
            LEFT JOIN registrations r ON r.id = f.registration_id
            LEFT JOIN final_reports fr ON fr.user_id = aa.user_id
            LEFT JOIN grades g ON g.user_id = aa.user_id
            WHERE aa.lecturer_id = ?
            ORDER BY u.student_id ASC`,
      args: [Number(lecturer.id)],
    })).rows;
    return json(rows);
  }

  const lecturerGrade = path.match(/^\/api\/lecturer\/grades\/(\d+)$/);
  if (lecturerGrade && method === 'GET') {
    requireRole(user, ['lecturer', 'admin']);
    const targetUserId = Number(lecturerGrade[1]);
    const lecturer = (await database.execute({ sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1', args: [user.email, user.name] })).rows[0] as any;
    if (!lecturer && user.role !== 'admin') return json(null);
    const row = (await database.execute({
      sql: `SELECT g.* FROM grades g
            JOIN advisor_assignments aa ON aa.user_id = g.user_id
            WHERE g.user_id = ? AND (aa.lecturer_id = ? OR ? = 'admin')
            LIMIT 1`,
      args: [targetUserId, lecturer ? Number(lecturer.id) : 0, user.role],
    })).rows[0] || null;
    return json(row);
  }
  if (lecturerGrade && method === 'PUT') {
    requireRole(user, ['lecturer', 'admin']);
    const body = await readBody(request);
    const userId = Number(lecturerGrade[1]);
    let lecturerId = await getPrimaryLecturerForUser(user, userId);
    if (user.role === 'admin' && body.lecturer_id) lecturerId = Number(body.lecturer_id);
    if (!lecturerId) return json({ error: 'Chỉ GVHD chính được nhập điểm cho sinh viên này.' }, 403);
    const result = await saveGradeForStudent(userId, lecturerId, body, false);
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json(result.row);
  }

  const lecturerGradeSubmit = path.match(/^\/api\/lecturer\/grades\/(\d+)\/submit$/);
  if (lecturerGradeSubmit && method === 'POST') {
    requireRole(user, ['lecturer', 'admin']);
    const body = await readBody(request);
    const userId = Number(lecturerGradeSubmit[1]);
    let lecturerId = await getPrimaryLecturerForUser(user, userId);
    if (user.role === 'admin' && body.lecturer_id) lecturerId = Number(body.lecturer_id);
    if (!lecturerId) return json({ error: 'Chỉ GVHD chính được nộp điểm cho sinh viên này.' }, 403);
    const result = await saveGradeForStudent(userId, lecturerId, body, true);
    if (result.error) return json({ error: result.error }, result.status || 400);
    const student = (await database.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
    await notify({
      user_id: userId,
      recipient_email: student?.personal_email || student?.email,
      type: 'grade_submitted',
      subject: 'GVHD đã nộp điểm thực tập',
      body: `GVHD đã nộp điểm thực tập của bạn về Khoa. Điểm tổng kết tạm tính: ${result.row?.final_score ?? '-'}.`,
    });
    return json(result.row);
  }

  if (method === 'POST' && path === '/api/cron/process-email-queue') {
    const expectedSecret = env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!expectedSecret) return json({ error: 'Chưa cấu hình CRON_SECRET.' }, 500);
    if (providedSecret !== expectedSecret) return json({ error: 'Forbidden' }, 403);

    try {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
        return json({ success: true, skipped: true, message: 'Bỏ qua vì chưa cấu hình RESEND_API_KEY hoặc EMAIL_FROM.' });
      }
      const result = await sendQueuedNotificationBatch(database, env, { ignoreBatchSize: true });
      return json({ success: true, skipped: false, message: 'Đã tự động xử lý hàng đợi email theo quota ngày.', ...result });
    } catch (error: any) {
      return json({ error: 'Lỗi cron tự động xử lý hàng đợi email: ' + (error?.message || error) }, 500);
    }
  }

  if (path.startsWith('/api/admin/')) requireRole(user, ['admin']);

  if (method === 'POST' && path === '/api/admin/migrations/turso-to-d1') {
    const body = await readBody(request);
    try {
      return json(await migrateTursoToD1(env, database, {
        dryRun: Boolean(body.dry_run),
        truncateOnly: Boolean(body.truncate_only),
        table: body.table ? String(body.table) : undefined,
        offset: Number(body.offset || 0),
        limit: Number(body.limit || DB_BATCH_SIZE),
        truncate: body.truncate !== false,
      }));
    } catch (e: any) {
      return json({ error: e?.message || 'Migration failed' }, 500);
    }
  }

  if (method === 'GET' && path === '/api/admin/approved-companies') {
    const rows = (await database.execute('SELECT * FROM approved_company_names ORDER BY name ASC')).rows;
    return json(rows);
  }

  if (method === 'POST' && path === '/api/admin/approved-companies/import') {
    const body = await readBody(request);
    const items = Array.isArray(body.companies) ? body.companies : [];
    const statements = items.map((item: any) => {
      const name = typeof item === 'string' ? item.trim() : String(item?.name || '').trim();
      const normalized = normalizeCompanyName(name);
      if (!name || !normalized) return null;
      return {
        sql: `INSERT INTO approved_company_names (name, normalized_name, source)
              VALUES (?, ?, ?)
              ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name, source = excluded.source`,
        args: [name, normalized, body.source || 'manual'],
      };
    }).filter(Boolean);
    if (body.override) await database.execute('DELETE FROM approved_company_names');
    await executeBatch(database, statements);
    return json({ success: true, count: statements.length });
  }

  if (method === 'POST' && path === '/api/admin/approved-companies') {
    const body = await readBody(request);
    const name = String(body.name || '').trim();
    const normalized = normalizeCompanyName(name);
    if (!name || !normalized) return json({ error: 'Tên công ty không được để trống.' }, 400);
    try {
      const result = await database.execute({
        sql: `INSERT INTO approved_company_names (name, normalized_name, source) VALUES (?, ?, ?)`,
        args: [name, normalized, body.source || 'manual'],
      });
      const row = (await database.execute({ sql: 'SELECT * FROM approved_company_names WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0];
      return json(row);
    } catch (e) {
      return json({ error: 'Công ty này đã có trong danh sách thẩm định.' }, 400);
    }
  }

  const approvedCompanyAdmin = path.match(/^\/api\/admin\/approved-companies\/(\d+)$/);
  if (approvedCompanyAdmin && method === 'PUT') {
    const body = await readBody(request);
    const name = String(body.name || '').trim();
    const normalized = normalizeCompanyName(name);
    if (!name || !normalized) return json({ error: 'Tên công ty không được để trống.' }, 400);
    try {
      await database.execute({
        sql: `UPDATE approved_company_names SET name = ?, normalized_name = ?, source = ? WHERE id = ?`,
        args: [name, normalized, body.source || 'manual', Number(approvedCompanyAdmin[1])],
      });
      return json({ success: true });
    } catch (e) {
      return json({ error: 'Tên công ty bị trùng với một mục đã có.' }, 400);
    }
  }

  if (approvedCompanyAdmin && method === 'DELETE') {
    await database.execute({ sql: 'DELETE FROM approved_company_names WHERE id = ?', args: [Number(approvedCompanyAdmin[1])] });
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/admin/dashboard-stats') {
    requireRole(user, ['admin']);
    const stats = (await database.execute(`
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM (SELECT user_id FROM registrations UNION SELECT user_id FROM final_internships)) AS registeredCount,
        (SELECT COUNT(DISTINCT user_id) FROM final_internships) AS confirmedCount,
        (SELECT COUNT(DISTINCT user_id) FROM final_reports WHERE status = 'submitted' OR object_key IS NOT NULL) AS reportCount,
        (SELECT COUNT(DISTINCT user_id)
           FROM grades
          WHERE status IN ('submitted', 'draft') OR final_score IS NOT NULL) AS gradedCount
    `)).rows[0] as any;
    return json({
      registeredCount: Number(stats?.registeredCount || 0),
      confirmedCount: Number(stats?.confirmedCount || 0),
      reportCount: Number(stats?.reportCount || 0),
      gradedCount: Number(stats?.gradedCount || 0),
    });
  }

  if (method === 'GET' && path === '/api/admin/students') {
    return json((await database.execute("SELECT id, email, name, student_id, dob, class_name, phone, personal_email FROM users WHERE role = 'student' ORDER BY student_id ASC")).rows);
  }

  if (method === 'POST' && path === '/api/admin/students/bulk') {
    const body = await readBody(request);
    const students = Array.isArray(body.students) ? body.students : [];
    const statements = students.filter((s: any) => s.student_id && s.name).map((s: any) => {
      const email = `${s.student_id}@vnu.edu.vn`;
      return body.override
        ? { sql: `INSERT INTO users (email, name, role, student_id, dob, class_name) VALUES (?, ?, 'student', ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name=excluded.name, dob=excluded.dob, class_name=excluded.class_name, student_id=excluded.student_id`, args: [email, s.name, s.student_id, s.dob || '', s.class_name || ''] }
        : { sql: `INSERT OR IGNORE INTO users (email, name, role, student_id, dob, class_name) VALUES (?, ?, 'student', ?, ?, ?)`, args: [email, s.name, s.student_id, s.dob || '', s.class_name || ''] };
    });
    await executeBatch(database, statements);
    return json({ success: true, count: statements.length });
  }

  if (method === 'POST' && path === '/api/admin/students') {
    const body = await readBody(request);
    if (!body.student_id || !body.name) return json({ error: 'Mã SV và Họ tên là bắt buộc' }, 400);
    await database.execute({
      sql: `INSERT INTO users (email, name, role, student_id, dob, class_name, phone, personal_email)
            VALUES (?, ?, 'student', ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
            name=excluded.name, dob=excluded.dob, class_name=excluded.class_name, student_id=excluded.student_id,
            phone=excluded.phone, personal_email=excluded.personal_email`,
      args: [`${body.student_id}@vnu.edu.vn`, body.name, body.student_id, body.dob || '', body.class_name || '', body.phone || '', body.personal_email || '']
    });
    return json({ success: true });
  }

  const studentDelete = path.match(/^\/api\/admin\/students\/([^/]+)$/);
  if (method === 'PUT' && studentDelete) {
    try {
      const selector = decodeURIComponent(studentDelete[1] || '').trim();
      if (!selector) return json({ error: 'Thiếu mã sinh viên cần sửa.' }, 400);

      const isUserIdSelector = selector.startsWith('user:');
      const userId = isUserIdSelector ? Number(selector.slice(5)) : null;
      if (isUserIdSelector && (!Number.isInteger(userId) || userId <= 0)) {
        return json({ error: 'Mã định danh sinh viên không hợp lệ.' }, 400);
      }

      const current = (await database.execute({
        sql: isUserIdSelector
          ? "SELECT id FROM users WHERE id = ? AND role = 'student'"
          : "SELECT id FROM users WHERE student_id = ? AND role = 'student'",
        args: [isUserIdSelector ? userId : selector],
      })).rows[0] as any;
      if (!current) return json({ error: 'Không tìm thấy sinh viên.' }, 404);

      const body = await readBody(request);
      const studentId = String(body.student_id || '').trim();
      const name = String(body.name || '').trim();
      const dob = String(body.dob || '').trim();
      const className = String(body.class_name || '').trim();
      const phone = String(body.phone || '').trim();
      const personalEmail = String(body.personal_email || '').trim();

      if (!studentId || !name) return json({ error: 'Mã SV và Họ tên là bắt buộc.' }, 400);
      if (!/^\d{8}$/.test(studentId)) return json({ error: 'Mã SV phải gồm 8 chữ số.' }, 400);
      if (phone) {
        const cleanPhone = phone.replace(/[\s\-\.]/g, '');
        if (!/^(0|\+84)[35789]\d{8}$/.test(cleanPhone)) {
          return json({ error: 'Số điện thoại cá nhân không hợp lệ (phải bắt đầu bằng 0 hoặc +84 và có 10 chữ số).' }, 400);
        }
      }
      if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
        return json({ error: 'Email cá nhân không hợp lệ.' }, 400);
      }

      await database.execute({
        sql: `UPDATE users
              SET email = ?, name = ?, student_id = ?, dob = ?, class_name = ?, phone = ?, personal_email = ?
              WHERE id = ? AND role = 'student'`,
        args: [`${studentId}@vnu.edu.vn`, name, studentId, dob || '', className || '', phone || '', personalEmail || '', current.id],
      });
      return json({ success: true });
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('unique')) return json({ error: 'Mã SV hoặc email VNU đã tồn tại ở tài khoản khác.' }, 400);
      return json({ error: 'Database error: ' + message }, 500);
    }
  }

  if (method === 'DELETE' && studentDelete) {
    const selector = decodeURIComponent(studentDelete[1] || '').trim();
    if (!selector) return json({ error: 'Thiếu mã sinh viên cần xoá.' }, 400);

    const isUserIdSelector = selector.startsWith('user:');
    const userId = isUserIdSelector ? Number(selector.slice(5)) : null;
    if (isUserIdSelector && (!Number.isInteger(userId) || userId <= 0)) {
      return json({ error: 'Mã định danh sinh viên không hợp lệ.' }, 400);
    }

    const student = (await database.execute({
      sql: isUserIdSelector
        ? "SELECT id, email, student_id FROM users WHERE id = ? AND role = 'student'"
        : "SELECT id, email, student_id FROM users WHERE student_id = ? AND role = 'student'",
      args: [isUserIdSelector ? userId : selector],
    })).rows[0] as any;
    if (student) await executeBatch(database, [
      { sql: 'DELETE FROM advisor_assignment_history WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM final_reports WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM grades WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM chat_messages WHERE student_user_id = ? OR sender_user_id = ?', args: [student.id, student.id] },
      { sql: 'DELETE FROM notifications WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM final_internships WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM registrations WHERE user_id = ?', args: [student.id] },
      { sql: 'DELETE FROM users WHERE id = ?', args: [student.id] },
    ]);
    const studentId = student?.student_id || (!isUserIdSelector ? selector : '');
    const deletedLegacyStudent = studentId
      ? await deleteLegacyStudentRow(database, studentId, student?.email || `${studentId}@vnu.edu.vn`)
      : false;
    return json({ success: true, deleted_user: Boolean(student), deleted_legacy_student: deletedLegacyStudent });
  }

  if (method === 'GET' && path === '/api/admin/lecturers') return json((await database.execute('SELECT * FROM lecturers ORDER BY name ASC')).rows);

  if (method === 'POST' && path === '/api/admin/lecturers/bulk') {
    const body = await readBody(request);
    const lecturers = Array.isArray(body.lecturers) ? body.lecturers : [];
    const statements = lecturers.map((item: any) => {
      const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
      const email = typeof item === 'string' ? null : item?.email?.trim() || null;
      const workUnit = typeof item === 'string' ? null : item?.work_unit?.trim() || null;
      return name ? {
        sql: `INSERT INTO lecturers (name, email, work_unit)
              VALUES (?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET
                email = CASE
                  WHEN ? = 1 AND excluded.email IS NOT NULL AND excluded.email != '' THEN excluded.email
                  WHEN excluded.email IS NOT NULL AND excluded.email != '' AND (lecturers.email IS NULL OR lecturers.email = '') THEN excluded.email
                  ELSE lecturers.email
                END,
                work_unit = CASE
                  WHEN ? = 1 AND excluded.work_unit IS NOT NULL AND excluded.work_unit != '' THEN excluded.work_unit
                  WHEN excluded.work_unit IS NOT NULL AND excluded.work_unit != '' AND (lecturers.work_unit IS NULL OR lecturers.work_unit = '') THEN excluded.work_unit
                  ELSE lecturers.work_unit
                END`,
        args: [name, email, workUnit, body.override ? 1 : 0, body.override ? 1 : 0]
      } : null;
    }).filter(Boolean);
    await executeBatch(database, statements);
    await syncLecturerUsers(database);
    return json({ success: true, count: statements.length });
  }

  if (method === 'POST' && path === '/api/admin/lecturers') {
    const body = await readBody(request);
    if (!body.name) return json({ error: 'Tên không được để trống' }, 400);
    const result = await database.execute({ sql: 'INSERT INTO lecturers (name, email, work_unit) VALUES (?, ?, ?)', args: [body.name.trim(), body.email?.trim() || null, body.work_unit?.trim() || null] });
    await syncLecturerUsers(database);
    return json((await database.execute({ sql: 'SELECT * FROM lecturers WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0]);
  }

  const lecturerId = path.match(/^\/api\/admin\/lecturers\/(\d+)$/);
  if (lecturerId && method === 'PUT') {
    const body = await readBody(request);
    await database.execute({ sql: 'UPDATE lecturers SET name = ?, email = ?, work_unit = ? WHERE id = ?', args: [body.name?.trim(), body.email?.trim() || null, body.work_unit?.trim() || null, lecturerId[1]] });
    await syncLecturerUsers(database);
    return json({ success: true });
  }
  if (lecturerId && method === 'DELETE') {
    const idVal = Number(lecturerId[1]);
    await executeBatch(database, [
      { sql: 'DELETE FROM advisor_assignments WHERE lecturer_id = ?', args: [idVal] },
      { sql: 'DELETE FROM lecturer_quotas WHERE lecturer_id = ?', args: [idVal] },
      { sql: 'DELETE FROM chat_messages WHERE lecturer_id = ?', args: [idVal] },
      { sql: 'DELETE FROM lecturers WHERE id = ?', args: [idVal] }
    ]);
    await syncLecturerUsers(database);
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/admin/companies') {
    const officialRows = (await database.execute(`
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
    const rawOtherRows = (await database.execute(`
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
    return json([...officialRows, ...otherRows]);
  }

  if (method === 'POST' && path === '/api/admin/companies') {
    const body = await readBody(request);
    if (!body.name) return json({ error: 'Tên công ty không được để trống' }, 400);
    const result = await database.execute({ sql: `INSERT INTO companies (name, description, slots, contact_email, address, recruitment_link, phone, contact_name, history, qualifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '')`, args: [body.name.trim(), body.description || 'Chưa rõ', parseInt(body.slots) || 5, body.contact_email || '', body.address || '', body.recruitment_link || '', body.phone || '', body.contact_name || ''] });
    return json((await database.execute({ sql: 'SELECT * FROM companies WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0]);
  }

  const companyAdmin = path.match(/^\/api\/admin\/companies\/(\d+)$/);
  if (companyAdmin && method === 'PUT') {
    const body = await readBody(request);
    await database.execute({ sql: `UPDATE companies SET name = ?, description = ?, slots = ?, contact_email = ?, address = ?, recruitment_link = ?, phone = ?, contact_name = ?, history = ?, qualifications = ? WHERE id = ?`, args: [body.name?.trim(), body.description || 'Chưa rõ', parseInt(body.slots) || 5, body.contact_email || '', body.address || '', body.recruitment_link || '', body.phone || '', body.contact_name || '', body.history || '', body.qualifications || '', companyAdmin[1]] });
    return json({ success: true });
  }
  const companyDriveLinkMatch = path.match(/^\/api\/admin\/companies\/(\d+)\/applicants-drive-link$/);
  if (companyDriveLinkMatch && method === 'PUT') {
    const body = await readBody(request);
    const link = String(body.applicants_drive_link || '').trim();
    if (!link) return json({ error: 'Link Drive không được để trống.' }, 400);
    await database.execute({ sql: 'UPDATE companies SET applicants_drive_link = ? WHERE id = ?', args: [link, companyDriveLinkMatch[1]] });
    return json({ success: true, applicants_drive_link: link });
  }
  if (companyAdmin && method === 'DELETE') {
    await executeBatch(database, [
      { sql: 'DELETE FROM final_internships WHERE company_id = ?', args: [companyAdmin[1]] },
      { sql: 'DELETE FROM registrations WHERE company_id = ?', args: [companyAdmin[1]] },
      { sql: 'DELETE FROM companies WHERE id = ?', args: [companyAdmin[1]] },
    ]);
    return json({ success: true });
  }

  if (method === 'POST' && path === '/api/admin/companies/bulk') {
    const body = await readBody(request);
    if (body.override) await executeBatch(database, [{ sql: 'DELETE FROM final_internships' }, { sql: 'DELETE FROM registrations' }, { sql: 'DELETE FROM companies' }]);
    const companies = Array.isArray(body.companies) ? body.companies : [];
    const statements = companies.map((item: any) => {
      const name = typeof item === 'string' ? item.trim() : item?.name?.trim();
      if (!name) return null;
      const slots = parseInt(item?.slots) || 5;
      return { sql: `INSERT OR IGNORE INTO companies (name, description, slots, contact_email, address, phone, contact_name, history, qualifications, recruitment_link) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '')`, args: [name, 'Chưa rõ', slots, item?.contact_email || '', item?.address || '', item?.phone || '', item?.contact_name || ''] };
    }).filter(Boolean);
    await executeBatch(database, statements);
    await ensureSpecialCompanies(database);
    return json({ success: true, count: statements.length });
  }

  if (method === 'GET' && path === '/api/admin/registrations') {
    return json((await database.execute(`
      SELECT r.id as registration_id, r.user_id, r.company_id, u.email, u.name as student_name, u.student_id, u.dob, u.class_name, r.note, r.review_comment,
             r.preference_order,
             COALESCE(c.name, 'Không rõ/đã bị xoá') as company_name, r.status, r.created_at, r.other_company_name, r.other_company_role,
             r.other_company_contact, r.sent_to_company_at, r.sent_to_company_note,
             u.course_code, c.contact_email, u.phone, u.personal_email
      FROM registrations r JOIN users u ON r.user_id = u.id LEFT JOIN companies c ON r.company_id = c.id
      ORDER BY r.created_at DESC
    `)).rows);
  }

  const registrationUpdateMatch = path.match(/^\/api\/admin\/registrations\/(\d+)$/);
  if (method === 'PUT' && registrationUpdateMatch) {
    const body = await readBody(request);
    const companyId = Number(body.company_id);
    const note = String(body.note || '').trim();
    const courseCode = String(body.course_code || '').trim();
    const preferenceOrder = body.preference_order === '' || body.preference_order === undefined || body.preference_order === null
      ? null
      : Number(body.preference_order);

    if (!Number.isInteger(companyId) || companyId <= 0) return json({ error: 'Nơi thực tập không hợp lệ.' }, 400);
    if (preferenceOrder !== null && (!Number.isInteger(preferenceOrder) || preferenceOrder < 1)) return json({ error: 'Thứ tự nguyện vọng không hợp lệ.' }, 400);

    const current = (await database.execute({
      sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            JOIN companies c ON c.id = r.company_id
            WHERE r.id = ?`,
      args: [registrationUpdateMatch[1]],
    })).rows[0] as any;
    if (!current) return json({ error: 'Không tìm thấy đăng ký.' }, 404);

    const company = (await database.execute({ sql: 'SELECT id, name FROM companies WHERE id = ?', args: [companyId] })).rows[0] as any;
    if (!company) return json({ error: 'Không tìm thấy nơi thực tập.' }, 400);

    const isOtherCompany = company.name === 'Công ty khác';
    const isSchoolInternship = company.name === 'Trường Đại học Công nghệ';
    const otherCompanyName = isOtherCompany ? String(body.other_company_name || '').trim() : '';
    const otherCompanyRole = isOtherCompany || isSchoolInternship ? String(body.other_company_role || '').trim() : '';
    const otherCompanyContact = isOtherCompany || isSchoolInternship ? String(body.other_company_contact || '').trim() : '';
    if (isOtherCompany && !otherCompanyName) return json({ error: 'Vui lòng nhập tên công ty tự liên hệ.' }, 400);
    const approvedCompany = isOtherCompany
      ? (await database.execute({
          sql: 'SELECT id FROM approved_company_names WHERE normalized_name = ? LIMIT 1',
          args: [normalizeCompanyName(otherCompanyName)],
        })).rows[0]
      : company;
    const status = approvedCompany ? 'approved' : 'pending';
    const reviewComment = current.status === status ? String(current.review_comment || '').trim() : '';
    const targetChanged =
      Number(current.company_id) !== companyId ||
      String(current.other_company_name || '').trim() !== otherCompanyName;

    try {
      await database.execute({
        sql: `UPDATE registrations
              SET company_id = ?, note = ?, status = ?,
                  review_comment = CASE WHEN status != ? THEN NULL ELSE review_comment END,
                  preference_order = ?,
                  other_company_name = ?, other_company_role = ?, other_company_contact = ?,
                  created_at = datetime('now', '+7 hours')
              WHERE id = ?`,
        args: [companyId, note || null, status, status, preferenceOrder, otherCompanyName || null, otherCompanyRole || null, otherCompanyContact || null, registrationUpdateMatch[1]],
      });
      await database.execute({
        sql: 'UPDATE users SET course_code = ? WHERE id = ?',
        args: [courseCode || null, current.user_id],
      });
      if (targetChanged) {
        await database.execute({
          sql: 'UPDATE registrations SET sent_to_company_at = NULL, sent_to_company_note = NULL WHERE id = ?',
          args: [registrationUpdateMatch[1]],
        });
      }
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.toLowerCase().includes('unique')) return json({ error: 'Sinh viên đã có đăng ký trùng nơi thực tập này.' }, 400);
      throw e;
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
      await addApprovedCompanyFromRegistration(database, updated);
      const autoApproved = await approveMatchingOtherCompanyRegistrations(database, updated, reviewComment);
      for (const item of autoApproved) {
        await notify({
          user_id: Number(item.user_id),
          recipient_email: item.personal_email || item.email,
          type: 'registration_status_changed',
          subject: 'Đăng ký thực tập đã được duyệt',
          body: `Đăng ký thực tập tại ${item.other_company_name || 'Công ty tự liên hệ'} đã được tự động duyệt vì công ty này đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
        });
      }
    }

    if (current.status !== status) {
      await notify({
        user_id: Number(current.user_id),
        recipient_email: current.personal_email || current.email,
        type: 'registration_status_changed',
        subject: `Đăng ký thực tập ${status === 'approved' ? 'đã được duyệt' : 'đang chờ duyệt'}`,
        body: `Đăng ký thực tập tại ${company.name === 'Công ty khác' ? otherCompanyName || 'Công ty khác' : company.name} hiện có trạng thái: ${status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
      });
    }
    return json({ success: true, status });
  }

  if (method === 'DELETE' && registrationUpdateMatch) {
    const registrationId = Number(registrationUpdateMatch[1]);
    if (!Number.isInteger(registrationId) || registrationId <= 0) {
      return json({ error: 'Mã đăng ký không hợp lệ.' }, 400);
    }

    const reg = (await database.execute({
      sql: `SELECT r.*, u.name as student_name, u.student_id, c.name as company_name
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN companies c ON c.id = r.company_id
            WHERE r.id = ?`,
      args: [registrationId],
    })).rows[0] as any;

    if (!reg) {
      return json({ error: 'Không tìm thấy đăng ký cần xóa.' }, 404);
    }

    const lockedFinal = (await database.execute({
      sql: 'SELECT id, locked_at FROM final_internships WHERE registration_id = ? AND locked_at IS NOT NULL LIMIT 1',
      args: [registrationId],
    })).rows[0] as any;

    if (lockedFinal) {
      return json({
        error: 'Không thể xóa đăng ký đã được chốt và khóa nơi thực tập chính thức.',
      }, 400);
    }

    await executeBatch(database, [
      { sql: 'DELETE FROM final_internships WHERE (registration_id = ? OR (user_id = ? AND registration_id IS NULL)) AND locked_at IS NULL', args: [registrationId, reg.user_id] },
      { sql: 'UPDATE advisor_requests SET source_registration_id = NULL WHERE source_registration_id = ?', args: [registrationId] },
      { sql: 'DELETE FROM registrations WHERE id = ?', args: [registrationId] },
    ]);

    return json({ success: true, message: 'Đã xóa đăng ký thành công.' });
  }

  if (method === 'PUT' && path === '/api/admin/registrations/mark-sent') {
    const body = await readBody(request);
    const note = body.note || null;
    if (Array.isArray(body.registration_ids) && body.registration_ids.length > 0) {
      const ids = body.registration_ids.map((id: any) => Number(id)).filter(Boolean);
      if (ids.length === 0) return json({ error: 'Danh sách đăng ký không hợp lệ' }, 400);
      await database.execute({
        sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
              WHERE id IN (${ids.map(() => '?').join(',')})`,
        args: [note, ...ids],
      });
      return json({ success: true, count: ids.length });
    }
    if (body.company_name) {
      await database.execute({
        sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
              WHERE status = 'approved'
                AND (
                  company_id IN (SELECT id FROM companies WHERE name = ?)
                  OR lower(trim(other_company_name)) = lower(trim(?))
                )`,
        args: [note, body.company_name, body.company_name],
      });
      return json({ success: true });
    }
    if (body.other_company_name) {
      await database.execute({
        sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = ?
              WHERE status = 'approved'
                AND lower(trim(other_company_name)) = lower(trim(?))`,
        args: [note, body.other_company_name],
      });
      return json({ success: true });
    }
    return json({ error: 'Vui lòng chọn đăng ký hoặc công ty cần đánh dấu đã gửi.' }, 400);
  }

  if (method === 'POST' && path === '/api/admin/companies/send-applicants-email') {
    const body = await readBody(request);
    const companyName = String(body.company_name || body.other_company_name || '').trim();
    const recipientEmail = String(body.recipient_email || '').trim();
    const ccEmails = Array.isArray(body.cc_emails)
      ? body.cc_emails.map((email: any) => String(email || '').trim()).filter(Boolean)
      : String(body.cc_emails || '').split(/[,\s;]+/).map((email: string) => email.trim()).filter(Boolean);
    if (!companyName) return json({ error: 'Thiếu tên công ty.' }, 400);
    if (!recipientEmail) return json({ error: 'Thiếu email doanh nghiệp.' }, 400);
    const isOther = Boolean(body.other_company_name);
    if (isOther) return json({ error: 'Chỉ hỗ trợ gửi email thật cho doanh nghiệp chính thức.' }, 400);
    const rows = (await database.execute({
      sql: `SELECT r.id, u.student_id, u.name, u.phone, u.personal_email, u.class_name, u.course_code, r.note
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            JOIN companies c ON c.id = r.company_id
            WHERE r.status = 'approved'
              AND ${isOther ? 'lower(trim(r.other_company_name)) = lower(trim(?))' : '(c.name = ? OR lower(trim(r.other_company_name)) = lower(trim(?)))'}
            ORDER BY u.student_id ASC`,
      args: isOther ? [companyName] : [companyName, companyName],
    })).rows as any[];
    if (rows.length === 0) return json({ error: 'Công ty này chưa có đăng ký đã duyệt để gửi.' }, 400);
    const emailBody = String(body.body || '').trim() || [
      'Kính gửi Quý Công ty,',
      '',
      `Khoa CNTT gửi danh sách sinh viên đăng ký thực tập tại ${companyName}.`,
      '',
      ...rows.map((row, idx) => `${idx + 1}. ${row.student_id || ''} - ${row.name || ''} - ${row.class_name || ''} - ${row.course_code || ''} - ${row.phone || ''} - ${row.personal_email || ''}${row.note ? ` - Ghi chú: ${row.note}` : ''}`),
      '',
      'Trân trọng.',
    ].join('\n');
    const subject = String(body.subject || '').trim() || `Danh sách sinh viên đăng ký thực tập - ${companyName}`;
    const notificationStatus = await notify({
      recipient_email: recipientEmail,
      cc_emails: ccEmails,
      type: 'company_applicants_sent',
      subject,
      body: emailBody,
    });
    if (notificationStatus !== 'sent') {
      return json({
        error: notificationStatus === 'queued'
          ? 'Chưa cấu hình EMAIL_PROVIDER/BREVO_API_KEY/EMAIL_FROM nên email chỉ được ghi vào hàng đợi, chưa gửi thật.'
          : 'Gửi email thất bại. Vui lòng xem trang Thông báo để biết lỗi chi tiết.',
      }, 400);
    }
    await database.execute({
      sql: `UPDATE registrations SET sent_to_company_at = datetime('now', '+7 hours'), sent_to_company_note = 'Gửi email thật qua hệ thống'
            WHERE status = 'approved'
              AND ${isOther ? 'lower(trim(other_company_name)) = lower(trim(?))' : '(company_id IN (SELECT id FROM companies WHERE name = ?) OR lower(trim(other_company_name)) = lower(trim(?)))'}`,
      args: isOther ? [companyName] : [companyName, companyName],
    });
    return json({ success: true, count: rows.length });
  }

  if (method === 'GET' && path === '/api/admin/final-internships') {
    const rows = (await database.execute(`
      SELECT f.*, u.email, u.name as student_name, u.student_id, u.class_name, u.course_code, u.phone, u.personal_email,
             c.name as company_name, r.other_company_name, r.other_company_role, r.other_company_contact
      FROM final_internships f
      JOIN users u ON f.user_id = u.id
      LEFT JOIN companies c ON f.company_id = c.id
      LEFT JOIN registrations r ON f.registration_id = r.id
      ORDER BY f.confirmed_at DESC
    `)).rows;
    return json(rows);
  }

  if (method === 'GET' && path === '/api/admin/unconfirmed-internships') {
    const rows = (await database.execute(`
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
    return json(rows);
  }

  if (method === 'GET' && path === '/api/admin/registered-students-export') {
    const rows = (await database.execute(`
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
    return json(rows.map(r => ({ ...r, student_name: cleanStudentName(r.student_name, r.student_id, r.email) })));
  }

  const finalAdmin = path.match(/^\/api\/admin\/final-internships\/(\d+)$/);
  if (finalAdmin && method === 'PUT') {
    const body = await readBody(request);
    const targetUserId = Number(finalAdmin[1]);
    if (!targetUserId) return json({ error: 'User không hợp lệ' }, 400);
    const type = body.internship_type === 'school' || body.internship_type === 'partner' ? body.internship_type : 'company';
    let registrationId = body.registration_id ? Number(body.registration_id) : null;
    let companyId = body.company_id ? Number(body.company_id) : null;
    if (registrationId) {
      const reg = (await database.execute({ sql: 'SELECT * FROM registrations WHERE id = ? AND user_id = ?', args: [registrationId, targetUserId] })).rows[0] as any;
      if (!reg) return json({ error: 'Không tìm thấy đăng ký của sinh viên.' }, 404);
      if (reg.status !== 'approved') return json({ error: 'Chỉ có thể tạo nơi thực tập từ đăng ký đã duyệt.' }, 400);
      companyId = reg.company_id;
    }
    if (!companyId && type !== 'partner') {
      const school = (await database.execute("SELECT id FROM companies WHERE name = 'Trường Đại học Công nghệ'")).rows[0] as any;
      companyId = school?.id || null;
    }
    const schoolAssignmentRequest = body.school_assignment_request ? 1 : 0;
    await database.execute({
      sql: `INSERT INTO final_internships (user_id, registration_id, company_id, internship_type, status, student_attested, attestation_text, school_lecturer, school_assignment_request, confirmed_by, note, confirmed_at)
            VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))
            ON CONFLICT(user_id) DO UPDATE SET registration_id = excluded.registration_id, company_id = excluded.company_id,
              internship_type = excluded.internship_type, status = 'confirmed', student_attested = excluded.student_attested,
              attestation_text = excluded.attestation_text, school_lecturer = excluded.school_lecturer,
              school_assignment_request = excluded.school_assignment_request, confirmed_by = excluded.confirmed_by, note = excluded.note, confirmed_at = excluded.confirmed_at`,
      args: [targetUserId, registrationId, companyId, type, body.student_attested ? 1 : 0, body.attestation_text || null, body.school_lecturer || null, schoolAssignmentRequest, user.id, body.note || null],
    });
    return json({ success: true });
  }

  if (finalAdmin && method === 'DELETE') {
    const targetUserId = Number(finalAdmin[1]);
    if (!targetUserId) return json({ error: 'User không hợp lệ' }, 400);
    const locked = (await database.execute({
      sql: 'SELECT locked_at FROM final_internships WHERE user_id = ? AND locked_at IS NOT NULL',
      args: [targetUserId],
    })).rows[0];
    if (locked) {
      return json({ error: 'Không thể xóa nơi thực tập chính thức đã bị khóa.' }, 400);
    }
    await executeBatch(database, [
      { sql: 'DELETE FROM grades WHERE user_id = ? AND locked_at IS NULL', args: [targetUserId] },
      { sql: 'DELETE FROM advisor_assignments WHERE user_id = ?', args: [targetUserId] },
      { sql: 'DELETE FROM final_reports WHERE user_id = ?', args: [targetUserId] },
      { sql: 'DELETE FROM final_internships WHERE user_id = ?', args: [targetUserId] },
    ]);
    return json({ success: true, message: 'Đã xóa sinh viên khỏi danh sách thực tập chính thức và bảng điểm.' });
  }

  const finalLock = path.match(/^\/api\/admin\/final-internships\/(\d+)\/lock$/);
  if (finalLock && method === 'PUT') {
    const body = await readBody(request);
    await database.execute({
      sql: `UPDATE final_internships SET locked_at = ${body.locked === false ? 'NULL' : "datetime('now', '+7 hours')"} WHERE user_id = ?`,
      args: [Number(finalLock[1])],
    });
    return json({ success: true });
  }

  async function resolveLecturerId(body: any) {
    if (body.lecturer_id) return Number(body.lecturer_id);
    const key = String(body.lecturer_email_or_name || body.lecturer || '').trim();
    if (!key) return 0;
    const row = (await database.execute({
      sql: 'SELECT id FROM lecturers WHERE email = ? OR name = ? LIMIT 1',
      args: [key, key],
    })).rows[0] as any;
    return row ? Number(row.id) : 0;
  }

  async function createAdvisorAssignment(body: any) {
    const userId = Number(body.user_id);
    const lecturerId = await resolveLecturerId(body);
    const role = body.role === 'co' ? 'co' : 'primary';
    if (!userId || !lecturerId) return { error: 'Sinh viên hoặc giảng viên không hợp lệ.', status: 400 };
    const final = (await database.execute({ sql: 'SELECT id FROM final_internships WHERE user_id = ?', args: [userId] })).rows[0];
    if (!final) return { error: 'Sinh viên chưa xác nhận nơi thực tập chính thức.', status: 400 };
    const lecturer = (await database.execute({ sql: 'SELECT * FROM lecturers WHERE id = ?', args: [lecturerId] })).rows[0] as any;
    if (!lecturer) return { error: 'Không tìm thấy giảng viên.', status: 404 };
    if (role === 'primary' && isBachelorLecturer(lecturer.name)) return { error: 'Giảng viên CN không được làm hướng dẫn chính.', status: 400 };
    const quotaRow = (await database.execute({ sql: 'SELECT max_total_students FROM lecturer_quotas WHERE lecturer_id = ?', args: [lecturerId] })).rows[0] as any;
    const maxTotal = quotaRow != null && quotaRow.max_total_students != null ? Number(quotaRow.max_total_students) : lecturerDefaultQuota(lecturer.name);
    const current = (await database.execute({ sql: 'SELECT COUNT(*) as count FROM advisor_assignments WHERE lecturer_id = ?', args: [lecturerId] })).rows[0] as any;
    const alreadyAssigned = (await database.execute({
      sql: 'SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? AND role = ?',
      args: [userId, lecturerId, role],
    })).rows[0];
    if (!alreadyAssigned && Number(current?.count || 0) >= maxTotal) return { error: `Giảng viên đã đủ chỉ tiêu ${maxTotal} sinh viên.`, status: 400 };
    try {
      const result = await database.execute({
        sql: `INSERT INTO advisor_assignments (user_id, lecturer_id, role, assigned_by, note, assigned_at)
              VALUES (?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
        args: [userId, lecturerId, role, user.id, body.note || null],
      });
      await database.execute({
        sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
              VALUES (?, ?, ?, ?, 'created', ?, ?, datetime('now', '+7 hours'))`,
        args: [Number(result.lastInsertRowid), userId, lecturerId, role, user.id, body.note || null],
      });
      const student = (await database.execute({ sql: 'SELECT email, personal_email, name FROM users WHERE id = ?', args: [userId] })).rows[0] as any;
      await notify({
        user_id: userId,
        recipient_email: student?.personal_email || student?.email,
        type: 'advisor_assigned',
        subject: 'Bạn đã được phân công giảng viên hướng dẫn',
        body: `Bạn đã được phân công ${role === 'primary' ? 'GVHD chính' : 'đồng hướng dẫn'}: ${lecturer.name}.`,
      });
      if (lecturer.email) {
        await notify({
          user_id: userId,
          recipient_email: lecturer.email,
          type: 'advisor_assigned',
          subject: `Bạn được phân công hướng dẫn sinh viên ${student?.name || ''}`,
          body: `Bạn đã được phân công ${role === 'primary' ? 'hướng dẫn chính' : 'đồng hướng dẫn'} sinh viên ${student?.name || userId}.`,
        });
      }
      return { row: (await database.execute({ sql: 'SELECT * FROM advisor_assignments WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0] };
    } catch (e) {
      return { error: role === 'primary' ? 'Sinh viên đã có giảng viên hướng dẫn chính.' : 'Phân công này đã tồn tại.', status: 400 };
    }
  }

  async function autoAssignPrimaryAdvisors() {
    const candidates = (await database.execute(`
      SELECT l.id, l.name, l.email,
             CASE
               WHEN q.max_total_students IS NOT NULL THEN q.max_total_students
               ELSE (CASE WHEN upper(l.name) LIKE '%PGS%' OR upper(l.name) LIKE '%GS%' THEN 10 ELSE 15 END)
             END as max_total_students,
             COALESCE(ac.assignment_count, 0) as assignment_count
      FROM lecturers l
      LEFT JOIN lecturer_quotas q ON q.lecturer_id = l.id
      LEFT JOIN (SELECT lecturer_id, COUNT(*) as assignment_count FROM advisor_assignments GROUP BY lecturer_id) ac ON ac.lecturer_id = l.id
      ORDER BY assignment_count ASC, l.name ASC
    `)).rows
      .map((row: any) => ({ ...row, id: Number(row.id), max_total_students: row.max_total_students != null ? Number(row.max_total_students) : lecturerDefaultQuota(row.name), assignment_count: Number(row.assignment_count || 0) }))
      .filter((row: any) => !isBachelorLecturer(row.name) && row.assignment_count < row.max_total_students);
    const students = (await database.execute(`
      SELECT f.user_id, u.student_id, u.email, u.personal_email, u.name
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM advisor_assignments aa
        WHERE aa.user_id = f.user_id AND aa.role = 'primary'
      )
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
      const lecturer = candidates.find((item: any) => item.assignment_count < item.max_total_students);
      if (!lecturer) {
        errors.push(`${student.student_id || student.user_id}: không còn giảng viên đủ chỉ tiêu`);
        continue;
      }
      await database.execute({
        sql: `INSERT INTO advisor_assignments (user_id, lecturer_id, role, assigned_by, note, assigned_at)
              VALUES (?, ?, 'primary', ?, 'Tự phân công theo quota', datetime('now', '+7 hours'))`,
        args: [Number(student.user_id), lecturer.id, user.id],
      });
      const assignment = (await database.execute({
        sql: "SELECT id FROM advisor_assignments WHERE user_id = ? AND lecturer_id = ? AND role = 'primary'",
        args: [Number(student.user_id), lecturer.id],
      })).rows[0] as any;
      await database.execute({
        sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
              VALUES (?, ?, ?, 'primary', 'auto_created', ?, 'Tự phân công theo quota', datetime('now', '+7 hours'))`,
        args: [Number(assignment?.id || 0), Number(student.user_id), lecturer.id, user.id],
      });
      await notify({
        user_id: Number(student.user_id),
        recipient_email: student.personal_email || student.email,
        type: 'advisor_assigned',
        subject: 'Bạn đã được phân công giảng viên hướng dẫn',
        body: `Bạn đã được phân công GVHD chính: ${lecturer.name}.`,
      });
      if (lecturer.email) {
        await notify({
          user_id: Number(student.user_id),
          recipient_email: lecturer.email,
          type: 'advisor_assigned',
          subject: `Bạn được phân công hướng dẫn sinh viên ${student.name || ''}`,
          body: `Bạn đã được phân công hướng dẫn chính sinh viên ${student.name || student.user_id}.`,
        });
      }
      lecturer.assignment_count += 1;
      count++;
    }
    return { count, errors };
  }

  if (method === 'GET' && path === '/api/admin/advisor-assignments') {
    const rows = (await database.execute(`
      SELECT f.user_id, f.internship_type, f.school_assignment_request, f.confirmed_at,
             u.student_id, u.name as student_name, u.email, u.class_name, u.course_code, u.phone, u.personal_email,
             CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
             GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN aa.id || '|' || COALESCE(l.name, 'Giảng viên đã bị xóa') || '|' || COALESCE(l.email, '') || '|' || COALESCE(aa.note, '') END) as primary_assignments,
             GROUP_CONCAT(CASE WHEN aa.role = 'co' THEN aa.id || '|' || COALESCE(l.name, 'Giảng viên đã bị xóa') || '|' || COALESCE(l.email, '') || '|' || COALESCE(aa.note, '') END) as co_assignments
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN registrations r ON r.id = f.registration_id
      LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
      LEFT JOIN lecturers l ON l.id = aa.lecturer_id
      GROUP BY f.user_id
      ORDER BY u.student_id ASC
    `)).rows;
    const lecturers = (await database.execute(`
      SELECT l.*,
             CASE
               WHEN q.max_total_students IS NOT NULL THEN q.max_total_students
               ELSE (CASE WHEN upper(l.name) LIKE '%PGS%' OR upper(l.name) LIKE '%GS%' THEN 10 ELSE 15 END)
             END as max_total_students,
             COALESCE(ac.assignment_count, 0) as assignment_count
      FROM lecturers l
      LEFT JOIN lecturer_quotas q ON q.lecturer_id = l.id
      LEFT JOIN (SELECT lecturer_id, COUNT(*) as assignment_count FROM advisor_assignments GROUP BY lecturer_id) ac ON ac.lecturer_id = l.id
      ORDER BY l.name ASC
    `)).rows;
    return json({ rows, lecturers });
  }

  if (method === 'POST' && path === '/api/admin/advisor-assignments') {
    const body = await readBody(request);
    const result = await createAdvisorAssignment(body);
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json(result.row);
  }

  if (method === 'POST' && path === '/api/admin/advisor-assignments/bulk') {
    const body = await readBody(request);
    const items = Array.isArray(body.assignments) ? body.assignments : [];
    let count = 0;
    const errors: string[] = [];
    for (const item of items) {
      const studentId = String(item.student_id || '').trim();
      const student = (await database.execute({ sql: "SELECT id FROM users WHERE student_id = ? AND role = 'student'", args: [studentId] })).rows[0] as any;
      if (!student) {
        errors.push(`${studentId}: không tìm thấy sinh viên`);
        continue;
      }
      const result = await createAdvisorAssignment({ ...item, user_id: student.id });
      if (result.error) errors.push(`${studentId}: ${result.error}`);
      else count++;
    }
    return json({ success: true, count, errors });
  }

  if (method === 'POST' && path === '/api/admin/advisor-assignments/auto-primary') {
    const result = await autoAssignPrimaryAdvisors();
    return json({ success: true, ...result });
  }

  const advisorDelete = path.match(/^\/api\/admin\/advisor-assignments\/(\d+)$/);
  if (advisorDelete && method === 'DELETE') {
    const existing = (await database.execute({ sql: 'SELECT * FROM advisor_assignments WHERE id = ?', args: [Number(advisorDelete[1])] })).rows[0] as any;
    if (existing) {
      await database.execute({
        sql: `INSERT INTO advisor_assignment_history (assignment_id, user_id, lecturer_id, role, action, actor_id, note, created_at)
              VALUES (?, ?, ?, ?, 'deleted', ?, ?, datetime('now', '+7 hours'))`,
        args: [Number(existing.id), Number(existing.user_id), Number(existing.lecturer_id), existing.role, user.id, existing.note || null],
      });
    }
    await database.execute({ sql: 'DELETE FROM advisor_assignments WHERE id = ?', args: [Number(advisorDelete[1])] });
    return json({ success: true });
  }

  const quotaMatch = path.match(/^\/api\/admin\/lecturer-quotas\/(\d+)$/);
  if (quotaMatch && method === 'PUT') {
    const body = await readBody(request);
    const maxTotal = Number(body.max_total_students);
    if (!Number.isFinite(maxTotal) || maxTotal < 0) return json({ error: 'Chỉ tiêu không hợp lệ.' }, 400);
    await database.execute({
      sql: `INSERT INTO lecturer_quotas (lecturer_id, max_total_students, note)
            VALUES (?, ?, ?)
            ON CONFLICT(lecturer_id) DO UPDATE SET max_total_students = excluded.max_total_students, note = excluded.note`,
      args: [Number(quotaMatch[1]), maxTotal, body.note || null],
    });
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/admin/reports/final') {
    const rows = (await database.execute(`
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
    return json(rows);
  }

  if (method === 'GET' && path === '/api/admin/grades') {
    const rows = (await database.execute(`
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
        database.execute({ sql: 'UPDATE users SET name = ? WHERE id = ?', args: [clean, r.user_id] }).catch(() => {});
      }
    }

    return json(rows.map(r => ({
      ...r,
      student_name: cleanStudentName(r.student_name, r.student_id, r.email),
    })));
  }

  const adminGradeLock = path.match(/^\/api\/admin\/grades\/(\d+)\/lock$/);
  if (adminGradeLock && method === 'PUT') {
    const body = await readBody(request);
    await database.execute({
      sql: `UPDATE grades SET locked_at = ${body.locked === false ? 'NULL' : "datetime('now', '+7 hours')"}, updated_at = datetime('now', '+7 hours') WHERE user_id = ?`,
      args: [Number(adminGradeLock[1])],
    });
    if (body.locked !== false) {
      const row = (await database.execute({
        sql: `SELECT u.email, u.personal_email, g.final_score
              FROM users u LEFT JOIN grades g ON g.user_id = u.id
              WHERE u.id = ?`,
        args: [Number(adminGradeLock[1])],
      })).rows[0] as any;
      await notify({
        user_id: Number(adminGradeLock[1]),
        recipient_email: row?.personal_email || row?.email,
        type: 'grade_submitted',
        subject: 'Khoa đã khóa điểm thực tập',
        body: `Khoa đã khóa điểm thực tập của bạn. Điểm tổng kết: ${row?.final_score ?? '-'}.`,
      });
    }
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/admin/grades/export.csv') {
    const rows = (await database.execute(`
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
    return new Response('\uFEFF' + csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="bang_diem_thuc_tap.csv"',
      },
    });
  }

  if (method === 'GET' && path === '/api/admin/notifications') {
    const rows = (await database.execute(`
      SELECT n.*, u.name as user_name, u.student_id
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
      LIMIT 500
    `)).rows;
    return json(rows);
  }

  if (method === 'GET' && path === '/api/admin/notifications/stats') {
    const statusRows = (await database.execute(`
      SELECT status, COUNT(*) as count
      FROM notifications
      GROUP BY status
    `)).rows as any[];
    const sentToday = await emailSentTodayCount(database);
    return json({
      provider: env.RESEND_API_KEY ? 'resend' : 'none',
      daily_cap: emailDailySendCap(env),
      sent_today: sentToday,
      remaining_today: Math.max(0, emailDailySendCap(env) - sentToday),
      batch_size: emailBatchSize(env),
      statuses: Object.fromEntries(statusRows.map(row => [row.status, Number(row.count || 0)])),
    });
  }

  if (method === 'POST' && path === '/api/admin/notifications/send-queued') {
    if (!env.RESEND_API_KEY) return json({ error: 'Chưa cấu hình RESEND_API_KEY.' }, 400);
    if (!env.EMAIL_FROM) return json({ error: 'Chưa cấu hình EMAIL_FROM.' }, 400);
    const body = await readBody(request);
    const notificationIds = Array.isArray(body.notification_ids)
      ? body.notification_ids
      : Array.isArray(body.ids)
        ? body.ids
        : undefined;
    const result = await sendQueuedNotificationBatch(database, env, {
      requestedLimit: Number(body.limit || 0) || undefined,
      notificationIds,
      ignoreBatchSize: body.mode === 'quota',
    });
    return json({ success: true, ...result });
  }

  if (method === 'DELETE' && path === '/api/admin/notifications/queued') {
    const body = await readBody(request);
    const rawIds = Array.isArray(body.notification_ids) ? body.notification_ids : [];
    const notificationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (notificationIds.length > 0) {
      const placeholders = notificationIds.map(() => '?').join(',');
      const result = await database.execute({
        sql: `DELETE FROM notifications WHERE status = 'queued' AND id IN (${placeholders})`,
        args: notificationIds,
      });
      return json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    const result = await database.execute("DELETE FROM notifications WHERE status = 'queued'");
    return json({ success: true, deleted: Number(result.rowsAffected || 0) });
  }

  if (method === 'DELETE' && path === '/api/admin/notifications') {
    const body = await readBody(request);
    const rawIds = Array.isArray(body.notification_ids) ? body.notification_ids : [];
    const notificationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    const status = String(body.status || '').trim();
    if (notificationIds.length > 0) {
      const placeholders = notificationIds.map(() => '?').join(',');
      const result = await database.execute({
        sql: `DELETE FROM notifications WHERE id IN (${placeholders})`,
        args: notificationIds,
      });
      return json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    if (status) {
      if (!['queued', 'sent', 'failed', 'website_only'].includes(status)) return json({ error: 'Trạng thái không hợp lệ.' }, 400);
      const result = await database.execute({ sql: 'DELETE FROM notifications WHERE status = ?', args: [status] });
      return json({ success: true, deleted: Number(result.rowsAffected || 0) });
    }
    return json({ error: 'Cần chọn thông báo hoặc trạng thái cần xoá.' }, 400);
  }

  const notificationStatus = path.match(/^\/api\/admin\/notifications\/(\d+)\/status$/);
  if (notificationStatus && method === 'PUT') {
    const body = await readBody(request);
    const status = String(body.status || 'queued');
    if (!['queued', 'sent', 'failed', 'website_only'].includes(status)) return json({ error: 'Trạng thái không hợp lệ.' }, 400);
    await database.execute({
      sql: `UPDATE notifications SET status = ?, error = ?, sent_at = ${status === 'sent' ? "datetime('now', '+7 hours')" : 'NULL'} WHERE id = ?`,
      args: [status, body.error || null, Number(notificationStatus[1])],
    });
    return json({ success: true });
  }

  if (method === 'POST' && path === '/api/admin/notifications/final-report-reminders') {
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('final_report_close_at')")).rows);
    const rows = (await database.execute(`
      SELECT u.id, u.email, u.personal_email, u.name, u.student_id
      FROM final_internships f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN final_reports fr ON fr.user_id = f.user_id
      WHERE fr.id IS NULL OR fr.status = 'needs_revision'
      ORDER BY u.student_id ASC
    `)).rows as any[];
    for (const row of rows) {
      await notify({
        user_id: Number(row.id),
        recipient_email: row.personal_email || row.email,
        type: 'final_report_due_reminder',
        subject: 'Nhắc nộp báo cáo',
        body: `Bạn cần nộp báo cáo${settings.final_report_close_at ? ` trước ${settings.final_report_close_at} (GMT+7)` : ''}. File PDF tối đa 10 MB.`,
      });
    }
    return json({ success: true, count: rows.length });
  }

  if (method === 'POST' && path === '/api/admin/notifications/final-confirmation-open') {
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('confirmation_open_at', 'confirmation_close_at')")).rows);
    const rows = (await database.execute(`
      SELECT DISTINCT u.id, u.email, u.personal_email, u.name, u.student_id
      FROM registrations r
      JOIN users u ON u.id = r.user_id
      WHERE NOT EXISTS (SELECT 1 FROM final_internships f WHERE f.user_id = u.id)
      ORDER BY u.student_id ASC
    `)).rows as any[];
    for (const row of rows) {
      await notify({
        user_id: Number(row.id),
        recipient_email: row.personal_email || row.email,
        type: 'final_confirmation_open',
        subject: 'Mở xác nhận nơi thực tập chính thức',
        body: `Khoa đã mở giai đoạn xác nhận nơi thực tập chính thức${settings.confirmation_close_at ? ` đến ${settings.confirmation_close_at} (GMT+7)` : ''}. Vui lòng đăng nhập hệ thống để xác nhận một nơi thực tập đã trúng tuyển hoặc đăng ký thực tập tại trường nếu không trúng tuyển doanh nghiệp nào.`,
      });
    }
    return json({ success: true, count: rows.length });
  }

  if (method === 'POST' && path === '/api/admin/notifications/manual') {
    const body = await readBody(request);
    const target = String(body.target || '').trim();
    const recipientInput = String(body.recipient || body.recipient_email || '').trim();
    const deliveryMode = String(body.delivery_mode || 'website_and_email').trim();
    const subject = String(body.subject || '').trim();
    const content = String(body.body || '').trim();
    if (!subject) return json({ error: 'Tiêu đề không được để trống.' }, 400);
    if (!content) return json({ error: 'Nội dung không được để trống.' }, 400);
    if (!['website_and_email', 'website_only'].includes(deliveryMode)) return json({ error: 'Kiểu gửi thông báo không hợp lệ.' }, 400);

    const notificationIds: number[] = [];
    const persistManualNotification = async (data: NotificationInput) => {
      const notification = await insertNotification(database, data);
      if (notification) notificationIds.push(notification.id);
    };
    const manualDeliveryResult = async () => {
      if (deliveryMode === 'website_only') {
        return { created: notificationIds.length, sent: 0, queued: 0, failed: 0 };
      }
      const delivery = await sendQueuedNotificationBatch(database, env, {
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
      const result = await database.execute({
        sql: `
          INSERT INTO system_notifications (type, subject, body, target_role, active, created_by, created_at)
          VALUES ('system_announcement', ?, ?, 'all', 1, ?, datetime('now', '+7 hours'))
        `,
        args: [subject, content, user.id],
      });
      if (deliveryMode === 'website_only') {
        return json({
          success: true,
          count: 1,
          created: 1,
          sent: 0,
          queued: 0,
          failed: 0,
          id: Number(result.lastInsertRowid),
        });
      }

      const users = (await database.execute(`
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
          body: content,
          status: 'queued',
        });
      }
      const delivery = await manualDeliveryResult();
      return json({
        success: true,
        count: delivery.created,
        ...delivery,
        system_notification_id: Number(result.lastInsertRowid),
      });
    }
    let rows: any[] = [];
    if (target === 'lecturers') {
      rows = (await database.execute(`
        SELECT NULL as user_id, email, name, NULL as student_id
        FROM lecturers
        WHERE email IS NOT NULL AND trim(email) != ''
        ORDER BY name ASC
      `)).rows as any[];
    } else if (target === 'students_approved' || target === 'students_rejected' || target === 'students_pending') {
      rows = (await database.execute({
        sql: `
          SELECT DISTINCT u.id as user_id, u.email, u.personal_email, u.name, u.student_id
          FROM registrations r
          JOIN users u ON u.id = r.user_id
          WHERE r.status = ?
          ORDER BY u.student_id ASC
        `,
        args: [target.replace('students_', '')],
      })).rows as any[];
    } else if (target === 'students_with_registration') {
      rows = (await database.execute(`
        SELECT DISTINCT u.id as user_id, u.email, u.personal_email, u.name, u.student_id
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        ORDER BY u.student_id ASC
      `)).rows as any[];
    } else if (target === 'all_students') {
      rows = (await database.execute(`
        SELECT id as user_id, email, personal_email, name, student_id
        FROM users
        WHERE role = 'student'
        ORDER BY student_id ASC
      `)).rows as any[];
    } else if (target === 'single_account') {
      if (!recipientInput) return json({ error: 'Vui lòng nhập email hoặc mã sinh viên/giảng viên.' }, 400);
      const userRows = (await database.execute({
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
        const lecturerRows = (await database.execute({
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
          return json({ error: 'Không tìm thấy tài khoản theo email hoặc mã đã nhập.' }, 404);
        }
      }
    } else {
      return json({ error: 'Nhóm nhận thông báo không hợp lệ.' }, 400);
    }
    for (const row of rows) {
      const recipient = row.personal_email || row.email;
      if (!recipient) continue;
      await persistManualNotification({
        user_id: row.user_id ? Number(row.user_id) : null,
        recipient_email: recipient,
        type: target === 'lecturers' || row.role === 'lecturer' ? 'manual_lecturer_notice' : target === 'single_account' ? 'manual_direct_notice' : 'manual_student_notice',
        subject,
        body: content,
        status: deliveryMode === 'website_only' ? 'website_only' : 'queued',
      });
    }
    const delivery = await manualDeliveryResult();
    return json({ success: true, count: delivery.created, ...delivery });
  }

  if (method === 'PUT' && path === '/api/admin/registrations/approve-all') {
    const body = await readBody(request);
    const reviewComment = String(body.review_comment || '').trim();
    const pending = (await database.execute(`
      SELECT r.id, u.id as user_id, u.email, u.personal_email, c.name as company_name, r.other_company_name
      FROM registrations r
      JOIN users u ON u.id = r.user_id
      JOIN companies c ON c.id = r.company_id
      WHERE r.status = 'pending'
    `)).rows as any[];
    await database.execute({ sql: "UPDATE registrations SET status = 'approved', review_comment = ? WHERE status = 'pending'", args: [reviewComment || null] });
    for (const row of pending) {
      await addApprovedCompanyFromRegistration(database, row);
      await notify({
        user_id: Number(row.user_id),
        recipient_email: row.personal_email || row.email,
        type: 'registration_status_changed',
        subject: 'Đăng ký thực tập đã được duyệt',
        body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
      });
    }
    return json({ success: true });
  }
  const statusMatch = path.match(/^\/api\/admin\/registrations\/(\d+)\/status$/);
  if (method === 'PUT' && statusMatch) {
    const body = await readBody(request);
    if (!['pending', 'approved', 'rejected'].includes(body.status)) return json({ error: 'Invalid status' }, 400);
    const reviewComment = String(body.review_comment || '').trim();
    const row = (await database.execute({
      sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            JOIN companies c ON c.id = r.company_id
            WHERE r.id = ?`,
      args: [statusMatch[1]],
    })).rows[0] as any;
    await database.execute({ sql: 'UPDATE registrations SET status = ?, review_comment = ? WHERE id = ?', args: [body.status, reviewComment || null, statusMatch[1]] });
    if (row && body.status === 'approved') {
      await addApprovedCompanyFromRegistration(database, row);
      const autoApproved = await approveMatchingOtherCompanyRegistrations(database, row, reviewComment);
      for (const item of autoApproved) {
        await notify({
          user_id: Number(item.user_id),
          recipient_email: item.personal_email || item.email,
          type: 'registration_status_changed',
          subject: 'Đăng ký thực tập đã được duyệt',
          body: `Đăng ký thực tập tại ${item.other_company_name || 'Công ty tự liên hệ'} đã được tự động duyệt vì công ty này đã được Khoa duyệt.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
        });
      }
    }
    if (row && row.status !== body.status) {
      await notify({
        user_id: Number(row.user_id),
        recipient_email: row.personal_email || row.email,
        type: 'registration_status_changed',
        subject: `Đăng ký thực tập ${body.status === 'approved' ? 'đã được duyệt' : body.status === 'rejected' ? 'đã bị từ chối' : 'đang chờ duyệt'}`,
        body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} hiện có trạng thái: ${body.status === 'approved' ? 'Đã duyệt' : body.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}.${reviewComment ? `\nNhận xét: ${reviewComment}` : ''}`,
      });
    }
    return json({ success: true });
  }

  const commentMatch = path.match(/^\/api\/admin\/registrations\/(\d+)\/comment$/);
  if (method === 'PUT' && commentMatch) {
    const body = await readBody(request);
    const reviewComment = String(body.review_comment || '').trim();
    if (!reviewComment) return json({ error: 'Nội dung nhận xét không được để trống.' }, 400);
    const row = (await database.execute({
      sql: `SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
            FROM registrations r
            JOIN users u ON u.id = r.user_id
            JOIN companies c ON c.id = r.company_id
            WHERE r.id = ?`,
      args: [commentMatch[1]],
    })).rows[0] as any;
    if (!row) return json({ error: 'Không tìm thấy đăng ký.' }, 404);

    await database.execute({
      sql: 'UPDATE registrations SET review_comment = ? WHERE id = ?',
      args: [reviewComment, commentMatch[1]],
    });
    await notify({
      user_id: Number(row.user_id),
      recipient_email: row.personal_email || row.email,
      type: 'registration_review_comment',
      subject: 'Khoa gửi nhận xét về đăng ký thực tập',
      body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} có nhận xét từ Khoa:\n${reviewComment}`,
    });
    return json({ success: true });
  }

  if (method === 'PUT' && path === '/api/admin/registrations/comments') {
    const body = await readBody(request);
    const reviewComment = String(body.review_comment || '').trim();
    const rawIds = Array.isArray(body.registration_ids) ? body.registration_ids : [];
    const registrationIds = rawIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    if (!reviewComment) return json({ error: 'Nội dung nhận xét không được để trống.' }, 400);
    if (registrationIds.length === 0) return json({ error: 'Danh sách đăng ký cần gửi nhận xét đang trống.' }, 400);
    const placeholders = registrationIds.map(() => '?').join(',');
    const rows = (await database.execute({
      sql: `
        SELECT r.*, u.id as user_id, u.email, u.personal_email, c.name as company_name
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        JOIN companies c ON c.id = r.company_id
        WHERE r.id IN (${placeholders})
      `,
      args: registrationIds,
    })).rows as any[];
    await database.execute({
      sql: `UPDATE registrations SET review_comment = ? WHERE id IN (${placeholders})`,
      args: [reviewComment, ...registrationIds],
    });
    for (const row of rows) {
      await notify({
        user_id: Number(row.user_id),
        recipient_email: row.personal_email || row.email,
        type: 'registration_review_comment',
        subject: 'Khoa gửi nhận xét về đăng ký thực tập',
        body: `Đăng ký thực tập tại ${row.company_name === 'Công ty khác' ? row.other_company_name || 'Công ty khác' : row.company_name} có nhận xét từ Khoa:\n${reviewComment}`,
      });
    }
    return json({ success: true, count: rows.length });
  }

  if (method === 'GET' && path === '/api/admin/admins') {
    return json((await database.execute("SELECT id, email, name, picture, is_lecturer FROM users WHERE role = 'admin' ORDER BY name ASC")).rows);
  }
  if (method === 'POST' && path === '/api/admin/admins') {
    const body = await readBody(request);
    const email = body.email;
    if (!email || (!email.endsWith('@vnu.edu.vn') && email !== env.ADMIN_EMAIL)) return json({ error: 'Chỉ hỗ trợ email @vnu.edu.vn' }, 400);
    const lecturer = (await database.execute({ sql: 'SELECT * FROM lecturers WHERE email = ?', args: [email] })).rows[0] as any;
    await database.execute({ sql: `INSERT INTO users (email, name, role, is_lecturer) VALUES (?, ?, 'admin', ?) ON CONFLICT(email) DO UPDATE SET role = 'admin', name = CASE WHEN ? IS NOT NULL THEN ? ELSE name END, is_lecturer = CASE WHEN ? = 1 THEN 1 ELSE is_lecturer END`, args: [email, lecturer?.name || 'Admin', lecturer ? 1 : 0, lecturer?.name || null, lecturer?.name || null, lecturer ? 1 : 0] });
    await syncLecturerUsers(database);
    return json({ success: true, isLecturer: !!lecturer });
  }
  const adminDelete = path.match(/^\/api\/admin\/admins\/(\d+)$/);
  if (method === 'DELETE' && adminDelete) {
    if (Number(adminDelete[1]) === Number(user.id)) return json({ error: 'Không thể tự hủy quyền của chính mình' }, 400);
    await database.execute({ sql: "UPDATE users SET role = 'student', is_lecturer = 0 WHERE id = ?", args: [adminDelete[1]] });
    await syncLecturerUsers(database);
    return json({ success: true });
  }
  const adminLecturer = path.match(/^\/api\/admin\/admins\/(\d+)\/lecturer$/);
  if (method === 'PUT' && adminLecturer) {
    const body = await readBody(request);
    await database.execute({ sql: 'UPDATE users SET is_lecturer = ? WHERE id = ? AND role = ? ', args: [body.is_lecturer ? 1 : 0, adminLecturer[1], 'admin'] });
    await syncLecturerUsers(database);
    return json({ success: true });
  }

  if (method === 'PUT' && path === '/api/settings/campaign') {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    await executeBatch(database, [
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_year', ?)", args: [body.year || null] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_start', ?)", args: [body.start || null] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('campaign_end', ?)", args: [body.end || null] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_open_at', ?)", args: [body.registration_open_at || ''] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_close_at', ?)", args: [body.registration_close_at || ''] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('confirmation_open_at', ?)", args: [body.confirmation_open_at || ''] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('confirmation_close_at', ?)", args: [body.confirmation_close_at || ''] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('final_report_open_at', ?)", args: [body.final_report_open_at || ''] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('final_report_close_at', ?)", args: [body.final_report_close_at || ''] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('classes_list', ?)", args: [body.classes_list || DEFAULT_CLASSES] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('allowed_registration_cohorts', ?)", args: [Array.isArray(body.allowed_registration_cohorts) ? body.allowed_registration_cohorts.join(',') : String(body.allowed_registration_cohorts || '')] },
    ]);
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/settings/registration-rules') {
    requireRole(user, ['admin']);
    const row = (await database.execute("SELECT value FROM settings WHERE key = 'registration_rules_md'")).rows[0] as any;
    return json({ registration_rules_md: row?.value || DEFAULT_REGISTRATION_RULES });
  }

  if (method === 'PUT' && path === '/api/settings/registration-rules') {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    await database.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('registration_rules_md', ?)",
      args: [String(body.registration_rules_md || '')],
    });
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/settings/faq') {
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('faq_student_md', 'faq_lecturer_md')")).rows);
    return json({
      faq_student_md: settings.faq_student_md || DEFAULT_STUDENT_FAQ,
      faq_lecturer_md: settings.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
    });
  }

  if (method === 'PUT' && path === '/api/settings/faq') {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    await executeBatch(database, [
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('faq_student_md', ?)", args: [String(body.faq_student_md || '')] },
      { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('faq_lecturer_md', ?)", args: [String(body.faq_lecturer_md || '')] },
    ]);
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/faq/questions/my') {
    const rows = (await database.execute({
      sql: `
        SELECT id, role, question, answer, status, created_at, answered_at
        FROM faq_questions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `,
      args: [user.id],
    })).rows;
    return json(rows);
  }

  if (method === 'POST' && path === '/api/faq/questions') {
    const body = await readBody(request);
    const question = String(body.question || '').trim();
    if (!question) return json({ error: 'Vui lòng nhập câu hỏi.' }, 400);
    if (question.length > 2000) return json({ error: 'Câu hỏi không được vượt quá 2000 ký tự.' }, 400);
    const role = user.role === 'lecturer' ? 'lecturer' : 'student';
    const result = await database.execute({
      sql: `
        INSERT INTO faq_questions (user_id, role, question, status, created_at)
        VALUES (?, ?, ?, 'pending', datetime('now', '+7 hours'))
      `,
      args: [user.id, role, question],
    });
    const admins = (await database.execute(`
      SELECT id, email, personal_email, name
      FROM users
      WHERE role = 'admin'
        AND email IS NOT NULL
        AND trim(email) != ''
    `)).rows as any[];
    const askerName = user.name || user.email || (role === 'lecturer' ? 'Giảng viên' : 'Sinh viên');
    const seenAdminEmails = new Set<string>();
    const uniqueAdmins: any[] = [];
    for (const admin of admins) {
      const targetEmail = String(admin.personal_email || admin.email || '').trim().toLowerCase();
      if (targetEmail && seenAdminEmails.has(targetEmail)) continue;
      if (targetEmail) seenAdminEmails.add(targetEmail);
      uniqueAdmins.push(admin);
    }
    for (const admin of uniqueAdmins) {
      await notify({
        user_id: Number(admin.id),
        recipient_email: admin.personal_email || admin.email,
        type: 'faq_question_created',
        subject: 'Có câu hỏi FAQ mới cần trả lời',
        body: `${askerName} vừa gửi câu hỏi FAQ:\n\n${question}\n\nVui lòng vào trang Trả lời câu hỏi FAQ để xử lý.`,
        status: 'website_only',
      });
    }
    return json({ success: true, id: Number(result.lastInsertRowid) });
  }

  if (method === 'GET' && path === '/api/admin/faq/questions') {
    requireRole(user, ['admin']);
    const rows = (await database.execute(`
      SELECT q.*, u.name as user_name, u.email as user_email, u.student_id, a.name as answered_by_name
      FROM faq_questions q
      JOIN users u ON u.id = q.user_id
      LEFT JOIN users a ON a.id = q.answered_by
      ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END, q.created_at DESC
      LIMIT 500
    `)).rows;
    return json(rows);
  }

  const faqAnswerMatch = path.match(/^\/api\/admin\/faq\/questions\/(\d+)\/answer$/);
  if (method === 'PUT' && faqAnswerMatch) {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    const answer = String(body.answer || '').trim();
    if (!answer) return json({ error: 'Vui lòng nhập câu trả lời.' }, 400);
    const existing = (await database.execute({
      sql: `
        SELECT q.*, u.email, u.personal_email
        FROM faq_questions q
        JOIN users u ON u.id = q.user_id
        WHERE q.id = ?
      `,
      args: [Number(faqAnswerMatch[1])],
    })).rows[0] as any;
    if (!existing) return json({ error: 'Không tìm thấy câu hỏi.' }, 404);
    await database.execute({
      sql: `
        UPDATE faq_questions
        SET answer = ?, status = 'answered', answered_at = datetime('now', '+7 hours'), answered_by = ?
        WHERE id = ?
      `,
      args: [answer, user.id, Number(faqAnswerMatch[1])],
    });
    await notify({
      user_id: Number(existing.user_id),
      recipient_email: existing.personal_email || existing.email,
      type: 'faq_answered',
      subject: 'Câu hỏi FAQ của bạn đã được trả lời',
      body: `Câu hỏi:\n${existing.question}\n\nTrả lời:\n${answer}`,
      status: 'website_only',
    });
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/settings/plan') {
    requireRole(user, ['admin']);
    const row = (await database.execute("SELECT value FROM settings WHERE key = 'implementation_plan_md'")).rows[0] as any;
    return json({ plan: row?.value || '' });
  }

  if (method === 'PUT' && path === '/api/settings/plan') {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    await database.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('implementation_plan_md', ?)",
      args: [String(body.plan || '')],
    });
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/settings/google-sheet') {
    requireRole(user, ['admin']);
    const settings = rowsToSettings((await database.execute("SELECT key, value FROM settings WHERE key IN ('google_sheet_url', 'export_google_sheet_url', 'implementation_plan_md')")).rows);
    return json({ url: settings.google_sheet_url || '', export_url: settings.export_google_sheet_url || '', plan: settings.implementation_plan_md || '' });
  }
  if (method === 'PUT' && path === '/api/settings/google-sheet') {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    const statements: any[] = [];
    if (body.url !== undefined) statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)", args: [body.url] });
    if (body.export_url !== undefined) statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('export_google_sheet_url', ?)", args: [body.export_url] });
    if (body.plan !== undefined) statements.push({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('implementation_plan_md', ?)", args: [body.plan] });
    await executeBatch(database, statements);
    return json({ success: true });
  }

  if (method === 'POST' && path === '/api/settings/import-companies') {
    requireRole(user, ['admin']);
    const body = await readBody(request);
    const setting = (await database.execute("SELECT value FROM settings WHERE key = 'google_sheet_url'")).rows[0] as any;
    if (!setting?.value) return json({ error: 'Spreadsheet URL not set' }, 400);
    let fetchUrl = setting.value;
    if (!fetchUrl.includes('export?format=csv')) fetchUrl = fetchUrl.includes('edit') ? fetchUrl.split('edit')[0] + 'export?format=csv' : fetchUrl;
    const csvRes = await fetch(fetchUrl);
    if (!csvRes.ok) throw new Error('Failed to fetch from Google Sheets');
    const records = recordsFromCsv(await csvRes.text());
    if (!body.keepRegistrations) await executeBatch(database, [{ sql: 'DELETE FROM registrations' }, { sql: 'DELETE FROM companies' }]);
    const statements = records.map((record: any) => {
      if (!record.Timestamp) return null;
      const name = record['Tên doanh nghiệp']?.trim();
      if (!name) return null;
      const slots = parseInt(record['Số lượng sinh viên cần tuyển  '] || record['Số lượng sinh viên cần tuyển'] || '0') || 5;
      const contactEmail = record['Email liên hệ']?.trim() || record['Email Address']?.trim() || '';
      const contactName = record['Họ và tên người liên hệ phụ trách thực tập']?.trim() || '';
      const phone = record['Điện thoại liên hệ']?.trim() || '';
      const address = record['Địa chỉ nơi thực tập']?.trim() || '';
      const infoLink = record['Thông tin vị trí tuyển thực tập']?.trim() || '';
      return { sql: `INSERT INTO companies (name, description, slots, contact_email, history, qualifications, address, recruitment_link, phone, contact_name) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description=excluded.description, slots=excluded.slots, contact_email=excluded.contact_email, history=excluded.history, address=excluded.address, recruitment_link=excluded.recruitment_link, phone=excluded.phone, contact_name=excluded.contact_name`, args: [name, 'Chưa rõ', slots, contactEmail, `Công ty ${name} tuyển dụng thực tập sinh.`, address, infoLink, phone, contactName] };
    }).filter(Boolean);
    await executeBatch(database, statements);
    await ensureSpecialCompanies(database);
    return json({ success: true, count: statements.length });
  }

  if (method === 'POST' && path === '/api/admin/export-to-sheet') {
    requireRole(user, ['admin']);
    const setting = (await database.execute("SELECT value FROM settings WHERE key = 'export_google_sheet_url'")).rows[0] as any;
    const match = setting?.value?.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return json({ error: 'URL Google Sheet không hợp lệ hoặc chưa cấu hình' }, 400);
    const data = (await database.execute(`
      SELECT u.student_id as "Mã SV", u.name as "Họ và tên", u.dob as "Ngày sinh", u.class_name as "Lớp KH",
             CASE
               WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
               ELSE COALESCE(u.course_code, '')
             END as "Mã môn học",
             CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || coalesce(r.other_company_name, '') ELSE c.name END as "Nơi thực tập",
             CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_role, '') ELSE 'Thực tập sinh' END as "Vị trí",
             CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_contact, '') ELSE c.contact_email END as "Liên hệ",
             r.note as "Ghi chú", r.status as "Trạng thái", r.created_at as "Thời gian đăng ký"
      FROM registrations r JOIN users u ON r.user_id = u.id JOIN companies c ON r.company_id = c.id ORDER BY r.created_at DESC
    `)).rows as any[];
    const headers = data.length ? ['STT', ...Object.keys(data[0])] : ['STT'];
    const values = [headers, ...data.map((row, i) => [i + 1, ...Object.values(row)])];
    const accessToken = await getGoogleAccessToken(env);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${match[1]}/values/A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(await res.text());
    return json({ success: true, message: 'Đã lưu dữ liệu vào Google Sheets thành công!' });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const response = await route(request, env);
      const out = new Response(response.body, response);
      Object.entries(headers).forEach(([key, value]) => out.headers.set(key, value));
      return out;
    } catch (error: any) {
      if (error instanceof Response) {
        const out = new Response(error.body, error);
        Object.entries(headers).forEach(([key, value]) => out.headers.set(key, value));
        out.headers.set('content-type', 'application/json; charset=utf-8');
        return out;
      }
      if (String(error?.message || '').includes('không được phép đăng nhập/đăng ký')) {
        return json({ error: error.message }, 403, headers);
      }
      return json({ error: error?.message || 'Internal error' }, 500, headers);
    }
  },
  async scheduled(event: any, env: Env, ctx: any) {
    try {
      const database = db(env);
      if (env.RESEND_API_KEY && env.EMAIL_FROM) {
        await sendQueuedNotificationBatch(database, env, { ignoreBatchSize: true });
      }
    } catch (e: any) {
      console.error('Worker scheduled queue drain error:', e?.message || e);
    }
  },
};
