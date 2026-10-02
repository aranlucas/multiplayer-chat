/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";

/** Local substitute for the Durable Object's SQL surface; runs real migration and mutation SQL. */
export function sqliteStorage() {
  const database = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...values: (string | number | null)[]) {
      if (query.includes("CREATE TABLE")) {
        database.exec(query);
        return { toArray: () => [] };
      }
      const rows = database.prepare(query).all(...values);
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) {
            throw new Error(`Expected one SQL row, received ${rows.length}`);
          }
          return rows[0];
        },
      };
    },
  } as SqlStorage;
  return { sql, close: () => database.close() };
}
