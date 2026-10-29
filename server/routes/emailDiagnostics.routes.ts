import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth';
import { checkEmailConnection } from '../services/emailDiagnostics';

export const emailDiagnosticsRouter = Router();
emailDiagnosticsRouter.get('/api/admin/email/diagnostics', requireAuth, requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(await checkEmailConnection());
});
