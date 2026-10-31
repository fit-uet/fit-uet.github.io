import {searchMatch} from '../services/search';
export {caseInsensitiveGlob} from '../services/search';
import {compoundSelect} from '../services/compoundSelect';
import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { COURSE_CATALOG, EMPTY_CLASS_SETTINGS, GROUP_NAMES, campaignKey, type CourseEnrollment, type AcademicClass } from '../../src/shared/academic';
import { fail, type Snapshot } from './store';
import { canJoin, enrollmentView } from './service';
import { requireRead, getClass, course,lecturerFor } from './domain';
import { hydrateLegacy } from './legacy';

const campaignIdSql = `COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||CASE WHEN json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132') THEN ':project' ELSE ':internship' END)`;
const withoutContent = (data: string) => `json_remove(${data},'$.settings.plan','$.settings.lecturerGuide','$.settings.studentFaq','$.settings.lecturerFaq','$.settings.registrationRules')`;
// Read models use one consistent SQL snapshot, filter before transferring rows,
// and join live legacy assignments rather than treating the academic copy as truth.
function buildRecordCte(accessOnly=false, lookup: 'class' | 'student' | 'enrollment' = 'class'){
 // Materialize the scope before any legacy joins. An OR against an actor at the
 // end of a LEFT JOIN chain lets SQLite read other campaigns before filtering.
 const stored=accessOnly?`json_object('id',e.id,'classId',e.class_id,'studentId',e.student_id,
   'email',json_extract(e.data,'$.email'),'name',json_extract(e.data,'$.name'),
   'status',json_extract(e.data,'$.status'),'legacy',json_extract(e.data,'$.legacy'),
   'assignments',json(COALESCE(json_extract(e.data,'$.assignments'),'[]')))`:'e.data';
 const liveGrades=accessOnly?'':`,'$.lockedAt',g.locked_at,'$.reviewComment',COALESCE(fr.lecturer_comment,''),
   '$.internshipGrade',json(CASE WHEN g.progress_score IS NOT NULL AND g.report_score IS NOT NULL AND g.company_score IS NOT NULL THEN json_object('progress',g.progress_score,'report',g.report_score,'company',g.company_score,'comment',COALESCE(g.comment,''),'lecturerId',g.lecturer_id,'assignmentId',COALESCE((SELECT 'legacy-'||aa.id FROM advisor_assignments aa WHERE aa.user_id=u.id AND aa.role='primary' LIMIT 1),''),'submittedAt',COALESCE(g.updated_at,''),'updatedAt',COALESCE(g.updated_at,'')) ELSE 'null' END),
   '$.versions[#-1]',json(CASE WHEN fr.object_key IS NOT NULL THEN json_set(json_extract(e.data,'$.versions[#-1]'),'$.id','legacy-report-'||fr.id,'$.objectKey',fr.object_key,'$.filename',fr.original_filename,'$.size',fr.file_size,'$.state','submitted','$.submittedAt',fr.submitted_at) ELSE json_extract(e.data,'$.versions[#-1]') END)`;
 const versionProjection=accessOnly?'NULL v,NULL advisor,NULL reviewer,':`json_extract(j,'$.versions[#-1]') v,
 json_extract(j,'$.evaluations."'||json_extract(j,'$.versions[#-1].id')||'".advisor') advisor,
 json_extract(j,'$.evaluations."'||json_extract(j,'$.versions[#-1].id')||'".reviewer') reviewer,`;
 const scoring=accessOnly?'0 hasGrade,0 complete,0 requiresResubmission':`CASE WHEN json_extract(j,'$.internshipGrade') IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.evaluations."'||json_extract(v,'$.id')||'"')) WHERE value IS NOT NULL) THEN 1 ELSE 0 END hasGrade,
 CASE WHEN courseCode IN ('INT3131','INT3132') THEN CASE WHEN advisor IS NOT NULL AND reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.id')=json_extract(advisor,'$.assignmentId') AND json_extract(a.value,'$.lecturerId')=json_extract(advisor,'$.lecturerId') AND json_extract(a.value,'$.role')='primary') AND EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.id')=json_extract(reviewer,'$.assignmentId') AND json_extract(a.value,'$.lecturerId')=json_extract(reviewer,'$.lecturerId') AND json_extract(a.value,'$.role')='reviewer') THEN 1 ELSE 0 END ELSE CASE WHEN json_extract(j,'$.internshipGrade') IS NOT NULL THEN 1 ELSE 0 END END complete,
 CASE WHEN courseCode IN ('INT3131','INT3132') AND EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.versions')) WHERE json_extract(value,'$.state')='submitted') AND json_extract(v,'$.topicVersion') IS NOT json_extract(j,'$.topicReview.version') THEN 1 ELSE 0 END requiresResubmission`;
 return `WITH actor_input AS MATERIALIZED (SELECT ? role,? email,? lecturer,? campaignId,? enrollmentId), actor AS MATERIALIZED (SELECT role,email,lecturer,CASE WHEN enrollmentId!='' THEN (SELECT ${campaignIdSql} FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE e.id=actor_input.enrollmentId) ELSE campaignId END campaignId,enrollmentId,(SELECT l.id FROM lecturers l WHERE actor_input.lecturer=1 AND lower(trim(l.email))=actor_input.email LIMIT 1) identityLecturerId FROM actor_input),
 scoped_classes AS MATERIALIZED (
   SELECT c.id,c.code classCode,json_extract(c.data,'$.courseCode') courseCode,${campaignIdSql} campaignId,
     COALESCE(json_extract(p.data,'$.status'),'draft') campaignStatus
   FROM academic_classes c LEFT JOIN academic_campaigns p ON p.id=${campaignIdSql}
   WHERE (SELECT campaignId FROM actor)='' OR ${campaignIdSql}=(SELECT campaignId FROM actor)
 ), scoped AS MATERIALIZED (
   SELECT e.id,e.class_id,e.student_id,e.data,c.classCode,c.courseCode,c.campaignId,c.campaignStatus
   FROM ${lookup==='class'?'scoped_classes c CROSS JOIN actor CROSS JOIN academic_enrollments e':'actor CROSS JOIN academic_enrollments e JOIN scoped_classes c ON c.id=e.class_id'}
   WHERE e.class_id=c.id AND ${lookup==='enrollment'?'e.id=actor.enrollmentId':lookup==='student'?"lower(json_extract(e.data,'$.email'))=actor.email":"(actor.enrollmentId='' OR e.id=actor.enrollmentId)"}
   AND (actor.role='admin' OR actor.role='student' AND lower(json_extract(e.data,'$.email'))=actor.email
     OR actor.lecturer=1 AND CASE WHEN json_extract(e.data,'$.legacy')=1 THEN
       e.student_id IN (SELECT u.student_id FROM advisor_assignments aa JOIN users u ON u.id=aa.user_id
         WHERE aa.lecturer_id=(SELECT identityLecturerId FROM actor))
       ELSE EXISTS(SELECT 1 FROM json_each(e.data,'$.assignments') a WHERE json_extract(a.value,'$.lecturerId')=actor.identityLecturerId) END)
 ), legacy_rows AS MATERIALIZED (SELECT * FROM scoped WHERE json_extract(data,'$.legacy')=1),
 raw AS MATERIALIZED (
 SELECT e.id,e.class_id,e.student_id,e.classCode,e.courseCode,e.campaignId,e.campaignStatus,${stored} j
 FROM scoped e WHERE COALESCE(json_extract(e.data,'$.legacy'),0)!=1
 UNION ALL
 SELECT e.id,e.class_id,e.student_id,e.classCode,e.courseCode,e.campaignId,e.campaignStatus,
   json_set(${stored},'$.assignments',json(COALESCE((SELECT json_group_array(json_object('id','legacy-'||aa.id,'lecturerId',aa.lecturer_id,'role',aa.role,'assignedAt',COALESCE(aa.assigned_at,''))) FROM advisor_assignments aa WHERE aa.user_id=u.id),'[]')),
   '$.name',COALESCE(u.name,json_extract(e.data,'$.name')),'$.dob',COALESCE(u.dob,''),'$.className',COALESCE(u.class_name,'')
   ${liveGrades}) j
 FROM legacy_rows e LEFT JOIN users u ON u.student_id=e.student_id
 ${accessOnly?'':'LEFT JOIN final_reports fr ON fr.user_id=u.id LEFT JOIN grades g ON g.user_id=u.id'}
 ), pairs AS MATERIALIZED (
 SELECT *,${versionProjection}
 (SELECT identityLecturerId FROM actor) actorLecturerId
 FROM raw
 ), visible AS MATERIALIZED (
 SELECT *, CASE WHEN actor.role='admin' OR EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=actorLecturerId AND json_extract(a.value,'$.role') IN ('primary','reviewer')) THEN 1 ELSE 0 END canSeeGrades,
 ${scoring}
 FROM pairs CROSS JOIN actor WHERE actor.role='admin' OR campaignStatus!='draft' AND COALESCE(json_extract(j,'$.status'),'active')='active' AND (actor.role='student' AND lower(json_extract(j,'$.email'))=actor.email OR EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=actorLecturerId))
 ), records AS MATERIALIZED (
 SELECT *,CASE WHEN json_extract(j,'$.lockedAt') IS NOT NULL THEN 'locked' WHEN complete=1 THEN 'complete' WHEN hasGrade=1 THEN 'partial' ELSE 'missing' END gradeStatus FROM visible
 )`;
}
export const recordCte=buildRecordCte();
export const accessRecordCte=buildRecordCte(true);
export const accessRecordCteFor=(actor:AuthenticatedUser)=>buildRecordCte(true,actor.role==='student'?'student':'class');
const argsFor = (actor: AuthenticatedUser, id = '', enrollmentId = '') => [actor.role, actor.email.trim().toLowerCase(), actor.role === 'lecturer' || actor.role === 'admin' || actor.is_lecturer ? 1 : 0, id, enrollmentId];

