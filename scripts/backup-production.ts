import { createClient } from '@libsql/client';
import { parse } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { backupLibsql } from './deployment/backup';

const option = (name: string) => process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const envFile = option('env-file'), output = option('output');
if (!envFile || !output) throw new Error('Dùng: npm run production:backup -- --env-file=/path/private.env --output=/path/new-backup.db');
const env = parse(await readFile(resolve(envFile)));
if (env.DB_PROVIDER !== 'turso' || !env.TURSO_DATABASE_URL?.startsWith('libsql://') || !env.TURSO_AUTH_TOKEN) throw new Error('Cần cấu hình Turso remote tường minh. Với D1 dùng wrangler d1 export --remote vào thư mục riêng.');
const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, intMode: 'bigint' });
try {
  const report = await backupLibsql(client, resolve(output));
  await writeFile(`${resolve(output)}.report.json`, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ destination: report.destination, integrity: report.integrity, foreignKeyIssues: report.foreignKeyIssues, counts: report.counts }, null, 2));
} catch {
  console.error('Sao lưu Turso thất bại; chưa thay đổi dữ liệu nguồn. Kiểm tra kết nối, quyền đọc và đường dẫn đầu ra mới.');
  process.exitCode = 1;
} finally { client.close(); }
