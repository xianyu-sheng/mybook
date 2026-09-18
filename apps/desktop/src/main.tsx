import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './global.css'

// 暗色模式跟随系统
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark')
}

function 启动应用() {
  const rootEl = document.getElementById('root')
  if (!rootEl) {
    document.body.innerHTML = '<div style="padding:40px;color:red">严重错误：找不到 #root 元素</div>'
    return
  }

  // 检测 preload API 是否可用
  if (!window.knowmind) {
    rootEl.innerHTML = '<div style="padding:40px;text-align:center"><h2>⚠️ 应用初始化失败</h2><p>preload.ts 未正常加载，window.knowmind API 不可用。</p><p>请尝试重新安装应用。</p></div>'
    return
  }

  // 测试数据库连接
  window.knowmind.ping().then(() => {
    console.log('[Mybook] preload 正常，数据库连接成功')
  }).catch((err: any) => {
    console.error('[Mybook] 数据库连接失败:', err)
    rootEl.innerHTML = `<div style="padding:40px;text-align:center"><h2>⚠️ 数据库连接失败</h2><p>${err?.message || String(err)}</p></div>`
    return
  })

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

启动应用()
