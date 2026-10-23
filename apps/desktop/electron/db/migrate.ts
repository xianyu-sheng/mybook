import type Database from 'better-sqlite3'
import { practiceMigration } from '../practice/schema.js'

export const SCHEMA_VERSION = 8

const migrations: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notebook (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      settings_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS source (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('pdf','docx','url','github','markdown','text')),
      title TEXT NOT NULL,
      file_path TEXT,
      url TEXT,
      content_text TEXT,
      metadata_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','error')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_source_notebook ON source(notebook_id)`,
    `CREATE TABLE IF NOT EXISTS chunk (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chunk_source ON chunk(source_id)`,
    `CREATE TABLE IF NOT EXISTS card (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      brief_answer TEXT NOT NULL,
      detail_answer TEXT,
      source_ids TEXT DEFAULT '[]',
      tags_json TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','brief_ready','detail_ready')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_card_notebook ON card(notebook_id)`,
    `CREATE TABLE IF NOT EXISTS card_answer (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_card_answer_card ON card_answer(card_id)`,
    `CREATE TABLE IF NOT EXISTS supplement (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('card_brief','card_detail','qa','manual')),
      reference_id TEXT,
      embedding_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_supplement_notebook ON supplement(notebook_id)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ],
  2: [
    `CREATE TABLE chat_message (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_chat_notebook ON chat_message(notebook_id)`,
    `INSERT INTO chat_message (id, notebook_id, role, content, created_at)
      SELECT id, notebook_id, role, content, created_at FROM (
        SELECT id || '-user' AS id, notebook_id, 'user' AS role, COALESCE(embedding_text, title) AS content, created_at, rowid AS seq, 0 AS part FROM supplement WHERE source_type = 'qa' AND reference_id IS NULL
        UNION ALL
        SELECT id || '-assistant', notebook_id, 'assistant', content, created_at, rowid, 1 FROM supplement WHERE source_type = 'qa' AND reference_id IS NULL
      ) ORDER BY seq, part`,
    `CREATE TABLE interview_session (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      jd TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      search_web INTEGER NOT NULL DEFAULT 1,
      question_count INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed')),
      research_json TEXT NOT NULL DEFAULT '[]',
      research_error TEXT,
      export_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_interview_notebook ON interview_session(notebook_id)`,
    `CREATE TABLE interview_turn (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT,
      feedback TEXT,
      score INTEGER,
      reference_answer TEXT,
      knowledge TEXT,
      model_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_interview_turn_session ON interview_turn(session_id)`
  ],
  3: [
    `CREATE TABLE global_repository (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL UNIQUE,
      homepage TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      revision TEXT,
      warning TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'not_synced' CHECK(status IN ('not_synced','syncing','ready','error')),
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE global_document (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES global_repository(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repository_id, url)
    )`,
    `CREATE INDEX idx_global_document_repo ON global_document(repository_id)`,
    `CREATE TABLE global_chunk (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES global_document(id) ON DELETE CASCADE,
      content TEXT NOT NULL
    )`,
    `CREATE INDEX idx_global_chunk_document ON global_chunk(document_id)`,
    `CREATE VIRTUAL TABLE global_search USING fts5(title_tokens, body_tokens, tokenize='unicode61')`,
    `CREATE TRIGGER global_chunk_delete AFTER DELETE ON global_chunk BEGIN
      DELETE FROM global_search WHERE rowid = old.id;
    END`
  ],
  4: [
    `CREATE TABLE recording (
      id TEXT PRIMARY KEY,
      notebook_id TEXT REFERENCES notebook(id) ON DELETE SET NULL,
      title TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', jd TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]', tracks_json TEXT NOT NULL DEFAULT '[]',
      transcript_json TEXT NOT NULL DEFAULT '[]', report_json TEXT,
      status TEXT NOT NULL DEFAULT 'recorded', duration REAL NOT NULL DEFAULT 0,
      shared INTEGER NOT NULL DEFAULT 1, started_at TEXT, error TEXT, export_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE recording_chunk (
      id INTEGER PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      content TEXT NOT NULL
    )`,
    `CREATE INDEX idx_recording_chunk ON recording_chunk(recording_id)`,
    `CREATE VIRTUAL TABLE recording_search USING fts5(title_tokens, body_tokens, tokenize='unicode61')`,
    `CREATE TRIGGER recording_chunk_delete AFTER DELETE ON recording_chunk BEGIN
      DELETE FROM recording_search WHERE rowid=old.id;
    END`
  ],
  5: [
    `ALTER TABLE notebook ADD COLUMN archived_at TEXT`,
    `ALTER TABLE supplement ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE card ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE interview_turn ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE interview_turn ADD COLUMN question_citations_json TEXT NOT NULL DEFAULT '[]'`,
    `CREATE TABLE target_role (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, jd TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    ...practiceMigration
  ],
  6: [
    `CREATE TABLE coding_strategy (
      id TEXT PRIMARY KEY,
      target_role_id TEXT REFERENCES target_role(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      jd TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '["nowcoder","xiaohongshu","codetop","leetcode","lingshen"]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','completed','archived')),
      research_json TEXT NOT NULL DEFAULT '[]',
      research_error TEXT,
      last_researched_at TEXT,
      last_synced_at TEXT,
      sync_json TEXT NOT NULL DEFAULT '{}',
      sync_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_coding_strategy_status ON coding_strategy(status, updated_at)`,
    `CREATE TABLE coding_problem (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      source_id TEXT,
      source_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard','unknown')),
      tags_json TEXT NOT NULL DEFAULT '[]',
      knowledge_json TEXT NOT NULL DEFAULT '[]',
      statement TEXT NOT NULL DEFAULT '',
      constraints TEXT NOT NULL DEFAULT '',
      examples_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_coding_problem_source ON coding_problem(source, difficulty)`,
    `CREATE TABLE coding_strategy_problem (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL REFERENCES coding_strategy(id) ON DELETE CASCADE,
      problem_id TEXT NOT NULL REFERENCES coding_problem(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'pattern' CHECK(phase IN ('foundation','pattern','company','stretch')),
      reason TEXT NOT NULL DEFAULT '',
      prerequisites_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','learning','attempted','mastered','skipped')),
      due_at TEXT,
      last_attempted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(strategy_id, problem_id)
    )`,
    `CREATE INDEX idx_coding_strategy_problem_order ON coding_strategy_problem(strategy_id, sort_order)`,
    `CREATE TABLE coding_attempt (
      id TEXT PRIMARY KEY,
      strategy_problem_id TEXT NOT NULL REFERENCES coding_strategy_problem(id) ON DELETE CASCADE,
      language TEXT NOT NULL DEFAULT 'text',
      thought TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      time_complexity TEXT NOT NULL DEFAULT '',
      space_complexity TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewing','reviewed','error')),
      review_json TEXT,
      model_name TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_coding_attempt_problem ON coding_attempt(strategy_problem_id, created_at)`,
    `CREATE TABLE coding_sync_record (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL REFERENCES coding_strategy(id) ON DELETE CASCADE,
      strategy_problem_id TEXT REFERENCES coding_strategy_problem(id) ON DELETE SET NULL,
      platform TEXT NOT NULL CHECK(platform IN ('leetcode','nowcoder')),
      external_id TEXT NOT NULL,
      external_title TEXT NOT NULL DEFAULT '',
      external_status TEXT NOT NULL DEFAULT 'unknown',
      external_url TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(strategy_id, platform, external_id)
    )`,
    `CREATE INDEX idx_coding_sync_strategy ON coding_sync_record(strategy_id, platform, synced_at)`
  ],
  7: [
    `CREATE TABLE qa_session (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE qa_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES qa_session(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX idx_qa_message_session ON qa_message(session_id, created_at)`,
    `INSERT INTO qa_session(id,title,created_at,updated_at)
      SELECT 'legacy-' || n.id, n.title || ' · 历史问答', MIN(m.created_at), MAX(m.created_at)
      FROM chat_message m JOIN notebook n ON n.id = m.notebook_id GROUP BY n.id`,
    `INSERT INTO qa_message(id,session_id,role,content,citations_json,created_at)
      SELECT id, 'legacy-' || notebook_id, role, content, citations_json, created_at FROM chat_message`
  ],
  8: [
    `ALTER TABLE global_document ADD COLUMN blob_sha TEXT`
  ]
}

export function runMigrations(db: Database.Database): void {
  // 确保版本表存在
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)')

  const row = db.prepare('SELECT COALESCE(MAX(version), 0) as version FROM _schema_version').get() as { version: number }
  let currentVersion = row.version

  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const sqls = migrations[v]
    if (sqls) {
      const runAll = db.transaction(() => {
        for (const sql of sqls) {
          db.exec(sql)
        }
        db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(v)
      })
      runAll()
      console.log(`[DB] Migration v${v} applied`)
    }
  }
}
