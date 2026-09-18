/** Added by the shared v5 migration. Source IDs deliberately have no cascading foreign keys. */
export const practiceMigration: string[] = [
  `CREATE TABLE practice_item (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL CHECK(source_type IN ('recording','interview','card')),
    source_id TEXT NOT NULL,
    source_label TEXT NOT NULL,
    question TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL,
    requirements_json TEXT NOT NULL,
    input_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','mastered','archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE practice_attempt (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES practice_item(id) ON DELETE CASCADE,
    answer TEXT NOT NULL,
    input_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('evaluating','ready','error')),
    review_json TEXT,
    model_name TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX idx_practice_attempt_item ON practice_attempt(item_id)',
]
