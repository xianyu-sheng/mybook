import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Building2, Loader2, Trash2 } from 'lucide-react'
import type { TargetInput, TargetRole } from '@/types/target'

export default function TargetPicker({ value, onApply }: { value: TargetInput; onApply: (target: TargetInput) => void }) {
  const [targets, setTargets] = useState<TargetRole[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const lock = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { window.knowmind.targets.list().then(setTargets).catch(e => setError(e.message)) }, [])
  useEffect(() => { if (removing) dialog.current?.showModal(); else dialog.current?.close() }, [removing])
  const run = async (task: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await task(); setTargets(await window.knowmind.targets.list()) }
    catch (error: any) { setError(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="rounded-xl border border-primary-100 dark:border-primary-900 bg-primary-50/70 dark:bg-primary-950/30 p-3 mb-4">
    <div className="flex flex-wrap items-center gap-2">
      <Building2 size={15} className="text-primary-600" />
      <label className="flex-1 min-w-40"><span className="sr-only">复用目标岗位</span><select disabled={busy} className="w-full text-sm rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-2 py-2" value={selected} onChange={event => { const target = targets.find(t => t.id === event.target.value); setSelected(event.target.value); setMessage(''); if (target) onApply(target) }}>
        <option value="">复用已保存的企业 / 岗位</option>{targets.map(t => <option key={t.id} value={t.id}>{t.company} · {t.role}{t.department && ` · ${t.department}`}</option>)}
      </select></label>
      <button type="button" disabled={busy || !value.company.trim() || !value.role.trim()} className="inline-flex items-center gap-1.5 text-xs px-2 py-2 text-primary-700 dark:text-primary-300 disabled:opacity-40" onClick={() => run(async () => { const saved = await window.knowmind.targets.save(value); setSelected(saved.id); setMessage('目标已保存，可在模拟面试和录音中复用。') })}>{busy ? <Loader2 size={14} className="animate-spin" /> : <BookmarkPlus size={14} />}保存为目标</button>
      {selected && <button type="button" aria-label="删除已保存目标" disabled={busy} onClick={() => setRemoving(true)} className="p-2 text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>}
    </div>
    <p className="mt-2 text-xs text-zinc-500">选择后填入企业、岗位和 JD。每场面试会单独保留当时的信息。</p>
    {message && <p role="status" className="mt-2 text-xs text-emerald-600">{message}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600 break-words">{error}</p>}
    <dialog ref={dialog} onClose={() => setRemoving(false)} onCancel={e => { if (busy) e.preventDefault() }} aria-label="删除已保存目标确认" className="m-auto max-w-sm rounded-xl p-5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 backdrop:bg-black/40">
      <h3 className="font-semibold">删除这个目标？</h3><p className="text-sm text-zinc-500 mt-2">已有面试、录音和练习保留各自的岗位信息。</p>
      <div className="mt-4 flex justify-end gap-3"><button type="button" autoFocus disabled={busy} className="px-3 py-2 text-sm" onClick={() => setRemoving(false)}>取消</button><button type="button" disabled={busy} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm" onClick={() => run(async () => { await window.knowmind.targets.delete(selected); setSelected(''); setRemoving(false) })}>确认删除目标</button></div>
    </dialog>
  </div>
}
