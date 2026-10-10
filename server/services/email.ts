import { db } from '../db';
import { DB_BATCH_SIZE } from '../config';

export function parseEmailAddress(value: string | undefined) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '');
    return { email: match[2].trim(), name: name || undefined };
  }
  return { email: raw };
}

export function emailDailySendCap() {
  const configured = Number(process.env.EMAIL_DAILY_SEND_CAP || process.env.BREVO_DAILY_SEND_CAP || 250);
  if (!Number.isFinite(configured) || configured < 1) return 250;
  return Math.min(Math.floor(configured), 300);
}

export function emailBatchSize() {
  const configured = Number(process.env.EMAIL_BATCH_SIZE || 25);
  if (!Number.isFinite(configured) || configured < 1) return 25;
  return Math.min(Math.floor(configured), 100);
}

export async function emailSentTodayCount() {
  const row = (await db.execute(`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE status = 'sent'
      AND date(sent_at) = date('now', '+7 hours')
  `)).rows[0] as any;
  return Number(row?.count || 0);
}

export async function sendNotificationEmail(notificationId: number, data: {
  recipient_email: string;
  cc_emails?: string[];
  subject: string;
  body: string;
}) {
  const from = process.env.EMAIL_FROM || process.env.NOTIFICATION_EMAIL_FROM;
  const provider = (process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '')).toLowerCase();
  if (!from || !notificationId) return 'queued';
  if ((await emailSentTodayCount()) >= emailDailySendCap()) return 'queued';
  try {
    let response: Response;
    let providerMessageId: string | null = null;
    if (provider === 'brevo') {
      const apiKey = process.env.BREVO_API_KEY;
      if (!apiKey) return 'queued';
      response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: parseEmailAddress(from),
          to: [parseEmailAddress(data.recipient_email)],
          ...((data.cc_emails || []).length > 0 ? { cc: data.cc_emails.map(parseEmailAddress) } : {}),
          subject: data.subject,
          textContent: data.body,
        }),
      });
    } else if (provider === 'resend') {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return 'queued';
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [data.recipient_email],
          ...((data.cc_emails || []).length > 0 ? { cc: data.cc_emails } : {}),
          subject: data.subject,
          text: data.body,
        }),
      });
    } else {
      return 'queued';
    }
    const responseText = await response.text();
    if (response.status === 429) {
      await db.execute({
        sql: `UPDATE notifications
              SET error = ?, provider = ?, last_attempt_at = datetime('now', '+7 hours')
              WHERE id = ?`,
        args: ['Provider rate limit exceeded; giữ trong hàng đợi để gửi lại sau.', provider, notificationId],
      });
      return 'queued';
    }
    if (!response.ok) throw new Error(responseText.slice(0, 1000));
    try {
      const json = JSON.parse(responseText);
      providerMessageId = json.messageId || json.id || null;
    } catch (e) { }
    await db.execute({
      sql: `UPDATE notifications
            SET status = 'sent', sent_at = datetime('now', '+7 hours'), error = NULL,
                provider = ?, provider_message_id = ?, attempt_count = COALESCE(attempt_count, 0) + 1,
                last_attempt_at = datetime('now', '+7 hours')
            WHERE id = ?`,
      args: [provider, providerMessageId, notificationId],
    });
    return 'sent';
  } catch (e: any) {
    const rawError = String(e?.message || e);
    let message = rawError;
    if (/unrecognised IP address|authorised_ips|authorized_ips/i.test(rawError)) {
      const ipMatch = rawError.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      message = `Brevo đang chặn IP máy chủ${ipMatch ? ` ${ipMatch[0]}` : ''}. Vào Brevo > Security > Authorised IPs để thêm IP này, hoặc tắt giới hạn Authorized IPs nếu không cần. Lỗi gốc: ${rawError}`;
    }
    await db.execute({
      sql: `UPDATE notifications
            SET status = 'failed', error = ?, provider = ?,
                attempt_count = COALESCE(attempt_count, 0) + 1,
                last_attempt_at = datetime('now', '+7 hours')
            WHERE id = ?`,
      args: [message.slice(0, 1000), process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : 'resend'), notificationId],
    });
    return 'failed';
  }
}

export async function sendQueuedNotificationBatch(options: { requestedLimit?: number; notificationIds?: number[]; ignoreBatchSize?: boolean } = {}) {
  const sentToday = await emailSentTodayCount();
  const remainingToday = Math.max(0, emailDailySendCap() - sentToday);
  const batchLimit = options.ignoreBatchSize ? remainingToday : emailBatchSize();
  const hasSelectedIds = Array.isArray(options.notificationIds);
  const normalizedIds = Array.from(new Set((options.notificationIds || [])
    .map(id => Number(id))
    .filter(id => Number.isInteger(id) && id > 0)));
  const requestedLimit = options.requestedLimit === undefined
    ? (hasSelectedIds ? normalizedIds.length : batchLimit)
    : Math.max(0, Number(options.requestedLimit) || 0);
  const idLimit = hasSelectedIds ? normalizedIds.length : requestedLimit;
  const limit = Math.max(0, Math.min(requestedLimit, idLimit, batchLimit, remainingToday));
  if (limit === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining_today: remainingToday,
      message: remainingToday === 0 ? 'Đã đạt giới hạn gửi email hôm nay.' : 'Không có thông báo phù hợp để gửi.',
    };
  }

  let rows: any[];
  if (hasSelectedIds) {
    const selectedRows: any[] = [];
    for (let offset = 0; offset < normalizedIds.length; offset += DB_BATCH_SIZE) {
      const idChunk = normalizedIds.slice(offset, offset + DB_BATCH_SIZE);
      const chunkRows = (await db.execute({
        sql: `SELECT id, recipient_email, subject, body
              FROM notifications
              WHERE status = 'queued'
                AND id IN (${idChunk.map(() => '?').join(',')})`,
        args: idChunk,
      })).rows as any[];
      selectedRows.push(...chunkRows);
    }
    rows = selectedRows.sort((a, b) => Number(a.id) - Number(b.id)).slice(0, limit);
  } else {
    rows = (await db.execute({
      sql: `SELECT id, recipient_email, subject, body
            FROM notifications
            WHERE status = 'queued'
            ORDER BY created_at ASC, id ASC
            LIMIT ?`,
      args: [limit],
    })).rows as any[];
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendNotificationEmail(Number(row.id), {
      recipient_email: row.recipient_email,
      subject: row.subject,
      body: row.body,
    });
    if (result === 'sent') sent++;
    else if (result === 'failed') failed++;
    else break;
  }
  return {
    sent,
    failed,
    skipped: Math.max(0, rows.length - sent - failed),
    remaining_today: Math.max(0, remainingToday - sent),
    selected: normalizedIds.length || null,
  };
}
