/// <reference types="node" />
import type { RoomSql } from "../storage";
import { DatabaseSync } from "node:sqlite";

/** Local substitute for the Durable Object's SQL surface; runs real migration and mutation SQL. */
export function sqliteStorage(database = new DatabaseSync(":memory:")) {
  const sql: RoomSql = {
    exec<T extends Record<string, SqlStorageValue>>(query: string, ...values: SqlStorageValue[]) {
      if (query.includes("CREATE TABLE")) {
        database.exec(query);

        return {
          toArray: () => [],
          one: (): T => {
            throw new Error("Statement has no result row");
          },
        };
      }

      // SAFETY: This adapter preserves the SQL driver's generic query-result contract.
      // Callers select T from the same schema/aliases used by their SQL, just as with Workers SqlStorage.exec<T>.
      // The adapter never invents missing fields; SQLite executes migrations and constraints in these tests.
      const rows = database
        .prepare(query)
        .all(
          ...values.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
        ) as T[];

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
  };

  return { sql, close: () => database.close() };
}
