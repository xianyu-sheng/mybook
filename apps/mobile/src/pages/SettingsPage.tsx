import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Check, ChevronRight, CloudDownload, Loader2, RefreshCw, Wifi } from 'lucide-react'
import type { AiConfig } from '../App'
import type { DiscoveredDevice, Provider, SyncSettings } from '../types'
import { countResources, deviceId, getProviders, getSetting, listCards, listInterviewSessions, listQaSessions, setProviders, setSetting } from '../db'
import { discoverComputers } from '../discovery'
import { ping, probeEndpoint, syncNow } from '../sync'

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
  const [syncLoaded, setSyncLoaded] = useState(false)
  const [syncBusy, setSyncBusy] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [devices, setDevices] = useState<DiscoveredDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [counts, setCounts] = useState({ cards: 0, qa: 0, interviews: 0, resources: 0 })

  const refreshCounts = () => {
    const resources = countResources()
    setCounts({
      cards: listCards().length, qa: listQaSessions().length, interviews: listInterviewSessions().length,
      resources: resources.sources + resources.documents,
    })
  }

  useEffect(() => {
    const saved = getSetting<SyncSettings>('sync', { endpoint: '', code: '', deviceId: deviceId() })
    setSync({ ...saved, deviceId: saved.deviceId || deviceId() })
    setSyncLoaded(true)
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

  const scan = async (showEmptyHint = true) => {
    if (!Capacitor.isNativePlatform()) {
      setScanMessage('自动发现仅支持手机 App；开发环境请手动填写电脑地址。')
      return
    }
    setScanning(true)
    setScanMessage('')
    try {
      const found = await discoverComputers()
      // 发现只说明 UDP 通了，不代表 HTTP 47821 可达。逐个候选地址做健康检查，
      // 避免选到电脑的 WSL/虚拟网卡地址，或继续使用已经过期的旧地址。
      const checked = await Promise.all(found.map(async device => {
        const candidates = [...new Set([device.endpoint, ...(device.endpoints || [])])].slice(0, 6)
        const results = await Promise.all(candidates.map(async endpoint => ({ endpoint, ok: await probeEndpoint(endpoint) })))
        const reachable = results.find(result => result.ok)
        return { ...device, endpoint: reachable?.endpoint || device.endpoint, reachable: Boolean(reachable) }
      }))
      setDevices(checked)
      const reachableDevices = checked.filter(device => device.reachable)
      if (!checked.length && showEmptyHint) {
        setScanMessage('没有发现电脑。请确认电脑端已开启“手机同步”，手机和电脑连同一个 Wi-Fi/热点，并关闭 VPN；也可以直接把电脑 IP 填到下面（手机浏览器能打开 http://电脑IP:47821/health 的地址）。')
      } else if (checked.length && !reachableDevices.length) {
        setScanMessage(`扫描到 ${checked.length} 台电脑，但 HTTP 47821 端口都连不上。请关闭手机 VPN，确认 Windows 防火墙允许专用网络访问 TCP 47821；也可以改用 USB 网络共享。`)
      } else if (reachableDevices.length === 1) {
        const chosen = reachableDevices[0]
        const next = { ...sync, endpoint: chosen.endpoint }
        saveSync(next)
        setSyncMessage(`已自动选中 ${chosen.name}（${chosen.endpoint}）。请输入电脑端显示的配对码，然后点“立即同步”。`)
      } else if (reachableDevices.length > 1 && showEmptyHint) {
        setScanMessage('发现多台可连接的电脑，请点选一台。')
      }
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    // 等本地保存的配对码读完再自动扫描，避免自动选中时把已保存的 code 覆盖成空。
    if (syncLoaded && Capacitor.isNativePlatform()) void scan(false)
    // 只在本页首次打开时扫描一次，避免反复弹出扫描。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncLoaded])

  const chooseDevice = (device: DiscoveredDevice) => {
    const next = { ...sync, endpoint: device.endpoint }
    saveSync(next)
    if (device.reachable === false) {
      setSyncMessage(`已选择 ${device.name}，但当前探测不可达。请确认手机和电脑在同一网络，关闭 VPN，或点“扫描电脑”重新检测。`)
    } else {
      setSyncMessage(`已选择 ${device.name}（${device.endpoint}），请输入电脑端显示的配对码，然后点“立即同步”。`)
    }
  }

  const saveSync = (next: SyncSettings) => { setSync(next); setSetting('sync', next) }

  const test = async () => {
    setSyncBusy('test'); setSyncMessage('')
    try { saveSync(sync); const ok = await ping(sync); setSyncMessage(ok ? '电脑端可达，可以同步' : '电脑端没有响应：请确认手机和电脑在同一 Wi-Fi、防火墙允许 TCP 47821，或重新扫描选择电脑') }
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
      <p className="muted small">电脑端 Mybook → 设置 → 手机同步，开启后手机和电脑连同一个 Wi-Fi/热点，点“扫描电脑”自动填入地址；也支持 USB 网络共享。配对码只用于解密同步包，不会在局域网广播。</p>
      <div className="row">
        <button className="secondary" disabled={scanning || Boolean(syncBusy)} onClick={() => void scan()}>
          {scanning ? <Loader2 className="spin" size={15} /> : <Wifi size={15} />}
          {scanning ? '正在扫描…' : '扫描电脑'}
        </button>
        {devices.length > 0 && <span className="muted small">发现 {devices.length} 台电脑</span>}
      </div>
      {devices.length > 0 && <div className="device-list">
        {devices.map(device => <button key={`${device.address}:${device.port}`} className={sync.endpoint === device.endpoint ? 'device-item active' : 'device-item'} onClick={() => chooseDevice(device)}>
          <span>
            <strong>{device.name}{device.reachable === false ? <em className="device-state bad">不可达</em> : <em className="device-state good">可连接</em>}</strong>
            <small>{device.endpoint}</small>
          </span>
          {sync.endpoint === device.endpoint ? <Check size={16} /> : <ChevronRight size={16} />}
        </button>)}
      </div>}
      {scanMessage && <p className="muted small scan-message">{scanMessage}</p>}
      <label>电脑端地址</label>
      <input value={sync.endpoint} onChange={event => setSync({ ...sync, endpoint: event.target.value })} placeholder="http://192.168.1.10:47821" autoCapitalize="none" />
      <label>配对码</label>
      <input value={sync.code} onChange={event => setSync({ ...sync, code: event.target.value })} placeholder="电脑端显示的配对码" autoCapitalize="none" />
      <div className="row">
        <button className="secondary" disabled={Boolean(syncBusy)} onClick={() => void test()}>{syncBusy === 'test' ? <Loader2 className="spin" size={15} /> : <Wifi size={15} />} 测试连接</button>
        <button className="primary" disabled={Boolean(syncBusy)} onClick={() => void runSync()}>{syncBusy === 'sync' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} 立即同步</button>
      </div>
      {syncMessage && <p className={syncMessage.includes('失败') || syncMessage.includes('错误') || syncMessage.includes('没有响应') ? 'alert error' : 'alert ok'}>{syncMessage}</p>}
      <div className="stats"><span>卡片 {counts.cards}</span><span>问答 {counts.qa}</span><span>面试 {counts.interviews}</span><span>资料 {counts.resources}</span></div>
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
