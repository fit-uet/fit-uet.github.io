export interface DatabaseClient {
  execute(stmt: string | { sql: string; args?: any[] }): Promise<{ rows: any[]; lastInsertRowid?: number | bigint; rowsAffected?: number }>;
  executeMultiple(sql: string): Promise<void>;
  batch(statements: Array<{ sql: string; args?: any[] }>, mode?: string): Promise<any[]>;
}

export type NotificationInput = {
  user_id?: number | null;
  recipient_email: string;
  cc_emails?: string[];
  type: string;
  subject: string;
  body: string;
  html?: string;
  status?: 'queued' | 'website_only';
  send_now?: boolean;
  no_queue_on_send_skip?: boolean;
};

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: 'student' | 'lecturer' | 'admin';
  student_id?: string | null;
  is_lecturer?: number | boolean;
  is_admin?: number | boolean;
  [key: string]: any;
}
