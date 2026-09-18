import { ipcMain } from 'electron'
import { v4 as uuid } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db/connection.js'
import { getActiveModel } from '../ai/provider.js'
import { generateTextWithFallback } from '../ai/generate.js'
import { parseSourceSummary } from '../ai/structured.js'

async function parseDocument(filePath: string): Promise<{ text: string; title: string }> {
  const ext = path.extname(filePath).toLowerCase()
  const title = path.basename(filePath)

  try {
    switch (ext) {
      case '.pdf': {
        const { parsePdf } = await import('../doc/pdf.js')
        const text = await parsePdf(filePath)
        return { text, title }
      }
      case '.docx':
      case '.doc': {
        const { parseWord } = await import('../doc/word.js')
        const text = await parseWord(filePath)
        return { text, title }
      }
      case '.md':
      case '.txt': {
        const text = fs.readFileSync(filePath, 'utf-8')
        return { text, title }
      }
      default:
        throw new Error(`不支持的文件类型: ${ext}`)
    }
  } catch (err: any) {
    throw new Error(`文档解析失败: ${err.message}`)
  }
}

function getSourceType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.pdf': return 'pdf'
    case '.docx':
    case '.doc': return 'docx'
    case '.md': return 'markdown'
    default: return 'text'
  }
}

/** 生成来源摘要 - 自动调用 AI 生成摘要、关键主题、建议问题 */
async function generateSourceSummary(sourceId: string, contentText: string, title: string): Promise<void> {
  const db = getDb()
  try {
    const { model, def } = await getActiveModel(db)
    const truncated = contentText.length > 6000 ? contentText.substring(0, 6000) + '...(已截断)' : contentText

    const { text, usedModel } = await generateTextWithFallback(model, def, {
      system: '你是面试知识助手。请根据提供的文档内容，生成以下结构 JSON。严格输出 JSON，不要其他文字。',
      prompt: `文档标题：${title}

文档内容（截取）：
${truncated}

请生成以下 JSON（键名固定为英文）：
{
  "summary": "文档核心内容摘要（2-3句话，中文）",
  "keyTopics": ["关键主题1", "关键主题2", "..."],
  "suggestedQuestions": ["AI可帮回答的问题1", "问题2", "..."]
}`,
      maxOutputTokens: 1500, stream: true,
      validate: text => { parseSourceSummary(text) },
    })

    const metadata = { ...parseSourceSummary(text), generatedModel: usedModel }

    db.prepare(
      'UPDATE source SET metadata_json = ? WHERE id = ?'
    ).run(JSON.stringify(metadata), sourceId)
  } catch (err: any) {
    console.error('来源摘要生成失败:', err.message)
    db.prepare('UPDATE source SET metadata_json = ? WHERE id = ?').run(JSON.stringify({
      summary: '摘要暂未生成，原文已保存，可以继续问答和复习。', keyTopics: [], suggestedQuestions: [], summaryError: true,
    }), sourceId)
  }
}

// ---- URL / GitHub 内容抓取 ----

/** 判断是否 GitHub 链接 */
function isGitHubUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'github.com' || host === 'raw.githubusercontent.com' || host === 'gist.github.com'
  } catch {
    return false
  }
}

/** 解析 GitHub URL，提取 owner/repo/branch/path */
function parseGitHubUrl(url: string): { apiUrl: string; displayTitle: string } | null {
  try {
    const u = new URL(url)

    // raw.githubusercontent.com -> 直接读
    if (u.hostname === 'raw.githubusercontent.com') {
      return { apiUrl: url, displayTitle: url.split('/').pop() || url }
    }

    // gist.github.com
    if (u.hostname === 'gist.github.com') {
      return { apiUrl: url.replace('gist.github.com', 'gist.githubusercontent.com') + '/raw', displayTitle: 'Gist' }
    }

    // github.com/owner/repo
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) {
      const owner = parts[0]
      const repo = parts[1]
      const branch = parts.length >= 4 && parts[2] === 'blob' ? parts[3] : 'main'

      // 如果路径指向具体文件
      if (parts.length >= 5 && parts[2] === 'blob') {
        const filePath = parts.slice(4).join('/')
        return {
          apiUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
          displayTitle: `${owner}/${repo}/${filePath.split('/').pop()}`
        }
      }

      // 否则读取 README
      return {
        apiUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
        displayTitle: `${owner}/${repo}`
      }
    }

    return null
  } catch {
    return null
  }
}

