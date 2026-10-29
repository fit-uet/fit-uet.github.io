import { db } from '../db';
import { caseInsensitiveGlob } from '../academic/reads';

// Opt-in pagination keeps existing array/object responses intact for older clients.
export async function legacyRows(req: any, sql: string, args: any[] = [], options: { name?: string; status?: string; sort?: Record<string,string> } = {}) {
  if (req.query.pagination !== '1') return (await db.execute({sql,args})).rows as any[];
  const page = Math.max(1,Math.floor(Number(req.query.page)||1)), limit = Math.min(100,Math.max(1,Math.floor(Number(req.query.limit)||25)));
  const q = req.query, filters:string[] = [], values:any[] = [];
  const name = options.name || 'student_name';
  const extraSearch:Record<string,string[]> = {
    '/api/admin/registrations':['company_name','other_company_name','other_company_contact','review_comment'],
    '/api/admin/final-internships':['company_name','other_company_name','school_lecturer','other_company_role','note'],
    '/api/admin/advisor-assignments':['internship_place','primary_assignments','co_assignments'],
    '/api/admin/advisor-requests':['internship_place','lecturer_name','co_lecturer_name'],
    '/api/admin/reports/final':['internship_place','primary_advisors','co_advisors'],
    '/api/admin/grades':['internship_place','primary_advisors','co_advisors'],
    '/api/lecturer/students':['internship_place'],
    '/api/lecturer/grades':['internship_place']
  };
  const searchColumns=['student_id',name,'email','class_name',...(sql.includes('course_code')?['course_code']:[]),...(extraSearch[req.path]||[])];
  if(q.q){filters.push(`(${searchColumns.map(c=>`COALESCE(${c},'')`).join("||' '||")}) GLOB ?`);values.push(caseInsensitiveGlob(String(q.q).trim()));}
  if(q.courseCode){const code=String(q.courseCode).toUpperCase().match(/INT\d{4}/)?.[0];if(!code||!['INT4002','INT4003','INT3508'].includes(code)){req.legacyFilterError=true;return [];}filters.push(`instr(upper(COALESCE(course_code,'')),?)>0`);values.push(code);}
  if(q.classId){filters.push(`EXISTS(SELECT 1 FROM academic_classes c WHERE c.id=? AND json_extract(c.data,'$.legacy')=1 AND instr(upper(COALESCE(source.course_code,'')),json_extract(c.data,'$.courseCode'))>0)`);values.push(String(q.classId));}
  if(q.lecturerId){filters.push(`EXISTS(SELECT 1 FROM advisor_assignments a WHERE a.user_id=source.user_id AND a.lecturer_id=?)`);values.push(Number(q.lecturerId));}
  if(q.advisor && sql.includes('primary_advisors')){filters.push(`instr(COALESCE(primary_advisors,''),?)>0`);values.push(String(q.advisor));}
  const statusColumn=options.status || (sql.includes('grade_status')?'grade_status':sql.includes('report_status')?'report_status':sql.includes('internship_type')?'internship_type':null);
  if(q.status==='unassigned'&&sql.includes('primary_assignments')){filters.push(`COALESCE(primary_assignments,'')=''`);}else if(q.status&&statusColumn){if(q.status==='unassigned'&&sql.includes('primary_assignments'))filters.push(`COALESCE(primary_assignments,'')=''`);else{filters.push(`COALESCE(${statusColumn},'${statusColumn==='grade_status'?'missing':'missing'}')=?`);values.push(String(q.status));}}
  const sortMap:Record<string,string>={student_id:'student_id',student_name:name,student:`COALESCE(${name},'')||' '||COALESCE(student_id,'')`};
  if(req.path==='/api/admin/advisor-assignments')sortMap.primary_assignments='primary_assignment_names';
  if(req.path==='/api/admin/advisor-requests')Object.assign(sortMap,{lecturer:"COALESCE(lecturer_name,lecturer_name_text,'')||' '||COALESCE(co_lecturer_name,co_lecturer_name_text,'')",request_status:"COALESCE(status,'')||' '||COALESCE(quota_status,'')",student_note:'student_note'});
  for (const key of ['email','class_name','course_code','confirmed_at','internship_type','internship_place','report_submitted_at','grade_status','school_lecturer','dob','phone','personal_email','company_name','note','created_at','sent_to_company_at','status','review_comment']) if(sql.includes(key))sortMap[key]=key;
  if(req.path==='/api/admin/final-internships')sortMap.internship_place="CASE WHEN company_name='Công ty khác' THEN other_company_name ELSE company_name END";
  Object.assign(sortMap,options.sort);const sort=sortMap[String(q.sort)]||'student_id';const direction=q.direction==='desc'?'DESC':'ASC';
  const cte=`WITH source AS (${sql.replace(/;\s*$/,'')}), filtered AS (SELECT * FROM source ${filters.length?'WHERE '+filters.join(' AND '):''})`;
  const stats=[`count(*) total`,`count(DISTINCT student_id) studentCount`];
  if(sql.includes('contacted_at'))stats.push(`sum(CASE WHEN contacted_at IS NULL THEN 1 ELSE 0 END) uncontacted`);
  if(sql.includes('confirmed_at'))stats.push(`sum(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) confirmed`);
  if(sql.includes('report_status'))for(const status of ['missing','submitted','accepted','needs_revision'])stats.push(`sum(CASE WHEN COALESCE(report_status,'missing')='${status}' THEN 1 ELSE 0 END) report_${status}`);
  if(sql.includes('grade_status')){stats.push(`sum(CASE WHEN COALESCE(grade_status,'missing')='missing' THEN 1 ELSE 0 END) grade_missing`,`(SELECT count(DISTINCT lecturer_id) FROM advisor_assignments WHERE role='primary' AND user_id IN (SELECT user_id FROM filtered WHERE COALESCE(grade_status,'missing')!='submitted')) pendingLecturersCount`,`sum(CASE WHEN grade_status='submitted' THEN 1 ELSE 0 END) graded`,`sum(CASE WHEN ${sql.includes('grade_locked_at')?'grade_locked_at':'locked_at'} IS NOT NULL THEN 1 ELSE 0 END) locked`);}
  if(/\bas company_name\b/i.test(sql))stats.push(`count(DISTINCT CASE WHEN company_name='Công ty khác' THEN other_company_name ELSE company_name END) places`);
  if(options.status==='status') for(const state of ['pending','approved','rejected'])stats.push(`sum(CASE WHEN status='${state}' THEN 1 ELSE 0 END) registration_${state}`);
  if(sql.includes('internship_type')||options.status==='internship_type')stats.push(`sum(CASE WHEN internship_type='company' THEN 1 ELSE 0 END) companies`,`sum(CASE WHEN internship_type='school' THEN 1 ELSE 0 END) schools`);
  if(sql.includes('primary_assignments'))stats.push(`sum(CASE WHEN COALESCE(primary_assignments,'')='' THEN 1 ELSE 0 END) unassigned`);
  if(sql.includes('primary_advisors'))stats.push(`json_group_array(DISTINCT primary_advisors) advisorOptions`);
  if(q.classId)stats.push(`(SELECT count(*) FROM academic_classes WHERE id=? AND json_extract(data,'$.legacy')=1) validClass`);
  const results=await db.batch([{sql:`${cte} SELECT ${stats.join(',')} FROM filtered`,args:[...args,...values,...(q.classId?[String(q.classId)]:[])]},{sql:`${cte} SELECT * FROM filtered ORDER BY ${sort} ${direction},student_id ASC LIMIT ? OFFSET ?`,args:[...args,...values,limit,(page-1)*limit]}],'read');
  const rows=(result:any)=>result.rows||result.results||[];
  const summary=rows(results[0])[0];if(q.classId&&!summary?.validClass){req.legacyFilterError=true;return [];}
  req.legacyPage={total:Number(summary?.total||0),studentCount:Number(summary?.studentCount||0),page,limit,totalPages:Math.max(1,Math.ceil(Number(summary?.total||0)/limit)),summary};
  return rows(results[1]);
}
export function legacyPagingMiddleware(req:any,res:any,next:any){
  if(req.query.pagination!=='1'||req.method!=='GET')return next();
  const json=res.json.bind(res);
  res.json=(data:any)=>{
    if(req.legacyFilterError)return json.call(res.status(422),{error:'Lớp/học phần không thuộc nhóm Thực tập cũ.'});
    if(!req.legacyPage||res.statusCode!==200)return json(data);
    const body=Array.isArray(data)?{}:{...data};const items=Array.isArray(data)?data:body.rows||[];delete body.rows;
    return json({...body,...req.legacyPage,items});
  };
  next();
}
