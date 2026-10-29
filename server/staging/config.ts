export type Environment = Record<string, string | undefined>;
export type ConfigIssue = { field: string; message: string };
const knownProductionDatabase = '866e23b7-3b49-43e4-ab90-59dceb4c4f76';
const knownProductionBucket = 'internship-final-reports';
const placeholder = (value: string) => !value || /(?:your-|replace-|change-me|mock\.apps|example\.com|generate-a-long)/i.test(value);
export const stagingJobsEnabled = (env: Environment = process.env) => !['staging', 'local-staging'].includes(env.APP_ENV || '') || env.STAGING_RUN_JOBS === 'true';

// Report field names, never credential values. Staging must explicitly select its resources.
export function stagingConfigIssues(env: Environment): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const required = (field: string) => { if (placeholder(env[field]?.trim() || '')) add(field, 'Chưa có giá trị hợp lệ.'); };
  if (env.APP_ENV !== 'staging') add('APP_ENV', 'Phải là staging.');
  if (env.NODE_ENV !== 'production') add('NODE_ENV', 'Staging phải dùng production để xác minh Google token thật và phục vụ bản build.');
  required('JWT_SECRET');
  if ((env.JWT_SECRET || '').length < 32 || env.JWT_SECRET === 'uyet-vnu-secret-key-1234') add('JWT_SECRET', 'Cần secret riêng của staging, tối thiểu 32 ký tự.');
  required('VITE_GOOGLE_CLIENT_ID');
  if (env.VITE_GOOGLE_CLIENT_ID && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(env.VITE_GOOGLE_CLIENT_ID)) add('VITE_GOOGLE_CLIENT_ID', 'Client ID Google không đúng định dạng.');
  required('ADMIN_EMAIL');
  if (env.DB_PROVIDER === 'd1') {
    required('CLOUDFLARE_ACCOUNT_ID');
    const id = env.CLOUDFLARE_DATABASE_ID || env.CLOUDFLARE_D1_DATABASE_ID;
    if (!id || id === knownProductionDatabase) add('CLOUDFLARE_DATABASE_ID', 'Cần ID D1 staging tường minh, khác database production đã biết.');
    if (placeholder(env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_D1_API_TOKEN || '')) add('CLOUDFLARE_API_TOKEN', 'Cần token dành cho database staging.');
  } else if (env.DB_PROVIDER === 'turso') {
    required('TURSO_DATABASE_URL');
    const url = env.TURSO_DATABASE_URL || '';
    if (!url.startsWith('libsql://')) add('TURSO_DATABASE_URL', 'Staging deploy cần database libsql remote riêng. Diễn tập SQLite dùng academic:stage.');
    required('TURSO_AUTH_TOKEN');
  } else add('DB_PROVIDER', 'Chọn d1 hoặc turso tường minh.');
  const bucket = env.R2_BUCKET || env.R2_BUCKET_NAME;
  if (!bucket || bucket === knownProductionBucket) add('R2_BUCKET', 'Cần bucket staging riêng, khác bucket production đã biết.');
  if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) add('R2_ACCOUNT_ID', 'Cần R2_ACCOUNT_ID hoặc R2_ENDPOINT.');
  required('R2_ACCESS_KEY_ID'); required('R2_SECRET_ACCESS_KEY');
  const origins = (env.CORS_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!origins.length || origins.some(x => { try { return new URL(x).origin !== x || !x.startsWith('https://') || x === 'https://fit-uet.github.io'; } catch { return true; } })) add('CORS_ORIGIN', 'Khai báo origin HTTPS của giao diện staging, không dùng origin production.');
  if (env.VITE_API_BASE_URL !== '') {
    try { const url = new URL(env.VITE_API_BASE_URL || ''); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname === 'internship-api-dplz.onrender.com') throw new Error(); }
    catch { add('VITE_API_BASE_URL', 'Để trống tường minh khi cùng origin, hoặc dùng origin HTTPS API staging riêng.'); }
  }
  const provider = env.EMAIL_PROVIDER;
  if (!['none', 'brevo', 'resend'].includes(provider || '')) add('EMAIL_PROVIDER', 'Mặc định none; chỉ bật brevo/resend khi thử hộp thư staging.');
  if (provider && provider !== 'none') {
    required('EMAIL_FROM'); required(provider === 'brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY');
    if (!stagingEmailRecipient(env)) add('STAGING_EMAIL_RECIPIENT', 'Cần đúng một hộp thư nghiệm thu. Mọi email staging sẽ chuyển tới địa chỉ này và bỏ CC.');
  }
  if (env.FORCE_DB_INIT === 'true') add('FORCE_DB_INIT', 'Không bật khởi tạo cưỡng bức khi nghiệm thu bản sao dữ liệu.');
  return issues;
}
export function assertStagingConfig(env: Environment = process.env) {
  if (env.APP_ENV !== 'staging') return;
  const issues = stagingConfigIssues(env);
  if (issues.length) throw new Error(`Cấu hình staging chưa hợp lệ: ${issues.map(x => `${x.field}: ${x.message}`).join(' ')}`);
}
export function stagingEmailRecipient(env: Environment = process.env) {
  const value = (env.STAGING_EMAIL_RECIPIENT || '').trim();
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value) ? value : '';
}