/** 抓取 GitHub 原始内容 */
async function fetchGitHubContent(apiUrl: string, signal: AbortSignal): Promise<string> {
  // 先尝试 .md，如果 404 则尝试降级
  const response = await fetch(apiUrl, {
    signal,
    headers: { 'Accept': 'text/plain,text/markdown,text/html' }
  })

  if (!response.ok) {
    throw new Error(`GitHub 抓取失败: HTTP ${response.status}`)
  }

  const text = await response.text()
  return text || '(仓库内容为空)'
}

/** 抓取普通网页正文 */
async function fetchWebContent(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`网页抓取失败: HTTP ${response.status}`)
  const html = await response.text()
  let text = html

  try {
    const { load } = await import('cheerio')
    const $ = load(html)
    $('script, style, nav, footer, header, aside').remove()
    text = $('body').text().replace(/\s+/g, ' ').trim()
    if (!text) text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  } catch {
    text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  return text
}

// ---- IPC 注册 ----

export function registerDocIpc(): void {
  const db = getDb

  ipcMain.handle('knowmind:source:get-summary', async (_event, sourceId: string) => {
    const row = db().prepare('SELECT metadata_json FROM source WHERE id = ?').get(sourceId) as any
    if (!row?.metadata_json) return null
    try {
      const summary = JSON.parse(row.metadata_json)
      return typeof summary?.summary === 'string' && summary.summary.trim() ? summary : null
    } catch { return null }
  })

  ipcMain.handle('knowmind:source:upload', async (_event, notebookId: string, filePath: string) => {
    const sourceId = uuid()
    const srcType = getSourceType(filePath)

    db().prepare(
      `INSERT INTO source (id, notebook_id, type, title, file_path, status)
       VALUES (?, ?, ?, ?, ?, 'processing')`
    ).run(sourceId, notebookId, srcType, path.basename(filePath), filePath)

    try {
      const { text } = await parseDocument(filePath)

      db().prepare(
        "UPDATE source SET content_text = ?, status = 'ready', updated_at = datetime('now') WHERE id = ?"
      ).run(text, sourceId)

      db().prepare("UPDATE notebook SET updated_at = datetime('now') WHERE id = ?").run(notebookId)

      // 后台生成摘要（不阻塞返回）
      generateSourceSummary(sourceId, text, path.basename(filePath))
    } catch (err: any) {
      db().prepare(
        "UPDATE source SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(err.message, sourceId)
    }

    return db().prepare('SELECT * FROM source WHERE id = ?').get(sourceId)
  })

  ipcMain.handle('knowmind:source:add-url', async (_event, notebookId: string, url: string) => {
    const sourceId = uuid()
    const gitHub = isGitHubUrl(url)
    const parsed = gitHub ? parseGitHubUrl(url) : null
    const srcType = gitHub ? 'github' : 'url'

    db().prepare(
      `INSERT INTO source (id, notebook_id, type, title, url, status)
       VALUES (?, ?, ?, ?, ?, 'processing')`
    ).run(sourceId, notebookId, srcType, url, url)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)
      let text = ''

      try {
        if (parsed) {
          text = await fetchGitHubContent(parsed.apiUrl, controller.signal)
        } else {
          text = await fetchWebContent(url, controller.signal)
        }
      } finally {
        clearTimeout(timeout)
      }

      if (!text) text = '(无法提取内容)'

      const title = parsed?.displayTitle || url

      db().prepare(
        "UPDATE source SET content_text = ?, title = ?, status = 'ready', updated_at = datetime('now') WHERE id = ?"
      ).run(text, title, sourceId)

      db().prepare("UPDATE notebook SET updated_at = datetime('now') WHERE id = ?").run(notebookId)

      // 后台生成摘要
      generateSourceSummary(sourceId, text, title)
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? '抓取超时' : err.message
      db().prepare(
        "UPDATE source SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(msg, sourceId)
    }

    return db().prepare('SELECT * FROM source WHERE id = ?').get(sourceId)
  })
}
