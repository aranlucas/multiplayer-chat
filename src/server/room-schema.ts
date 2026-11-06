import type { RoomSql } from "./storage";

type SqlNameRow = { name: string };

type SqlCountRow = { count: number };

export function migrateRoomSchema(sql: RoomSql) {
  sql.exec(`
      CREATE TABLE IF NOT EXISTS relay_room (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL,
        title TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT NOT NULL,
        agent_status TEXT NOT NULL,
        opencode_model TEXT,
        opencode_session_id TEXT,
        opencode_event_cursor TEXT,
        commit_sha TEXT,
        workspace_status TEXT NOT NULL DEFAULT 'cloning',
        workspace_error TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        actor_json TEXT,
        payload_json TEXT NOT NULL,
        queue_status TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_participants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        color TEXT NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_permissions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resources_json TEXT NOT NULL,
        message TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_revisions (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        workspace_revision INTEGER NOT NULL,
        commit_sha TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        preview_url TEXT,
        provider TEXT,
        deployment_id TEXT,
        failure TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        activated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS relay_handoffs (
        token_hash TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        target_origin TEXT NOT NULL,
        participant_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS relay_brief (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        objective TEXT NOT NULL DEFAULT '',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        validation_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER,
        updated_by_json TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_decisions (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        rationale TEXT,
        source_event_id TEXT,
        actor_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_brief_review_comments (
        id TEXT PRIMARY KEY,
        review_round INTEGER NOT NULL,
        text TEXT NOT NULL,
        actor_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS relay_events_created_idx ON relay_events(created_at);
      CREATE INDEX IF NOT EXISTS relay_handoffs_expiry_idx ON relay_handoffs(expires_at);
      CREATE INDEX IF NOT EXISTS relay_decisions_created_idx ON relay_decisions(created_at);
      CREATE INDEX IF NOT EXISTS relay_brief_review_comments_created_idx ON relay_brief_review_comments(created_at);
    `);
  sql.exec("INSERT OR IGNORE INTO relay_brief (singleton) VALUES (1)");
  ensureColumn(sql, "relay_room", "commit_sha", "TEXT");
  ensureColumn(sql, "relay_room", "workspace_status", "TEXT NOT NULL DEFAULT 'cloning'");
  ensureColumn(sql, "relay_room", "workspace_error", "TEXT");
  ensureColumn(sql, "relay_room", "railway_sandbox_id", "TEXT");
  ensureColumn(sql, "relay_room", "opencode_event_cursor", "TEXT");
  ensureColumn(sql, "relay_room", "opencode_model", "TEXT");
  ensureColumn(sql, "relay_room", "agent_turn_generation", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sql, "relay_events", "queue_status", "TEXT");
  sql.exec("CREATE INDEX IF NOT EXISTS relay_events_queue_idx ON relay_events(queue_status, seq)");
  ensureColumn(sql, "relay_room", "pull_request_url", "TEXT");
  ensureColumn(sql, "relay_room", "pull_request_branch", "TEXT");
  ensureColumn(sql, "relay_room", "pull_request_number", "INTEGER");
  ensureColumn(sql, "relay_room", "pull_request_repository", "TEXT");
  ensureColumn(sql, "relay_room", "pull_request_head_sha", "TEXT");
  ensureColumn(sql, "relay_room", "github_credential", "TEXT");
  ensureColumn(sql, "relay_room", "title_auto", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sql, "relay_room", "workspace_revision", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sql, "relay_room", "published_workspace_revision", "INTEGER NOT NULL DEFAULT 0");
  restorePullRequestAssociation(sql);
  ensureColumn(sql, "relay_brief", "revision", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sql, "relay_brief", "review_status", "TEXT NOT NULL DEFAULT 'draft'");
  ensureColumn(sql, "relay_brief", "review_round", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sql, "relay_brief", "review_started_at", "INTEGER");
  ensureColumn(sql, "relay_brief", "review_started_by_json", "TEXT");
  ensureColumn(sql, "relay_brief", "review_resolved_at", "INTEGER");
  ensureColumn(sql, "relay_brief", "review_resolved_by_json", "TEXT");
  sql.exec("DELETE FROM relay_events WHERE id LIKE 'seed-%'");
  sql.exec("DELETE FROM relay_permissions WHERE id = 'demo-deploy'");
  sql.exec(
    "UPDATE relay_room SET branch = 'master', commit_sha = NULL, workspace_status = 'cloning', workspace_error = NULL WHERE repository = 'cloudflare/workers-chat-demo' AND branch IN ('fix/session-reconnect', 'main')",
  );
}

export function hideRelayTablesForOpenCodeBootstrap(sql: RoomSql): string[] {
  const tables = sql
    .exec<SqlNameRow>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'relay_%' OR name LIKE '_opencode_bootstrap_relay_%')",
    )
    .toArray()
    .map((row) => row.name);

  const hasOpenCodeSchema = sql
    .exec<SqlCountRow>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'session_v2')",
    )
    .one().count;

  const hidden = tables.filter((name) => name.startsWith("_opencode_bootstrap_"));

  if (hasOpenCodeSchema) {
    restoreRelayTables(sql, hidden);

    return [];
  }

  for (const name of tables) {
    if (name.startsWith("_opencode_bootstrap_")) {
      continue;
    }

    sql.exec(`ALTER TABLE ${name} RENAME TO _opencode_bootstrap_${name}`);
    hidden.push(`_opencode_bootstrap_${name}`);
  }

  return hidden;
}

export function restoreRelayTables(sql: RoomSql, tables: string[]) {
  for (const hidden of tables) {
    const visible = hidden.replace(/^_opencode_bootstrap_/, "");

    const exists = sql
      .exec<SqlCountRow>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
        hidden,
      )
      .one().count;

    if (exists) {
      sql.exec(`ALTER TABLE ${hidden} RENAME TO ${visible}`);
    }
  }
}

function ensureColumn(sql: RoomSql, table: string, column: string, definition: string) {
  const columns = sql.exec<SqlNameRow>(`PRAGMA table_info(${table})`).toArray();

  if (!columns.some((candidate) => candidate.name === column)) {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Older checkpoints cleared these two fields while retaining the publication's
// number and SHA. Recover only from the event for that exact published commit.
export function restorePullRequestAssociation(sql: RoomSql) {
  sql.exec(`
    UPDATE relay_room SET
      pull_request_url = COALESCE(pull_request_url, (
        SELECT json_extract(payload_json, '$.url') FROM relay_events
        WHERE kind = 'system' AND json_extract(payload_json, '$.type') = 'pull_request'
          AND json_extract(payload_json, '$.commitSHA') = relay_room.pull_request_head_sha
        ORDER BY seq DESC LIMIT 1
      )),
      pull_request_branch = COALESCE(pull_request_branch, (
        SELECT json_extract(payload_json, '$.branch') FROM relay_events
        WHERE kind = 'system' AND json_extract(payload_json, '$.type') = 'pull_request'
          AND json_extract(payload_json, '$.commitSHA') = relay_room.pull_request_head_sha
        ORDER BY seq DESC LIMIT 1
      ))
    WHERE singleton = 1 AND pull_request_number IS NOT NULL
      AND (pull_request_url IS NULL OR pull_request_branch IS NULL)
  `);
}
