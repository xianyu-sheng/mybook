import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mic, Monitor, Square, Plus, Upload, RefreshCw, Download, Trash2, FileText, Sparkles, Search, Play, Pencil, Save, X, Loader2, Check, ChevronLeft, ChevronRight, Headphones } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useRecordingState } from '@/hooks/useRecordingState'
import { useRecordingDraft, clearRecordingDraft, normalizeRecordingInput, RECORDING_SAVED_EVENT } from '@/hooks/useRecordingDraft'
import PracticeButton from '@/components/PracticeButton'
import TargetPicker from '@/components/TargetPicker'
import type { AudioDevice, Recording, RecordingInput } from '@/types/recording'
import type { Notebook } from '@/types/db'

const field = 'w-full min-w-0 border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900'
const command = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm disabled:opacity-40 whitespace-nowrap'
const primary = `${command} bg-blue-600 text-white hover:bg-blue-700`
const icon = 'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40'
const labels: Record<Recording['status'], string> = { importing: '导入中', recording: '录音中', recorded: '待转写', transcribing: '转写中', transcribed: '待复盘', analyzing: '分析中', ready: '已复盘', error: '待检查' }
const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`
const blank = (): RecordingInput => ({ title: `${new Date().toLocaleDateString('zh-CN')} 面试录音`, notebook_id: null, company: '', role: '', jd: '', tags: [] })

export default function RecordingsPage() {
  const state = useRecordingState()
  const [params, setParams] = useSearchParams()
  const [records, setRecords] = useState<Recording[]>([])
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [deviceError, setDeviceError] = useState('')
  const [microphone, setMicrophone] = useState('')
  const [system, setSystem] = useState('')
  const [form, setForm] = useState(blank)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [removing, setRemoving] = useState<Recording | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const selected = records.find(r => r.id === params.get('recording')) || records[0]

  const refresh = useCallback(async () => setRecords(await window.knowmind.recordings.list()), [])
  const loadDevices = async () => {
    const result = await window.knowmind.recordings.devices()
    setDevices(result.devices); setDeviceError(result.error || '')
    setMicrophone(old => result.devices.some(d => d.name === old) ? old : result.devices.find(d => !d.monitor && d.isDefault)?.name || result.devices.find(d => !d.monitor)?.name || '')
    setSystem(old => result.devices.some(d => d.name === old) ? old : result.devices.find(d => d.monitor && d.isDefault)?.name || result.devices.find(d => d.monitor)?.name || '')
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); window.knowmind.notebooks.list().then(setNotebooks).catch(console.error); loadDevices().catch(e => setDeviceError(e.message)) }, [refresh])
  useEffect(() => { refresh().catch(console.error) }, [state.active?.id, state.job?.id, refresh])
  useEffect(() => {
    const onSaved = (event: Event) => {
      const saved = (event as CustomEvent<Recording>).detail
      setRecords(current => current.map(record => record.id === saved.id ? saved : record))
    }
    window.addEventListener(RECORDING_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(RECORDING_SAVED_EVENT, onSaved)
  }, [])
  useEffect(() => { if (removing) dialog.current?.showModal(); else dialog.current?.close() }, [removing])

  const run = async (task: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await task() } catch (e: any) { setError((e.message || String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')) }
    finally { lock.current = false; setBusy(false); await refresh().catch(console.error) }
  }
  const create = (importFile: boolean) => run(async () => {
    const result = importFile ? await window.knowmind.recordings.importAudio(normalizeRecordingInput(form)) : await window.knowmind.recordings.start({ ...normalizeRecordingInput(form), microphone, system })
    if (result) { setParams({ recording: result.id }); setCreating(false); setForm(blank()) }
  })
  const filtered = records.filter(r => `${r.title} ${r.company} ${r.role} ${r.tags.join(' ')} ${r.segments.map(s => s.text).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const processing = Boolean(state.job || state.setup.running)

  return <div className="p-5 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-700">
      <div><h1 className="text-xl font-semibold flex items-center gap-2"><Headphones size={21} className="text-emerald-600" />面试录音</h1><p className="text-xs text-zinc-500 mt-1">全局文档 · {records.length} 场 · {records.filter(r => r.report).length} 场已复盘</p></div>
      <button className={primary} onClick={() => { setCreating(!creating); setError('') }} disabled={Boolean(state.active) || busy}><Plus size={16} />新建录音</button>
    </div>
    {error && <p role="alert" className="my-3 border-l-2 border-red-500 pl-3 text-sm text-red-600 break-words whitespace-pre-wrap">{error}</p>}
    {!state.setup.ready && <div className="flex flex-wrap items-center gap-3 py-3 border-b border-zinc-200 dark:border-zinc-700">
      <span className="text-sm text-zinc-500">{state.setup.message || '本地转写引擎未安装 · Whisper small'}</span>
      {state.setup.running ? <Loader2 size={16} className="animate-spin" /> : <button className={`${command} text-blue-600`} disabled={busy || processing} onClick={() => run(() => window.knowmind.recordings.setup())}><Download size={15} />安装转写引擎</button>}
    </div>}
    {(state.job || state.setup.running) && <div role="status" className="flex items-center gap-3 py-3 text-sm text-blue-600 border-b border-zinc-200 dark:border-zinc-700">
      <Loader2 size={16} className="animate-spin shrink-0" /><span className="flex-1 min-w-0 break-words">{state.job?.stage || state.setup.message}</span>
      {state.job && <progress aria-label="处理进度" max={100} value={state.job.percent} className="w-24 accent-blue-600" />}
      <button title="取消处理" aria-label="取消处理" className={icon} onClick={() => window.knowmind.recordings.cancel().catch(e => setError(e.message))}><X size={16} /></button>
    </div>}
    {state.active && <div className="flex items-center justify-between gap-3 py-3 text-red-600 border-b border-red-200"><span className="text-sm break-words">正在录音 · {state.active.title}</span><button className={`${command} bg-red-600 text-white`} disabled={state.active.stopping} onClick={() => run(() => window.knowmind.recordings.stop())}><Square size={14} />{state.active.stopping ? '保存中...' : '停止并保存'}</button></div>}
    {(creating || !records.length) && !state.active && <section aria-label="新建面试录音" className="py-5 border-b border-zinc-200 dark:border-zinc-700 space-y-4">
      <MetadataForm value={form} onChange={setForm} notebooks={notebooks} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <label className="text-sm space-y-1"><span className="flex items-center gap-1.5"><Mic size={14} />麦克风</span><select aria-label="麦克风" className={field} value={microphone} onChange={e => setMicrophone(e.target.value)}><option value="">不录制麦克风</option>{devices.filter(d => !d.monitor).map(d => <option key={d.name} value={d.name}>{d.label}{d.muted ? '（已静音）' : ''}</option>)}</select></label>
        <label className="text-sm space-y-1"><span className="flex items-center gap-1.5"><Monitor size={14} />系统声音 / 耳机输出</span><select aria-label="系统声音" className={field} value={system} onChange={e => setSystem(e.target.value)}><option value="">不录制系统声音</option>{devices.filter(d => d.monitor).map(d => <option key={d.name} value={d.name}>{d.label}{d.muted ? '（已静音）' : ''}</option>)}</select></label>
      </div>
      <p className="text-xs text-zinc-500">戴耳机时请选择对应耳机的系统输出，并同时选择你的麦克风。更换耳机后请刷新设备。转写按音轨标记本人/对方，可手动校对。</p>
      {deviceError && <p className="text-sm text-amber-700">{deviceError}</p>}
      <div className="flex flex-wrap gap-2 items-center">
        <button className={`${command} bg-red-600 text-white`} disabled={busy || !form.title.trim() || !microphone && !system} onClick={() => create(false)}><Mic size={16} />开始录音</button>
        <button className={`${command} border border-zinc-300 dark:border-zinc-700`} disabled={busy || processing || !form.title.trim()} onClick={() => create(true)}><Upload size={15} />导入音频</button>
        <button title="刷新录音设备" aria-label="刷新录音设备" className={icon} onClick={() => loadDevices().catch(e => setError(e.message))}><RefreshCw size={15} /></button>
        {records.length > 0 && <button className={command} onClick={() => setCreating(false)}>取消</button>}
      </div>
    </section>}
    {records.length > 0 && <div className="recording-layout pt-4">
      <aside className="min-w-0 recording-list">
        <label className="relative block mb-3"><Search size={15} className="absolute left-2.5 top-3 text-zinc-400" /><input aria-label="搜索录音" className={`${field} pl-8`} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索录音、标签或转写" /></label>
        <div className="space-y-1">{filtered.map(record => <button key={record.id} onClick={() => setParams({ recording: record.id })} className={`w-full p-3 rounded-md text-left border-l-2 ${record.id === selected?.id ? 'bg-blue-50 border-blue-600 dark:bg-zinc-800' : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><span className="block text-sm font-medium break-words">{record.title}</span><span className="block text-xs text-zinc-500 mt-1">{record.created_at.slice(0, 10)} · {time(record.duration)} · {labels[record.status]}</span>{record.tags.length > 0 && <span className="block text-xs text-emerald-700 dark:text-emerald-400 mt-1 break-words">{record.tags.join(' · ')}</span>}</button>)}</div>
        {!filtered.length && <p className="text-xs text-zinc-500 p-3">没有匹配的录音</p>}
      </aside>
      {selected && <RecordingDetail key={selected.id} record={selected} notebooks={notebooks} busy={busy || state.job?.id === selected.id || state.active?.id === selected.id} canProcess={!processing && !state.active && !busy} ready={state.setup.ready} run={run} remove={() => setRemoving(selected)} />}
    </div>}
    <dialog ref={dialog} onClose={() => setRemoving(null)} aria-label="删除面试录音" className="m-auto w-[calc(100%-40px)] max-w-sm rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-5 backdrop:bg-black/40">
      <h2 className="font-semibold">删除面试录音？</h2><p className="mt-3 text-sm text-zinc-500 break-words">{removing?.title} 的音频、转写与评分将一并删除。</p>
      <div className="flex justify-end gap-2 mt-5"><button autoFocus className={command} disabled={busy} onClick={() => dialog.current?.close()}>取消</button><button className={`${command} bg-red-600 text-white`} disabled={busy} onClick={() => run(async () => { await window.knowmind.recordings.delete(removing!.id); clearRecordingDraft(removing!.id); setRemoving(null) })}><Trash2 size={15} />确认删除</button></div>
    </dialog>
  </div>
}

function MetadataForm({ value, onChange, notebooks }: { value: RecordingInput; onChange: (value: RecordingInput) => void; notebooks: Notebook[] }) {
  return <>
    <TargetPicker value={{ company: value.company, role: value.role, jd: value.jd, department: '' }} onApply={target => onChange({ ...value, company: target.company, role: target.role, jd: target.jd })} />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <label className="text-sm space-y-1">录音名称<input aria-label="录音名称" maxLength={160} className={field} value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} /></label>
      <label className="text-sm space-y-1">关联项目笔记本<select className={field} value={value.notebook_id || ''} onChange={e => onChange({ ...value, notebook_id: e.target.value || null })}><option value="">仅使用全局知识</option>{notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.title}</option>)}</select></label>
      <label className="text-sm space-y-1">企业<input className={field} maxLength={120} value={value.company} onChange={e => onChange({ ...value, company: e.target.value })} /></label>
      <label className="text-sm space-y-1">岗位<input className={field} maxLength={200} value={value.role} onChange={e => onChange({ ...value, role: e.target.value })} /></label>
    </div>
    <label className="block text-sm space-y-1">岗位 JD<textarea aria-label="岗位 JD" className={`${field} resize-y`} rows={3} maxLength={18000} value={value.jd} onChange={e => onChange({ ...value, jd: e.target.value })} /></label>
    <label className="block text-sm space-y-1">标签<input className={field} placeholder="秋招，一面，后端" value={value.tags.join('，')} onChange={e => onChange({ ...value, tags: e.target.value.split(/[,，]/).slice(0, 12) })} /></label>
  </>
}

function RecordingDetail({ record, notebooks, busy, canProcess, ready, run, remove }: {
  record: Recording; notebooks: Notebook[]; busy: boolean; canProcess: boolean; ready: boolean; run: (fn: () => Promise<unknown>) => Promise<void>; remove: () => void
}) {
  const [tab, setTab] = useState('transcript')
  const draft = useRecordingDraft(record)
  const { metadata, setMetadata, setSegments } = draft
  const segments = draft.segments || []
  const editing = draft.segments !== null
  const [confirmTranscribe, setConfirmTranscribe] = useState(false)
  const transcribeDialog = useRef<HTMLDialogElement>(null)
  const [language, setLanguage] = useState('zh')
  const [page, setPage] = useState(0)
  const players = useRef<Record<string, HTMLAudioElement | null>>({})
  const pauseOtherTracks = (current: HTMLAudioElement) => {
    Object.values(players.current).forEach(player => { if (player && player !== current) player.pause() })
  }
  const playSegment = (track: string, start: number) => {
    const player = players.current[track]
    if (!player) return
    pauseOtherTracks(player)
    player.currentTime = start
    void player.play().catch(console.error)
  }
  const perPage = 30
  const rows = editing ? segments : record.segments
  useEffect(() => { setPage(p => Math.min(p, Math.max(0, Math.ceil(rows.length / perPage) - 1))) }, [rows.length])
  useEffect(() => { if (confirmTranscribe) transcribeDialog.current?.showModal(); else transcribeDialog.current?.close() }, [confirmTranscribe])
  return <section aria-label="录音详情" className="min-w-0">
    <div className="flex gap-2 items-start justify-between mb-2"><div className="min-w-0"><h2 className="text-lg font-semibold break-words">{record.title}</h2><p className="text-xs text-zinc-500 mt-1 break-words">{record.company || '未指定企业'} · {record.role || '未指定岗位'} · {time(record.duration)}</p></div><div className="flex gap-1 shrink-0">
      <button title="编辑录音信息" aria-label="编辑录音信息" className={icon} disabled={busy || Boolean(draft.draft)} onClick={() => setMetadata(record)}><Pencil size={15} /></button>
      <button title="导出 Markdown" aria-label="导出 Markdown" className={icon} disabled={busy} onClick={() => run(() => window.knowmind.recordings.export(record.id))}><Download size={15} /></button>
      <button title="删除录音" aria-label="删除录音" className={`${icon} hover:text-red-600`} disabled={busy} onClick={remove}><Trash2 size={15} /></button>
    </div></div>
    {(draft.draft || draft.warning) && <p role="status" className="text-xs text-blue-600 my-3">{draft.warning || '草稿已暂存，可切换录音或页面；保存后才会更新知识库。'}</p>}
    {draft.conflict && <p role="alert" className="text-sm text-amber-700 my-3">已保存的原文发生变化。草稿仍保留，请复制需要保留的修改，再放弃草稿重新校对。</p>}
    {metadata && <div className="space-y-3 py-4 border-y border-zinc-200 dark:border-zinc-700 my-3"><fieldset disabled={busy}><MetadataForm value={metadata} onChange={setMetadata} notebooks={notebooks} /></fieldset><div className="flex justify-end gap-2"><button className={command} disabled={busy} onClick={draft.clear}>放弃草稿</button><button className={primary} disabled={busy || draft.conflict} onClick={() => run(async () => { draft.saved(await window.knowmind.recordings.update(record.id, { ...normalizeRecordingInput(metadata), shared: record.shared })) })}><Save size={15} />保存</button></div></div>}
    <label className="inline-flex items-center gap-2 text-xs text-zinc-500 my-3"><input type="checkbox" checked={record.shared} disabled={busy || Boolean(metadata)} onChange={e => run(() => window.knowmind.recordings.update(record.id, { ...record, shared: e.target.checked }))} />参与所有笔记本的知识检索</label>
    {record.error && <p role="alert" className="text-sm text-amber-700 border-l-2 border-amber-500 pl-3 mb-3 break-words whitespace-pre-wrap">{record.error}</p>}
    {record.export_error && <p className="text-xs text-amber-700 mb-3">{record.export_error}</p>}
    {!['recording', 'importing'].includes(record.status) && record.duration > 0 && <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 mb-4">{record.tracks.map(track => <div key={track.kind} className="min-w-0"><p className="text-xs text-zinc-500 mb-1">{track.label}</p><audio aria-label={track.label} ref={element => { players.current[track.kind] = element }} onPlay={event => pauseOtherTracks(event.currentTarget)} controls preload="metadata" src={`mybook-audio://recording/${record.id}/${track.kind}?duration=${record.duration}`} className="w-full h-9" /></div>)}</div>}
    <div className="flex flex-wrap gap-2 items-center py-3 border-y border-zinc-200 dark:border-zinc-700">
      <select aria-label="转写语言" className="text-xs rounded-md border border-zinc-300 dark:border-zinc-700 p-2 bg-transparent" value={language} onChange={e => setLanguage(e.target.value)}><option value="zh">中文</option><option value="en">英语</option><option value="auto">自动识别</option></select>
      <button className={`${command} text-blue-600`} disabled={!canProcess || !ready || Boolean(draft.draft)} onClick={() => { if (record.segments.length || record.report) setConfirmTranscribe(true); else void run(() => window.knowmind.recordings.transcribe(record.id, language)) }}><FileText size={15} />{record.segments.length ? '重新转写' : '本地转写'}</button>
      <button className={primary} disabled={!canProcess || !record.segments.length || Boolean(draft.draft)} title="将转写文本和关联项目资料发送给已配置的 AI 模型" onClick={() => run(async () => { await window.knowmind.recordings.analyze(record.id); setTab('analysis') })}><Sparkles size={15} />{record.report ? '重新复盘' : 'AI 面试复盘'}</button>
    </div>
    <div role="tablist" aria-label="录音文档" className="flex gap-4 border-b border-zinc-200 dark:border-zinc-700 mb-4">{[{ id: 'transcript', label: `转写 ${record.segments.length}` }, { id: 'analysis', label: `答题复盘 ${record.report?.questions.length || 0}` }].map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`text-sm py-3 border-b-2 ${tab === item.id ? 'text-blue-600 border-blue-600' : 'text-zinc-500 border-transparent'}`}>{item.label}</button>)}</div>
    {tab === 'transcript' ? <>
      {record.segments.length > 0 && <div className="flex flex-wrap justify-between items-center gap-2 mb-3"><span className="text-xs text-zinc-500">{time(record.duration)} · {rows.length} 个片段</span><div className="flex gap-1">{editing ? <><button className={command} onClick={draft.clear} disabled={busy}>放弃草稿</button><button className={primary} disabled={busy || draft.conflict} onClick={() => run(async () => { draft.saved(await window.knowmind.recordings.saveTranscript(record.id, segments)) })}><Save size={14} />保存校对</button></> : <button className={`${command} text-blue-600`} disabled={busy || Boolean(metadata)} onClick={() => setSegments(record.segments.map(s => ({ ...s })))}><Pencil size={14} />校对文字 / 说话人</button>}</div></div>}
      {!rows.length && <p className="py-8 text-sm text-zinc-500 text-center">暂无转写文档</p>}
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">{rows.slice(page * perPage, (page + 1) * perPage).map(segment => <div key={segment.id} className="py-3 flex items-start gap-3">
        <button title="播放此片段" aria-label={`播放 ${time(segment.start)}`} className="text-xs text-blue-600 shrink-0 pt-1 w-14 inline-flex items-center gap-1" onClick={() => playSegment(segment.track, segment.start)}><Play size={12} />{time(segment.start)}</button>
        <div className="flex-1 min-w-0">{editing ? <><select disabled={busy} aria-label={`片段 ${segment.id} 说话人`} className="text-xs border border-zinc-300 dark:border-zinc-700 rounded bg-transparent p-1 mb-2" value={segment.speaker} onChange={e => setSegments(segments.map(s => s.id === segment.id ? { ...s, speaker: e.target.value } : s))}>{['本人', '对方', '未区分', ...(!['本人', '对方', '未区分'].includes(segment.speaker) ? [segment.speaker] : [])].map(s => <option key={s}>{s}</option>)}</select><textarea disabled={busy} aria-label={`片段 ${segment.id} 文字`} className={`${field} resize-y`} rows={2} value={segment.text} onChange={e => setSegments(segments.map(s => s.id === segment.id ? { ...s, text: e.target.value } : s))} /></> : <><p className={`text-xs mb-1 ${segment.speaker === '本人' ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500'}`}>{segment.speaker}</p><p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{segment.text}</p></>}</div>
      </div>)}</div>
      {rows.length > perPage && <div className="flex justify-center items-center gap-3 mt-4"><button className={icon} aria-label="上一页转写" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></button><span className="text-xs">{page + 1} / {Math.ceil(rows.length / perPage)}</span><button className={icon} aria-label="下一页转写" disabled={(page + 1) * perPage >= rows.length} onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></button></div>}
    </> : record.report ? <>
      <div className="flex items-center gap-3 mb-4"><span className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{record.report.score ?? '--'}<span className="text-xs text-zinc-500 font-normal"> / 100</span></span><span className="text-xs text-zinc-500">AI 参考评分 · {record.report.questions.length} 道问答</span></div>
      {record.report.summaries.map((summary, i) => <p key={i} className="text-sm leading-relaxed break-words mb-4">{summary}</p>)}
      <div className="space-y-3">{record.report.questions.map((question, i) => <details key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900" open={i === 0}>
        <summary className="p-3 cursor-pointer text-sm font-medium break-words">{i + 1}. {question.question}<span className="text-xs text-emerald-700 ml-2">{question.score} 分</span></summary>
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3 text-sm pt-3"><p className="text-xs text-zinc-500">我的回答</p><p className="break-words whitespace-pre-wrap">{question.answer}</p>
          <div className="flex flex-wrap gap-2">{question.evidence.map(id => { const s = record.segments.find(s => s.id === id); return s ? <button key={id} className="text-xs text-blue-600" onClick={() => { setTab('transcript'); setPage(Math.floor(record.segments.indexOf(s) / perPage)); playSegment(s.track, s.start) }}>录音 {time(s.start)}</button> : null })}</div>
          {question.strengths.map((s, n) => <p key={n} className="flex gap-2 text-emerald-700 dark:text-emerald-400"><Check size={14} className="shrink-0 mt-1" />{s}</p>)}
          <h3 className="text-xs text-amber-700 font-semibold">答题缺陷与改进</h3><ul className="list-disc pl-4 space-y-1">{question.gaps.map((gap, n) => <li key={n} className="break-words">{gap}</li>)}</ul>
          <h3 className="text-xs text-blue-600 font-semibold">标准要点与参考答案</h3><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{question.reference_answer}</ReactMarkdown></div>
          {Boolean(question.citations?.length) && <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3"><h3 className="text-xs text-zinc-500 mb-2">本题检索参考资料</h3><ul className="space-y-1 text-xs break-words">{question.citations!.map((source, n) => <li key={`${source.ref}-${n}`}><span className="text-zinc-500 mr-1">{source.ref}</span>{source.url && /^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">{source.title}</a> : <span>{source.title}</span>}</li>)}</ul></div>}
          <PracticeButton source="recording" id={record.id} index={i} />
          {question.followups.length > 0 && <><h3 className="text-xs text-zinc-500">继续练习</h3><ul className="list-disc pl-4">{question.followups.map((q, n) => <li key={n} className="break-words">{q}</li>)}</ul></>}
        </div>
      </details>)}</div>
    </> : <p className="py-8 text-center text-sm text-zinc-500">暂无面试复盘</p>}
    <dialog ref={transcribeDialog} onClose={() => setConfirmTranscribe(false)} aria-label="重新转写确认" className="m-auto w-[calc(100%-40px)] max-w-sm rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-5 backdrop:bg-black/40">
      <h2 className="font-semibold">重新转写这场录音？</h2><p className="mt-3 text-sm text-zinc-500">成功后将替换已校对的文字并清除当前复盘。失败或取消会保留原文。可先导出 Markdown 备份。</p>
      <div className="flex justify-end gap-2 mt-5"><button autoFocus className={command} onClick={() => setConfirmTranscribe(false)}>取消</button><button className={primary} disabled={!canProcess || Boolean(draft.draft)} onClick={() => { setConfirmTranscribe(false); void run(() => window.knowmind.recordings.transcribe(record.id, language)) }}>确认重新转写</button></div>
    </dialog>
  </section>
}