export async function readContext(actor: AuthenticatedUser, id = '', section = 'full', enrollmentId = '', pageQuery?:Record<string,any>,accessOnly=false) {
  const pageFilter = pageQuery ? listFilter(pageQuery) : null;
  const membershipOnly=accessOnly||!enrollmentId&&!pageQuery&&!['overview','full'].includes(section);
  const records=membershipOnly?'membership':'records';
  const cte=buildRecordCte(membershipOnly,enrollmentId?'enrollment':actor.role==='student'?'student':'class')+`,
    membership AS MATERIALIZED (SELECT scoped.* FROM scoped CROSS JOIN actor WHERE actor.role='admin'
      OR scoped.campaignStatus!='draft' AND COALESCE(json_extract(scoped.data,'$.status'),'active')='active'),
    record_lecturers AS MATERIALIZED (SELECT DISTINCT json_extract(a.value,'$.lecturerId') lecturerId
      FROM records e,json_each(e.j,'$.assignments') a)`;
  const needsLecturerDirectory=['management','full'].includes(section)&&!accessOnly;
  const page = Math.max(1,Math.floor(Number(pageQuery?.page)||1)), limit=Math.min(100,Math.max(1,Math.floor(Number(pageQuery?.limit)||25)));
  const light = section === 'base' || section === 'overview' || section === 'management';
  const gradingSummary=pageQuery?.projection==='grades'?`, 'gradingSummary',json_object(
    'advisorSubmitted',COALESCE(sum(CASE WHEN canSeeGrades=1 AND advisor IS NOT NULL THEN 1 ELSE 0 END),0),
    'reviewerSubmitted',COALESCE(sum(CASE WHEN canSeeGrades=1 AND reviewer IS NOT NULL THEN 1 ELSE 0 END),0),
    'completed',COALESCE(sum(CASE WHEN canSeeGrades=1 AND complete=1 THEN 1 ELSE 0 END),0),
    'locked',COALESCE(sum(CASE WHEN canSeeGrades=1 AND gradeStatus='locked' THEN 1 ELSE 0 END),0))`:'';
  const result = (await db.execute({ sql: compoundSelect(`
    SELECT 'revision' kind,CAST(revision AS TEXT) data FROM academic_meta WHERE id=1
    UNION ALL SELECT 'campaigns',${light ? withoutContent('data') : 'data'} data FROM academic_campaigns WHERE (SELECT campaignId FROM actor)='' OR id=(SELECT campaignId FROM actor)
    UNION ALL SELECT 'classes',${light ? withoutContent('c.data') : 'c.data'} FROM academic_classes c WHERE (SELECT campaignId FROM actor)='' OR ${campaignIdSql}=(SELECT campaignId FROM actor)
    ${enrollmentId?"UNION ALL SELECT 'enrollments',j FROM records\n    UNION ALL SELECT 'targetExists',json_object('n',count(*)) FROM academic_enrollments WHERE id=(SELECT enrollmentId FROM actor)":''}
    UNION ALL SELECT 'semesters',data FROM academic_semesters
    UNION ALL SELECT 'lecturers',json_object('id',id,'name',name,'email',COALESCE(email,''),'work_unit',COALESCE(work_unit,'')) FROM lecturers WHERE ${needsLecturerDirectory?"(SELECT role FROM actor)='admin' OR (SELECT campaignId FROM actor)='' OR EXISTS(SELECT 1 FROM academic_campaigns p WHERE p.id=(SELECT campaignId FROM actor) AND p.course_group='internship') OR lower(trim(email))=(SELECT email FROM actor) OR id IN (SELECT lecturerId FROM record_lecturers)":"lower(trim(email))=(SELECT email FROM actor)"}
    UNION ALL SELECT 'quotas',data FROM academic_quotas WHERE ${section === 'full' || section === 'management' ? "(SELECT role FROM actor)='admin'" : '0'}
    UNION ALL SELECT 'counts',json_object('campaignId',campaignId,'studentCount',count(DISTINCT student_id),'enrollmentCount',count(*)${membershipOnly?'':",'submitted',sum(CASE WHEN json_extract(v,'$.state')='submitted' AND requiresResubmission=0 THEN 1 ELSE 0 END),'graded',sum(CASE WHEN gradeStatus IN ('complete','locked') THEN 1 ELSE 0 END),'advisorMissing',sum(CASE WHEN canSeeGrades=1 AND advisor IS NULL THEN 1 ELSE 0 END),'reviewerMissing',sum(CASE WHEN canSeeGrades=1 AND reviewer IS NULL THEN 1 ELSE 0 END)"}) FROM ${records} WHERE COALESCE(json_extract(${membershipOnly?'data':'j'},'$.status'),'active')='active' GROUP BY campaignId
    ${actor.role==='student'?"UNION ALL SELECT 'enrolledClasses',json_object('id',class_id) FROM actor CROSS JOIN academic_enrollments WHERE lower(json_extract(data,'$.email'))=actor.email":''}
    UNION ALL SELECT 'classCounts',json_object('classId',class_id,'n',count(*)) FROM ${records} WHERE COALESCE(json_extract(${membershipOnly?'data':'j'},'$.status'),'active')='active' GROUP BY class_id
    UNION ALL SELECT 'unmapped',json_object('value',CASE WHEN (SELECT role FROM actor)='student' AND NOT EXISTS(SELECT 1 FROM academic_enrollments WHERE json_extract(data,'$.legacy')=1 AND lower(json_extract(data,'$.email'))=(SELECT email FROM actor)) THEN 1 ELSE 0 END)
    UNION ALL SELECT 'settings',json_object('key',key,'value',value) FROM settings WHERE EXISTS(SELECT 1 FROM academic_campaigns p WHERE json_extract(p.data,'$.legacy')=1 AND ((SELECT campaignId FROM actor)='' OR p.id=(SELECT campaignId FROM actor)))
    ${pageFilter?`UNION ALL SELECT 'pageCount',json_object('total',count(*),'studentCount',count(DISTINCT student_id)${gradingSummary}) FROM records WHERE ${pageFilter.sql}
    UNION ALL SELECT 'pageItem',j FROM (SELECT * FROM records WHERE ${pageFilter.sql} ORDER BY student_id,classCode ${pageQuery.__all?'':'LIMIT ? OFFSET ?'})`:''}`.split(/\n\s*UNION ALL /),cte), args: [...argsFor(actor, id, enrollmentId),...(pageFilter?[...pageFilter.args,...pageFilter.args,...(pageQuery.__all?[]:[limit,(page-1)*limit])]:[])] })).rows;
  const s: Snapshot = { revision: 0, campaigns: [], semesters: [], classes: [], enrollments: [], quotas: [], lecturers: [] };
  const counts = new Map<string, any>(), classCounts = new Map<string, number>(); let unmapped = false, targetExists = false; let pageCount:{total:number;studentCount:number}|undefined;
  const settings: any[] = []; const enrolledClasses = new Set<string>();
  for (const row of result) {
    const item = JSON.parse(String(row.data));
    if(row.kind==='revision')s.revision=Number(item);
    else if(row.kind==='pageCount')pageCount=item;
    else if(row.kind==='pageItem')s.enrollments.push(item);
    else if (row.kind === 'counts') counts.set(item.campaignId, item);
    else if (row.kind === 'classCounts') classCounts.set(item.classId, item.n);
    else if (row.kind === 'unmapped') unmapped = !!item.value;
    else if (row.kind === 'settings') settings.push(item);
    else if (row.kind === 'enrolledClasses') enrolledClasses.add(item.id);
    else if (row.kind === 'targetExists') targetExists = item.n > 0;
    else s[String(row.kind)].push(item);
  }
  for (const p of s.campaigns!) p.settings = { ...EMPTY_CLASS_SETTINGS, ...p.settings };
  for (const c of s.classes) {
    const group = course(c).group; c.campaignId ||= campaignKey(c.semesterId, group);
    let p = s.campaigns!.find(p => p.id === c.campaignId);
    if (!p) { p = { id: c.campaignId, semesterId: c.semesterId, group, status: 'draft', legacy: c.legacy, pendingMigration: true, revision: 0, settings: { ...EMPTY_CLASS_SETTINGS, ...c.settings } }; s.campaigns!.push(p); }
    c.status = p.status; c.settings = { ...p.settings };
  }
  // No legacy enrollment hydration here; only the shared settings overlay.
  applyReadSettings(s, settings);
  if (light) for (const item of [...s.campaigns!, ...s.classes]) for (const field of ['plan','lecturerGuide','studentFaq','lecturerFaq','registrationRules']) item.settings[field] = '';
  const classes = s.classes.filter(c => actor.role === 'admin' || c.status !== 'draft' && (classCounts.get(c.id) || 0) > 0 || canJoin(c, actor)).map(c => ({ ...c, semesterName: s.semesters.find(x => x.id === c.semesterId)?.name || '', courseName: course(c).name, group: course(c).group, enrollmentCount: actor.role === 'admin' ? classCounts.get(c.id) || 0 : undefined, canJoin: canJoin(c, actor) && !enrolledClasses.has(c.id), canManage: actor.role === 'admin' }));
  const campaigns = s.campaigns!.filter(p => actor.role === 'admin' || !p.pendingMigration && classes.some(c => c.campaignId === p.id)).map(p => ({ ...p, semesterName: s.semesters.find(x => x.id === p.semesterId)?.name || '', name: `${GROUP_NAMES[p.group]} · ${s.semesters.find(x => x.id === p.semesterId)?.name || ''}`, classCount: classes.filter(c => c.campaignId === p.id).length, studentCount: counts.get(p.id)?.studentCount || 0, enrollmentCount: counts.get(p.id)?.enrollmentCount || 0 }));
  if (id && !s.campaigns!.some(p => p.id === id)) fail(404, 'CAMPAIGN_NOT_FOUND', 'Không tìm thấy nhóm môn.');
  if (id && !campaigns.some(p => p.id === id)) fail(403, 'CAMPAIGN_ACCESS_DENIED', 'Bạn không có quyền vào nhóm môn này.');
  return { s, campaigns, classes, counts, pageCount, targetExists, unmapped: unmapped && actor.legacy_internship_access === 1 };
}
function applyReadSettings(s: Snapshot, rows: any[]) {
  const settings = Object.fromEntries(rows.map(r => [r.key, String(r.value || '')]));
  for (const p of s.campaigns!.filter(p => p.legacy)) {
    for (const [field, old] of Object.entries({ topic: 'topic', registration: 'registration', confirmation: 'confirmation', advisorRequest: 'advisor_request', submission: 'final_report', grading: 'grading' })) for (const [suffix, key] of [['OpenAt','open_at'],['CloseAt','close_at']]) {
      const value = settings[`${old}_${key}`] || ''; const time = value ? new Date(/(Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ','T')}+07:00`) : null;
      p.settings[`${field}${suffix}`] = time && Number.isFinite(time.getTime()) ? time.toISOString() : value;
    }
    for (const [field,key] of Object.entries({ plan:'implementation_plan_md',registrationRules:'registration_rules_md',lecturerGuide:'lecturer_guide_md',studentFaq:'faq_student_md',lecturerFaq:'faq_lecturer_md',allowedCohorts:'allowed_registration_cohorts' })) if (settings[key] !== undefined) p.settings[field] = settings[key];
    p.settings.notifyOnCompletion = settings.notify_on_grade_submission !== '0';
    p.settings.publishGradesToStudents = settings.publish_grades_to_students === '1';
    for (const c of s.classes.filter(c=>c.campaignId===p.id)) c.settings={...p.settings};
  }
}
let readCaches = new WeakMap<object, Map<string, { data: any; expiresAt: number; stamp:string }>>();
let projectPages=new WeakMap<object,Map<string,{data:any;expiresAt:number;bytes:number}>>();
export function invalidateReadCache() {
  readCaches=new WeakMap();
  projectPages=new WeakMap();
}
async function readStamp(actor:AuthenticatedUser){
  return (await db.execute({sql:'SELECT revision,(SELECT id FROM lecturers WHERE ?=1 AND lower(trim(email))=? LIMIT 1) lecturerId FROM academic_meta WHERE id=1',args:[actor.role==='admin'||actor.role==='lecturer'||actor.is_lecturer?1:0,actor.email.trim().toLowerCase()]})).rows[0];
}
function metadataCache(){
  let cache=readCaches.get(db);if(!cache){cache=new Map();readCaches.set(db,cache);}
  for(const[key,item]of cache)if(item.expiresAt<=Date.now())cache.delete(key);
  while(cache.size>=100)cache.delete(cache.keys().next().value!);
  return cache;
}
const actorCacheKey=(actor:AuthenticatedUser)=>[actor.id,actor.role,actor.email.trim().toLowerCase(),!!actor.is_lecturer,actor.legacy_internship_access||0];
const stampKey=(stamp:any)=>JSON.stringify([Number(stamp.revision),stamp.lecturerId??null]);
function metadataExpiry(classes:AcademicClass[]){
  const now=Date.now();return Math.min(now+30_000,...classes.flatMap(c=>Object.entries(c.settings).filter(([key])=>key.endsWith('At')).map(([key,value])=>Date.parse(String(value))+(key.endsWith('CloseAt')?1:0))).filter(t=>Number.isFinite(t)&&t>now));
}

export async function readCampaignDetail(actor: AuthenticatedUser, id: string, section = 'full', useCached = true) {
  if (!['base','overview','content','management','full'].includes(section)) fail(422,'INVALID_SECTION','Phần dữ liệu không hợp lệ.');
  const cache=metadataCache();
  const cacheKey=JSON.stringify(['detail',...actorCacheKey(actor),id,section]);
  const cached=useCached?cache.get(cacheKey):undefined;
  if(cached){if(cached.stamp===stampKey(await readStamp(actor)))return structuredClone(cached.data);cache.delete(cacheKey);}
  const ctx = await readContext(actor,id,section); const p = ctx.campaigns.find(p=>p.id===id)!;
  const lecturers = section === 'base' || section === 'overview' || section === 'content' ? ctx.s.lecturers.filter(l=>l.email.toLowerCase()===actor.email.toLowerCase()) : ctx.s.lecturers;
  const result = { campaign:p, classes:ctx.classes, lecturers, quotas:ctx.s.quotas, stats:section==='overview'||section==='full'?ctx.counts.get(id)||{}:{} };
  // Legacy assignments/grades have writers outside academic_meta. Always read
  // that source live, including on conditional requests.
  if(p.group==='project'&&!p.legacy)cache.set(cacheKey, { data: structuredClone(result), expiresAt: metadataExpiry(ctx.s.classes),stamp:stampKey({revision:ctx.s.revision,lecturerId:lecturerFor(ctx.s,actor)?.id}) });
  return result;
}
export async function readCampaignCatalog(actor: AuthenticatedUser, section = 'full', useCached = true) {
  const cache=metadataCache();
  const cacheKey=JSON.stringify(['catalog',...actorCacheKey(actor),section]);
  const cached=useCached?cache.get(cacheKey):undefined;
  if(cached){if(cached.stamp===stampKey(await readStamp(actor)))return structuredClone(cached.data);cache.delete(cacheKey);}
  const ctx=await readContext(actor,'',section,'',undefined,true);
  const result = {campaigns:ctx.campaigns,semesters:ctx.s.semesters,courses:COURSE_CATALOG,legacyInternshipUnmapped:ctx.unmapped};
  if(!ctx.s.campaigns!.some(p=>p.legacy))cache.set(cacheKey, { data: structuredClone(result), expiresAt: metadataExpiry(ctx.s.classes),stamp:stampKey({revision:ctx.s.revision,lecturerId:lecturerFor(ctx.s,actor)?.id}) });
  return result;
}
function listFilter(query: Record<string, any>) {
  const filters=['1=1'];const args:any[]=[];
  for(const [name,sql] of [['classId','class_id'],['courseCode','courseCode']] as const) if(query[name]){filters.push(`${sql}=?`);args.push(String(query[name]));}
  if(query.lecturerId){filters.push(`EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=?)`);args.push(Number(query.lecturerId));}
  if(query.q){const search=searchMatch("(student_id||' '||json_extract(j,'$.name')||' '||json_extract(j,'$.topic'))",String(query.q));filters.push(search.sql);args.push(...search.args);}
  if(query.assignmentStatus){
    const has=(role:string)=>`EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.role')='${role}')`;
    const cases:Record<string,string>={missingPrimary:`NOT ${has('primary')}`,missingReviewer:`NOT ${has('reviewer')}`,complete:`${has('primary')} AND ${has('reviewer')}`};
    if(!cases[query.assignmentStatus])fail(422,'INVALID_ASSIGNMENT_FILTER','Trạng thái phân công không hợp lệ.');filters.push(cases[query.assignmentStatus]);
  }
  if(query.submissionStatus){
    const cases:Record<string,string>={notSubmitted:`(json_extract(v,'$.state')!='submitted' OR requiresResubmission=1)`,submitted:`(json_extract(v,'$.state')='submitted' AND requiresResubmission=0 AND COALESCE(json_extract(j,'$.needsRevision'),0)=0)`,needsRevision:`(requiresResubmission=1 OR json_extract(j,'$.needsRevision')=1)`};
    if(!cases[query.submissionStatus])fail(422,'INVALID_SUBMISSION_FILTER','Trạng thái bài nộp không hợp lệ.');filters.push(cases[query.submissionStatus]);
  }
  if(query.gradeStatus){
    if(['advisorMissing','reviewerMissing'].includes(query.gradeStatus)){filters.push(`canSeeGrades=1 AND ${query.gradeStatus==='advisorMissing'?'advisor':'reviewer'} IS NULL`);}
    else {if(!['missing','partial','complete','locked'].includes(query.gradeStatus))fail(422,'INVALID_GRADE_FILTER','Trạng thái điểm không hợp lệ.');filters.push('canSeeGrades=1 AND gradeStatus=?');args.push(query.gradeStatus);}
  }
  if(query.topicStatus){filters.push(`json_extract(j,'$.topicReview.status')=?`);args.push(String(query.topicStatus));}
  if(query.status&&query.status!=='all'){
    filters.push(`(gradeStatus=? OR json_extract(j,'$.status')=? OR ?='notSubmitted' AND (json_extract(v,'$.state')!='submitted' OR requiresResubmission=1) OR ?='advisorMissing' AND canSeeGrades=1 AND advisor IS NULL OR ?='reviewerMissing' AND canSeeGrades=1 AND reviewer IS NULL)`);args.push(...Array(5).fill(String(query.status)));
  }
  return {sql:filters.join(' AND '),args};
}
export async function readCampaignEnrollments(actor: AuthenticatedUser,id:string,query:Record<string,any>={},all=false,context?:Awaited<ReturnType<typeof readContext>>,useCached=true) {
  const cacheable=!all&&!context&&id.endsWith(':project');const now=Date.now();
  const keyFor=(revision:number,lecturerId:unknown)=>JSON.stringify([revision,actor.id,actor.role,actor.email.trim().toLowerCase(),!!actor.is_lecturer,lecturerId??null,id,Object.entries(query).sort(([a],[b])=>a.localeCompare(b))]);
  let bucket=projectPages.get(db);if(!bucket){bucket=new Map();projectPages.set(db,bucket);}
  for(const[key,item]of bucket)if(item.expiresAt<=now)bucket.delete(key);
  if(cacheable&&useCached&&bucket.size){
    const stamp=(await db.execute({sql:'SELECT revision,(SELECT id FROM lecturers WHERE ?=1 AND lower(trim(email))=? LIMIT 1) lecturerId FROM academic_meta WHERE id=1',args:[actor.role==='admin'||actor.role==='lecturer'||actor.is_lecturer?1:0,actor.email.trim().toLowerCase()]})).rows[0];
    const key=keyFor(Number(stamp.revision),stamp.lecturerId),cached=bucket.get(key);
    if(cached){bucket.delete(key);bucket.set(key,cached);return structuredClone(cached.data);}
  }
  let ctx=context || await readContext(actor,id,'management','',{...query,__all:all});
  if(query.focusEnrollmentId&&!query.page&&!all&&!ctx.s.enrollments.some(e=>e.id===query.focusEnrollmentId)){
    const f=listFilter(query);const rank=(await db.execute({sql:`${recordCte}, ranked AS (SELECT id,row_number() OVER(ORDER BY student_id,classCode) n FROM records WHERE ${f.sql}) SELECT n FROM ranked WHERE id=?`,args:[...argsFor(actor,id),...f.args,String(query.focusEnrollmentId)]})).rows[0];
    if(rank){query={...query,page:Math.floor((Number(rank.n)-1)/Math.min(100,Math.max(1,Number(query.limit)||25)))+1};ctx=await readContext(actor,id,'management','',{...query,__all:all});}
  }
  if(query.classId&&!ctx.s.classes.some(c=>c.id===query.classId)||query.courseCode&&!ctx.s.classes.some(c=>c.courseCode===query.courseCode))fail(422,'INVALID_CAMPAIGN_FILTER','Lớp/học phần không thuộc nhóm môn.');
  if(query.topicStatus&&(!['unregistered','pending','approved'].includes(query.topicStatus)||ctx.campaigns[0]?.group!=='project'))fail(422,'INVALID_TOPIC_FILTER','Trạng thái đề tài không hợp lệ.');
  const projection=query.projection;if(projection&&!['students','assignments','reports','grades','student-list'].includes(projection))fail(422,'INVALID_PROJECTION','Loại danh sách không hợp lệ.');
  const page=Math.max(1,Math.floor(Number(query.page)||1)),limit=Math.min(100,Math.max(1,Math.floor(Number(query.limit)||25)));
  const filter=listFilter(query);
  let count=ctx.pageCount;
  if(!count){
    const rows=(await db.execute({sql:`${recordCte},filtered AS (SELECT * FROM records WHERE ${filter.sql})
    SELECT 'count' kind,json_object('total',count(*),'studentCount',count(DISTINCT student_id)) data FROM filtered
    UNION ALL SELECT 'item',j FROM (SELECT * FROM filtered ORDER BY student_id,classCode ${all?'':'LIMIT ? OFFSET ?'})`,args:[...argsFor(actor,id),...filter.args,...(all?[]:[limit,(page-1)*limit])]})).rows;
    count=JSON.parse(String(rows.find(r=>r.kind==='count')!.data));
    ctx.s.enrollments=rows.filter(r=>r.kind==='item').map(r=>JSON.parse(String(r.data)));
  }
  if(ctx.s.enrollments.some(e=>e.legacy))await hydrateLegacy(ctx.s);
  const items=ctx.s.enrollments.map(e=>{const c=getClass(ctx.s,e.classId);const view=enrollmentView(ctx.s,c,e,actor);if(projection){view.versions=view.versions.slice(-1);if(!['grades','student-list'].includes(projection)){delete view.evaluations;delete view.internshipGrade;delete view.finalScore;}else if(view.evaluations)view.evaluations={[view.versions[0].id]:view.evaluations[view.versions[0].id]||{}};view.preferences=[];view.finalInternship=null;view.advisorRequest=null;view.note='';}return {...view,classCode:c.code,courseCode:c.courseCode};});
  const result={items,...count,page,limit,totalPages:Math.max(1,Math.ceil(count.total/limit))};
  if(cacheable&&ctx.campaigns.find(p=>p.id===id)?.group==='project'&&!ctx.s.enrollments.some(e=>e.legacy)){
    const key=keyFor(ctx.s.revision,lecturerFor(ctx.s,actor)?.id),bytes=Buffer.byteLength(JSON.stringify(result));
    const deadlines=[...ctx.s.classes.flatMap(c=>Object.entries(c.settings).filter(([k])=>k.endsWith('At')).map(([k,v])=>Date.parse(String(v))+(k.endsWith('CloseAt')?1:0))),...ctx.s.enrollments.flatMap(e=>[Date.parse(e.reopenUntil||'')+1,Date.parse(e.topicSubmissionUntil||'')+1])].filter(t=>Number.isFinite(t)&&t>now);
    if(bytes<=10*1024*1024){bucket.delete(key);bucket.set(key,{data:structuredClone(result),bytes,expiresAt:Math.min(now+30_000,...deadlines)});while(bucket.size>25||[...bucket.values()].reduce((n,x)=>n+x.bytes,0)>10*1024*1024)bucket.delete(bucket.keys().next().value!);}
  }
  return result;
}
export async function readEnrollment(actor: AuthenticatedUser,id:string) {
  const ctx=await readContext(actor,'','management',id);
  if(!ctx.s.enrollments.length)fail(ctx.targetExists?403:404,ctx.targetExists?'CLASS_ACCESS_DENIED':'ENROLLMENT_NOT_FOUND',ctx.targetExists?'Bạn không có quyền truy cập hồ sơ này.':'Không tìm thấy lần học.');
  if(ctx.s.enrollments[0].legacy)await hydrateLegacy(ctx.s);
  const e=ctx.s.enrollments[0],c=getClass(ctx.s,e.classId);requireRead(ctx.s,c,actor,e);
  return {s:ctx.s,c,e,view:enrollmentView(ctx.s,c,e,actor)};
}

// Communications need current membership, never submission histories or grades.
// This context is read-only; mutation services continue to take a CAS snapshot.
export async function readCommunicationContext(actor: AuthenticatedUser, target: string) {
  const row = (await db.execute({sql: `SELECT ${campaignIdSql} id FROM academic_classes c WHERE c.id=?`,args:[target]})).rows[0];
  const id = row ? String(row.id) : target;
  const [ctx, roster] = await Promise.all([
    readContext(actor,id,'base'),
    db.execute({sql:`${accessRecordCteFor(actor)} SELECT json_object('id',id,'classId',class_id,'studentId',student_id,'name',json_extract(j,'$.name'),'email',json_extract(j,'$.email'),'status',json_extract(j,'$.status'),'legacy',json_extract(j,'$.legacy'),'assignments',json(json_extract(j,'$.assignments'))) data FROM records`,args:argsFor(actor,id)})
  ]);
  ctx.s.enrollments = roster.rows.map(r=>JSON.parse(String(r.data)));
  return ctx;
}
