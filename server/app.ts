import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { createCorsOptions, getAllowedOrigins, isCorsAllowed } from './middlewares/cors';
import { isTransientLibsqlError } from './db';
import { authRouter } from './routes/auth.routes';
import { commonRouter } from './routes/common.routes';
import { studentRouter } from './routes/student.routes';
import { lecturerRouter } from './routes/lecturer.routes';
import { chatRouter } from './routes/chat.routes';
import { cronRouter } from './routes/cron.routes';
import { adminRouter } from './routes/admin.routes';
import { academicRouter } from './academic/routes';
import { legacyAcademicWriteGuard } from './academic/legacyGuard';
import { healthRouter } from './routes/health.routes';
import { emailDiagnosticsRouter } from './routes/emailDiagnostics.routes';

export async function createApp(options: { vite?: import('vite').InlineConfig } = {}) {
  const app = express();
  app.set('trust proxy', 1);

  const allowedOrigins = getAllowedOrigins();
  const corsOptions = createCorsOptions();

  app.use(cors(corsOptions));
  app.options('/api/*', cors(corsOptions));
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin as string | undefined;
    if (req.path?.startsWith('/api/') && !isCorsAllowed(origin, allowedOrigins)) {
      console.warn(`[cors] blocked origin: ${origin || '(empty)'}; allowed: ${allowedOrigins.join(', ') || '(none)'}`);
      return res.status(403).json({ error: 'Origin không được phép gọi API. Vui lòng kiểm tra CORS_ORIGIN trên Render.' });
    }
    next();
  });

  app.use(express.json());

  // Mount API routers
  app.use(healthRouter);
  app.use(authRouter);
  app.use(academicRouter);
  app.use(legacyAcademicWriteGuard);
  app.use(commonRouter);
  app.use(studentRouter);
  app.use(lecturerRouter);
  app.use(chatRouter);
  app.use(cronRouter);
  app.use(adminRouter);
  app.use(emailDiagnosticsRouter);

  // Global Error Handling Middleware
  app.use((err: any, req: any, res: any, next: any) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'File PDF vượt quá 10 MB. Vui lòng nén lại trước khi nộp.' });
    }
    if (err?.message === 'Not allowed by CORS') {
      return res.status(403).json({ error: 'Origin không được phép gọi API. Vui lòng kiểm tra CORS_ORIGIN trên Render.' });
    }
    if (isTransientLibsqlError(err)) {
      return res.status(503).json({ error: 'Cơ sở dữ liệu Turso tạm thời không phản hồi. Vui lòng thử lại sau.' });
    }
    if (req.path?.startsWith('/api/')) {
      return res.status(500).json({ error: err?.message || 'Internal server error' });
    }
    next(err);
  });

  // Vite Middleware (Dev) or Static Assets (Prod)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      ...options.vite,
      server: { ...options.vite?.server, middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(join(distPath, 'index.html'));
    });
  }

  return app;
}
