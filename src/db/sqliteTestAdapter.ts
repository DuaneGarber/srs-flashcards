/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * expo-sqlite is a native module and can't run under Jest. Since
 * schema.ts/repository.ts only ever touch the async subset of
 * SQLiteDatabase (execAsync/getFirstAsync/getAllAsync/runAsync), an
 * in-memory node:sqlite database wearing the same async method names
 * exercises the real SQL and app logic without needing the native
 * binding. Test-only — never imported by app code.
 */
export function createTestDb(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');

  return {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) => {
      const args = flattenParams(params);
      const stmt = raw.prepare(sql);
      return (args.length ? stmt.get(...args) : stmt.get()) ?? null;
    },
    getAllAsync: async (sql: string, ...params: unknown[]) => {
      const args = flattenParams(params);
      const stmt = raw.prepare(sql);
      return args.length ? stmt.all(...args) : stmt.all();
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const args = flattenParams(params);
      const stmt = raw.prepare(sql);
      const result = args.length ? stmt.run(...args) : stmt.run();
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
    },
    closeAsync: async () => {
      raw.close();
    },
  } as unknown as SQLiteDatabase;
}

// expo-sqlite accepts either varargs or a single array/object of bind params;
// this repo's callers always pass a single array, so unwrap that one shape.
function flattenParams(params: unknown[]): SQLInputValue[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat as SQLInputValue[];
}
