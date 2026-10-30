import { useEffect, useState } from 'react'
import { BookOpen, ChevronLeft, Database, FileText, Search } from 'lucide-react'
import type { KnowledgeDocument, Notebook, Repository, ResourceSource } from '../types'
import { countResources, listDocuments, listNotebooks, listRepositories, listSources } from '../db'
import Markdown from '../components/Markdown'

interface SelectedResource {
  title: string
  subtitle: string
  content: string
}

export default function ResourcesPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [sources, setSources] = useState<ResourceSource[]>([])
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SelectedResource | null>(null)
  const [counts, setCounts] = useState({ sources: 0, documents: 0 })

  const refresh = () => {
    setNotebooks(listNotebooks())
    setSources(listSources())
    setRepositories(listRepositories())
    setDocuments(listDocuments())
    setCounts(countResources())
  }

  useEffect(refresh, [])

  const needle = query.trim().toLowerCase()
  const match = (title: string, content = '') => !needle || title.toLowerCase().includes(needle) || content.toLowerCase().includes(needle)
  const visibleSources = sources.filter(source => match(source.title, source.content_text))
  const visibleDocuments = documents.filter(document => match(document.title, document.content_text))

  if (selected) {
    return <div className="page">
      <button className="resource-back" onClick={() => setSelected(null)}><ChevronLeft size={16} /> 返回资料</button>
      <section className="hero">
        <div><span className="eyebrow">{selected.subtitle}</span><h2>{selected.title}</h2></div>
      </section>
      <article className="panel resource-content">
        {selected.content.trim() ? <Markdown>{selected.content}</Markdown> : <div className="empty">这份资料没有可显示的正文。</div>}
      </article>
    </div>
  }

  return <div className="page">
    <section className="hero">
      <div><span className="eyebrow">电脑同步</span><h2>资料</h2><p>笔记本资料和全局知识库会随同步一起到手机，只读查看，不需要重新下载。</p></div>
      <span className="count-pill">{counts.sources + counts.documents} 份</span>
    </section>

    <section className="panel compose">
      <label className="resource-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索资料标题或正文…" /></label>
      {needle && <p className="muted small">找到 {visibleSources.length + visibleDocuments.length} 份资料</p>}
    </section>

    <section className="panel">
      <h3><BookOpen size={17} /> 笔记本资料</h3>
      {notebooks.map((notebook, index) => {
        const list = visibleSources.filter(source => source.notebook_id === notebook.id)
        if (needle && !list.length) return null
        return <details className="resource-group" key={notebook.id} open={index === 0 && !needle}>
          <summary><span>{notebook.title}</span><small>{list.length} 份</small></summary>
          {list.map(source => <button className="resource-item" key={source.id} onClick={() => setSelected({
            title: source.title,
            subtitle: `笔记本 · ${notebook.title} · ${source.type}`,
            content: source.content_text,
          })}>
            <FileText size={14} />
            <span><strong>{source.title}</strong><small>{source.type} · {source.status === 'ready' ? '已解析' : source.status}</small></span>
          </button>)}
          {!list.length && <p className="muted small resource-empty">这个笔记本还没有资料。</p>}
        </details>
      })}
      {!notebooks.length && <div className="empty">还没有同步到笔记本资料。先在电脑端同步一次。</div>}
    </section>

    <section className="panel">
      <h3><Database size={17} /> 全局知识库</h3>
      {repositories.map((repository, index) => {
        const list = visibleDocuments.filter(document => document.repository_id === repository.id)
        if (needle && !list.length) return null
        return <details className="resource-group" key={repository.id} open={index === 0 && !needle}>
          <summary><span>{repository.name}</span><small>{list.length} 篇</small></summary>
          {list.map(document => <button className="resource-item" key={document.id} onClick={() => setSelected({
            title: document.title,
            subtitle: `全局知识库 · ${repository.name}`,
            content: document.content_text,
          })}>
            <FileText size={14} />
            <span><strong>{document.title}</strong><small>{document.path}</small></span>
          </button>)}
          {!list.length && <p className="muted small resource-empty">这个仓库还没有可显示的文章。</p>}
        </details>
      })}
      {!repositories.length && <div className="empty">还没有同步到全局知识库。电脑端同步仓库后再点一次手机同步。</div>}
    </section>
  </div>
}
