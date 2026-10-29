import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../types';
import type { CourseEnrollment, TopicReview } from '../../src/shared/academic';

export const emptyTopicReview = (at = new Date().toISOString()): TopicReview => ({
  status: 'unregistered', version: 0, updatedAt: at, source: null,
  approvedById: null, approvedByLecturerId: null, approvedByName: null, approvedAssignmentId: null, approvedAt: null,
});

// Read-only preview. No title, submission snapshot, grade or storage key is rewritten.
async function migrationSnapshot(client: DatabaseClient) {
  // Revision and candidates must come from the same SELECT. A writer on the old
  // instance during a rolling deploy must cause CAS rejection, never lost edits.
  const rows = (await client.execute(`SELECT 'revision' kind,CAST(revision AS TEXT) data FROM academic_meta WHERE id=1
    UNION ALL SELECT 'enrollment',e.data FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id
    WHERE json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132')`)).rows;
  const at = new Date().toISOString();
  const changes = rows.filter(row => row.kind === 'enrollment').map(row => JSON.parse(String(row.data)) as CourseEnrollment).filter(e => !e.topicReview).sort((a, b) => a.id.localeCompare(b.id)).map(before => {
    const after = structuredClone(before);
    const hasTitle = !!after.topic.trim();
    after.topicReview = { ...emptyTopicReview(at), status: hasTitle ? 'approved' : 'unregistered', version: hasTitle ? 1 : 0, source: hasTitle ? 'legacy' : null, approvedAt: hasTitle ? at : null };
    after.topicSubmissionUntil = null;
    for (const v of after.versions) v.topicVersion = v.title === after.topic ? after.topicReview.version : 0;
    // Historical submitted titles can differ from the editable title; retain their
    // existing grading eligibility until the first actual title change.
    for (const v of after.versions) if (v.state === 'submitted') v.topicVersion = after.topicReview.version;
    after.revision++;
    return { before, after };
  });
  return { revision: Number(rows.find(row => row.kind === 'revision')?.data), changes };
}
export async function previewTopicMigration(client: DatabaseClient) {
  return (await migrationSnapshot(client)).changes;
}

export async function migrateProjectTopics(client: DatabaseClient) {
  const { changes: rows, revision } = await migrationSnapshot(client);
  for (let start = 0; start < rows.length; start += 50) {
    const batch = rows.slice(start, start + 50);
    const payload = JSON.stringify({ enrollments: batch.map(r => r.after), before: { enrollments: batch.map(r => r.before) }, lecturerGuards: [] });
    if (Buffer.byteLength(payload) > 1_800_000) throw new Error('Topic metadata migration batch too large; no records in this batch changed.');
    await client.execute({ sql: 'INSERT INTO academic_commands(id,expected_revision,actor_id,action,reason,payload,created_at) VALUES(?,?,?,?,?,?,?)', args: [randomUUID(), revision + start / 50, 0, 'system.topic_metadata.migrate', 'Công nhận đề tài trước nâng cấp; bảo toàn bài nộp và điểm.', payload, new Date().toISOString()] });
  }
  await client.execute("INSERT OR IGNORE INTO academic_schema_migrations(version,applied_at) VALUES(3,datetime('now'))");
  return { migrated: rows.length };
}
