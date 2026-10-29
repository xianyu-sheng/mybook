import { useState, useEffect, useCallback } from 'react'
import { Upload, Link, FileText, Trash2, Loader2, AlertCircle, ChevronDown, ChevronUp, Lightbulb, Download } from 'lucide-react'
import type { Source, SourceSummary, PlatformStatus } from '@/types/db'

interface Props { notebookId: string }

export default function SourcePanel({ notebookId }: Props) {
  const [来源列表, set来源列表] = useState<Source[]>([])
  const [正在上传, set正在上传] = useState(false)
  const [加载中, set加载中] = useState(true)
  const [提示, set提示] = useState('')
  const [错误, set错误] = useState('')
  const [展开摘要, set展开摘要] = useState<Record<string, SourceSummary | null>>({})
  const [正在加载摘要, set正在加载摘要] = useState<Record<string, boolean>>({})
  const [平台状态, set平台状态] = useState<PlatformStatus>({ github: { connected: false }, leetcode: { connected: false }, nowcoder: { connected: false } })
  const [正在导入平台, set正在导入平台] = useState<string | null>(null)
  const [显示平台菜单, set显示平台菜单] = useState(false)
  const [列表已折叠, set列表已折叠] = useState(true)
  const [显示链接表单, set显示链接表单] = useState(false)
  const [链接地址, set链接地址] = useState('')

  const 已连接平台 = Object.entries(平台状态).filter(([_, v]) => v.connected).map(([k]) => k)
  const 平台名称: Record<string, string> = { github: 'GitHub', leetcode: '力扣', nowcoder: '牛客网' }
  const 平台图标: Record<string, string> = { github: '🐙', leetcode: '🏷️', nowcoder: '🐮' }
  const 类型中文名: Record<string, string> = { pdf: 'PDF', docx: 'Word', doc: 'Word', md: 'Markdown', txt: '文本', github: 'GitHub', url: '网页', markdown: 'Markdown', text: '文本' }

  // 类型统计（折叠时展示）
  const 类型统计: Record<string, number> = {}
  for (const s of 来源列表) {
    类型统计[s.type] = (类型统计[s.type] || 0) + 1
  }
  const 统计文本 = Object.entries(类型统计).map(([k, v]) => `${v} ${类型中文名[k] || k}`).join(' · ')
  const 有异常 = 来源列表.some(s => s.status === 'processing' || s.status === 'error')
  const 需折叠 = 列表已折叠 && 来源列表.length >= 5

  const 加载来源 = useCallback(async () => {
    try {
      const list = await window.knowmind.sources.list(notebookId)
      set来源列表(list)
      set错误(previous => previous.startsWith('加载来源失败:') ? '' : previous)
    } catch (err: any) {
      set错误('加载来源失败: ' + (err?.message || String(err)))
    } finally {
      set加载中(false)
    }
  }, [notebookId])

  useEffect(() => { 加载来源(); 加载平台状态() }, [加载来源])

  const 加载平台状态 = async () => {
    try {
      const status = await window.knowmind.auth.status()
      set平台状态(status)
    } catch { /* 忽略 */ }
  }

  // 轮询检查新来源的摘要（后台异步生成）
  useEffect(() => {
    const 需要检查 = 来源列表.filter(s => s.status === 'ready' && !展开摘要[s.id])
    if (需要检查.length === 0) return

    let stopped = false
    const pending = new Set(需要检查.map(s => s.id))
    const timer = setInterval(async () => {
      for (const id of pending) {
        try {
          const summary = await window.knowmind.sources.getSummary(id)
          if (stopped) return
          if (summary?.summary) {
            pending.delete(id)
            set展开摘要(prev => ({ ...prev, [id]: summary }))
          }
        } catch { /* 忽略 */ }
      }
      if (!pending.size) clearInterval(timer)
    }, 3000)
    const deadline = setTimeout(() => clearInterval(timer), 195000)
    return () => { stopped = true; clearInterval(timer); clearTimeout(deadline) }
  }, [来源列表])

  const 上传文件 = async () => {
    try {
      set提示('正在打开文件选择器...')
      const filePaths = await window.knowmind.dialog.openFiles([
        { name: '文档', extensions: ['pdf', 'docx', 'doc', 'md', 'txt'] }
      ])
      if (!filePaths || filePaths.length === 0) { set提示(''); return }

      set正在上传(true)
      let 成功数 = 0
      let 失败数 = 0

      for (let i = 0; i < filePaths.length; i++) {
        const fp = filePaths[i]
        set提示(`正在解析文件 (${i + 1}/${filePaths.length})...`)
        try {
          const source = await window.knowmind.sources.upload(notebookId, fp)
          set来源列表(prev => [source, ...prev])
          if (source.status === 'error') 失败数++
          else 成功数++
        } catch {
          失败数++
        }
      }

      if (失败数 === 0) {
        set提示(`${成功数} 个文件已添加，AI 正在后台分析...`)
      } else {
        set提示(`${成功数} 个成功, ${失败数} 个失败`)
      }

      setTimeout(async () => { await 加载来源(); set提示(''); set列表已折叠(false) }, 3000)
    } catch (err: any) {
      set错误('上传失败: ' + (err?.message || String(err)))
    } finally {
      set正在上传(false)
    }
  }

  const 添加链接 = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = 链接地址.trim()
    if (!url) return
    try {
      set正在上传(true)
      set提示('正在抓取网页...')
      const source = await window.knowmind.sources.addUrl(notebookId, url)
      set来源列表(prev => [source, ...prev])
      if (source.status === 'error') throw new Error(source.error_message || '网页抓取失败')
      set提示('链接已添加，AI 正在后台分析...')
      set链接地址('')
      set显示链接表单(false)
      setTimeout(() => set提示(''), 1500)
    } catch (err: any) {
      set错误('添加链接失败: ' + (err?.message || String(err)))
    } finally {
      set正在上传(false)
    }
  }

  const 删除来源 = async (id: string) => {
    const source = 来源列表.find(item => item.id === id)
    if (!confirm(`删除来源「${source?.title || id}」？相关的分块会一并删除；已经生成的卡片会保留。`)) return
    try {
      await window.knowmind.sources.delete(id)
      set来源列表(prev => prev.filter(s => s.id !== id))
      set展开摘要(prev => { const next = { ...prev }; delete next[id]; return next })
      set提示('来源已删除')
      setTimeout(() => set提示(''), 1500)
    } catch (err: any) {
      set错误('删除失败: ' + (err?.message || String(err)))
    }
  }

  const 导入平台数据 = async (platform: string) => {
    set错误('')
    set正在导入平台(platform)
    set显示平台菜单(false)
    set提示(`正在从${平台名称[platform]}导入数据...`)
    try {
      const result = await window.knowmind.auth.importData(notebookId, platform)
      if (result.success) {
        await 加载来源()
        set提示(result.warning || `已从 ${平台名称[platform]} 导入 ${result.platformData?.description}，生成了 ${result.cardsGenerated || 0} 张卡片`)
        if (result.cardGenerationError) set错误(`来源已保存，AI 卡片暂未生成：${result.cardGenerationError}。可在复习资料中重新生成卡片。`)
        setTimeout(() => set提示(''), 2000)
      } else {
        set错误(`导入失败: ${result.error}`)
      }
    } catch (err: any) {
      set错误('导入失败: ' + (err?.message || String(err)))
    } finally {
      set正在导入平台(null)
    }
  }

  const 切换摘要 = async (source: Source) => {
    if (展开摘要[source.id] !== undefined) {
      set展开摘要(prev => { const next = { ...prev }; delete next[source.id]; return next })
      return
    }
    set正在加载摘要(prev => ({ ...prev, [source.id]: true }))
    try {
      const summary = await window.knowmind.sources.getSummary(source.id)
      set展开摘要(prev => ({ ...prev, [source.id]: summary }))
    } catch {
      set展开摘要(prev => ({ ...prev, [source.id]: null }))
    } finally {
      set正在加载摘要(prev => { const next = { ...prev }; delete next[source.id]; return next })
    }
  }

  const 状态 = (s: string) => {
    switch (s) {
      case 'processing': return <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
      case 'ready': return <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
      case 'error': return <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
      default: return <div className="w-1.5 h-1.5 rounded-full bg-zinc-300" />
    }
  }

  const 图标 = (t: string) => {
    switch (t) {
      case 'pdf': return <FileText className="w-4 h-4 text-red-400" />
      case 'docx': return <FileText className="w-4 h-4 text-blue-400" />
      case 'github': return <Link className="w-4 h-4 text-purple-400" />
      default: return <FileText className="w-4 h-4 text-zinc-400" />
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          知识来源{来源列表.length > 0 && <span className="ml-2 font-normal text-zinc-400">({来源列表.length})</span>}
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          {/* 导入平台数据下拉 */}
          {已连接平台.length > 0 && (
            <div className="relative">
              <button
                onClick={() => set显示平台菜单(!显示平台菜单)}
                disabled={正在上传 || 正在导入平台 !== null}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary-50 dark:bg-primary-950 hover:bg-primary-100 dark:hover:bg-primary-900 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 transition-colors disabled:opacity-50"
              >
                <Download className="w-3 h-3" />导入平台数据
              </button>
              {显示平台菜单 && (
                <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg z-20 py-1">
                  {(['github', 'leetcode', 'nowcoder'] as const).filter(p => 平台状态[p].connected).map(p => (
                    <button
                      key={p}
                      onClick={() => 导入平台数据(p)}
                      disabled={正在导入平台 === p}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs flex items-center gap-2 disabled:opacity-50"
                    >
                      <span>{平台图标[p]}</span>
                      <span>从{平台名称[p]}导入</span>
                      {正在导入平台 === p && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={上传文件} disabled={正在上传}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors">
            {正在上传 ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}上传文件
          </button>
          <button onClick={() => set显示链接表单(!显示链接表单)} disabled={正在上传}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors">
            <Link className="w-3 h-3" />添加链接
          </button>
        </div>
      </div>

      {显示链接表单 && <form onSubmit={添加链接} className="flex flex-wrap gap-2 mb-3">
        <input aria-label="网页地址" type="url" required value={链接地址} onChange={e => set链接地址(e.target.value)} placeholder="https://" className="flex-1 min-w-0 border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-transparent" />
        <button disabled={正在上传} className="px-3 py-2 text-sm text-white bg-blue-600 rounded-md disabled:opacity-50">导入网页</button>
        <button type="button" onClick={() => set显示链接表单(false)} className="px-3 py-2 text-sm text-zinc-500">取消</button>
      </form>}

      {错误 && (
        <div className="mb-2 p-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{错误}</span>
          <button onClick={() => set错误('')} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {提示 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
          {正在上传 && <Loader2 className="w-3 h-3 animate-spin" />}{提示}
        </div>
      )}

      {加载中 ? (
        <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-zinc-300" /></div>
      ) : 来源列表.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg">
          <Upload className="w-6 h-6 mx-auto mb-2 text-zinc-300" />
          <p className="text-sm text-zinc-400">上传简历、面试文档或添加网页链接</p>
          <p className="text-xs text-zinc-400 mt-1">支持 PDF、Word、Markdown、URL — 可同时选择多个文件</p>
        </div>
      ) : 需折叠 ? (
        /* 折叠态：单行摘要 */
        <button
          onClick={() => set列表已折叠(false)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors"
        >
          <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="flex-1 text-left text-zinc-600 dark:text-zinc-400 truncate">
            {来源列表.length} 个来源
            {统计文本 && <span className="text-zinc-400 ml-1">（{统计文本}）</span>}
          </span>
          {有异常 && (
            <>
              {来源列表.some(s => s.status === 'processing') && <Loader2 className="w-3 h-3 animate-spin text-amber-500 shrink-0" />}
              {来源列表.some(s => s.status === 'error') && <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />}
            </>
          )}
          <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
        </button>
      ) : (
        <div className="space-y-2">
          {/* 展开态：收起按钮 */}
          {来源列表.length >= 5 && (
            <button
              onClick={() => set列表已折叠(true)}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <ChevronUp className="w-3 h-3" />收起来源列表
            </button>
          )}
          {来源列表.map(s => (
            <div key={s.id}>
              <div className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
                {图标(s.type)}
                <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate flex-1">{s.title}</span>
                {状态(s.status)}
                {s.status === 'error' && s.error_message && (
                  <span className="text-[10px] text-red-500 truncate max-w-[100px]" title={s.error_message}>{s.error_message}</span>
                )}
                {s.status === 'ready' && (
                  <button onClick={() => 切换摘要(s)}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-primary-500 transition-all"
                    title="查看 AI 摘要">
                    {正在加载摘要[s.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : 展开摘要[s.id] !== undefined ? <ChevronUp className="w-3.5 h-3.5" />
                      : <Lightbulb className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button onClick={() => 删除来源(s.id)} title="删除来源" aria-label={`删除来源 ${s.title}`}
                  className="opacity-70 hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-all">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* AI 摘要展开区 */}
              {展开摘要[s.id] !== undefined && (
                <div className="ml-6 mt-1 p-3 rounded-lg border border-primary-100 dark:border-primary-900 bg-primary-50/50 dark:bg-primary-950/30 text-sm">
                  {展开摘要[s.id] ? (
                    <div className="space-y-2">
                      <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{展开摘要[s.id]!.summary}</p>
                      {(展开摘要[s.id]!.keyTopics?.length > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {展开摘要[s.id]!.keyTopics.map((t: string) => (
                            <span key={t} className="px-1.5 py-0.5 text-[10px] rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {(展开摘要[s.id]!.suggestedQuestions?.length > 0) && (
                        <div>
                          <p className="text-[11px] text-zinc-400 mb-1">建议问题：</p>
                          {展开摘要[s.id]!.suggestedQuestions.map((q: string) => (
                            <p key={q} className="text-[12px] text-primary-600 dark:text-primary-400 leading-relaxed pl-2 border-l-2 border-primary-200 dark:border-primary-800 mt-1">
                              {q}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-zinc-400">由 AI 自动生成，点灯泡图标切换显示</p>
                    </div>
                  ) : (
                    <p className="text-zinc-400 text-xs">AI 正在分析此来源，请稍后...</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
