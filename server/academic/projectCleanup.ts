import {db} from '../db';
import {deleteReportObject,deleteChatAttachmentObject} from '../services/storage';
let draining:Promise<void>|null=null;
export async function drainProjectCleanup(remove=async(kind:string,key:string)=>kind==='report'?deleteReportObject(key):deleteChatAttachmentObject(key)){
  if(draining)return draining;
  draining=(async()=>{
    const rows=(await db.execute('SELECT id,job_id,kind,object_key FROM academic_file_cleanup ORDER BY rowid LIMIT 100')).rows;
    if(!rows.length)return;
    const tables=new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('final_reports','chat_messages','chat_group_messages')")).rows.map(r=>r.name));
    const legacy=[['final_reports','object_key'],['chat_messages','attachment_key'],['chat_group_messages','attachment_key']].filter(([table])=>tables.has(table));
    // Check references once per batch, rather than scan every source for each file.
    const keys=JSON.stringify(rows.map(r=>r.object_key));
    const used=new Set((await db.execute({sql:`WITH pending AS (SELECT value FROM json_each(?)) SELECT json_extract(v.value,'$.objectKey') object_key FROM academic_enrollments e,json_each(e.data,'$.versions') v WHERE json_extract(v.value,'$.objectKey') IN pending UNION SELECT attachment_key FROM academic_messages WHERE attachment_key IN pending ${legacy.map(([table,column])=>`UNION SELECT ${column} FROM ${table} WHERE ${column} IN pending`).join(' ')}`,args:[keys]})).rows.map(r=>r.object_key));
    for(const row of rows){
      try{
        // Reused files in another enrollment or group conversation must survive.
        if(!used.has(row.object_key))await remove(String(row.kind),String(row.object_key));
        await db.execute({sql:'DELETE FROM academic_file_cleanup WHERE id=?',args:[row.id]});
      }catch{await db.execute({sql:"UPDATE academic_file_cleanup SET attempts=attempts+1,last_error='Không xóa được tệp; sẽ thử lại.' WHERE id=?",args:[row.id]});}
    }
  })().finally(()=>{draining=null;});return draining;
}
