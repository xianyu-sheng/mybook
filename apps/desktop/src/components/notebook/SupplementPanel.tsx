import { useState, useEffect, useCallback } from 'react'
import { FileText, Loader2, Trash2, ChevronDown, ChevronUp, Download, Filter } from 'lucide-react'
import CitationList, { parseCitations } from '@/components/CitationList'
import type { Supplement, SupplementSourceType } from '@/types/db'

const 类型标签: Record<SupplementSourceType, { label: string; color: string }> = {
  card_brief: { label: '卡片', color: 'text-blue-400' },
  card_detail: { label: '展开', color: 'text-purple-400' },
  qa: { label: '问答', color: 'text-green-400' },
  manual: { label: '手动', color: 'text-amber-400' },
}

interface Props {
  notebookId: string
}

export default function SupplementPanel({ notebookId }: Props) {
  const [补充列表, set补充列表] = useState<Supplement[]>([])
  const [筛选类型, set筛选类型] = useState<SupplementSourceType | 'all'>('all')
  const [展开文件, set展开文件] = useState<string | null>(null)
  const [文件内容, set文件内容] = useState<Record<string, string>>({})
  const [正在加载, set正在加载] = useState<Record<string, boolean>>({})
  const [加载中, set加载中] = useState(true)
  const [折叠面板, set折叠面板] = useState(true)

  const 加载补充 = useCallback(async () => {
    try {
      const list = await window.knowmind.supplement.list(notebookId)
      set补充列表(list)
    } catch (err) {
      console.error('加载补充文件失败:', err)
    } finally {
      set加载中(false)
    }
  }, [notebookId])

  useEffect(() => {
    加载补充()
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === notebookId) 加载补充() }
    window.addEventListener('knowmind:knowledge-changed', refresh)
    return () => window.removeEventListener('knowmind:knowledge-changed', refresh)
  }, [加载补充, notebookId])

  const 切换展开 = async (sup: Supplement) => {
    if (展开文件 === sup.id) {
      set展开文件(null)
      return
    }
    set展开文件(sup.id)

    if (!文件内容[sup.id]) {
      set正在加载(prev => ({ ...prev, [sup.id]: true }))
      try {
        const content = await window.knowmind.supplement.getContent(sup.id)
        set文件内容(prev => ({ ...prev, [sup.id]: content }))
      } catch { /* ignore */ }
      finally {
        set正在加载(prev => { const next = { ...prev }; delete next[sup.id]; return next })
      }
    }
  }

  const 删除文件 = async (id: string) => {
    try {
      await window.knowmind.supplement.delete(id)
      set补充列表(prev => prev.filter(s => s.id !== id))
      set文件内容(prev => { const next = { ...prev }; delete next[id]; return next })
    } catch (err: any) {
      alert('删除失败: ' + (err.message || String(err)))
    }
  }

  const 导出全部 = async () => {
    try {
      const md = await window.knowmind.supplement.export(notebookId)
      // 触发下载
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `补充文件_${new Date().toISOString().split('T')[0]}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert('导出失败: ' + (err.message || String(err)))
    }
  }

  const 过滤列表 = 筛选类型 === 'all' ? 补充列表 : 补充列表.filter(s => s.source_type === 筛选类型)

  return (
    <section>
      {/* 折叠标题栏 */}
      <div
        className="w-full flex items-center justify-between text-sm"
      >
        <button onClick={() => set折叠面板(!折叠面板)} aria-expanded={!折叠面板} className="flex flex-1 items-center gap-2 text-left font-semibold text-zinc-500 dark:text-zinc-400">
          补充文件
          {补充列表.length > 0 && (
            <span className="ml-2 font-normal text-zinc-400">({补充列表.length})</span>
          )}
          {折叠面板 ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-2">
          {!折叠面板 && 补充列表.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); 导出全部() }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
            >
              <Download className="w-3 h-3" />导出全部
            </button>
          )}
        </div>
      </div>

      {!折叠面板 && (
        <div className="mt-3">
          {/* 类型筛选 */}
          <div className="flex items-center gap-1.5 mb-3">
            <Filter className="w-3 h-3 text-zinc-400" />
            {(['all', 'card_brief', 'card_detail', 'qa'] as const).map(t => (
              <button
                key={t}
                onClick={() => set筛选类型(t)}
                className={`px-2 py-0.5 text-[11px] rounded-full transition-colors ${筛选类型 === t ? 'bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200'}`}
              >
                {t === 'all' ? '全部' : 类型标签[t].label}
              </button>
            ))}
          </div>

          {加载中 ? (
            <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-zinc-300" /></div>
          ) : 过滤列表.length === 0 ? (
            <p className="text-xs text-zinc-400 py-2">还没有补充文件。生成卡片或提问后会自动生成。</p>
          ) : (
            <div className="space-y-1.5">
              {过滤列表.map(sup => (
                <div key={sup.id}>
                  <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm">
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${(类型标签[sup.source_type] || 类型标签.qa).color}`} />
                    <button
                      onClick={() => 切换展开(sup)}
                      className="flex-1 text-left text-zinc-600 dark:text-zinc-400 truncate hover:text-zinc-900 dark:hover:text-zinc-200"
                    >
                      {sup.title}
                    </button>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {sup.created_at?.split('T')[0]}
                    </span>
                    {正在加载[sup.id] && <Loader2 className="w-3 h-3 animate-spin text-zinc-300 shrink-0" />}
                    <button
                      onClick={() => 删除文件(sup.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-all shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {展开文件 === sup.id && 文件内容[sup.id] && (
                    <div className="ml-5 mt-1 mb-2 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 max-h-48 overflow-y-auto">
                      <div className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                        {文件内容[sup.id]}
                      </div>
                      <CitationList citations={parseCitations(sup.citations_json)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
