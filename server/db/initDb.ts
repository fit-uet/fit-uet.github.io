import fs from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@libsql/client';
import { db, setDb, CloudflareD1Client, withDbRetry, executeBatch, getSqliteObjectType } from '../db';
import {
  DEFAULT_JWT_SECRET,
  JWT_SECRET,
  DEFAULT_ALLOWED_REGISTRATION_COHORTS,
  DEFAULT_REGISTRATION_RULES,
  DEFAULT_STUDENT_FAQ,
  DEFAULT_LECTURER_FAQ,
  DEFAULT_LECTURER_GUIDE,
} from '../config';
import {
  normalizeCompanyName,
  normalizeExistingStudentNames,
} from '../services/helpers';
import { approvePendingOtherRegistrationsFromApprovedNames } from '../services/companyApproval';

export async function deleteLegacyStudentRow(studentId: string, email?: string | null) {
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

export async function consolidateLegacyPeopleTables() {
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

export async function syncLecturerUsers() {
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

export async function ensureDbIndexes(force = false) {
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

export async function ensureSpecialCompanies() {
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

export async function seedApprovedCompanyNamesIfEmpty() {
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

export async function seedCompaniesIfEmpty() {
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

export async function initDb() {
  if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET is required in production.');
  }

  const d1Token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_API_TOKEN;
  const d1AccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '7f6e0debd543c1ec1871f4f6d2c03dd5';
  const d1DatabaseId = process.env.CLOUDFLARE_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || '866e23b7-3b49-43e4-ab90-59dceb4c4f76';
  const dbProvider = (process.env.DB_PROVIDER || (d1Token ? 'd1' : 'turso')).toLowerCase();

  let client: any;
  if (dbProvider === 'd1') {
    if (!d1Token) {
      throw new Error('CLOUDFLARE_API_TOKEN (or CLOUDFLARE_D1_API_TOKEN) is required when DB_PROVIDER=d1.');
    }
    console.log(`[db] Using Cloudflare D1 database: ${d1DatabaseId} (Account: ${d1AccountId})`);
    client = new CloudflareD1Client(d1AccountId, d1DatabaseId, d1Token);
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
    client = createClient({
      url: databaseUrl,
      authToken
    });
  }

  const rawExecute = client.execute.bind(client);
  const rawExecuteMultiple = client.executeMultiple.bind(client);
  client.execute = ((statement: any) => withDbRetry(() => rawExecute(statement), 'execute')) as any;
  client.executeMultiple = ((sql: string) => withDbRetry(() => rawExecuteMultiple(sql), 'executeMultiple')) as any;
  setDb(client);

  await db.execute('PRAGMA foreign_keys = ON');

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'lecturer', 'admin')),
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
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('grading_open_at', '')`);
  await db.executeMultiple(`INSERT OR IGNORE INTO settings (key, value) VALUES ('grading_close_at', '')`);
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
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN student_id'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN dob'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN class_name'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE registrations DROP COLUMN course_code'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE users ADD COLUMN is_lecturer INTEGER DEFAULT 0'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE lecturers ADD COLUMN email TEXT'); } catch (e) { }
  try { await db.executeMultiple('ALTER TABLE lecturers ADD COLUMN work_unit TEXT'); } catch (e) { }
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
  try { await db.executeMultiple('UPDATE grades SET final_score = ROUND(final_score, 1) WHERE final_score IS NOT NULL'); } catch (e) { }

  const force = process.env.FORCE_DB_INIT === 'true';
  await ensureDbIndexes(force);

  if (force) {
    await consolidateLegacyPeopleTables();
    await ensureSpecialCompanies();
    await seedApprovedCompanyNamesIfEmpty();
    await approvePendingOtherRegistrationsFromApprovedNames();

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
