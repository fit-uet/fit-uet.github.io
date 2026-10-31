import type { DatabaseClient } from '../types';
import {migrateProjectMembership,previewProjectMembership} from './projectMembership';
import { migrateProjectTopics } from './topicMigration';

// Existing internship tables remain the sole source for legacy enrollments.
// New class data is additive. Each command is one SQLite statement: triggers,
// CAS guard, records, user admissions, audit and outbox commit or roll back together,
// including through the D1 REST adapter (no multi-request transaction assumption).
export async function initAcademicSchema(client: DatabaseClient) {
  const columns = (await client.execute('PRAGMA table_info(users)')).rows as { name: string }[];
  if (!columns.some(c => c.name === 'legacy_internship_access')) {
    await client.execute('ALTER TABLE users ADD COLUMN legacy_internship_access INTEGER NOT NULL DEFAULT 1');
  }
  const notificationColumns = (await client.execute('PRAGMA table_info(notifications)')).rows as { name: string }[];
  for (const name of ['academic_event_id', 'academic_class_id', 'academic_enrollment_id', 'academic_campaign_id', 'academic_audience_class_ids']) {
    if (!notificationColumns.some(c => c.name === name)) await client.execute(`ALTER TABLE notifications ADD COLUMN ${name} TEXT`);
  }
  const statements = [
    `CREATE TABLE IF NOT EXISTS academic_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)`,
    `INSERT OR IGNORE INTO academic_meta(id,revision) VALUES(1,0)`,
    `CREATE TABLE IF NOT EXISTS academic_semesters (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`,
    `CREATE TABLE IF NOT EXISTS academic_campaigns (id TEXT PRIMARY KEY,semester_id TEXT NOT NULL REFERENCES academic_semesters(id),course_group TEXT NOT NULL CHECK(course_group IN ('internship','project')),data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(semester_id,course_group))`,
    `CREATE TABLE IF NOT EXISTS academic_classes (id TEXT PRIMARY KEY, semester_id TEXT NOT NULL REFERENCES academic_semesters(id), code TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(semester_id,code))`,
    `CREATE TABLE IF NOT EXISTS academic_enrollments (id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES academic_classes(id), student_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(class_id,student_id))`,
    `CREATE TABLE IF NOT EXISTS academic_quotas (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`,
    `CREATE TABLE IF NOT EXISTS academic_previews (id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, expires_at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), result TEXT)`,
    `CREATE TABLE IF NOT EXISTS academic_commands (id TEXT PRIMARY KEY, expected_revision INTEGER NOT NULL, actor_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS academic_outbox (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), delivered_at TEXT, notification_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS academic_messages (id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES academic_classes(id), enrollment_id TEXT, lecturer_id INTEGER NOT NULL, sender_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS academic_message_reads (message_id TEXT NOT NULL REFERENCES academic_messages(id), user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(message_id,user_id))`,
    `CREATE TABLE IF NOT EXISTS academic_questions (id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES academic_classes(id),user_id INTEGER NOT NULL REFERENCES users(id),question TEXT NOT NULL,answer TEXT,created_at TEXT NOT NULL,answered_at TEXT,revision INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS academic_schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS academic_enrollment_student ON academic_enrollments(student_id,class_id)`,
    `CREATE INDEX IF NOT EXISTS idx_academic_enrollments_class ON academic_enrollments(class_id)`,
    `CREATE INDEX IF NOT EXISTS academic_enrollment_email ON academic_enrollments(lower(json_extract(data,'$.email')))`,
    `CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_email_casefold ON users(lower(email))`,
    `CREATE INDEX IF NOT EXISTS idx_lecturers_email_casefold_trim ON lecturers(lower(trim(email)))`,
    `CREATE INDEX IF NOT EXISTS academic_message_thread ON academic_messages(class_id,lecturer_id,enrollment_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS academic_message_lecturer ON academic_messages(lecturer_id,enrollment_id,class_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS academic_notification_event ON notifications(academic_event_id) WHERE academic_event_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS academic_file_cleanup(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,kind TEXT NOT NULL,object_key TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT)`,
    `CREATE TABLE IF NOT EXISTS academic_deletions(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,actor_id INTEGER NOT NULL,enrollment_ids TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL)`,
    `CREATE TRIGGER IF NOT EXISTS academic_project_admission_guard BEFORE INSERT ON academic_commands
    WHEN NEW.action='admin.project.add' BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='admin') THEN RAISE(ABORT,'ACADEMIC_ADMIN_REQUIRED') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM academic_campaigns p JOIN academic_classes c
        ON COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||':project')=p.id
        WHERE p.id=json_extract(NEW.payload,'$.projectAdmission.campaignId') AND p.course_group='project'
          AND c.id=json_extract(NEW.payload,'$.projectAdmission.classId') AND json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132')
          AND json_extract(p.data,'$.revision')=json_extract(NEW.payload,'$.projectAdmission.campaignRevision')
          AND json_extract(p.data,'$.status') IN ('draft','active') AND COALESCE(json_extract(p.data,'$.pendingMigration'),0)!=1
      ) THEN RAISE(ABORT,'ACADEMIC_STALE') END;
      SELECT CASE WHEN json_type(NEW.payload,'$.projectAdmission.account')='null' AND EXISTS(SELECT 1 FROM users
        WHERE student_id=json_extract(NEW.payload,'$.projectAdmission.studentId') OR lower(email)=json_extract(NEW.payload,'$.projectAdmission.email'))
        THEN RAISE(ABORT,'ACADEMIC_STALE') END;
      SELECT CASE WHEN json_type(NEW.payload,'$.projectAdmission.account')!='null' AND NOT EXISTS(SELECT 1 FROM users u
        WHERE u.id=json_extract(NEW.payload,'$.projectAdmission.account.id') AND u.role='student'
          AND u.email=json_extract(NEW.payload,'$.projectAdmission.account.email') AND u.student_id=json_extract(NEW.payload,'$.projectAdmission.studentId')
          AND u.name=json_extract(NEW.payload,'$.projectAdmission.account.name')
          AND COALESCE(u.dob,'')=json_extract(NEW.payload,'$.projectAdmission.account.dob')
          AND COALESCE(u.class_name,'')=json_extract(NEW.payload,'$.projectAdmission.account.className'))
        THEN RAISE(ABORT,'ACADEMIC_STALE') END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS academic_command_apply_v4 AFTER INSERT ON academic_commands BEGIN
      SELECT CASE WHEN (SELECT revision FROM academic_meta WHERE id=1) != NEW.expected_revision THEN RAISE(ABORT,'ACADEMIC_STALE') END;
      SELECT CASE WHEN json_extract(NEW.payload,'$.membershipMigration')=1 AND EXISTS(SELECT 1 FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132') AND json_extract(e.data,'$.status')='withdrawn') THEN RAISE(ABORT,'PROJECT_MEMBERSHIP_CONFLICT') END;
      SELECT CASE WHEN NEW.action LIKE 'admin.%' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='admin') THEN RAISE(ABORT,'ACADEMIC_ADMIN_REQUIRED') END;
      SELECT CASE WHEN NEW.action LIKE 'student.%' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='student') THEN RAISE(ABORT,'ACADEMIC_ROLE_CHANGED') END;
      SELECT CASE WHEN NEW.action LIKE 'lecturer.%' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role IN ('lecturer','admin')) THEN RAISE(ABORT,'ACADEMIC_ROLE_CHANGED') END;
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM json_each(NEW.payload,'$.lecturerGuards') g
        WHERE NOT EXISTS (SELECT 1 FROM lecturers l WHERE l.id=json_extract(g.value,'$.id')
          AND COALESCE(l.name,'')=json_extract(g.value,'$.name') AND COALESCE(l.email,'')=json_extract(g.value,'$.email')
          AND COALESCE(l.work_unit,'')=json_extract(g.value,'$.work_unit'))
      ) THEN RAISE(ABORT,'ACADEMIC_STALE') END;
      INSERT INTO academic_semesters(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(NEW.payload,'$.semesters') WHERE 1
        ON CONFLICT(id) DO UPDATE SET data=excluded.data;
      INSERT INTO academic_campaigns(id,semester_id,course_group,data)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.semesterId'),json_extract(value,'$.group'),value FROM json_each(NEW.payload,'$.campaigns') WHERE 1
        ON CONFLICT(id) DO UPDATE SET data=excluded.data;
      INSERT INTO settings(key,value) SELECT json_extract(value,'$.key'),json_extract(value,'$.value') FROM json_each(NEW.payload,'$.legacySettings') WHERE 1
        ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      UPDATE grades SET locked_at=(SELECT json_extract(value,'$.lockedAt') FROM json_each(NEW.payload,'$.legacyGradeLocks') WHERE json_extract(value,'$.userId')=grades.user_id)
        WHERE user_id IN (SELECT json_extract(value,'$.userId') FROM json_each(NEW.payload,'$.legacyGradeLocks'));
      INSERT INTO academic_classes(id,semester_id,code,data)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.semesterId'),json_extract(value,'$.code'),value FROM json_each(NEW.payload,'$.classes') WHERE 1
        ON CONFLICT(id) DO UPDATE SET semester_id=excluded.semester_id,code=excluded.code,data=excluded.data;
      INSERT INTO users(email,name,role,student_id,dob,class_name,legacy_internship_access)
        SELECT json_extract(value,'$.email'),json_extract(value,'$.name'),'student',json_extract(value,'$.studentId'),json_extract(value,'$.dob'),json_extract(value,'$.className'),0
        FROM json_each(NEW.payload,'$.users') WHERE 1
        ON CONFLICT(email) DO NOTHING;
      INSERT INTO academic_enrollments(id,class_id,student_id,data)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.classId'),json_extract(value,'$.studentId'),value FROM json_each(NEW.payload,'$.enrollments') WHERE 1
        ON CONFLICT(id) DO UPDATE SET data=excluded.data;
      INSERT INTO academic_quotas(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(NEW.payload,'$.quotas') WHERE 1
        ON CONFLICT(id) DO UPDATE SET data=excluded.data;
      INSERT OR IGNORE INTO academic_outbox(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(NEW.payload,'$.events');
      UPDATE academic_previews SET result=json_extract(NEW.payload,'$.previewResult') WHERE id=json_extract(NEW.payload,'$.previewId');
      UPDATE academic_enrollments SET data=json_remove(json_set(data,'$.revision',json_extract(data,'$.revision')+1),'$.status')
        WHERE json_extract(NEW.payload,'$.membershipMigration')=1 AND class_id IN (SELECT id FROM academic_classes WHERE json_extract(data,'$.courseCode') IN ('INT3131','INT3132')) AND json_type(data,'$.status') IS NOT NULL;
      DELETE FROM academic_message_reads WHERE message_id IN (SELECT id FROM academic_messages WHERE enrollment_id IN (SELECT value FROM json_each(NEW.payload,'$.deletedEnrollmentIds')));
      DELETE FROM academic_messages WHERE enrollment_id IN (SELECT value FROM json_each(NEW.payload,'$.deletedEnrollmentIds'));
      DELETE FROM notifications WHERE academic_enrollment_id IN (SELECT value FROM json_each(NEW.payload,'$.deletedEnrollmentIds'));
      DELETE FROM academic_outbox WHERE json_extract(data,'$.enrollmentId') IN (SELECT value FROM json_each(NEW.payload,'$.deletedEnrollmentIds'));
      DELETE FROM academic_enrollments WHERE id IN (SELECT value FROM json_each(NEW.payload,'$.deletedEnrollmentIds'));
      DELETE FROM academic_previews WHERE id IN (SELECT value FROM json_each(NEW.payload,'$.deletePreviewIds'));
      UPDATE academic_commands SET payload=(
        WITH RECURSIVE purge(step,data,paths) AS (
          SELECT 0,academic_commands.payload,json_extract(value,'$.paths') FROM json_each(NEW.payload,'$.purgeCommands') WHERE json_extract(value,'$.id')=academic_commands.id
          UNION ALL SELECT step+1,json_remove(data,json_extract(paths,'$['||step||']')),paths FROM purge WHERE step<json_array_length(paths)
        ) SELECT data FROM purge ORDER BY step DESC LIMIT 1
      ) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.payload,'$.purgeCommands'));
      INSERT INTO academic_file_cleanup(id,job_id,kind,object_key)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.jobId'),json_extract(value,'$.kind'),json_extract(value,'$.objectKey') FROM json_each(NEW.payload,'$.cleanupFiles');
      INSERT INTO academic_deletions(id,campaign_id,actor_id,enrollment_ids,reason,created_at)
        SELECT json_extract(NEW.payload,'$.deletionJob.id'),json_extract(NEW.payload,'$.deletionJob.campaignId'),NEW.actor_id,json_extract(NEW.payload,'$.deletionJob.enrollmentIds'),NEW.reason,NEW.created_at WHERE json_type(NEW.payload,'$.deletionJob') IS NOT NULL;
      UPDATE academic_commands SET payload=json_object('deletedEnrollmentIds',json_extract(NEW.payload,'$.deletedEnrollmentIds'),'jobId',json_extract(NEW.payload,'$.deletionJob.id')) WHERE id=NEW.id AND json_type(NEW.payload,'$.deletionJob') IS NOT NULL;
      UPDATE academic_meta SET revision=revision+1 WHERE id=1;
    END`,
  ];
  // Upgrade before accepting writers; preserve CAS and deletion guards together.
  await client.execute('DROP TRIGGER IF EXISTS academic_command_apply');
  await client.execute('DROP TRIGGER IF EXISTS academic_command_apply_v2');
  await client.execute('DROP TRIGGER IF EXISTS academic_command_apply_v3');
  for (const sql of statements) await client.execute(sql);
  const messageColumns = (await client.execute('PRAGMA table_info(academic_messages)')).rows as { name: string }[];
  for (const [name, type] of [['attachment_key', 'TEXT'], ['attachment_name', 'TEXT'], ['attachment_mime', 'TEXT'], ['attachment_size', 'INTEGER NOT NULL DEFAULT 0'], ['upload_size', 'INTEGER NOT NULL DEFAULT 0'], ['retracted_at', 'TEXT']]) {
    if (!messageColumns.some(c => c.name === name)) await client.execute(`ALTER TABLE academic_messages ADD COLUMN ${name} ${type}`);
  }
  for (const table of ['academic_messages', 'academic_questions']) {
    const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows as { name: string }[];
    if (!cols.some(c => c.name === 'campaign_id')) await client.execute(`ALTER TABLE ${table} ADD COLUMN campaign_id TEXT`);
  }
  await client.execute('UPDATE academic_messages SET upload_size=attachment_size WHERE upload_size=0 AND attachment_size>0');
  await client.execute("INSERT OR IGNORE INTO academic_schema_migrations(version,applied_at) VALUES(1,datetime('now'))");
  await client.execute("INSERT OR IGNORE INTO academic_schema_migrations(version,applied_at) VALUES(2,datetime('now'))");
  if((await previewProjectMembership(client)).conflicts.length)throw new Error('PROJECT_MEMBERSHIP_CONFLICT: Cần đối soát hồ sơ Dự án đã rút.');
  await migrateProjectTopics(client);
  await migrateProjectMembership(client);
}
