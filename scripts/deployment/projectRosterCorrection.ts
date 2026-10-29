import {randomUUID} from 'node:crypto';
import type {DatabaseClient} from '../../server/types';
import type {Snapshot} from '../../server/academic/store';
import {compoundSelect} from '../../server/services/compoundSelect';
export async function readRosterSnapshot(client:DatabaseClient,campaignId:string):Promise<Snapshot>{
 // This administrative correction needs only one project campaign. In
 // particular, never hydrate or scan the independent legacy internship tables.
 const query=compoundSelect([
  "SELECT 'revision' kind,CAST(revision AS TEXT) data FROM academic_meta WHERE id=1",
  "SELECT 'campaigns',data FROM academic_campaigns WHERE id=(SELECT id FROM scope) AND course_group='project'",
  "SELECT 'semesters',data FROM academic_semesters WHERE id=(SELECT semester_id FROM academic_campaigns WHERE id=(SELECT id FROM scope))",
  "SELECT 'classes',data FROM academic_classes WHERE json_extract(data,'$.campaignId')=(SELECT id FROM scope)",
  "SELECT 'enrollments',e.data FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE json_extract(c.data,'$.campaignId')=(SELECT id FROM scope)",
  "SELECT 'lecturers',json_object('id',id,'name',name,'email',COALESCE(email,''),'work_unit',COALESCE(work_unit,'')) FROM lecturers",
 ],'WITH scope AS (SELECT ? id)');
 const s:Snapshot={revision:0,campaigns:[],semesters:[],classes:[],enrollments:[],quotas:[],lecturers:[]};
 for(const row of (await client.execute({sql:query,args:[campaignId]})).rows){
  if(row.kind==='revision')s.revision=Number(row.data);
  else s[String(row.kind)].push(JSON.parse(String(row.data)));
 }
 return s;
}
export type RosterCorrection={campaignId:string;revision:number;sourceHash:string;keys:string[];keep:number;students:number;remove:{id:string;revision:number}[]};
export function planRosterCorrection(s:Snapshot,campaignId:string,rows:{studentId:string;classCode:string}[],sourceHash:string):RosterCorrection{
 const campaign=s.campaigns?.find(p=>p.id===campaignId);if(campaign?.group!=='project'||campaign.status!=='active')throw Error('ACTIVE_PROJECT_REQUIRED');
 const classes=s.classes.filter(c=>c.campaignId===campaignId),ids=new Set(classes.map(c=>c.id)),keys=new Set<string>();
 for(const row of rows){const c=classes.find(c=>c.code===row.classCode);if(!c||!/^\d{8}$/.test(row.studentId))throw Error('INVALID_ROSTER_IDENTITY');keys.add(c.id+'|'+row.studentId);}
 if(!keys.size)throw Error('EMPTY_ROSTER');const current=s.enrollments.filter(e=>ids.has(e.classId));
 const selected=current.filter(e=>keys.has(e.classId+'|'+e.studentId));if(selected.length!==keys.size)throw Error('ROSTER_NOT_FULLY_PRESENT');
 const remove=current.filter(e=>!keys.has(e.classId+'|'+e.studentId));
 for(const e of remove)if(e.topic.trim()||e.assignments.length||Object.keys(e.evaluations).length||e.internshipGrade||e.lockedAt||e.submissionLockedAt||e.versions.some(v=>v.state!=='empty'||v.objectKey||v.slidesUrl||v.demoUrl))throw Error('PROTECTED_ENROLLMENT:'+e.id);
 return{campaignId,revision:s.revision,sourceHash,keys:[...keys].sort(),keep:selected.length,students:new Set(selected.map(e=>e.studentId)).size,remove:remove.map(e=>({id:e.id,revision:e.revision})).sort((a,b)=>a.id.localeCompare(b.id))};
}
const trigger=`CREATE TRIGGER IF NOT EXISTS academic_roster_correction AFTER INSERT ON academic_commands WHEN NEW.action='admin.project.roster.correct' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM academic_campaigns WHERE id=json_extract(NEW.payload,'$.rosterCorrection.campaignId') AND course_group='project' AND json_extract(data,'$.status')='active') THEN RAISE(ABORT,'ROSTER_SCOPE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.rosterCorrection.remove') r LEFT JOIN academic_enrollments e ON e.id=json_extract(r.value,'$.id') LEFT JOIN academic_classes c ON c.id=e.class_id WHERE e.id IS NULL OR json_extract(e.data,'$.revision')!=json_extract(r.value,'$.revision') OR json_extract(c.data,'$.campaignId')!=json_extract(NEW.payload,'$.rosterCorrection.campaignId') OR e.class_id||'|'||e.student_id IN (SELECT value FROM json_each(NEW.payload,'$.rosterCorrection.keys'))) THEN RAISE(ABORT,'ROSTER_STALE') END;
 SELECT CASE WHEN (SELECT count(*) FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE json_extract(c.data,'$.campaignId')=json_extract(NEW.payload,'$.rosterCorrection.campaignId') AND e.class_id||'|'||e.student_id NOT IN (SELECT value FROM json_each(NEW.payload,'$.rosterCorrection.keys'))) != json_array_length(NEW.payload,'$.rosterCorrection.remove') THEN RAISE(ABORT,'ROSTER_STALE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM academic_enrollments e WHERE e.id IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.payload,'$.rosterCorrection.remove')) AND (trim(COALESCE(json_extract(e.data,'$.topic'),''))!='' OR json_array_length(e.data,'$.assignments')>0 OR EXISTS(SELECT 1 FROM json_each(e.data,'$.evaluations')) OR json_extract(e.data,'$.internshipGrade') IS NOT NULL OR json_extract(e.data,'$.lockedAt') IS NOT NULL OR json_extract(e.data,'$.submissionLockedAt') IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(e.data,'$.versions') v WHERE json_extract(v.value,'$.state')!='empty' OR COALESCE(json_extract(v.value,'$.objectKey'),'')!='' OR COALESCE(json_extract(v.value,'$.slidesUrl'),'')!='' OR COALESCE(json_extract(v.value,'$.demoUrl'),'')!=''))) THEN RAISE(ABORT,'ROSTER_PROTECTED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM academic_messages WHERE enrollment_id IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.payload,'$.rosterCorrection.remove'))) THEN RAISE(ABORT,'ROSTER_PRIVATE_CHAT') END;
 DELETE FROM notifications WHERE academic_enrollment_id IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.payload,'$.rosterCorrection.remove'));
 DELETE FROM academic_outbox WHERE json_extract(data,'$.enrollmentId') IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.payload,'$.rosterCorrection.remove'));
 DELETE FROM academic_enrollments WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.payload,'$.rosterCorrection.remove'));
END`;
export async function applyRosterCorrection(client:DatabaseClient,actorId:number,plan:RosterCorrection,reason:string){
 if(!reason.trim())throw Error('REASON_REQUIRED');if(!plan.remove.length)return{removed:0};
 // The existing command trigger supplies global CAS, role guards, revision and
 // audit. This companion trigger applies the correction in that same statement.
 await client.execute(trigger);
 await client.execute({sql:'INSERT INTO academic_commands(id,expected_revision,actor_id,action,reason,payload,created_at) VALUES(?,?,?,?,?,?,?)',args:[randomUUID(),plan.revision,actorId,'admin.project.roster.correct',reason,JSON.stringify({rosterCorrection:plan}),new Date().toISOString()]});
 return{removed:plan.remove.length};
}
