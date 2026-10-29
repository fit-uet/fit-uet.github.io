import { createClient } from '@libsql/client';
import { parse } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { previewTopicMigration } from '../server/academic/topicMigration';
import { libsqlDatabase } from '../server/academic/libsql';

const option = (name: string) => process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const envFile = option('env-file'), source = option('source'), output = option('output');
if (!output || (!envFile && !source) || (envFile && source) || source && !source.startsWith('file:')) throw new Error('Dùng --source=file:/path/copy.db hoặc --env-file=/path/private.env, cùng --output=.staging/.../topics-preview.json. Chỉ xem trước.');
const env = envFile ? parse(await readFile(resolve(envFile))) : {};
if (envFile && (env.DB_PROVIDER !== 'turso' || !env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN)) throw new Error('Cần cấu hình Turso tường minh.');
const client = createClient({ url: source || env.TURSO_DATABASE_URL!, authToken: env.TURSO_AUTH_TOKEN });
try {
  const rows = await previewTopicMigration(libsqlDatabase(client));
  const summary = { changed: rows.length, recognized: rows.filter(r => r.after.topicReview?.status === 'approved').length, unregistered: rows.filter(r => r.after.topicReview?.status === 'unregistered').length };
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  await writeFile(resolve(output), JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ...summary, output: resolve(output), readOnly: true }));
} finally { client.close(); }
