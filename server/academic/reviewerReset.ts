import type { AuthenticatedUser } from '../types';
import { campaignClasses, requireCampaign } from './campaigns';
import { hasGrade, requireAdmin, requireRevision, text } from './domain';
import { commit, fail, snapshot, type Snapshot } from './store';

function resetPlan(s: Snapshot, actor: AuthenticatedUser, campaignId: string) {
  requireAdmin(actor);
  const campaign = requireCampaign(s, campaignId, actor, true);
  if (campaign.group !== 'project' || campaign.legacy) fail(422, 'PROJECT_REQUIRED', 'Chỉ gỡ GVNX trong nhóm Thực hành nghiên cứu.');
  const classes = campaignClasses(s, campaignId);
  const targets = s.enrollments.filter(e => classes.some(c => c.id === e.classId) && e.assignments.some(a => a.role === 'reviewer'));
  return { targets, summary: {
    campaignId, revision: s.revision, enrollments: targets.length,
    assignments: targets.reduce((n, e) => n + e.assignments.filter(a => a.role === 'reviewer').length, 0),
    protectedEnrollments: targets.filter(e => hasGrade(e) || e.lockedAt).map(e => ({ id:e.id, studentId:e.studentId, classId:e.classId })),
    classes: classes.map(c => ({ id:c.id, code:c.code, enrollments:targets.filter(e=>e.classId===c.id).length })),
  } };
}
// Explicit maintenance operation; never called during startup, import or page load.
export async function reviewerResetPreview(actor: AuthenticatedUser, campaignId: string) {
  return resetPlan(await snapshot(), actor, campaignId).summary;
}
export async function resetProjectReviewers(actor: AuthenticatedUser, campaignId: string, input: {expectedRevision:number;reason:string}) {
  const s = await snapshot(), plan = resetPlan(s, actor, campaignId);
  requireRevision(s.revision, input.expectedRevision);
  if (!text(input.reason)) fail(422, 'REASON_REQUIRED', 'Cần lý do gỡ phân công GVNX.');
  if (plan.summary.protectedEnrollments.length) fail(409, 'EVALUATED_ASSIGNMENT', 'Có hồ sơ đã chấm hoặc khóa điểm; chưa gỡ bất kỳ phân công nào.', plan.summary.protectedEnrollments);
  if (!plan.targets.length) return {...plan.summary, changed:0};
  const enrollments = plan.targets.map(original => { const e=structuredClone(original); e.assignments=e.assignments.filter(a=>a.role!=='reviewer'); return e; });
  await commit(s, actor.id, 'admin.reviewers.reset', {enrollments}, text(input.reason));
  return {...plan.summary, changed:enrollments.length};
}
