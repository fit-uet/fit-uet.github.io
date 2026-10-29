import fs from 'fs';
import { dirname, join } from 'path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db } from '../db';
import {
  ALLOWED_CHAT_ATTACHMENT_EXTENSIONS,
  ALLOWED_CHAT_ATTACHMENT_MIME_PREFIXES,
} from '../config';

let r2Client: S3Client | null = null;

export function reportObjectKey(year: string, studentId: string | null | undefined) {
  const cleanYear = String(year || new Date().getFullYear()).replace(/[^0-9A-Za-z_-]/g, '_');
  const cleanStudent = String(studentId || 'unknown').replace(/[^0-9A-Za-z_-]/g, '_');
  return `reports/${cleanYear}/${cleanStudent}/final.pdf`;
}

export function safeFilename(filename: string) {
  const clean = String(filename || 'attachment')
    .replace(/[/\\]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, 180);
  return clean || 'attachment';
}

export function safeDecodeHeader(value: string | undefined, fallback = '') {
  try {
    return decodeURIComponent(String(value || fallback));
  } catch (e) {
    return String(value || fallback);
  }
}

export function fileExtension(filename: string) {
  const clean = safeFilename(filename);
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : '';
}

export function chatAttachmentObjectKey(studentUserId: number, lecturerId: number, senderUserId: number, filename: string) {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `chat/${studentUserId}/${lecturerId}/${senderUserId}/${stamp}-${random}-${safeFilename(filename)}`;
}

export function chatGroupAttachmentObjectKey(lecturerId: number, senderUserId: number, filename: string) {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `chat-groups/${lecturerId}/${senderUserId}/${stamp}-${random}-${safeFilename(filename)}`;
}

export function isAllowedChatAttachment(filename: string, mimeType: string) {
  const ext = fileExtension(filename);
  const mime = String(mimeType || '').toLowerCase();
  return ALLOWED_CHAT_ATTACHMENT_EXTENSIONS.has(ext) || ALLOWED_CHAT_ATTACHMENT_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
}

export function normalizeChatAttachmentMime(filename: string, mimeType: string) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = fileExtension(filename);
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    zip: 'application/zip',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || 'application/octet-stream';
}

export function getR2Config() {
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

export function getR2Client() {
  const config = getR2Config();
  if (!config) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return { client: r2Client, bucket: config.bucket };
}

export function localReportPath(key: string) {
  return join(process.cwd(), '.storage', 'final-reports', key);
}

export function localChatAttachmentPath(key: string) {
  return join(process.cwd(), '.storage', 'chat-attachments', key);
}

export async function saveReportObject(key: string, file: Buffer) {
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: file,
      ContentType: 'application/pdf',
    }));
    return 'r2';
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho lưu báo cáo PDF. Cần R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY và R2_ACCOUNT_ID/R2_ENDPOINT.');
  }

  const localPath = localReportPath(key);
  fs.mkdirSync(dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, file);
  return 'local';
}

export async function streamReportObject(key: string, res: any) {
  const r2 = getR2Client();
  if (r2) {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    const body = object.Body as any;
    if (!body) return false;
    if (typeof body.pipe === 'function') {
      body.pipe(res);
      return true;
    }
    if (typeof body.transformToByteArray === 'function') {
      res.end(Buffer.from(await body.transformToByteArray()));
      return true;
    }
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho tải báo cáo PDF.');
  }

  const localPath = localReportPath(key);
  if (!fs.existsSync(localPath)) return false;
  fs.createReadStream(localPath).pipe(res);
  return true;
}

export async function deleteReportObject(key: string | null | undefined) {
  if (!key) return;
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    const localPath = localReportPath(key);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } else {
    throw new Error('Chưa cấu hình Cloudflare R2 để xóa báo cáo PDF.');
  }
}

export async function saveChatAttachmentObject(key: string, file: Buffer, contentType: string) {
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: file,
      ContentType: contentType || 'application/octet-stream',
    }));
    return 'r2';
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho lưu file trao đổi. Cần R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY và R2_ACCOUNT_ID/R2_ENDPOINT.');
  }

  const localPath = localChatAttachmentPath(key);
  fs.mkdirSync(dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, file);
  return 'local';
}

export async function streamChatAttachmentObject(key: string, res: any) {
  const r2 = getR2Client();
  if (r2) {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    const body = object.Body as any;
    if (!body) return false;
    if (typeof body.pipe === 'function') {
      body.pipe(res);
      return true;
    }
    if (typeof body.transformToByteArray === 'function') {
      res.end(Buffer.from(await body.transformToByteArray()));
      return true;
    }
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Chưa cấu hình Cloudflare R2 cho tải file trao đổi.');
  }

  const localPath = localChatAttachmentPath(key);
  if (!fs.existsSync(localPath)) return false;
  fs.createReadStream(localPath).pipe(res);
  return true;
}

export async function deleteChatAttachmentObject(key: string | null | undefined) {
  if (!key) return;
  const r2 = getR2Client();
  if (r2) {
    await r2.client.send(new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    }));
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
    const localPath = localChatAttachmentPath(key);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } else {
    throw new Error('Chưa cấu hình Cloudflare R2 để xóa tệp trao đổi.');
  }
}

export async function cleanupChatAttachments(sql: string, args: any[]) {
  const rows = (await db.execute({ sql, args })).rows as any[];
  await Promise.all(rows
    .map(row => row.attachment_key)
    .filter(Boolean)
    .map(key => deleteChatAttachmentObject(String(key)).catch(() => undefined))
  );
}
