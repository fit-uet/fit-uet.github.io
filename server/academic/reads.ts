import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { COURSE_CATALOG, EMPTY_CLASS_SETTINGS, GROUP_NAMES, campaignKey, type CourseEnrollment, type AcademicClass } from '../../src/shared/academic';
import { fail, type Snapshot } from './store';
import { canJoin, enrollmentView } from './service';
import { requireRead, getClass, course } from './domain';
import { hydrateLegacy } from './legacy';

const campaignIdSql = `COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||CASE WHEN json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132') THEN ':project' ELSE ':internship' END)`;
const withoutContent = (data: string) => `json_remove(${data},'$.settings.plan','$.settings.lecturerGuide','$.settings.studentFaq','$.settings.lecturerFaq','$.settings.registrationRules')`;
// Read models use one consistent SQL snapshot, filter before transferring rows,
// and join live legacy assignments rather than treating the academic copy as truth.
export const recordCte = `WITH actor_input AS MATERIALIZED (SELECT ? role,? email,? lecturer,? campaignId,? enrollmentId), actor AS MATERIALIZED (SELECT role,email,lecturer,CASE WHEN enrollmentId!='' THEN (SELECT ${campaignIdSql} FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE e.id=actor_input.enrollmentId) ELSE campaignId END campaignId,enrollmentId FROM actor_input),
 raw AS MATERIALIZED (
 SELECT e.id,e.class_id,e.student_id,c.code classCode,json_extract(c.data,'$.courseCode') courseCode,${campaignIdSql} campaignId,
 COALESCE(json_extract(p.data,'$.status'),'draft') campaignStatus,
 CASE WHEN json_extract(e.data,'$.legacy')=1 THEN
   json_set(e.data,'$.assignments',json(COALESCE((SELECT json_group_array(json_object('id','legacy-'||aa.id,'lecturerId',aa.lecturer_id,'role',aa.role,'assignedAt',COALESCE(aa.assigned_at,''))) FROM advisor_assignments aa WHERE aa.user_id=u.id),'[]')),
   '$.name',COALESCE(u.name,json_extract(e.data,'$.name')),'$.dob',COALESCE(u.dob,''),'$.className',COALESCE(u.class_name,''),
   '$.lockedAt',g.locked_at,'$.reviewComment',COALESCE(fr.lecturer_comment,''),
   '$.internshipGrade',json(CASE WHEN g.progress_score IS NOT NULL AND g.report_score IS NOT NULL AND g.company_score IS NOT NULL THEN json_object('progress',g.progress_score,'report',g.report_score,'company',g.company_score,'comment',COALESCE(g.comment,''),'lecturerId',g.lecturer_id,'assignmentId',COALESCE((SELECT 'legacy-'||aa.id FROM advisor_assignments aa WHERE aa.user_id=u.id AND aa.role='primary' LIMIT 1),''),'submittedAt',COALESCE(g.updated_at,''),'updatedAt',COALESCE(g.updated_at,'')) ELSE 'null' END),
   '$.versions[#-1]',json(CASE WHEN fr.object_key IS NOT NULL THEN json_set(json_extract(e.data,'$.versions[#-1]'),'$.id','legacy-report-'||fr.id,'$.objectKey',fr.object_key,'$.filename',fr.original_filename,'$.size',fr.file_size,'$.state','submitted','$.submittedAt',fr.submitted_at) ELSE json_extract(e.data,'$.versions[#-1]') END))
 ELSE e.data END j
 FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id
 LEFT JOIN academic_campaigns p ON p.id=${campaignIdSql}
 LEFT JOIN users u ON json_extract(e.data,'$.legacy')=1 AND u.student_id=e.student_id
 LEFT JOIN final_reports fr ON fr.user_id=u.id LEFT JOIN grades g ON g.user_id=u.id CROSS JOIN actor
 WHERE (actor.campaignId='' OR ${campaignIdSql}=actor.campaignId) AND (actor.enrollmentId='' OR e.id=actor.enrollmentId)
 ), pairs AS MATERIALIZED (
 SELECT *,json_extract(j,'$.versions[#-1]') v,
 json_extract(j,'$.evaluations."'||json_extract(j,'$.versions[#-1].id')||'".advisor') advisor,
 json_extract(j,'$.evaluations."'||json_extract(j,'$.versions[#-1].id')||'".reviewer') reviewer,
 (SELECT id FROM lecturers,actor WHERE actor.lecturer=1 AND lower(trim(lecturers.email))=actor.email LIMIT 1) actorLecturerId
 FROM raw
 ), visible AS MATERIALIZED (
 SELECT *, CASE WHEN actor.role='admin' OR EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=actorLecturerId AND json_extract(a.value,'$.role') IN ('primary','reviewer')) THEN 1 ELSE 0 END canSeeGrades,
 CASE WHEN json_extract(j,'$.internshipGrade') IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.evaluations."'||json_extract(v,'$.id')||'"')) WHERE value IS NOT NULL) THEN 1 ELSE 0 END hasGrade,
 CASE WHEN courseCode IN ('INT3131','INT3132') THEN CASE WHEN advisor IS NOT NULL AND reviewer IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.id')=json_extract(advisor,'$.assignmentId') AND json_extract(a.value,'$.lecturerId')=json_extract(advisor,'$.lecturerId') AND json_extract(a.value,'$.role')='primary') AND EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.id')=json_extract(reviewer,'$.assignmentId') AND json_extract(a.value,'$.lecturerId')=json_extract(reviewer,'$.lecturerId') AND json_extract(a.value,'$.role')='reviewer') THEN 1 ELSE 0 END ELSE CASE WHEN json_extract(j,'$.internshipGrade') IS NOT NULL THEN 1 ELSE 0 END END complete,
 CASE WHEN courseCode IN ('INT3131','INT3132') AND EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.versions')) WHERE json_extract(value,'$.state')='submitted') AND json_extract(v,'$.topicVersion') IS NOT json_extract(j,'$.topicReview.version') THEN 1 ELSE 0 END requiresResubmission
 FROM pairs CROSS JOIN actor WHERE actor.role='admin' OR campaignStatus!='draft' AND json_extract(j,'$.status')='active' AND (actor.role='student' AND lower(json_extract(j,'$.email'))=actor.email OR EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=actorLecturerId))
 ), records AS MATERIALIZED (
 SELECT *,CASE WHEN json_extract(j,'$.lockedAt') IS NOT NULL THEN 'locked' WHEN complete=1 THEN 'complete' WHEN hasGrade=1 THEN 'partial' ELSE 'missing' END gradeStatus FROM visible
 )`;
