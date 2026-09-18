import type Database from 'better-sqlite3'

export const legacyTables = ['notebook', 'source', 'chunk', 'card', 'card_answer', 'supplement', 'chat_message',
  'interview_session', 'interview_turn', 'recording', 'recording_chunk', 'recording_search',
  'global_repository', 'global_document', 'global_chunk', 'global_search', 'settings'] as const

/** A connected user-data fixture using only columns present in schema v4. */
export function seedLegacyData(db: Database.Database) {
  db.prepare("INSERT INTO notebook(id,title,description,settings_json,created_at,updated_at) VALUES ('book','原有项目笔记','不可丢失的描述','{\"theme\":\"dark\"}','2026-01-02 03:04:05','2026-01-03 04:05:06')").run()
  db.prepare("INSERT INTO source(id,notebook_id,type,title,file_path,url,content_text,metadata_json,status) VALUES ('source','book','markdown','原始资料','/tmp/synthetic-project.md','https://example.test/project','项目有唯一约束。来源[1]','{\"summary\":\"原有摘要\"}','ready')").run()
  db.prepare("INSERT INTO chunk(id,source_id,chunk_index,content,token_count) VALUES ('chunk','source',0,'项目有唯一约束。',12)").run()
  db.prepare("INSERT INTO card(id,notebook_id,title,brief_answer,detail_answer,source_ids,tags_json,status) VALUES ('card','book','如何幂等？','唯一约束','旧卡片的完整解释','[\"source\"]','{\"tags\":[\"数据库\"]}','detail_ready')").run()
  db.prepare("INSERT INTO card_answer(id,card_id,question,answer,model_name) VALUES ('card-answer','card','怎么重试？','维持请求唯一键','legacy-model')").run()
  db.prepare("INSERT INTO supplement(id,notebook_id,title,content,source_type,reference_id,embedding_text) VALUES ('supplement','book','原有补充','补充正文 来源[1]','card_detail','card','如何幂等')").run()
  db.prepare("INSERT INTO chat_message(id,notebook_id,role,content,citations_json) VALUES ('chat','book','assistant','旧问答 来源[1]','[{\"ref\":\"来源[1]\",\"id\":\"source\",\"title\":\"原始资料\"}]')").run()
  db.prepare("INSERT INTO interview_session(id,notebook_id,title,company,department,role,jd,tags_json,status,research_json) VALUES ('session','book','原有模拟面试','合成企业','研发','后端','数据库基础','[\"一面\"]','active','[{\"title\":\"公开线索\",\"url\":\"https://example.test/interview\",\"snippet\":\"摘要\",\"retrieved_at\":\"2026-01-01\"}]')").run()
  db.prepare("INSERT INTO interview_turn(id,session_id,question,answer,feedback,score,reference_answer,knowledge,model_name) VALUES ('turn','session','如何保证幂等？','请求唯一键','需要说明并发',60,'参考答案 来源[1]','已有复习知识','legacy-model')").run()
  db.prepare("INSERT INTO recording(id,notebook_id,title,company,role,jd,tags_json,tracks_json,transcript_json,report_json,status,duration,shared) VALUES ('recording','book','原有录音','合成企业','后端','数据库','[\"回访\"]','[{\"kind\":\"imported\",\"label\":\"导入\"}]','[{\"id\":0,\"track\":\"imported\",\"speaker\":\"本人\",\"start\":0,\"end\":5,\"text\":\"AUDIOMIGRATIONTOKEN 唯一约束\"}]','{\"questions\":[],\"score\":null,\"summaries\":[\"旧复盘\"],\"created_at\":\"2026-01-01\"}','ready',5,1)").run()
  db.prepare("INSERT INTO recording_chunk(id,recording_id,content) VALUES (1,'recording','AUDIOMIGRATIONTOKEN 原有录音索引')").run()
  db.prepare("INSERT INTO recording_search(rowid,title_tokens,body_tokens) VALUES (1,'recording','audiomigrationtoken')").run()
  db.prepare("INSERT INTO global_repository(id,name,base_url,revision,status) VALUES ('repository','原有知识仓库','https://example.test/repository','old-revision','ready')").run()
  db.prepare("INSERT INTO global_document(id,repository_id,path,url,title,content_text,checksum) VALUES ('document','repository','docs/old.md','https://example.test/old','原有文章','GLOBALMIGRATIONTOKEN 旧文章内容','old-checksum')").run()
  db.prepare("INSERT INTO global_chunk(id,document_id,content) VALUES (1,'document','GLOBALMIGRATIONTOKEN 旧文章内容')").run()
  db.prepare("INSERT INTO global_search(rowid,title_tokens,body_tokens) VALUES (1,'original','globalmigrationtoken')").run()
  db.prepare("INSERT INTO settings(key,value_json) VALUES ('existing-setting','{\"preserve\":true}')").run()
}

export function columnSnapshot(db: Database.Database, tables: readonly string[] = legacyTables) {
  return Object.fromEntries(tables.map(table => {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name)
    return [table, { columns, rows: db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY rowid`).all() }]
  }))
}

export function snapshotOriginalColumns(db: Database.Database, snapshot: ReturnType<typeof columnSnapshot>) {
  return Object.fromEntries(Object.entries(snapshot).map(([table, value]) => [table, {
    columns: value.columns, rows: db.prepare(`SELECT ${value.columns.join(',')} FROM ${table} ORDER BY rowid`).all(),
  }]))
}
