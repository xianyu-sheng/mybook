import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ArrowUpRight, BookOpen, Check, Loader2, RotateCcw, X } from 'lucide-react'
import type { Notebook } from '@/types/db'

export const NOTEBOOKS_CHANGED = 'knowmind:notebooks-changed'
export const OPEN_ARCHIVE = 'knowmind:open-notebook-archive'
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')

export function ArchiveNotebookDialog({ notebook, onClose, onArchived }: { notebook: Notebook | null; onClose: () => void; onArchived: (notebook: Notebook) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    if (notebook && !dialog.current?.open) dialog.current?.showModal()
    else if (!notebook) dialog.current?.close()
  }, [notebook?.id])
  const archive = async () => {
    if (!notebook || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      await window.knowmind.notebooks.archive(notebook.id)
      window.dispatchEvent(new Event(NOTEBOOKS_CHANGED))
      onArchived(notebook)
      onClose()
    } catch (error) { setError(message(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="workspace-dialog max-w-md" aria-labelledby="archive-notebook-heading" onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="dialog-symbol"><Archive size={22} /></div>
    <h2 id="archive-notebook-heading" className="text-lg font-semibold mt-4">归档这本笔记本？</h2>
    <p className="mt-2 text-sm font-medium break-words">{notebook?.title}</p>
    <p className="workspace-muted text-sm leading-7 mt-3">归档后从当前列表移出，资料、卡片、模拟面试和练习记录都会保留，录音不受影响。你可以随时在“已归档笔记本”中恢复。</p>
    {error && <p role="alert" className="workspace-error mt-3">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 mt-6"><button autoFocus className="workspace-button" disabled={busy} onClick={onClose}>取消</button><button className="workspace-button is-primary" disabled={busy} onClick={() => void archive()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}确认归档</button></div>
  </dialog>
}

export function ArchivedNotebooksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const request = useRef(0)
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [restored, setRestored] = useState<Notebook | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    const version = ++request.current
    setLoading(true); setError('')
    try { const list = await window.knowmind.notebooks.listArchived(); if (version === request.current) setNotebooks(list) }
    catch (error) { if (version === request.current) setError(message(error)) }
    finally { if (version === request.current) setLoading(false) }
  }, [])
  useEffect(() => {
    if (open) { setRestored(null); if (!dialog.current?.open) dialog.current?.showModal(); void refresh() }
    else { request.current++; dialog.current?.close() }
    return () => { request.current++ }
  }, [open, refresh])
  const restore = async (notebook: Notebook) => {
    if (lock.current) return
    lock.current = true; setBusy(notebook.id); setError('')
    try {
      const result = await window.knowmind.notebooks.restore(notebook.id)
      setNotebooks(list => list.filter(item => item.id !== notebook.id))
      setRestored(result)
      window.dispatchEvent(new Event(NOTEBOOKS_CHANGED))
    } catch (error) { setError(message(error)) }
    finally { lock.current = false; setBusy(null) }
  }
  return <dialog ref={dialog} className="workspace-dialog max-w-xl" aria-labelledby="archived-notebooks-heading" onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="flex gap-3 items-start justify-between"><div><h2 id="archived-notebooks-heading" className="text-lg font-semibold">已归档笔记本</h2><p className="workspace-muted text-sm mt-2">暂时收起的准备资料，需要时可以继续。</p></div><button autoFocus className="shell-icon-button" aria-label="关闭归档列表" disabled={Boolean(busy)} onClick={onClose}><X size={18} /></button></div>
    {error && <p role="alert" className="workspace-error mt-4">{error}<button className="ml-2 underline" disabled={Boolean(busy)} onClick={() => void refresh()}>重新加载</button></p>}
    {restored && <div role="status" className="archive-restored mt-4"><Check size={16} className="shrink-0" /><span className="break-words min-w-0">已恢复“{restored.title}”</span><button className="inline-flex items-center gap-1 text-xs shrink-0 ml-auto" onClick={() => { onClose(); navigate(`/notebook/${restored.id}`) }}>打开<ArrowUpRight size={13} /></button></div>}
    <div className="mt-5 max-h-[55vh] overflow-y-auto">
      {loading ? <p role="status" className="workspace-muted text-sm py-10 flex items-center justify-center gap-2"><Loader2 size={17} className="animate-spin" />正在加载归档...</p> : !notebooks.length && !error ? <div className="py-10 text-center workspace-muted"><Archive size={28} className="mx-auto mb-3 opacity-50" /><p className="text-sm">还没有归档的笔记本</p><p className="text-xs mt-2">归档会保留内容，恢复后回到工作台。</p></div> : <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{notebooks.map(notebook => <div key={notebook.id} className="py-4 flex items-center gap-3"><BookOpen size={17} className="workspace-muted shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-medium break-words">{notebook.title}</p>{notebook.description && <p className="text-xs workspace-muted truncate mt-1">{notebook.description}</p>}</div><button className="workspace-button is-small" disabled={Boolean(busy)} onClick={() => void restore(notebook)}>{busy === notebook.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}恢复</button></div>)}</div>}
    </div>
  </dialog>
}