const argsFor = (actor: AuthenticatedUser, id = '', enrollmentId = '') => [actor.role, actor.email.trim().toLowerCase(), actor.role === 'lecturer' || actor.role === 'admin' || actor.is_lecturer ? 1 : 0, id, enrollmentId];

export async function readContext(actor: AuthenticatedUser, id = '', section = 'full', enrollmentId = '') {
  const light = section === 'base' || section === 'overview' || section === 'management';
  const result = (await db.execute({ sql: `${recordCte}
    SELECT 'campaigns' kind,${light ? withoutContent('data') : 'data'} data FROM academic_campaigns WHERE (SELECT campaignId FROM actor)='' OR id=(SELECT campaignId FROM actor)
    UNION ALL SELECT 'classes',${light ? withoutContent('c.data') : 'c.data'} FROM academic_classes c WHERE (SELECT campaignId FROM actor)='' OR ${campaignIdSql}=(SELECT campaignId FROM actor)
    UNION ALL SELECT 'enrollments',j FROM records WHERE (SELECT enrollmentId FROM actor)!=''
    UNION ALL SELECT 'targetExists',json_object('n',count(*)) FROM raw WHERE (SELECT enrollmentId FROM actor)!=''
    UNION ALL SELECT 'semesters',data FROM academic_semesters
    UNION ALL SELECT 'lecturers',json_object('id',id,'name',name,'email',COALESCE(email,''),'work_unit',COALESCE(work_unit,'')) FROM lecturers WHERE (SELECT role FROM actor)='admin' OR (SELECT campaignId FROM actor)='' OR EXISTS(SELECT 1 FROM academic_campaigns p WHERE p.id=(SELECT campaignId FROM actor) AND p.course_group='internship') OR lower(trim(email))=(SELECT email FROM actor) OR EXISTS(SELECT 1 FROM records e,json_each(json_extract(e.j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=lecturers.id)
    UNION ALL SELECT 'quotas',data FROM academic_quotas WHERE ${section === 'full' || section === 'management' ? "(SELECT role FROM actor)='admin'" : '0'}
    UNION ALL SELECT 'counts',json_object('campaignId',campaignId,'studentCount',count(DISTINCT student_id),'enrollmentCount',count(*),'submitted',sum(CASE WHEN json_extract(v,'$.state')='submitted' AND requiresResubmission=0 THEN 1 ELSE 0 END),'graded',sum(CASE WHEN gradeStatus IN ('complete','locked') THEN 1 ELSE 0 END),'advisorMissing',sum(CASE WHEN canSeeGrades=1 AND advisor IS NULL THEN 1 ELSE 0 END),'reviewerMissing',sum(CASE WHEN canSeeGrades=1 AND reviewer IS NULL THEN 1 ELSE 0 END)) FROM records WHERE json_extract(j,'$.status')='active' GROUP BY campaignId
    UNION ALL SELECT 'enrolledClasses',json_object('id',class_id) FROM academic_enrollments CROSS JOIN actor WHERE lower(json_extract(data,'$.email'))=actor.email
    UNION ALL SELECT 'classCounts',json_object('classId',class_id,'n',count(*)) FROM records WHERE json_extract(j,'$.status')='active' GROUP BY class_id
    UNION ALL SELECT 'unmapped',json_object('value',CASE WHEN (SELECT role FROM actor)='student' AND NOT EXISTS(SELECT 1 FROM academic_enrollments WHERE json_extract(data,'$.legacy')=1 AND lower(json_extract(data,'$.email'))=(SELECT email FROM actor)) THEN 1 ELSE 0 END)
    UNION ALL SELECT 'settings',json_object('key',key,'value',value) FROM settings WHERE EXISTS(SELECT 1 FROM academic_campaigns p WHERE json_extract(p.data,'$.legacy')=1 AND ((SELECT campaignId FROM actor)='' OR p.id=(SELECT campaignId FROM actor)))`, args: argsFor(actor, id, enrollmentId) })).rows;
  const s: Snapshot = { revision: 0, campaigns: [], semesters: [], classes: [], enrollments: [], quotas: [], lecturers: [] };
  const counts = new Map<string, any>(), classCounts = new Map<string, number>(); let unmapped = false, targetExists = false;
  const settings: any[] = []; const enrolledClasses = new Set<string>();
  for (const row of result) {
    const item = JSON.parse(String(row.data));
    if (row.kind === 'counts') counts.set(item.campaignId, item);
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
  return { s, campaigns, classes, counts, targetExists, unmapped: unmapped && actor.legacy_internship_access === 1 };
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
    for (const c of s.classes.filter(c=>c.campaignId===p.id)) c.settings={...p.settings};
  }
}
export async function readCampaignDetail(actor: AuthenticatedUser, id: string, section = 'full') {
  if (!['base','overview','content','management','full'].includes(section)) fail(422,'INVALID_SECTION','Phần dữ liệu không hợp lệ.');
  const ctx = await readContext(actor,id,section); const p = ctx.campaigns.find(p=>p.id===id)!;
  const lecturers = section === 'base' || section === 'overview' || section === 'content' ? ctx.s.lecturers.filter(l=>l.email.toLowerCase()===actor.email.toLowerCase()) : ctx.s.lecturers;
  return { campaign:p, classes:ctx.classes, lecturers, quotas:ctx.s.quotas, stats:section==='overview'||section==='full'?ctx.counts.get(id)||{}:{} };
}
export async function readCampaignCatalog(actor: AuthenticatedUser, section = 'full') {
  const ctx=await readContext(actor,'',section);
  return {campaigns:ctx.campaigns,semesters:ctx.s.semesters,courses:COURSE_CATALOG,legacyInternshipUnmapped:ctx.unmapped};
}
export function caseInsensitiveGlob(value: string) {
  return '*' + Array.from(value.normalize('NFC')).map(c => c === '*' ? '[*]' : c === '?' ? '[?]' : c === '[' ? '[[]' : c.toLowerCase() !== c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c).join('') + '*';
}
function listFilter(query: Record<string, any>) {
  const filters=['1=1'];const args:any[]=[];
  for(const [name,sql] of [['classId','class_id'],['courseCode','courseCode']] as const) if(query[name]){filters.push(`${sql}=?`);args.push(String(query[name]));}
  if(query.lecturerId){filters.push(`EXISTS(SELECT 1 FROM json_each(json_extract(j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=?)`);args.push(Number(query.lecturerId));}
  if(query.q){filters.push(`(student_id||' '||json_extract(j,'$.name')||' '||json_extract(j,'$.topic')) GLOB ?`);args.push(caseInsensitiveGlob(String(query.q)));}
  if(query.topicStatus){filters.push(`json_extract(j,'$.topicReview.status')=?`);args.push(String(query.topicStatus));}
  if(query.status&&query.status!=='all'){
    filters.push(`(gradeStatus=? OR json_extract(j,'$.status')=? OR ?='notSubmitted' AND (json_extract(v,'$.state')!='submitted' OR requiresResubmission=1) OR ?='advisorMissing' AND canSeeGrades=1 AND advisor IS NULL OR ?='reviewerMissing' AND canSeeGrades=1 AND reviewer IS NULL)`);args.push(...Array(5).fill(String(query.status)));
  }
  return {sql:filters.join(' AND '),args};
}
export async function readCampaignEnrollments(actor: AuthenticatedUser,id:string,query:Record<string,any>={},all=false,context?:Awaited<ReturnType<typeof readContext>>) {
  const ctx=context || await readContext(actor,id,'management');
  if(query.classId&&!ctx.s.classes.some(c=>c.id===query.classId)||query.courseCode&&!ctx.s.classes.some(c=>c.courseCode===query.courseCode))fail(422,'INVALID_CAMPAIGN_FILTER','Lớp/học phần không thuộc nhóm môn.');
  if(query.topicStatus&&(!['unregistered','pending','approved'].includes(query.topicStatus)||ctx.campaigns[0]?.group!=='project'))fail(422,'INVALID_TOPIC_FILTER','Trạng thái đề tài không hợp lệ.');
  const projection=query.projection;if(projection&&!['students','assignments','reports','grades'].includes(projection))fail(422,'INVALID_PROJECTION','Loại danh sách không hợp lệ.');
  const page=Math.max(1,Math.floor(Number(query.page)||1)),limit=Math.min(100,Math.max(1,Math.floor(Number(query.limit)||25)));
  const filter=listFilter(query);
  const rows=(await db.execute({sql:`${recordCte},filtered AS (SELECT * FROM records WHERE ${filter.sql})
    SELECT 'count' kind,json_object('total',count(*),'studentCount',count(DISTINCT student_id)) data FROM filtered
    UNION ALL SELECT 'item',j FROM (SELECT * FROM filtered ORDER BY student_id,classCode ${all?'':'LIMIT ? OFFSET ?'})`,args:[...argsFor(actor,id),...filter.args,...(all?[]:[limit,(page-1)*limit])]})).rows;
  const count=JSON.parse(String(rows.find(r=>r.kind==='count')!.data));
  ctx.s.enrollments=rows.filter(r=>r.kind==='item').map(r=>JSON.parse(String(r.data)));
  if(ctx.s.enrollments.some(e=>e.legacy))await hydrateLegacy(ctx.s);
  const items=ctx.s.enrollments.map(e=>{const c=getClass(ctx.s,e.classId);const view=enrollmentView(ctx.s,c,e,actor);if(projection){view.versions=view.versions.slice(-1);if(projection!=='grades'){delete view.evaluations;delete view.internshipGrade;delete view.finalScore;}else if(view.evaluations)view.evaluations={[view.versions[0].id]:view.evaluations[view.versions[0].id]||{}};view.preferences=[];view.finalInternship=null;view.advisorRequest=null;view.note='';}return {...view,classCode:c.code,courseCode:c.courseCode};});
  return {items,...count,page,limit,totalPages:Math.max(1,Math.ceil(count.total/limit))};
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
    db.execute({sql:`${recordCte} SELECT json_object('id',id,'classId',class_id,'studentId',student_id,'name',json_extract(j,'$.name'),'email',json_extract(j,'$.email'),'status',json_extract(j,'$.status'),'legacy',json_extract(j,'$.legacy'),'assignments',json(json_extract(j,'$.assignments'))) data FROM records`,args:argsFor(actor,id)})
  ]);
  ctx.s.enrollments = roster.rows.map(r=>JSON.parse(String(r.data)));
  return ctx;
}
