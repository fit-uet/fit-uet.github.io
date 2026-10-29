import { db } from '../db';

export async function legacyCampaignArchived() {
  return !!(await db.execute(`SELECT c.id FROM academic_classes c LEFT JOIN academic_campaigns p ON p.id=COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||':internship')
    WHERE json_extract(c.data,'$.legacy')=1 AND COALESCE(json_extract(p.data,'$.status'),'draft')!='active' LIMIT 1`)).rows[0];
}
// Legacy endpoints operate one campaign, so archive/reopen that campaign as a unit.
// Catalogs, account profiles and global email administration remain available.
export async function legacyAcademicWriteGuard(req: any, res: any, next: any) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !/^\/api\/(?:registrations(?:\/|$)|internships\/final|advisor(?:\/|$)|reports\/final|lecturer\/(?:grades|students)|chat(?:\/|$)|faq\/questions|admin\/(?:registrations|final-internships|advisor-assignments|advisor-requests|lecturer-quotas|grades|reports\/final|faq\/questions|notifications\/(?:final-report-reminders|remind-pending-students|remind-pending-lecturers|final-confirmation-open))|settings\/(?:campaign|plan|registration-rules|lecturer-guide|faq))/.test(req.path)) return next();
  try {
    if (await legacyCampaignArchived()) return res.status(403).json({ error: 'Nhóm Thực tập cũ chưa hoạt động, đang chờ chuyển đổi hoặc đã lưu trữ. Khoa cần xử lý nhóm trước khi thay đổi dữ liệu.' });
    next();
  } catch (error) { next(error); }
}
