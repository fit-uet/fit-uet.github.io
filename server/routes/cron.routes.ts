import { Router } from 'express';
import { db } from '../db';
import { rowsToSettings, isWithinLocalWindow } from '../services/helpers';
import { exportRegistrationsToGoogleSheets } from '../services/googleSheets';
import { sendQueuedNotificationBatch } from '../services/email';
import { checkAndQueueScheduledReminders } from '../services/autoReminders';

export const cronRouter = Router();

cronRouter.post('/api/cron/export-to-sheet', async (req: any, res: any) => {
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expectedSecret) return res.status(500).json({ error: 'Chưa cấu hình CRON_SECRET trên Render.' });
  if (providedSecret !== expectedSecret) return res.status(403).json({ error: 'Forbidden' });

  const settings = rowsToSettings((await db.execute(`
    SELECT key, value FROM settings
    WHERE key IN ('registration_open_at', 'registration_close_at')
  `)).rows);
  if (!settings.registration_open_at && !settings.registration_close_at) {
    return res.json({ success: true, skipped: true, message: 'Bỏ qua vì chưa cấu hình thời gian mở/đóng đăng ký.' });
  }
  const windowStatus = isWithinLocalWindow(settings, 'registration_open_at', 'registration_close_at');
  if (!windowStatus.ok) {
    return res.json({ success: true, skipped: true, message: `Bỏ qua vì ngoài đợt đăng ký: ${windowStatus.error}` });
  }

  try {
    const result = await exportRegistrationsToGoogleSheets();
    res.json({ success: true, skipped: false, message: 'Đã tự động lưu dữ liệu đăng ký vào Google Sheets.', ...result });
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ error: 'Lỗi cron lưu vào Google Sheets: ' + error.message });
  }
});

cronRouter.post('/api/cron/check-auto-reminders', async (req: any, res: any) => {
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expectedSecret) return res.status(500).json({ error: 'Chưa cấu hình CRON_SECRET trên Render.' });
  if (providedSecret !== expectedSecret) return res.status(403).json({ error: 'Forbidden' });

  try {
    const counts = await checkAndQueueScheduledReminders(db);
    res.json({ success: true, message: 'Đã quét và thêm email nhắc nhở tự động vào hàng đợi (T-3 đến T-0).', ...counts });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi kiểm tra nhắc nhở tự động: ' + error.message });
  }
});

cronRouter.post('/api/cron/process-email-queue', async (req: any, res: any) => {
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expectedSecret) return res.status(500).json({ error: 'Chưa cấu hình CRON_SECRET trên Render.' });
  if (providedSecret !== expectedSecret) return res.status(403).json({ error: 'Forbidden' });

  try {
    // 1. Quét và đưa vào hàng đợi các email nhắc tự động nếu đến đợt T-3 đến T-0 (kèm cooldown 24h)
    await checkAndQueueScheduledReminders(db).catch(err => {
      console.error('Lỗi khi quét email nhắc nhở tự động:', err?.message || err);
    });

    // 2. Xử lý xả hàng đợi email theo quota ngày
    const provider = process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '');
    if (!provider || provider === 'none') {
      return res.json({ success: true, skipped: true, message: 'Bỏ qua vì chưa cấu hình provider email.' });
    }
    const result = await sendQueuedNotificationBatch({ ignoreBatchSize: true });
    res.json({ success: true, skipped: false, message: 'Đã tự động xử lý hàng đợi email theo quota ngày.', ...result });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi cron tự động xử lý hàng đợi email: ' + error.message });
  }
});

