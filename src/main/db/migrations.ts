// Forward-only migrations. Each runs once, tracked in the _migrations table.
// Append new migrations; never edit an applied one.

export interface Migration {
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    name: '0001_init',
    sql: `
      CREATE TABLE sessions (
        id              TEXT PRIMARY KEY,
        sdk_session_id  TEXT,
        title           TEXT NOT NULL,
        model           TEXT,
        cwd             TEXT NOT NULL,
        repo_id         TEXT,
        branch          TEXT,
        worktree_path   TEXT,
        status          TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        preset_id       TEXT,
        total_cost_usd  REAL NOT NULL DEFAULT 0,
        num_turns       INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        error           TEXT
      );

      CREATE TABLE messages (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL,
        kind           TEXT NOT NULL,
        blocks_json    TEXT NOT NULL,
        result_subtype TEXT,
        cost_usd       REAL,
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_session ON messages(session_id, created_at);

      CREATE TABLE actions (
        id          TEXT PRIMARY KEY,
        session_id  TEXT,
        action_type TEXT NOT NULL,
        connector   TEXT NOT NULL,
        direction   TEXT NOT NULL,
        summary     TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status      TEXT NOT NULL,
        decided_by  TEXT,
        result_json TEXT,
        error       TEXT,
        created_at  INTEGER NOT NULL,
        decided_at  INTEGER
      );
      CREATE INDEX idx_actions_created ON actions(created_at DESC);
      CREATE INDEX idx_actions_status ON actions(status);

      CREATE TABLE policies (
        action_type TEXT PRIMARY KEY,
        mode        TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE repos (
        id             TEXT PRIMARY KEY,
        path           TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        added_at       INTEGER NOT NULL
      );
    `
  },
  {
    name: '0002_session_pinned',
    sql: `ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`
  },
  {
    name: '0003_session_workstate_links',
    sql: `
      ALTER TABLE sessions ADD COLUMN work_state      TEXT;
      ALTER TABLE sessions ADD COLUMN linear_issue_id TEXT;
      ALTER TABLE sessions ADD COLUMN notion_page_id  TEXT;
    `
  },
  {
    name: '0004_session_parent',
    sql: `ALTER TABLE sessions ADD COLUMN parent_id TEXT;`
  },
  {
    name: '0005_session_tokens',
    sql: `
      ALTER TABLE sessions ADD COLUMN input_tokens  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    name: '0006_session_task_brief',
    sql: `ALTER TABLE sessions ADD COLUMN task_brief TEXT;`
  },
  {
    name: '0007_session_review_verdict',
    sql: `ALTER TABLE sessions ADD COLUMN review_verdict TEXT;`
  },
  {
    name: '0008_session_cached_input_tokens',
    sql: `ALTER TABLE sessions ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;`
  }
]
