import { Router } from 'express';
import { db } from '../db';

export const healthRouter = Router();
const metadata = () => ({ environment: process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development'), release: (process.env.APP_RELEASE || process.env.RENDER_GIT_COMMIT || 'local').slice(0, 40) });
healthRouter.get('/api/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ status: 'up', ...metadata() }); });
healthRouter.get('/api/ready', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await db.execute('SELECT version FROM academic_schema_migrations WHERE version=3');
    if (!result.rows.length) {
      console.warn('[ready] Version 3 not found in academic_schema_migrations');
      throw new Error('Schema not ready');
    }
    res.json({ status: 'ready', ...metadata(), database: 'ok', academicSchema: 3 });
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    console.error('[ready error]:', errMsg);
    res.status(503).json({ status: 'unavailable', ...metadata() });
  }
});
