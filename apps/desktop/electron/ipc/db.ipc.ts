import { ipcMain, dialog } from 'electron'
import { v4 as uuid } from 'uuid'
import { getDb } from '../db/connection.js'

export function registerDbIpc(): void {
  const db = getDb

  // ---- Notebook ----
  ipcMain.handle('knowmind:notebook:create', (_event, title: string, description?: string, template?: string) => {
    const id = uuid()
    let desc = description || ''

    // 预置模板
    const templates: Record<string, { desc: string; cards: Array<{ title: string; brief_answer: string; tags: string[] }> }> = {
      'tech-interview': {
        desc: '技术面试准备 — 涵盖算法、数据结构、系统设计等',
        cards: [
          { title: '请简单介绍一下你自己', brief_answer: '准备一段 1-2 分钟的技术背景自我介绍，突出核心技术栈和代表性项目经验。', tags: ['自我介绍', '基础'] },
          { title: '你最擅长的技术栈是什么？', brief_answer: '明确列出 2-3 个核心技术栈，并准备每个栈的深入问题。', tags: ['技术栈', '基础'] },
          { title: '介绍一个你最有成就感的项目', brief_answer: '用 STAR 法则描述：背景、任务、行动、结果，重点突出技术难点和个人贡献。', tags: ['项目经验', 'STAR'] },
          { title: '如何设计一个高并发系统？', brief_answer: '从负载均衡、缓存策略、数据库分库分表、消息队列等方面展开。', tags: ['系统设计', '高并发'] },
          { title: '你对微服务架构的理解？', brief_answer: '解释服务拆分原则、通信方式(REST/RPC/消息)、服务发现、熔断降级等。', tags: ['架构', '微服务'] },
        ]
      },
      'behavioral': {
        desc: '行为面试准备 — 聚焦软技能、团队协作、领导力等',
        cards: [
          { title: '请分享一次你解决团队冲突的经历', brief_answer: '描述具体冲突场景、你的沟通方式、如何找到共识、最终结果。', tags: ['团队协作', '沟通'] },
          { title: '你是如何保持技术学习的？', brief_answer: '列举学习渠道（博客/开源/课程/书籍），说明学习方法和实践方式。', tags: ['学习能力', '成长'] },
          { title: '描述一次你主导的项目经历', brief_answer: '说明项目背景、你的角色、关键决策、遇到的困难及解决方案。', tags: ['领导力', '项目管理'] },
          { title: '你如何处理工作中的压力？', brief_answer: '描述具体压力场景、你的应对策略、时间管理和心态调节方法。', tags: ['抗压能力', '自我管理'] },
          { title: '你为什么想加入我们公司？', brief_answer: '结合公司业务/技术栈/文化与个人职业规划的契合点来回答。', tags: ['动机', '职业规划'] },
        ]
      },
      'system-design': {
        desc: '系统设计面试准备 — 架构设计、可扩展性、分布式系统',
        cards: [
          { title: '如何设计一个短链接系统？', brief_answer: '核心：哈希算法选择、数据库设计、缓存策略、301/302 重定向、分片扩展。', tags: ['系统设计', 'URL'] },
          { title: '设计一个实时聊天系统', brief_answer: 'WebSocket 长连接、消息队列、离线消息存储、在线状态管理、水平扩展。', tags: ['系统设计', '实时通信'] },
          { title: '如何设计一个分布式 ID 生成器？', brief_answer: '雪花算法(Snowflake)、号段模式、Redis 自增、UUID 对比分析。', tags: ['分布式', 'ID生成'] },
          { title: '设计一个限流系统', brief_answer: '令牌桶/漏桶算法、滑动窗口、Redis + Lua 实现、分布式限流方案。', tags: ['系统设计', '限流'] },
          { title: '如何设计分布式锁？', brief_answer: 'Redis SET NX + 过期时间、Redlock 算法、ZooKeeper 临时节点、etcd 实现对比。', tags: ['分布式', '锁'] },
        ]
      },
      'general': {
        desc: '综合面试准备 — 涵盖技术、行为、项目等全方位准备',
        cards: [
          { title: '自我介绍（30秒/2分钟版本）', brief_answer: '准备长短两个版本，涵盖背景、技术栈、亮点项目、求职意向。', tags: ['自我介绍', '基础'] },
          { title: '你的职业规划是什么？', brief_answer: '短期(1-2年)技术深耕 + 中期(3-5年)领域专家 + 长期愿景。', tags: ['职业规划', '行为'] },
          { title: '你对薪资的期望？', brief_answer: '提前调研市场行情，给出合理范围，表达灵活性。', tags: ['薪资', '谈判'] },
          { title: '你有什么想问我们的？', brief_answer: '准备 3-5 个有深度的问题：技术栈、团队结构、项目挑战、成长空间。', tags: ['反问', '面试技巧'] },
          { title: '如果入职，你前 30/60/90 天的计划？', brief_answer: '了解业务、熟悉代码、建立关系、找到可贡献的点、逐步交付价值。', tags: ['入职计划', '综合'] },
        ]
      }
    }

    if (template && templates[template]) {
      const tpl = templates[template]
      desc = tpl.desc

      // 在事务中创建笔记本和初始卡片
      const insertCard = getDb().prepare(
        `INSERT INTO card (id, notebook_id, title, brief_answer, source_ids, tags_json, status)
         VALUES (?, ?, ?, ?, '[]', ?, 'brief_ready')`
      )
      const insertSupplement = getDb().prepare(
        `INSERT INTO supplement (id, notebook_id, title, content, source_type, embedding_text, reference_id)
         VALUES (?, ?, ?, ?, 'card_brief', ?, ?)`
      )

      const txn = getDb().transaction(() => {
        getDb().prepare(
          'INSERT INTO notebook (id, title, description) VALUES (?, ?, ?)'
        ).run(id, title, desc)

        for (const card of tpl.cards) {
          const cardId = uuid()
          const supplementId = uuid()
          insertCard.run(cardId, id, card.title, card.brief_answer, JSON.stringify({ tags: card.tags, mode: template }))
          insertSupplement.run(supplementId, id, `卡片: ${card.title}`, `## ${card.title}\n\n${card.brief_answer}`, card.title, cardId)
        }
      })
      txn()
    } else {
      getDb().prepare(
        'INSERT INTO notebook (id, title, description) VALUES (?, ?, ?)'
      ).run(id, title, desc)
    }

    return getDb().prepare('SELECT * FROM notebook WHERE id = ?').get(id)
  })

  ipcMain.handle('knowmind:notebook:list', () => {
    return db().prepare('SELECT * FROM notebook WHERE archived_at IS NULL ORDER BY updated_at DESC').all()
  })

  ipcMain.handle('knowmind:notebook:list-archived', () => db().prepare('SELECT * FROM notebook WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all())
  const archiveNotebook = (_event: unknown, id: string) => {
    const result = db().prepare("UPDATE notebook SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(id)
    if (!result.changes) throw new Error('笔记本不存在')
  }
  ipcMain.handle('knowmind:notebook:archive', archiveNotebook)
  ipcMain.handle('knowmind:notebook:restore', (_event, id: string) => {
    const result = db().prepare("UPDATE notebook SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?").run(id)
    if (!result.changes) throw new Error('笔记本不存在')
    return db().prepare('SELECT * FROM notebook WHERE id = ?').get(id)
  })

  ipcMain.handle('knowmind:notebook:get', (_event, id: string) => {
    return db().prepare('SELECT * FROM notebook WHERE id = ?').get(id) || null
  })

  ipcMain.handle('knowmind:notebook:update', (_event, id: string, patch: Record<string, unknown>) => {
    const notebook = db().prepare('SELECT * FROM notebook WHERE id = ?').get(id) as any
    if (!notebook) throw new Error(`Notebook not found: ${id}`)
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title) }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description) }
    if (patch.settings_json !== undefined) { fields.push('settings_json = ?'); values.push(patch.settings_json) }
    fields.push("updated_at = datetime('now')")
    values.push(id)
    db().prepare(`UPDATE notebook SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return db().prepare('SELECT * FROM notebook WHERE id = ?').get(id)
  })

  // Old renderer clients get the same reversible operation.
  ipcMain.handle('knowmind:notebook:delete', archiveNotebook)

  // ---- Source ----
  ipcMain.handle('knowmind:source:list', (_event, notebookId: string) => {
    return db().prepare(
      'SELECT * FROM source WHERE notebook_id = ? ORDER BY created_at DESC'
    ).all(notebookId)
  })

  ipcMain.handle('knowmind:source:get', (_event, id: string) => {
    return db().prepare('SELECT * FROM source WHERE id = ?').get(id) || null
  })

  ipcMain.handle('knowmind:source:get-content', (_event, id: string) => {
    const row = db().prepare('SELECT content_text FROM source WHERE id = ?').get(id) as any
    return row?.content_text || ''
  })

  ipcMain.handle('knowmind:source:delete', (_event, id: string) => {
    db().prepare('DELETE FROM source WHERE id = ?').run(id)
  })

  // ---- Card ----
  ipcMain.handle('knowmind:card:list', (_event, notebookId: string) => {
    return db().prepare(
      'SELECT * FROM card WHERE notebook_id = ? ORDER BY created_at ASC'
    ).all(notebookId)
  })

  ipcMain.handle('knowmind:card:get', (_event, id: string) => {
    return db().prepare('SELECT * FROM card WHERE id = ?').get(id) || null
  })

  ipcMain.handle('knowmind:card:update', (_event, cardId: string, patch: Record<string, unknown>) => {
    const card = db().prepare('SELECT * FROM card WHERE id = ?').get(cardId) as any
    if (!card) throw new Error(`Card not found: ${cardId}`)
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title) }
    if (patch.brief_answer !== undefined) { fields.push('brief_answer = ?'); values.push(patch.brief_answer) }
    if (patch.detail_answer !== undefined) { fields.push('detail_answer = ?'); values.push(patch.detail_answer) }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status) }
    if (patch.tags_json !== undefined) { fields.push('tags_json = ?'); values.push(patch.tags_json) }
    fields.push("updated_at = datetime('now')")
    values.push(cardId)
    db().prepare(`UPDATE card SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return db().prepare('SELECT * FROM card WHERE id = ?').get(cardId)
  })

  ipcMain.handle('knowmind:card:delete', (_event, cardId: string) => {
    const card = db().prepare('SELECT id, notebook_id FROM card WHERE id = ?').get(cardId) as { id: string; notebook_id: string } | undefined
    if (!card) throw new Error('卡片不存在')
    db().transaction(() => {
      // Card details are supplements linked by reference_id; remove them with
      // the card so deleted generated content does not remain in retrieval.
      db().prepare("DELETE FROM supplement WHERE notebook_id = ? AND reference_id = ? AND source_type IN ('card_brief', 'card_detail')").run(card.notebook_id, cardId)
      db().prepare('DELETE FROM card_answer WHERE card_id = ?').run(cardId)
      db().prepare('DELETE FROM card WHERE id = ?').run(cardId)
      db().prepare("UPDATE notebook SET updated_at = datetime('now') WHERE id = ?").run(card.notebook_id)
    })()
  })

  // ---- Supplement ----
  ipcMain.handle('knowmind:supplement:list', (_event, notebookId: string) => {
    return db().prepare(
      'SELECT * FROM supplement WHERE notebook_id = ? ORDER BY created_at DESC'
    ).all(notebookId)
  })

  ipcMain.handle('knowmind:supplement:get-content', (_event, id: string) => {
    const row = db().prepare('SELECT content FROM supplement WHERE id = ?').get(id) as any
    return row?.content || ''
  })

  ipcMain.handle('knowmind:supplement:delete', (_event, id: string) => {
    db().prepare('DELETE FROM supplement WHERE id = ?').run(id)
  })

  // ---- Settings ----
  // 供应商凭据只能通过专用 IPC 读写；这里拦截，避免 Key 进入渲染进程或被误覆盖。
  const SETTINGS_BLOCKED = new Set(['customProviders'])
  const isBlockedSettingsKey = (key: string) => SETTINGS_BLOCKED.has(key)

  ipcMain.handle('knowmind:settings:get', (_event, key: string) => {
    if (typeof key !== 'string' || isBlockedSettingsKey(key)) return null
    const row = db().prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as any
    return row ? JSON.parse(row.value_json) : null
  })

  ipcMain.handle('knowmind:settings:set', (_event, key: string, value: unknown) => {
    if (typeof key !== 'string' || !key || isBlockedSettingsKey(key)) throw new Error('该设置项只能通过对应功能修改')
    db().prepare(
      'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
    ).run(key, JSON.stringify(value))
  })

  ipcMain.handle('knowmind:settings:get-all', () => {
    const rows = db().prepare('SELECT key, value_json FROM settings').all() as Array<{ key: string; value_json: string }>
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      if (isBlockedSettingsKey(row.key) || row.key.startsWith('platform_')) continue
      result[row.key] = JSON.parse(row.value_json)
    }
    return result
  })

  // ---- Dialog ----
  ipcMain.handle('knowmind:dialog:open-file', async (_event, filters?: Array<{ name: string; extensions: string[] }>) => {
    const defaultFilters = [
      { name: '文档', extensions: ['pdf', 'docx', 'doc', 'md', 'txt'] },
      { name: '全部文件', extensions: ['*'] }
    ]
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || defaultFilters
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('knowmind:dialog:open-files', async (_event, filters?: Array<{ name: string; extensions: string[] }>) => {
    const defaultFilters = [
      { name: '文档', extensions: ['pdf', 'docx', 'doc', 'md', 'txt'] },
      { name: '全部文件', extensions: ['*'] }
    ]
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters || defaultFilters
    })
    if (result.canceled || result.filePaths.length === 0) return []
    return result.filePaths
  })

  ipcMain.handle('knowmind:dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
