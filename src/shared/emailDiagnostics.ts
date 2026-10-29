export type EmailConnectionStatus = 'connected' | 'disabled' | 'missing_config' | 'ip_blocked' | 'authentication_failed' | 'access_denied' | 'rate_limited' | 'sending_disabled' | 'unavailable' | 'not_checked';

export interface EmailConnectionDiagnostic {
  provider: 'brevo' | 'resend' | 'none' | 'other';
  status: EmailConnectionStatus;
  checkedAt: string;
  message: string;
  sender?: string;
  blockedIp?: string;
  providerStatus?: number;
}
