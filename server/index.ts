import {drainProjectCleanup} from './academic/projectCleanup';
import { db } from './db';
import { initDb, seedCompaniesIfEmpty } from './db/initDb';
import { createApp } from './app';
import { emailSentTodayCount, emailDailySendCap, sendQueuedNotificationBatch } from './services/email';
import { initAcademicSchema } from './academic/schema';
import { deliverAcademicOutbox } from './academic/outbox';
import { assertStagingConfig, stagingJobsEnabled } from './staging/config';

export async function startServer() {
  assertStagingConfig();
  await initDb();
  await initAcademicSchema(db);
  await deliverAcademicOutbox();
  await drainProjectCleanup();
  await seedCompaniesIfEmpty();

  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Tự động kiểm tra và xả hàng đợi email theo quota ngày (mỗi 30 phút và 10 giây sau khi khởi động)
  const runAutoQueueDrain = async () => {
    try {
      const provider = process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '');
      if (!provider || provider === 'none') return;
      const sentToday = await emailSentTodayCount();
      const remainingToday = Math.max(0, emailDailySendCap() - sentToday);
      if (remainingToday <= 0) return;

      const queuedCount = Number((await db.execute("SELECT COUNT(*) as count FROM notifications WHERE status = 'queued'")).rows[0]?.count || 0);
      if (queuedCount > 0) {
        console.log(`[AutoQueue] Có ${queuedCount} email trong hàng đợi, quota còn lại hôm nay: ${remainingToday}. Đang tự động gửi...`);
        const result = await sendQueuedNotificationBatch({ ignoreBatchSize: true });
        console.log(`[AutoQueue] Kết quả tự động xả hàng đợi: đã gửi ${result.sent}, lỗi ${result.failed}, còn lại trong ngày ${result.remaining_today}.`);
      }
    } catch (e: any) {
      console.error('[AutoQueue] Lỗi khi tự động xử lý hàng đợi email:', e?.message || e);
    }
  };

  if (stagingJobsEnabled()) {
    setTimeout(runAutoQueueDrain, 10000);
    setInterval(()=>drainProjectCleanup().catch(()=>{}),60_000);
    setInterval(runAutoQueueDrain, 30 * 60 * 1000);
  }
}

startServer().catch(console.error);
