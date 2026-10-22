import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, MessagesSquare, Loader2, Check, X } from 'lucide-react'
import ChatPanel from '@/components/chat/ChatPanel'
import type { QaSession } from '@/types/db'

const timeLabel = (value: string) => value?.slice(5, 16) || ''

export default function AskPage() {
  const [sessions, setSessions] = useState<QaSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const refresh = useCallback(async (preferredId?: string) => {
    try {
      const list = await window.knowmind.ai.listSessions()
      setSessions(list)
      setError('')
      setActiveId(current => {
        const wanted = preferredId || current
        if (wanted && list.some(session => session.id === wanted)) return wanted
        return list[0]?.id || null
      })
    } catch (err: any) {
      setError(`加载会话失败：${err.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const 新建会话 = async () => {
    if (creating) return
    setCreating(true)
    try {
      const session = await window.knowmind.ai.createSession()
      await refresh(session.id)
      setActiveId(session.id)
    } catch (err: any) {
      setError(`新建会话失败：${err.message || String(err)}`)
    } finally {
      setCreating(false)
    }
  }

  const 删除会话 = async (session: QaSession) => {
    if (!confirm(`删除会话「${session.title}」？其中的问答记录会一并删除。`)) return
    try {
      await window.knowmind.ai.deleteSession(session.id)
      await refresh(session.id === activeId ? undefined : activeId || undefined)
    } catch (err: any) {
      setError(`删除会话失败：${err.message || String(err)}`)
    }
  }

  const 开始重命名 = (session: QaSession) => {
    setEditingId(session.id)
    setDraftTitle(session.title)
  }

  const 保存重命名 = async (id: string) => {
    const title = draftTitle.trim()
    if (!title) return
    try {
      await window.knowmind.ai.renameSession(id, title)
      setEditingId(null)
      await refresh(id)
    } catch (err: any) {
      setError(`重命名失败：${err.message || String(err)}`)
    }
  }

  return (
    <div className="flex h-full min-h-0 bg-transparent">
      <aside className="w-72 shrink-0 border-r border-[color:var(--app-border)] bg-[color:var(--app-sidebar)] backdrop-blur-xl ask-surface flex flex-col min-h-0">
        <div className="px-4 pt-5 pb-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">知识问答</h1>
            <button onClick={() => void 新建会话()} disabled={creating}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}新对话
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            跨全部笔记本、全局知识库和共享面试录音检索答案。
          </p>
          {error && <p role="alert" className="text-xs text-amber-700 mt-2 break-words">{error}</p>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-1">
          {loading ? <p className="px-2 py-4 text-xs text-zinc-400">正在加载会话...</p>
            : !sessions.length ? <p className="px-2 py-4 text-xs text-zinc-400">还没有问答会话，点「新对话」开始。</p>
            : sessions.map(session => (
              <div key={session.id}
                className={`group rounded-lg px-2.5 py-2 cursor-pointer border ${
                  session.id === activeId
                    ? 'border-[color:var(--app-border)] bg-[color:var(--app-accent-soft)]'
                    : 'border-transparent hover:bg-[color:var(--app-hover)]'
                }`}
                onClick={() => setActiveId(session.id)}>
                <div className="flex items-start gap-1.5">
                  <MessagesSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    {editingId === session.id ? (
                      <div className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
                        <input autoFocus value={draftTitle} onChange={event => setDraftTitle(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') void 保存重命名(session.id)
                            if (event.key === 'Escape') setEditingId(null)
                          }}
                          className="w-full min-w-0 rounded border border-[color:var(--app-border)] bg-transparent px-1.5 py-0.5 text-xs outline-none" />
                        <button aria-label="保存名称" onClick={() => void 保存重命名(session.id)} className="p-0.5 text-emerald-600"><Check className="w-3.5 h-3.5" /></button>
                        <button aria-label="取消重命名" onClick={() => setEditingId(null)} className="p-0.5 text-zinc-400"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <p className="text-xs font-medium truncate" title={session.title}>{session.title}</p>
                    )}
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">{session.preview || '还没有提问'}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">{timeLabel(session.updated_at)} · {session.messages} 条消息</p>
                  </div>
                  <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={event => event.stopPropagation()}>
                    <button aria-label={`重命名 ${session.title}`} onClick={() => 开始重命名(session)} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700">
                      <Pencil className="w-3 h-3 text-zinc-500" />
                    </button>
                    <button aria-label={`删除 ${session.title}`} onClick={() => void 删除会话(session)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950">
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0 min-h-0">
        {activeId ? <ChatPanel sessionId={activeId} onChanged={() => void refresh(activeId)} />
          : <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <MessagesSquare className="w-8 h-8 text-zinc-300 mb-3" />
            <h2 className="text-base font-semibold mb-2">知识问答</h2>
            <p className="text-sm text-zinc-500 max-w-md mb-4">
              新建一个会话，问题会同时检索所有笔记本、全局知识库和共享面试录音。
            </p>
            <button onClick={() => void 新建会话()} disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
              <Plus className="w-4 h-4" />新对话
            </button>
          </div>}
      </div>
    </div>
  )
}
