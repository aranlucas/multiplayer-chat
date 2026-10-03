/** The synchronous SQL surface used by room logic, implemented by Workers and local SQLite. */
export interface RoomSql {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): { toArray(): T[]; one(): T };
}

export interface RoomStorage {
  sql: RoomSql;
}
