import type { Client, TransactionMode } from '@libsql/client';
import type { DatabaseClient } from '../types';

export function libsqlDatabase(client: Client): DatabaseClient {
  return {
    execute: statement => client.execute(typeof statement === 'string' ? statement : { sql: statement.sql, args: statement.args || [] }),
    executeMultiple: sql => client.executeMultiple(sql),
    batch: (statements, mode = 'write') => client.batch(statements.map(s => ({ sql: s.sql, args: s.args || [] })), mode as TransactionMode),
  };
}
