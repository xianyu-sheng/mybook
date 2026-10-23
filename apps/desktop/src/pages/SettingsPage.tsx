import { useEffect, useState } from 'react'
import { Check, Loader2, Server, Globe, Folder, Link2, Link2Off, Download, Pencil, Plus, Trash2, KeyRound, Palette, RefreshCw } from 'lucide-react'
import type { PlatformStatus } from '@/types/db'

interface 模型信息 {
  key: string
  name: string
  provider: 'openai' | 'anthropic'
  modelName: string
  appType: string
  isCCSwitchActive: boolean
  isCustom: boolean
  isActive: boolean
}

interface 供应商信息 {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  models: string[]
  wireApi: 'chat' | 'responses'
  keyHint: string
  createdAt: string
}

interface 供应商草稿 {
  id?: string
  name: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  apiKey: string
  models: string
  wireApi: 'chat' | 'responses'
}

export default function SettingsPage() {
  const [模型列表, set模型列表] = useState<模型信息[]>([])
  const [供应商列表, set供应商列表] = useState<供应商信息[]>([])
  const [供应商草稿, set供应商草稿] = useState<供应商草稿 | null>(null)
  const [供应商错误, set供应商错误] = useState('')
  const [正在保存供应商, set正在保存供应商] = useState(false)
  const [加载中, set加载中] = useState(true)
  const [当前模型, set当前模型] = useState<string>('')
  const [模型搜索, set模型搜索] = useState('')
  const [正在测试, set正在测试] = useState<string | null>(null)
  const [测试结果, set测试结果] = useState<Record<string, boolean | null>>({})
  const [保存提示, set保存提示] = useState('')
  const [输出目录, set输出目录] = useState('')
  const [平台状态, set平台状态] = useState<PlatformStatus>({ github: { connected: false }, leetcode: { connected: false }, nowcoder: { connected: false } })
  const [正在连接, set正在连接] = useState<string | null>(null)
  const [连接提示, set连接提示] = useState('')
  const [显示Cookie输入, set显示Cookie输入] = useState<string | null>(null)
  const [Cookie文本, setCookie文本] = useState('')
  const [壁纸地址, set壁纸地址] = useState<string | null>(null)
  const [壁纸来源, set壁纸来源] = useState<string | null>(null)
  const [外观模式, set外观模式] = useState<'off' | 'soft' | 'vivid'>('soft')

  useEffect(() => {
    (async () => {
      try {
        const list = await window.knowmind.ai.listModels()
        set模型列表(list)
        const active = list.find((m: 模型信息) => m.isActive)
        if (active) set当前模型(active.key)

        try {
          set供应商列表(await window.knowmind.ai.listProviders())
        } catch { /* 供应商配置读取失败不影响其他设置 */ }

        // 加载输出目录
        const savedDir = await window.knowmind.settings.get('outputDir')
        if (savedDir) set输出目录(String(savedDir))

        // 加载平台连接状态
        try {
          const status = await window.knowmind.auth.status()
          set平台状态(status)
        } catch { /* 忽略 */ }
      } catch (err) {
        console.error('加载设置失败:', err)
      } finally {
        set加载中(false)
      }
    })()
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [info, saved] = await Promise.all([
          window.knowmind.appearance.wallpaper(),
          window.knowmind.settings.get('wallpaperTheme'),
        ])
        if (!active) return
        set壁纸地址(info.url)
        set壁纸来源(info.label)
        if (saved === 'off' || saved === 'soft' || saved === 'vivid') set外观模式(saved)
      } catch { /* 未检测到壁纸时保持纯色主题 */ }
    })()
    return () => { active = false }
  }, [])

  const 切换外观 = async (mode: 'off' | 'soft' | 'vivid') => {
    set外观模式(mode)
    try {
      await window.knowmind.settings.set('wallpaperTheme', mode)
      window.dispatchEvent(new CustomEvent('knowmind:appearance-changed', { detail: mode }))
      set保存提示(mode === 'off' ? '已切换为纯色背景' : '外观已更新')
      setTimeout(() => set保存提示(''), 2500)
    } catch (err: any) {
      alert('切换外观失败: ' + (err.message || String(err)))
    }
  }

  const 刷新壁纸 = async () => {
    const info = await window.knowmind.appearance.wallpaper()
    set壁纸地址(info.url)
    set壁纸来源(info.label)
    window.dispatchEvent(new CustomEvent('knowmind:wallpaper-changed', { detail: info.url }))
    return info
  }

  const 选择壁纸图片 = async () => {
    try {
      const file = await window.knowmind.appearance.choose()
      if (!file) return
      await window.knowmind.settings.set('wallpaperImage', file)
      await 刷新壁纸()
      if (外观模式 === 'off') {
        set外观模式('soft')
        await window.knowmind.settings.set('wallpaperTheme', 'soft')
        window.dispatchEvent(new CustomEvent('knowmind:appearance-changed', { detail: 'soft' }))
      }
      set保存提示('背景图片已更新')
      setTimeout(() => set保存提示(''), 2500)
    } catch (err: any) {
      alert('选择图片失败: ' + (err.message || String(err)))
    }
  }

  const 使用自动壁纸 = async () => {
    try {
      await window.knowmind.settings.set('wallpaperImage', null)
      await 刷新壁纸()
      set保存提示('已恢复自动检测')
      setTimeout(() => set保存提示(''), 2500)
    } catch (err: any) {
      alert('恢复自动壁纸失败: ' + (err.message || String(err)))
    }
  }

  const 切换模型 = async (key: string) => {
    set保存提示('')
    try {
      await window.knowmind.ai.setActiveModel(key)
      set当前模型(key)
      set保存提示('优先使用 ' + (模型列表.find(m => m.key === key)?.modelName || key))
      setTimeout(() => set保存提示(''), 2500)
    } catch (err: any) {
      alert('切换失败: ' + (err.message || String(err)))
    }
  }

  const 测试连接 = async (key: string) => {
    set正在测试(key)
    set测试结果(prev => ({ ...prev, [key]: null }))
    try {
      const ok = await window.knowmind.ai.testConnection(key)
      set测试结果(prev => ({ ...prev, [key]: ok }))
    } catch {
      set测试结果(prev => ({ ...prev, [key]: false }))
    } finally {
      set正在测试(null)
    }
  }

  const 选择输出目录 = async () => {
    try {
      const dir = await window.knowmind.dialog.openDirectory()
      if (!dir) return
      set输出目录(dir)
      await window.knowmind.settings.set('outputDir', dir)
      set保存提示('输出目录已修改')
      setTimeout(() => set保存提示(''), 2500)
    } catch (err: any) {
      alert('选择目录失败: ' + (err.message || String(err)))
    }
  }

  // ---- 本地 AI 供应商（API Key 只存本机数据库）----
  const 刷新模型与供应商 = async () => {
    const [models, providers] = await Promise.all([
      window.knowmind.ai.listModels(),
      window.knowmind.ai.listProviders(),
    ])
    set模型列表(models)
    set供应商列表(providers)
    set当前模型(models.find((m: 模型信息) => m.isActive)?.key || '')
  }

  const 新建供应商 = () => {
    set供应商错误('')
    set供应商草稿({ name: '', provider: 'openai', baseURL: '', apiKey: '', models: '', wireApi: 'chat' })
  }

  const 编辑供应商 = (p: 供应商信息) => {
    set供应商错误('')
    set供应商草稿({ id: p.id, name: p.name, provider: p.provider, baseURL: p.baseURL, apiKey: '', models: p.models.join(', '), wireApi: p.wireApi })
  }

  const 保存供应商 = async () => {
    if (!供应商草稿) return
    set正在保存供应商(true)
    set供应商错误('')
    try {
      await window.knowmind.ai.saveProvider(供应商草稿)
      set供应商草稿(null)
      await 刷新模型与供应商()
      set保存提示('供应商已保存，API Key 只写入本机数据库')
      setTimeout(() => set保存提示(''), 3000)
    } catch (err: any) {
      set供应商错误(err.message || String(err))
    } finally {
      set正在保存供应商(false)
    }
  }

  const 删除供应商 = async (p: 供应商信息) => {
    if (!confirm(`删除供应商「${p.name}」？本机保存的 API Key 也会一并删除。`)) return
    try {
      await window.knowmind.ai.deleteProvider(p.id)
      if (供应商草稿?.id === p.id) set供应商草稿(null)
      await 刷新模型与供应商()
      set保存提示('供应商已删除')
      setTimeout(() => set保存提示(''), 2500)
    } catch (err: any) {
      alert('删除失败: ' + (err.message || String(err)))
    }
  }

  const 更新草稿 = (patch: Partial<供应商草稿>) => set供应商草稿(prev => prev ? { ...prev, ...patch } : prev)

  // ---- 平台连接 ----
  const 连接平台 = async (platform: string) => {
    set正在连接(platform)
    set连接提示('')
    try {
      let result: any
      switch (platform) {
        case 'github':
          set连接提示('正在打开浏览器进行 GitHub 授权...')
          result = await window.knowmind.auth.githubConnect()
          break
        case 'leetcode':
          result = await window.knowmind.auth.leetcodeLogin()
          // 如果已有 cookie 直接返回；如果需要手动粘贴，result.needCookie=true
          break
        case 'nowcoder':
          result = await window.knowmind.auth.nowcoderLogin()
          break
      }

      if (result?.success) {
        set平台状态(prev => ({
          ...prev,
          [platform]: { connected: true, username: result.username }
        }))
        set连接提示(`已连接 ${result.username}`)
        setTimeout(() => set连接提示(''), 3000)
      } else if (result?.needCookie) {
        // 打开 Cookie 粘贴面板
        set连接提示('')
        set显示Cookie输入(platform)
      } else if (result) {
        set连接提示(`连接失败: ${result.error}`)
      }
    } catch (err: any) {
      set连接提示('连接失败: ' + (err.message || String(err)))
    } finally {
      set正在连接(null)
    }
  }

  const 提交Cookie = async (platform: string) => {
    if (!Cookie文本.trim()) return
    set正在连接(platform)
    set连接提示('正在验证 Cookie...')
    try {
      const result = await window.knowmind.auth.saveCookie(platform, Cookie文本.trim())
      if (result?.success) {
        set平台状态(prev => ({
          ...prev,
          [platform]: { connected: true, username: result.username }
        }))
        set连接提示(`已连接 ${result.username}`)
        set显示Cookie输入(null)
        setCookie文本('')
        setTimeout(() => set连接提示(''), 3000)
      } else {
        set连接提示(`Cookie 验证失败: ${result?.error || '无效'}`)
      }
    } catch (err: any) {
      set连接提示('验证失败: ' + (err.message || String(err)))
    } finally {
      set正在连接(null)
    }
  }

  const 断开平台 = async (platform: string) => {
    try {
      await window.knowmind.auth.disconnect(platform)
      set平台状态(prev => ({
        ...prev,
        [platform]: { connected: false }
      }))
    } catch (err: any) {
      alert('断开失败: ' + (err.message || String(err)))
    }
  }

  const 应用类型名 = (t: string) => {
    switch (t) {
      case 'claude': return 'Claude Code'
      case 'claude-desktop': return 'Claude Desktop'
      case 'codex': return 'OpenAI Codex'
      case 'gemini': return 'Gemini'
      case 'custom': return '本机供应商'
      default: return t
    }
  }

  if (加载中) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">设置</h1>
      <p className="text-sm text-zinc-500 mb-6">
        管理平台连接、桌面壁纸外观、AI 供应商和输出目录。API Key 只保存在本机数据库，不会进入源码仓库或导出文件。
      </p>

      {保存提示 && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
          <Check className="w-4 h-4" />{保存提示}
        </div>
      )}

      {连接提示 && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-sm flex items-center gap-1">
          {正在连接 && <Loader2 className="w-4 h-4 animate-spin" />}{连接提示}
        </div>
      )}


      {/* Cookie 手动粘贴面板（力扣/牛客）*/}
      {显示Cookie输入 && (
        <div className="mb-6 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
          <h3 className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
            📋 粘贴 {显示Cookie输入 === 'leetcode' ? '力扣' : '牛客'} Cookie
          </h3>
          <p className="text-xs text-amber-600 dark:text-amber-500 mb-3">
            为避免踢掉浏览器登录态，请手动复制 Cookie：
            <br />1. 在浏览器打开 {显示Cookie输入 === 'leetcode' ? 'leetcode.cn' : 'nowcoder.com'} 并登录
            <br />2. 按 F12 → Application → Cookies → 复制所有 cookie（或用插件导出）
            <br />3. 粘贴到下方文本框
          </p>
          <textarea
            value={Cookie文本}
            onChange={e => setCookie文本(e.target.value)}
            placeholder="粘贴完整的 Cookie 字符串..."
            rows={3}
            className="w-full px-3 py-2 text-xs rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 outline-none focus:border-amber-500 font-mono resize-none"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => { set显示Cookie输入(null); setCookie文本('') }}
              className="px-3 py-1.5 text-xs rounded-md hover:bg-amber-100 dark:hover:bg-amber-900">
              取消
            </button>
            <button onClick={() => 提交Cookie(显示Cookie输入)} disabled={!Cookie文本.trim() || 正在连接 !== null}
              className="px-3 py-1.5 text-xs rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1">
              {正在连接 === 显示Cookie输入 ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              验证并连接
            </button>
          </div>
        </div>
      )}

      {/* 平台连接 */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">平台连接</h2>
        <p className="text-sm text-zinc-500 mb-3">
          连接 GitHub / 力扣 / 牛客账户，将项目信息和刷题记录导入为知识来源
        </p>

        <div className="space-y-2">
          {/* GitHub */}
          <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                <div>
                  <div className="font-medium text-sm">GitHub</div>
                  <div className="text-xs text-zinc-400">
                    {平台状态.github.connected
                      ? `已连接 @${平台状态.github.username}`
                      : '导入项目仓库和技术栈信息'}
                  </div>
                </div>
              </div>
              {平台状态.github.connected ? (
                <button onClick={() => 断开平台('github')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                  <Link2Off className="w-3 h-3" />断开
                </button>
              ) : (
                <button onClick={() => 连接平台('github')} disabled={正在连接 === 'github'}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-white disabled:opacity-50">
                  {正在连接 === 'github' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}连接
                </button>
              )}
            </div>
          </div>

          {/* 力扣 */}
          <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded bg-amber-500 flex items-center justify-center text-white text-[10px] font-bold">L</div>
                <div>
                  <div className="font-medium text-sm">力扣 (LeetCode)</div>
                  <div className="text-xs text-zinc-400">
                    {平台状态.leetcode.connected
                      ? `已连接 @${平台状态.leetcode.username}`
                      : '导入刷题记录，辅助复习和推荐'}
                  </div>
                </div>
              </div>
              {平台状态.leetcode.connected ? (
                <button onClick={() => 断开平台('leetcode')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                  <Link2Off className="w-3 h-3" />断开
                </button>
              ) : (
                <button onClick={() => 连接平台('leetcode')} disabled={正在连接 === 'leetcode'}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50">
                  {正在连接 === 'leetcode' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}连接
                </button>
              )}
            </div>
          </div>

          {/* 牛客 */}
          <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold">牛</div>
                <div>
                  <div className="font-medium text-sm">牛客网</div>
                  <div className="text-xs text-zinc-400">
                    {平台状态.nowcoder.connected
                      ? `已连接 @${平台状态.nowcoder.username}`
                      : '导入练习和企业真题刷题记录'}
                  </div>
                </div>
              </div>
              {平台状态.nowcoder.connected ? (
                <button onClick={() => 断开平台('nowcoder')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                  <Link2Off className="w-3 h-3" />断开
                </button>
              ) : (
                <button onClick={() => 连接平台('nowcoder')} disabled={正在连接 === 'nowcoder'}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50">
                  {正在连接 === 'nowcoder' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}连接
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Palette className="w-4 h-4" />外观</h2>
        <p className="text-sm text-zinc-500 mb-3">
          把桌面壁纸作为窗口背景，模糊后叠在界面后面。支持 Wallpaper Engine 当前壁纸、系统壁纸和自定义图片；
          只读取静态图片，不采集桌面图标、其它窗口或屏幕内容。
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={() => void 选择壁纸图片()}
            className="inline-flex items-center gap-1 rounded-md border border-[color:var(--app-border)] px-2.5 py-1.5 text-xs hover:bg-[color:var(--app-hover)]">
            <Folder className="w-3.5 h-3.5" />选择图片
          </button>
          <button onClick={() => void 刷新壁纸()} title="重新读取 Wallpaper Engine 或系统壁纸"
            className="inline-flex items-center gap-1 rounded-md border border-[color:var(--app-border)] px-2.5 py-1.5 text-xs hover:bg-[color:var(--app-hover)]">
            <RefreshCw className="w-3.5 h-3.5" />重新检测
          </button>
          {壁纸来源 === '自定义图片' && (
            <button onClick={() => void 使用自动壁纸()}
              className="inline-flex items-center gap-1 rounded-md border border-[color:var(--app-border)] px-2.5 py-1.5 text-xs hover:bg-[color:var(--app-hover)]">
              恢复自动检测
            </button>
          )}
          {壁纸来源 && <span className="text-xs text-zinc-500">当前：{壁纸来源}</span>}
        </div>
        {壁纸地址 ? <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([
              ['off', '纯色', '不使用壁纸'],
              ['soft', '轻透', '模糊壁纸 + 玻璃面板'],
              ['vivid', '通透', '更明显的壁纸'],
            ] as const).map(([mode, label, description]) => (
              <button key={mode} onClick={() => void 切换外观(mode)}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  外观模式 === mode
                    ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-950'
                    : 'border-[color:var(--app-border)] hover:bg-[color:var(--app-hover)]'
                }`}>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-zinc-500 mt-0.5">{description}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 relative h-20 rounded-lg overflow-hidden border border-[color:var(--app-border)]">
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${壁纸地址}")`, filter: 'blur(3px) saturate(1.1)', transform: 'scale(1.08)' }} />
            <div className="absolute inset-0 bg-white/45 dark:bg-black/45" />
            <span className="absolute left-3 bottom-2 text-[11px] text-zinc-700 dark:text-zinc-200">当前窗口背景 · 模糊预览</span>
          </div>
        </> : (
          <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-[color:var(--app-border)] p-4">
            未检测到桌面壁纸。可以手动选择一张图片，或启动 Wallpaper Engine 后重试。
          </p>
        )}
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">AI 供应商 · {供应商列表.length}</h2>
          {!供应商草稿 && (
            <button onClick={新建供应商} className="flex items-center gap-1 text-sm text-primary-600">
              <Plus className="w-4 h-4" />添加供应商
            </button>
          )}
        </div>
        <p className="text-sm text-zinc-500 mb-3">
          支持 OpenAI 兼容服务（DeepSeek、通义、Kimi、OpenRouter、Ollama 等）和 Anthropic 协议。
          模型名可用逗号分隔多个，第一个作为默认，其余用于失败降级。
        </p>

        {供应商列表.length === 0 && !供应商草稿 && (
          <div className="p-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-center">
            <p className="text-sm text-zinc-500 mb-2">还没有配置 AI 供应商</p>
            <p className="text-xs text-zinc-400">
              点击右上角「添加供应商」，填入 Base URL、API Key 和模型名，即可使用 AI 问答、模拟面试和录音复盘。
            </p>
          </div>
        )}

        {供应商列表.map(p => (
          <div key={p.id} className="p-3 mb-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  {p.name}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-300">
                    {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 mt-1 break-all">{p.baseURL}</div>
                <div className="text-xs text-zinc-500 mt-1 break-all">{p.models.join(' / ')}</div>
                <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
                  <KeyRound className="w-3 h-3" />{p.keyHint}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button aria-label={`编辑 ${p.name}`} onClick={() => 编辑供应商(p)}
                  className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button aria-label={`删除 ${p.name}`} onClick={() => 删除供应商(p)}
                  className="p-1.5 rounded border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {供应商草稿 && (
          <div className="p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/40 dark:bg-primary-950/30">
            <h3 className="font-medium text-sm mb-3">{供应商草稿.id ? '编辑供应商' : '添加供应商'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-zinc-500">名称
                <input value={供应商草稿.name} onChange={e => 更新草稿({ name: e.target.value })}
                  placeholder="我的 DeepSeek" autoComplete="off"
                  className="mt-1 w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none focus:border-primary-500" />
              </label>
              <label className="text-xs text-zinc-500">协议
                <select value={供应商草稿.provider} onChange={e => 更新草稿({ provider: e.target.value as 'openai' | 'anthropic' })}
                  className="mt-1 w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none focus:border-primary-500">
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
            </div>
            <label className="block mt-3 text-xs text-zinc-500">Base URL
              <input value={供应商草稿.baseURL} onChange={e => 更新草稿({ baseURL: e.target.value })}
                placeholder={供应商草稿.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1'} autoComplete="off"
                className="mt-1 w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none focus:border-primary-500" />
            </label>
            <label className="block mt-3 text-xs text-zinc-500">API Key
              <input type="password" value={供应商草稿.apiKey} onChange={e => 更新草稿({ apiKey: e.target.value })}
                placeholder={供应商草稿.id ? '留空则沿用已保存的 Key' : 'sk-...'} autoComplete="new-password"
                className="mt-1 w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none focus:border-primary-500 font-mono" />
            </label>
            <label className="block mt-3 text-xs text-zinc-500">模型名（逗号分隔，可填多个）
              <input value={供应商草稿.models} onChange={e => 更新草稿({ models: e.target.value })}
                placeholder="deepseek-chat, deepseek-reasoner" autoComplete="off"
                className="mt-1 w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none focus:border-primary-500 font-mono" />
            </label>
            {供应商草稿.provider === 'openai' && (
              <label className="block mt-3 text-xs text-zinc-500">接口模式
                <select value={供应商草稿.wireApi} onChange={e => 更新草稿({ wireApi: e.target.value as 'chat' | 'responses' })}
                  className="mt-1 w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none focus:border-primary-500">
                  <option value="chat">Chat Completions（多数兼容服务）</option>
                  <option value="responses">Responses（OpenAI 新接口）</option>
                </select>
              </label>
            )}
            {供应商错误 && <p className="mt-3 text-xs text-red-500">{供应商错误}</p>}
            <p className="mt-3 text-xs text-zinc-400">
              API Key 会以明文存放在本机数据库（userData/knowmind.db），不会上传或写入仓库。
            </p>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => { set供应商草稿(null); set供应商错误('') }}
                className="px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700">
                取消
              </button>
              <button onClick={保存供应商} disabled={正在保存供应商}
                className="flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
                {正在保存供应商 && <Loader2 className="w-3.5 h-3.5 animate-spin" />}保存
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-semibold">模型候选 · {模型列表.length}</h2><button className="text-sm text-primary-600" onClick={async () => { await 刷新模型与供应商() }}>刷新配置</button></div>
        <p className="text-sm text-zinc-500 mb-3">上方配置的供应商优先；如本机装有 CC Switch，也会一并读取其中 Claude、Codex、Hermes 的模型。选中的模型优先使用；超时、限流或渠道不可用时自动尝试同一供应商的其他模型。</p>
        <input aria-label="搜索模型" value={模型搜索} onChange={e => set模型搜索(e.target.value)} placeholder="搜索模型或供应商" className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent p-2 text-sm mb-3" />

        {模型列表.length === 0 ? (
          <div className="p-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-center">
            <p className="text-sm text-zinc-500 mb-2">未检测到可用模型</p>
            <p className="text-xs text-zinc-400">
              请在上方「AI 供应商」中添加 Base URL、API Key 和模型名后保存。
              已安装 CC Switch 的用户也会自动读取其中的 Provider。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {模型列表.filter(m => `${m.name} ${m.modelName}`.toLowerCase().includes(模型搜索.toLowerCase())).map(m => (
              <div
                key={m.key}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  当前模型 === m.key
                    ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-950'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
                onClick={() => 切换模型(m.key)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {m.provider === 'anthropic' ? (
                      <Server className="w-5 h-5 text-orange-400" />
                    ) : (
                      <Globe className="w-5 h-5 text-green-500" />
                    )}
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {m.name}
                        {m.isCCSwitchActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400">
                            CC Switch 当前
                          </span>
                        )}
                        {m.isCustom && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">
                            本机配置
                          </span>
                        )}
                        {当前模型 === m.key && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500 text-white">优先使用</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {m.modelName} · {应用类型名(m.appType)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation()
                      测试连接(m.key)
                    }}
                    disabled={正在测试 === m.key}
                    className="px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {正在测试 === m.key ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : 测试结果[m.key] === true ? (
                      <span className="text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" /> 正常
                      </span>
                    ) : 测试结果[m.key] === false ? (
                      <span className="text-red-500">失败</span>
                    ) : (
                      '测试'
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">输出目录</h2>
        <p className="text-sm text-zinc-500 mb-3">
          所有 AI 回复会自动落盘到这个目录。每次生成卡片、展开解释、问答回复都会保存为 Markdown 文件。
          默认目录为 <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">~/Mybook输出/</code>
        </p>
        <div className="flex items-center gap-2">
          <input
            value={输出目录}
            readOnly
          placeholder="~/Mybook输出/"
            className="flex-1 px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 outline-none text-zinc-500"
          />
          <button
            onClick={选择输出目录}
            className="flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            <Folder className="w-4 h-4" />选择
          </button>
        </div>
      </section>

      <section>
        <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
          <h3 className="font-medium mb-1">配置来源</h3>
          <p className="text-sm text-zinc-500">
            AI 供应商和 API Key 保存位置：
          </p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-500">
            <li>· <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">userData/knowmind.db</code> — 设置页添加的供应商（本机 SQLite）</li>
            <li>· <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">~/.cc-switch/cc-switch.db</code> — 可选的 CC Switch 兼容来源</li>
          </ul>
          <p className="text-sm text-zinc-400 mt-3">
            数据库只在你的设备上，不随仓库或安装包分发。API Key 不会回传到界面，也不会写入导出文件。
            如设备可能被他人使用，请自行评估本机数据库的访问权限。
          </p>
        </div>
      </section>
    </div>
  )
}
