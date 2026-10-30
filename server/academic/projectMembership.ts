import {randomUUID} from 'node:crypto';
import type { DatabaseClient } from '../types';
export async function previewProjectMembership(client:DatabaseClient){
  // Revision and candidates share one database snapshot during rolling deploys.
  const records=(await client.execute(`SELECT CAST(revision AS TEXT) id,NULL class_id,NULL studentId,NULL status FROM academic_meta WHERE id=1
    UNION ALL SELECT e.id,e.class_id,json_extract(e.data,'$.studentId'),json_extract(e.data,'$.status') FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132') AND json_type(e.data,'$.status') IS NOT NULL`)).rows;
  const rows=records.filter(r=>r.class_id!==null);
  return {revision:Number(records.find(r=>r.class_id===null)?.id),changes:rows.filter(r=>r.status!=='withdrawn'),conflicts:rows.filter(r=>r.status==='withdrawn')};
}
export async function migrateProjectMembership(client:DatabaseClient){
  const p=await previewProjectMembership(client);if(p.conflicts.length)throw new Error('PROJECT_MEMBERSHIP_CONFLICT: Có hồ sơ Dự án đã rút; cần đối soát trước chuyển đổi.');
  if(p.changes.length){
    // A single command guarded by global CAS; do not rewrite academic history.
    await client.execute({sql:`INSERT INTO academic_commands(id,expected_revision,actor_id,action,reason,payload,created_at) VALUES(?,?,0,'system.project_membership.migrate','Dự án dùng danh sách làm căn cứ tham gia.',?,datetime('now'))`,args:[randomUUID(),p.revision,JSON.stringify({membershipMigration:true})]});
  }
  await client.execute("INSERT OR IGNORE INTO academic_schema_migrations(version,applied_at) VALUES(4,datetime('now'))");
}
