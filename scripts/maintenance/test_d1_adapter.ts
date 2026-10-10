import fs from 'fs';
import path from 'path';

// Extract token from wrangler config
const wranglerConfigPath = path.join(process.env.HOME || '', 'Library/Preferences/.wrangler/config/default.toml');
const content = fs.readFileSync(wranglerConfigPath, 'utf-8');
const tokenMatch = content.match(/oauth_token\s*=\s*"([^"]+)"/);
const token = tokenMatch ? tokenMatch[1] : '';

const ACCOUNT_ID = '7f6e0debd543c1ec1871f4f6d2c03dd5';
const DATABASE_ID = '866e23b7-3b49-43e4-ab90-59dceb4c4f76';

interface D1ExecuteResult {
  rows: any[];
  lastInsertRowid?: number | bigint;
  rowsAffected?: number;
}

class CloudflareD1Client {
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

  async execute(stmt: string | { sql: string; args?: any[] }): Promise<D1ExecuteResult> {
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
      throw new Error(`D1 HTTP Error ${res.status}: ${errText}`);
    }

    const data = await res.json() as any;
    if (!data.success) {
      const err = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 Query Error: ${err}`);
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
      throw new Error(`D1 HTTP Error ${res.status}: ${errText}`);
    }

    const data = await res.json() as any;
    if (!data.success) {
      const err = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 ExecuteMultiple Error: ${err}`);
    }
  }

  async batch(statements: Array<{ sql: string; args?: any[] }>): Promise<D1ExecuteResult[]> {
    if (!statements || statements.length === 0) return [];

    // Format SQL statements with parameters inlined to execute in one roundtrip
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
      throw new Error(`D1 HTTP Error ${res.status}: ${errText}`);
    }

    const data = await res.json() as any;
    if (!data.success) {
      const err = data.errors?.[0]?.message || JSON.stringify(data.errors);
      throw new Error(`D1 Batch Error: ${err}`);
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
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }
}

async function test() {
  console.log('Testing CloudflareD1Client adapter...');
  const client = new CloudflareD1Client(ACCOUNT_ID, DATABASE_ID, token);

  // 1. Simple query
  const res1 = await client.execute('SELECT COUNT(*) as count FROM users');
  console.log('✓ Simple execute count:', res1.rows[0].count);

  // 2. Parameterized query
  const res2 = await client.execute({
    sql: 'SELECT id, email, name FROM users WHERE email = ?',
    args: ['23020078@vnu.edu.vn'],
  });
  console.log('✓ Parameterized execute:', res2.rows[0]);

  // 3. Batch query
  const batchRes = await client.batch([
    { sql: 'SELECT ? as num1', args: [123] },
    { sql: 'SELECT ? as str1', args: ["It's working!"] },
  ]);
  console.log('✓ Batch results:', batchRes[0].rows[0], batchRes[1].rows[0]);

  console.log('\nALL TESTS PASSED SUCCESSFULLY!');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
