import { useEffect, useState } from 'react'
import { BookOpen, MessageCircle, Mic, Settings as SettingsIcon } from 'lucide-react'
import type { Provider, Tab } from './types'
import { getProviders, getSetting, initDb, setSetting } from './db'
import CardsPage from './pages/CardsPage'
import QaPage from './pages/QaPage'
import InterviewPage from './pages/InterviewPage'
import SettingsPage from './pages/SettingsPage'

export interface AiConfig {
  provider: Provider | null
  model: string
}

const tabs: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'cards', label: '卡片', icon: BookOpen },
  { id: 'qa', label: '问答', icon: MessageCircle },
  { id: 'interview', label: '模拟面试', icon: Mic },
  { id: 'settings', label: '设置', icon: SettingsIcon },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('cards')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [providers, setProviders] = useState<Provider[]>([])
  const [model, setModel] = useState('')

  const refreshConfig = () => {
    const next = getProviders()
    const saved = getSetting<string>('activeModel', '')
    setProviders(next)
    setModel(saved && next[0]?.models.includes(saved) ? saved : next[0]?.models[0] || '')
  }

  useEffect(() => {
    initDb()
      .then(() => { refreshConfig(); setReady(true) })
      .catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setReady(true) })
  }, [])

  const config: AiConfig = { provider: providers[0] || null, model }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Mybook <span>手机版</span></h1>
          <p>{config.provider ? `${config.provider.name} · ${model || '未选择模型'}` : '尚未同步 AI 配置'}</p>
        </div>
        <span className={`status-dot ${config.provider ? 'online' : ''}`} />
      </header>

      <main className="app-main">
        {!ready ? <div className="empty">正在打开本地知识库…</div> : error ? <div className="alert error">{error}</div> : <>
          {tab === 'cards' && <CardsPage config={config} />}
          {tab === 'qa' && <QaPage config={config} />}
          {tab === 'interview' && <InterviewPage config={config} />}
          {tab === 'settings' && <SettingsPage config={config} onConfigChanged={refreshConfig} onModelChanged={value => { setModel(value); setSetting('activeModel', value) }} />}
        </>}
      </main>

      <nav className="tab-bar" aria-label="主导航">
        {tabs.map(item => {
          const Icon = item.icon
          return <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        })}
      </nav>
    </div>
  )
}
