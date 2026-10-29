import { useEffect, useState } from 'react'
import { Check, CloudDownload, Loader2, RefreshCw, Wifi } from 'lucide-react'
import type { AiConfig } from '../App'
import type { Provider, SyncSettings } from '../types'
import { deviceId, getProviders, getSetting, listCards, listInterviewSessions, listQaSessions, setProviders, setSetting } from '../db'
import { ping, syncNow } from '../sync'

export default function SettingsPage({ config, onConfigChanged, onModelChanged }: {
  config: AiConfig
  onConfigChanged: () => void
  onModelChanged: (model: string) => void
}) {
  const [name, setName] = useState(config.provider?.name || 'DeepSeek')
  const [baseURL, setBaseURL] = useState(config.provider?.baseURL || 'https://api.deepseek.com')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState(config.provider?.models.join(', ') || 'deepseek-flash, deepseek-v4-pro')
  const [reason, setReason] = useState('')
  const [sync, setSync] = useState<SyncSettings>({ endpoint: '', code: '', deviceId: deviceId() })
  const [syncBusy, setSyncBusy] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [counts, setCounts] = useState({ cards: 0, qa: 0, interviews: 0 })

  const refreshCounts = () => setCounts({
    cards: listCards().length, qa: listQaSessions().length, interviews: listInterviewSessions().length,
  })

  useEffect(() => {
    const saved = getSetting<SyncSettings>('sync', { endpoint: '', code: '', deviceId: deviceId() })
    setSync({ ...saved, deviceId: saved.deviceId || deviceId() })
    refreshCounts()
  }, [])

  useEffect(() => {
    if (!config.provider) return
    setName(config.provider.name)
    setBaseURL(config.provider.baseURL)
    setModels(config.provider.models.join(', '))
  }, [config.provider])

  const saveProvider = () => {
    const modelList = [...new Set(models.split(/[\n,，;；]/).map(item => item.trim()).filter(Boolean))]
    if (!baseURL.trim() || !modelList.length) { setReason('Base URL 和模型名不能为空'); return }
    const previous = config.provider
    const key = apiKey.trim() || previous?.apiKey || ''
    if (!key) { setReason('请填写 API Key（或先同步电脑端配置）'); return }
    const provider: Provider = {
      id: previous?.id || `mobile-${crypto.randomUUID()}`,
      name: name.trim() || '自定义供应商',
      provider: previous?.provider || 'openai',
      baseURL: baseURL.trim(),
      apiKey: key,
      models: modelList,
      wireApi: 'chat',
    }
    setProviders([provider])
    setSetting('activeModel', modelList[0])
    setApiKey('')
    setReason('已保存到手机本地')
    onConfigChanged()
    onModelChanged(modelList[0])
  }

  const saveSync = (next: SyncSettings) => { setSync(next); setSetting('sync', next) }

  const test = async () => {
    setSyncBusy('test'); setSyncMessage('')
    try { saveSync(sync); const ok = await ping(sync); setSyncMessage(ok ? '电脑端可达，可以同步' : '电脑端没有响应') }
    catch (error) { setSyncMessage(error instanceof Error ? error.message : String(error)) }
    finally { setSyncBusy('') }
  }

  const runSync = async () => {
    setSyncBusy('sync'); setSyncMessage('')
    try {
      saveSync(sync)
      const result = await syncNow(sync)
      setSyncMessage(result.message)
      refreshCounts()
      onConfigChanged()
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : String(error))
    } finally { setSyncBusy('') }
  }

  return <div className="page">
    <section className="hero">
      <div><span className="eyebrow">本机配置</span><h2>设置与同步</h2><p>手机不经过云端中转；AI 请求由手机直连供应商。</p></div>
    </section>

    <section className="panel compose">
      <h3><CloudDownload size={17} /> 与电脑同步</h3>
      <p className="muted small">电脑端 Mybook → 设置 → 手机同步，开启后显示地址和配对码。数据通过 USB 网络共享直连电脑，不经过第三方服务器。</p>
      <label>电脑端地址</label>
      <input value={sync.endpoint} onChange={event => setSync({ ...sync, endpoint: event.target.value })} placeholder="http://192.168.42.1:47821" autoCapitalize="none" />
      <label>配对码</label>
      <input value={sync.code} onChange={event => setSync({ ...sync, code: event.target.value })} placeholder="电脑端显示的配对码" autoCapitalize="none" />
      <div className="row">
        <button className="secondary" disabled={Boolean(syncBusy)} onClick={() => void test()}>{syncBusy === 'test' ? <Loader2 className="spin" size={15} /> : <Wifi size={15} />} 测试连接</button>
        <button className="primary" disabled={Boolean(syncBusy)} onClick={() => void runSync()}>{syncBusy === 'sync' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} 立即同步</button>
      </div>
      {syncMessage && <p className={syncMessage.includes('失败') || syncMessage.includes('错误') || syncMessage.includes('没有响应') ? 'alert error' : 'alert ok'}>{syncMessage}</p>}
      <div className="stats"><span>卡片 {counts.cards}</span><span>问答 {counts.qa}</span><span>面试 {counts.interviews}</span></div>
    </section>

    <section className="panel compose">
      <h3><Check size={17} /> AI 供应商</h3>
      <p className="muted small">同步电脑端配置后会自动覆盖这里；也可以手动填写。Key 只保存在手机本地。</p>
      <label>名称</label>
      <input value={name} onChange={event => setName(event.target.value)} />
      <label>Base URL</label>
      <input value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://api.deepseek.com" autoCapitalize="none" />
      <label>API Key {config.provider ? '（留空表示沿用已保存的 Key）' : ''}</label>
      <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={config.provider ? '已保存，留空不修改' : 'sk-...'} autoCapitalize="none" />
      <label>模型（逗号分隔，第一个为默认）</label>
      <input value={models} onChange={event => setModels(event.target.value)} placeholder="deepseek-flash, deepseek-v4-pro" autoCapitalize="none" />
      {config.provider && <div className="model-picker">
        <span>当前模型</span>
        <select value={config.model} onChange={event => onModelChanged(event.target.value)}>
          {config.provider.models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>
      </div>}
      <button className="primary" onClick={saveProvider}>{config.provider ? '保存修改' : '保存供应商'}</button>
      {reason && <p className={reason.includes('不能') || reason.includes('请填写') ? 'alert error' : 'alert ok'}>{reason}</p>}
    </section>

    <section className="panel notice">
      <h3>阶段说明</h3>
      <p>当前版本优先卡片、问答、文字模拟面试。面试录音、代码执行和本地 Whisper 不在手机端，后续再补。</p>
    </section>
  </div>
}
