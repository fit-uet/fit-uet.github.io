import { isIP } from 'node:net';
import { parseEmailAddress } from './email';
import type { EmailConnectionDiagnostic } from '../../src/shared/emailDiagnostics';

export async function checkEmailConnection(options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}): Promise<EmailConnectionDiagnostic> {
  const env = options.env || process.env;
  const configured = (env.EMAIL_PROVIDER || (env.BREVO_API_KEY ? 'brevo' : env.RESEND_API_KEY ? 'resend' : 'none')).trim().toLowerCase();
  const provider: EmailConnectionDiagnostic['provider'] = ['brevo', 'resend', 'none'].includes(configured) ? configured as 'brevo' | 'resend' | 'none' : 'other';
  const sender = parseEmailAddress(env.EMAIL_FROM || env.NOTIFICATION_EMAIL_FROM).email;
  const base = { provider, checkedAt: new Date().toISOString(), ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) ? { sender } : {}) };
  const result = (status: EmailConnectionDiagnostic['status'], message: string, extra: Partial<EmailConnectionDiagnostic> = {}): EmailConnectionDiagnostic => ({ ...base, status, message, ...extra });
  if (provider === 'none') return result('disabled', 'Dịch vụ email đang tắt. Thông báo trên website vẫn hoạt động.');
  if (provider === 'other') return result('missing_config', 'EMAIL_PROVIDER không được hỗ trợ. Chọn brevo, resend hoặc none.');
  if (!base.sender) return result('missing_config', 'Chưa cấu hình địa chỉ người gửi hợp lệ trong EMAIL_FROM.');
  if (provider === 'resend') return env.RESEND_API_KEY
    ? result('not_checked', 'Resend đã có cấu hình. Chức năng kiểm tra kết nối hiện hỗ trợ Brevo; chưa xác nhận khả năng phát thư của Resend.')
    : result('missing_config', 'Chưa cấu hình RESEND_API_KEY.');
  if (!env.BREVO_API_KEY?.trim()) return result('missing_config', 'Chưa cấu hình BREVO_API_KEY.');
  try {
    // Read account metadata from this server's outbound IP, without sending an
    // email, changing the queue, or returning provider/account credentials.
    const response = await (options.fetcher || fetch)('https://api.brevo.com/v3/account', {
      method: 'GET', headers: { 'api-key': env.BREVO_API_KEY.trim(), Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    const extra = { providerStatus: response.status };
    if (response.status === 429) return result('rate_limited', 'Brevo đang giới hạn số yêu cầu. Chờ một lúc rồi kiểm tra lại.', extra);
    if (response.status === 401 || response.status === 403) {
      const message = (await response.text()).slice(0, 8192);
      if (/unrecogni[sz]ed IP|authori[sz]ed_ips|IP(?: address)?[^\n]{0,80}(?:not authori[sz]ed|not allowed|blocked)/i.test(message)) {
        const candidate = /(?:IP address|IP)\s+([0-9a-f:.]+)/i.exec(message)?.[1].replace(/[.]+$/, '');
        const blockedIp = candidate && isIP(candidate) ? candidate : undefined;
        return result('ip_blocked', 'Brevo chưa cho phép IP đi ra của máy chủ này. Cho phép IP trong Brevo → Security → Authorized IPs rồi kiểm tra lại; chưa thể kết luận khóa API không hợp lệ.', { ...extra, ...(blockedIp ? { blockedIp } : {}) });
      }
      return response.status === 401
        ? result('authentication_failed', 'Brevo từ chối xác thực. Kiểm tra BREVO_API_KEY đang đặt trên Render.', extra)
        : result('access_denied', 'Brevo từ chối quyền truy cập tài khoản. Kiểm tra quyền của khóa và trạng thái tài khoản.', extra);
    }
    if (!response.ok) return result('unavailable', 'Brevo chưa phản hồi thành công. Thử kiểm tra lại sau.', extra);
    const data = await response.json();
    if (typeof data?.email !== 'string' || !data.email.includes('@')) return result('unavailable', 'Không xác nhận được phản hồi tài khoản từ Brevo. Thử kiểm tra lại sau.', extra);
    if (data.relay?.enabled === false) return result('sending_disabled', 'Đã kết nối Brevo nhưng chức năng gửi email giao dịch của tài khoản đang tắt. Kiểm tra trạng thái tài khoản với Brevo.', extra);
    return result('connected', 'Máy chủ đã kết nối Brevo thành công. Chưa gửi thư; cần nghiệm thu việc nhận email bằng một hộp thư thử.', extra);
  } catch {
    return result('unavailable', 'Không kết nối được Brevo trong thời gian cho phép. Kiểm tra lại kết nối từ máy chủ.');
  }
}
