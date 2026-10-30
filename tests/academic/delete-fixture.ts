import {snapshot} from '../../server/academic/store';
import {previewProjectDeletion,applyProjectDeletion} from '../../server/academic/projectDeletion';
import type {AuthenticatedUser} from '../../server/types';
export async function removeProjectFixture(actor:AuthenticatedUser,id:string){const s=await snapshot(),e=s.enrollments.find(e=>e.id===id)!,c=s.classes.find(c=>c.id===e.classId)!;const p=await previewProjectDeletion(actor,c.campaignId,{enrollmentIds:[id]});return applyProjectDeletion(actor,c.campaignId,p.id,{reason:'Xóa khỏi danh sách kiểm thử'});}
