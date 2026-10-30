import { DatabaseClient } from './types';
import { DB_BATCH_SIZE } from './config';

export class CloudflareD1Client implements DatabaseClient {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;
  private baseUrl: string;

  constructor(accountId: string, databaseId: string, apiToken: string) {
    this.accountId = accountId;
    this.databaseId = databaseId;
    this.apiToken = apiToken;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  }

  async execute(stmt: string | { sql: string; args?: any[] }): Promise<{ rows: any[]; lastInsertRowid?: number | bigint; rowsAffected?: number }> {
    let sql: string;
    let params: any[] | undefined;

    if (typeof stmt === 'string') {
      sql = stmt;
      params = undefined;
    } else {
      sql = stmt.sql;
      params = stmt.args;
    }

    const payload: any = { sql };
    if (params && params.length > 0) {
      payload.params = params.map(p => (p === undefined ? null : p));
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`D1 HTTP Error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json() as any;
    if (!data.success) {
      const errMessage = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 Query Error: ${errMessage}`);
    }

    const firstResult = data.result?.[0];
    const rows = firstResult?.results || [];
    const meta = firstResult?.meta || {};

    return {
      rows,
      lastInsertRowid: meta.last_row_id !== undefined ? meta.last_row_id : undefined,
      rowsAffected: meta.changes !== undefined ? meta.changes : 0,
    };
  }

  async executeMultiple(sql: string): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`D1 HTTP Error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json() as any;
    if (!data.success) {
      const errMessage = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 ExecuteMultiple Error: ${errMessage}`);
    }
  }

  async batch(statements: Array<{ sql: string; args?: any[] }>, _mode?: string): Promise<any[]> {
    if (!statements || statements.length === 0) return [];

    const formattedQueries = statements.map(st => {
      let q = st.sql.trim();
      if (q.endsWith(';')) q = q.slice(0, -1);
      return this.formatSqlWithArgs(q, st.args);
    });

    const combinedSql = formattedQueries.join(';\n') + ';';

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: combinedSql }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`D1 HTTP Error ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json() as any;
    if (!data.success) {
      const errMessage = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 Batch Error: ${errMessage}`);
    }

    const results = data.result || [];
    return results.map((r: any) => ({
      rows: r.results || [],
      lastInsertRowid: r.meta?.last_row_id,
      rowsAffected: r.meta?.changes || 0,
    }));
  }

  private formatSqlWithArgs(sql: string, args?: any[]): string {
    if (!args || args.length === 0) return sql;
    let i = 0;
    return sql.replace(/\?/g, () => {
      if (i >= args.length) return '?';
      const val = args[i++];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
      if (typeof val === 'boolean') return val ? '1' : '0';
      if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
        return `X'${Buffer.from(val).toString('hex')}'`;
      }
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }
}

export let db: DatabaseClient;

export function setDb(client: DatabaseClient) {
  db = client;
}

export function isDbQuotaError(error: any): boolean {
  const message = String(error?.message || error?.cause?.message || error || '').toLowerCase();
  return /reads? (?:are |is )?blocked|read operations are forbidden|quota|upgrade your plan|daily (?:row )?(?:read|write) limit/i.test(message);
}

export function isTransientLibsqlError(error: any) {
  if (isDbQuotaError(error)) return false;
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.cause?.status || error?.status || 0);
  return code === 'SERVER_ERROR' || [429, 500, 502, 503, 504].includes(status) || /bad gateway|service unavailable|gateway timeout|fetch failed|network|rate limit|econnreset|etimedout/i.test(message);
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withDbRetry<T>(operation: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (!isTransientLibsqlError(error) || attempt === attempts) break;
      const delay = Math.min(3000, 250 * Math.pow(2, attempt - 1));
      console.warn(`[db] transient ${label} error, retry ${attempt}/${attempts - 1} after ${delay}ms: ${error.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

export async function executeBatch(statements: any[], mode: 'read' | 'write' = 'write') {
  for (let i = 0; i < statements.length; i += DB_BATCH_SIZE) {
    const chunk = statements.slice(i, i + DB_BATCH_SIZE);
    await withDbRetry(() => (db as any).batch(chunk, mode), `batch(${chunk.length})`);
  }
}

export async function getSqliteObjectType(name: string) {
  const row = (await db.execute({
    sql: "SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
    args: [name]
  })).rows[0] as { type?: string } | undefined;
  return row?.type || null;
}
