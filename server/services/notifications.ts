import { db } from '../db';
import { NotificationInput } from '../types';
import { sendNotificationEmail } from './email';

export async function insertNotification(data: NotificationInput) {
  if (!data.recipient_email) return null;
  const status = data.status === 'website_only' ? 'website_only' : 'queued';
  const result = await db.execute({
    sql: `INSERT INTO notifications (user_id, recipient_email, type, subject, body, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
    args: [data.user_id || null, data.recipient_email, data.type, data.subject, data.body, status],
  });
  return { id: Number(result.lastInsertRowid), status } as const;
}

export async function createNotification(data: NotificationInput) {
  try {
    const notification = await insertNotification(data);
    if (!notification) return;
    if (notification.status === 'queued' && (data.send_now || process.env.EMAIL_SEND_IMMEDIATE === 'true')) {
      const notificationId = notification.id;
      const sendStatus = await sendNotificationEmail(notificationId, data);
      if (data.no_queue_on_send_skip && sendStatus === 'queued') {
        await db.execute({
          sql: `UPDATE notifications
                SET status = 'website_only',
                    error = COALESCE(error, 'Email chưa gửi do hết quota hoặc chưa cấu hình provider; thông báo chỉ hiển thị trên website.')
                WHERE id = ?`,
          args: [notificationId],
        });
        return 'website_only';
      }
      return sendStatus;
    }
    return notification.status;
  } catch (e) {
    // Notification failures must not block the main business flow.
  }
}
