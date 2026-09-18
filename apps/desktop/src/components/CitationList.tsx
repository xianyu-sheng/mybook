type Citation = { ref: string; title: string; url?: string; excerpt?: string; retrieved_at?: string }
export function parseCitations(value?: string): Citation[] {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((c): c is Citation => c && typeof c.ref === 'string' && typeof c.title === 'string') : [] }
  catch { return [] }
}

export default function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null
  return <details className="mt-3 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-xs">
    <summary className="cursor-pointer text-zinc-500">引用资料 · {citations.length} 个来源</summary>
    <ul className="mt-2 space-y-3">{citations.map((citation, index) => <li key={`${citation.ref}-${index}`} className="break-words">
      <span className="text-primary-600 dark:text-primary-400 mr-1">{citation.ref}</span>
      {citation.url && /^https?:\/\//i.test(citation.url) ? <a href={citation.url} target="_blank" rel="noreferrer" className="underline">{citation.title}</a> : <span className="font-medium">{citation.title}</span>}
      {citation.excerpt && <p className="mt-1.5 whitespace-pre-wrap text-zinc-500 leading-relaxed max-h-44 overflow-y-auto">{citation.excerpt}</p>}
      {citation.retrieved_at && <p className="mt-1 text-zinc-400">保存于 {new Date(citation.retrieved_at).toLocaleDateString('zh-CN')} · 保留当时引用片段</p>}
    </li>)}</ul>
  </details>
}
