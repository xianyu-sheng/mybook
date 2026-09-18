import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, ExternalLink, FileText, LibraryBig, Loader2, Pencil, Plus, RefreshCw, Search, Square, Trash2, Upload, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GlobalRepository, RepositoryDocument, RepositoryInput } from '@/types/repository'

const field = 'w-full min-w-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm'
const command = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md disabled:opacity-40'
const icon = 'inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 shrink-0'
const initial: RepositoryInput = { name: '', base_url: '', homepage: '', description: '', enabled: true }
const statuses = { not_synced: '未同步', syncing: '同步中', ready: '已就绪', error: '同步未完成' }

export default function RepositoriesPage() {
  const [repos, setRepos] = useState<GlobalRepository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<RepositoryInput>(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<GlobalRepository | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [results, setResults] = useState<{ items: RepositoryDocument[]; total: number }>({ items: [], total: 0 })
  const [searching, setSearching] = useState(false)
  const [document, setDocument] = useState<(RepositoryDocument & { content_text: string }) | null>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  const docRequest = useRef(0)
  const refresh = async () => {
    const list = await window.knowmind.repositories.list()
    if (alive.current) { setRepos(list); setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    refresh().catch(err => { setError(err.message); setLoading(false) })
    const timer = setInterval(() => { refresh().catch(() => {}) }, 1500)
    return () => { alive.current = false; clearInterval(timer) }
  }, [])
  const revision = repos.map(repo => `${repo.id}:${repo.revision}`).join(',')
  useEffect(() => {
    let stale = false
    setSearching(true)
    const timer = setTimeout(() => {
      window.knowmind.repositories.documents(query, filter || undefined, page).then(value => {
        if (!stale) setResults(value)
      }).catch(err => { if (!stale) setError(err.message) }).finally(() => { if (!stale) setSearching(false) })
    }, 250)
    return () => { stale = true; clearTimeout(timer) }
  }, [query, filter, page, revision])
  const run = async (task: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await task(); await refresh() }
    catch (err: any) { if (alive.current) setError(err.message || String(err)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    run(async () => {
      if (editing === 'new') await window.knowmind.repositories.create(form)
      else if (editing) { const { base_url, ...patch } = form; await window.knowmind.repositories.update(editing, patch) }
      if (alive.current) setEditing(null)
    })
  }
  const openDoc = async (id: string) => {
    const request = ++docRequest.current
    try { const doc = await window.knowmind.repositories.document(id); if (alive.current && request === docRequest.current) setDocument(doc) }
    catch (err: any) { if (alive.current) setError(err.message) }
  }
  const syncing = repos.some(r => r.status === 'syncing')
  return <div className="max-w-6xl mx-auto p-6 min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div><h1 className="text-xl font-semibold flex items-center gap-2"><LibraryBig size={21} />全局知识仓库</h1><p className="text-xs text-zinc-500 mt-2">全部笔记本共享 · {repos.filter(r => r.enabled).length} 个已启用 · {repos.reduce((n, r) => n + r.document_count, 0)} 篇本地文档</p></div>
      <div className="flex flex-wrap gap-1">
        <button disabled={busy} className={`${command} text-zinc-600 dark:text-zinc-400`} onClick={() => run(() => window.knowmind.repositories.importPack())}><Upload size={15} />导入配置</button>
        <button disabled={busy || !repos.length} className={icon} title="导出仓库配置" aria-label="导出仓库配置" onClick={() => run(async () => { const file = await window.knowmind.repositories.exportPack(); if (file && alive.current) setNotice(`已导出：${file}`) })}><Download size={16} /></button>
        <button disabled={busy} className={`${command} bg-blue-600 text-white`} onClick={() => { setForm(initial); setEditing('new') }}><Plus size={15} />添加仓库</button>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-red-600 border-l-2 border-red-500 pl-3 mb-4 whitespace-pre-wrap break-words">{error}</p>}
    {notice && <p role="status" className="text-xs text-emerald-600 mb-3 break-words">{notice}</p>}
    {editing && <form onSubmit={save} className="border-y border-zinc-200 dark:border-zinc-700 py-4 mb-4 space-y-3">
      <div className="grid md:grid-cols-2 gap-3"><label className="text-sm space-y-1">仓库名称<input className={field} required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label className="text-sm space-y-1">GitHub 仓库地址<input className={field} required type="url" disabled={editing !== 'new'} placeholder="https://github.com/作者/仓库" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} /></label></div>
      <label className="text-sm block space-y-1">网站首页<input className={field} type="url" value={form.homepage} onChange={e => setForm({ ...form, homepage: e.target.value })} /></label>
      <label className="text-sm block space-y-1">说明<input className={field} maxLength={500} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <div className="flex justify-end gap-2"><button type="button" className={command} onClick={() => setEditing(null)}>取消</button><button disabled={busy} className={`${command} bg-blue-600 text-white`}>保存仓库</button></div>
    </form>}
    {loading ? <Loader2 className="animate-spin text-zinc-400 my-6" /> : !repos.length ? <p className="py-8 text-center text-sm text-zinc-500">暂无全局仓库</p> : <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200 dark:border-zinc-800">{repos.map(repo => <div key={repo.id} className="py-4 flex flex-wrap items-start gap-3">
      <div className="flex-1 min-w-48"><h2 className="text-sm font-semibold break-words">{repo.name}</h2><p className="text-xs text-zinc-500 mt-1 break-words">{repo.description}</p><p className="text-[11px] text-zinc-400 mt-1 break-all">{repo.base_url}</p><p className="text-xs text-zinc-500 mt-2">{repo.progress || statuses[repo.status]} · {repo.document_count} 篇{repo.last_synced_at && ` · ${new Date(repo.last_synced_at.replace(' ', 'T') + 'Z').toLocaleString('zh-CN')}`}{repo.revision && ` · ${repo.revision.slice(0, 8)}`}</p>{(repo.last_error || repo.warning) && <p role="alert" className="text-xs text-amber-700 mt-2 whitespace-pre-wrap break-words">{repo.last_error || repo.warning}</p>}</div>
      <div className="flex items-center gap-1"><label className="inline-flex items-center gap-1.5 text-xs mr-2"><input aria-label={`启用 ${repo.name}`} type="checkbox" checked={repo.enabled} disabled={busy} onChange={() => run(() => window.knowmind.repositories.update(repo.id, { enabled: !repo.enabled }))} />启用</label>
        {repo.status === 'syncing' ? <button title={`取消同步 ${repo.name}`} aria-label={`取消同步 ${repo.name}`} className={icon} onClick={() => run(() => window.knowmind.repositories.cancel(repo.id))}><Square size={14} /></button> : <button title={`同步 ${repo.name}`} aria-label={`同步 ${repo.name}`} disabled={busy || syncing} className={icon} onClick={() => run(() => window.knowmind.repositories.sync(repo.id))}><RefreshCw size={15} /></button>}
        <button title={`编辑 ${repo.name}`} aria-label={`编辑 ${repo.name}`} className={icon} onClick={() => { setEditing(repo.id); setForm(repo) }}><Pencil size={15} /></button>
        <button title={`移除 ${repo.name}`} aria-label={`移除 ${repo.name}`} disabled={busy || repo.status === 'syncing'} className={`${icon} text-zinc-400 hover:text-red-500`} onClick={() => setRemoving(repo)}><Trash2 size={15} /></button>
      </div>
    </div>)}</div>}
    <div className="mt-7">
      <div className="flex flex-wrap gap-2 items-center mb-3"><h2 className="text-sm font-semibold mr-auto">文档 · {results.total}</h2><label className="relative flex-1 min-w-40 max-w-sm"><Search size={14} className="absolute left-3 top-3 text-zinc-400" /><input className={`${field} pl-9`} aria-label="搜索全局文档" placeholder="TCP、JVM、Redis、Agent..." value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} /></label><select aria-label="筛选仓库" className={`${field} max-w-44`} value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }}><option value="">全部仓库</option>{repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></div>
      {searching && <p className="text-xs text-zinc-400 py-2">正在检索...</p>}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{results.items.map(doc => <button key={doc.id} onClick={() => openDoc(doc.id)} className="flex w-full text-left gap-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 min-w-0"><FileText size={16} className="shrink-0 text-emerald-600 mt-1" /><div className="min-w-0"><h3 className="text-sm break-words">{doc.title}</h3><p className="text-xs text-zinc-400 mt-1 break-all">{doc.repository_name} · {doc.path}</p></div></button>)}</div>
      {!searching && !results.total && <p className="text-center text-sm text-zinc-400 py-8">没有匹配的本地文档</p>}
      <div className="flex justify-end items-center gap-3 mt-3"><span className="text-xs text-zinc-500">{page + 1} / {Math.max(1, Math.ceil(results.total / 30))}</span><button title="上一页" aria-label="上一页" className={icon} disabled={!page} onClick={() => setPage(p => p - 1)}><ArrowLeft size={16} /></button><button title="下一页" aria-label="下一页" className={icon} disabled={(page + 1) * 30 >= results.total} onClick={() => setPage(p => p + 1)}><ArrowRight size={16} /></button></div>
    </div>
    {document && <div role="dialog" aria-modal="true" aria-label="本地文档" className="fixed inset-0 z-40 bg-black/40 flex justify-center items-center p-5" onClick={() => { docRequest.current++; setDocument(null) }}><div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg bg-white dark:bg-zinc-950 shadow-xl" onClick={e => e.stopPropagation()}><div className="flex gap-2 items-start p-4 border-b border-zinc-200 dark:border-zinc-800"><div className="flex-1 min-w-0"><h2 className="text-base font-semibold break-words">{document.title}</h2><p className="text-xs text-zinc-500 break-all mt-1">{document.repository_name} · {document.path}</p></div><button title="打开原文" aria-label="打开原文" className={icon} onClick={() => run(() => window.knowmind.repositories.openDocument(document.id))}><ExternalLink size={16} /></button><button autoFocus title="关闭文档" aria-label="关闭文档" className={icon} onClick={() => setDocument(null)}><X size={17} /></button></div><div className="overflow-y-auto p-5 markdown-body text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span className="text-zinc-500">[图片：{alt || '原文图片'}]</span> }}>{document.content_text}</ReactMarkdown></div></div></div>}
    {removing && <div role="dialog" aria-modal="true" aria-label="移除仓库" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-5"><div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-lg p-5"><h2 className="font-semibold text-base">移除 {removing.name}</h2><p className="text-sm text-zinc-500 mt-3">将删除此仓库的本地文档。已有笔记本和问答记录会保留。</p><div className="flex justify-end gap-2 mt-5"><button autoFocus className={command} onClick={() => setRemoving(null)}>取消</button><button disabled={busy} className={`${command} bg-red-600 text-white`} onClick={() => run(async () => { await window.knowmind.repositories.delete(removing.id); setRemoving(null); setFilter(''); setPage(0) })}><Trash2 size={14} />移除</button></div></div></div>}
  </div>
}
