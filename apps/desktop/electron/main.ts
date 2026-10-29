import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerDbIpc } from './ipc/db.ipc.js'
import { registerDocIpc } from './ipc/doc.ipc.js'
import './ipc/ai.ipc.js'
import { registerAuthIpc } from './ipc/auth.ipc.js'
import { getDb, closeDb } from './db/connection.js'
import { configureCustomProviders } from './ai/provider.js'
import { readCustomProviders } from './ai/custom.js'
import { registerInterviewIpc } from './ipc/interview.ipc.js'
import { registerRepositoryIpc } from './ipc/repository.ipc.js'
import { recoverInterruptedSyncs, cancelAllSyncs } from './repository/repository.js'
import { registerRecordingIpc } from './ipc/recording.ipc.js'
import { registerPracticeIpc } from './ipc/practice.ipc.js'
import { registerTargetIpc } from './ipc/target.ipc.js'
import { registerCodingIpc } from './ipc/coding.ipc.js'
import { registerMobileSyncIpc } from './ipc/mobile-sync.ipc.js'
import { restoreMobileSync, shutdownMobileSync } from './mobile-sync.js'
import { initializeSpeech, recoverRecordings, recordingInProgress, shutdownRecording, simplifyLegacyTranscripts } from './recording/service.js'
import { registerAppearanceIpc, registerWallpaperProtocol } from './appearance.js'

protocol.registerSchemesAsPrivileged([
  { scheme: 'mybook-audio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'mybook-wallpaper', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// On a few Linux/Chromium combinations the GPU process is created before
// Electron applies app.disableHardwareAcceleration(). Re-exec the packaged
// process with Chromium's explicit switch so a normal desktop launch is as
// reliable as `mybook --disable-gpu`.
if (process.platform === 'linux' && !process.argv.includes('--disable-gpu')) {
  const child = spawn(process.execPath, [...process.argv.slice(1), '--disable-gpu'], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  process.exit(0)
}

// Some Linux desktop/GPU combinations let Electron create a window and then
// immediately crash its GPU process. Mybook is a document-focused app, so
// software rendering is a safer default on Linux and keeps the window usable
// after a driver or compositor update. Windows and macOS retain hardware
// acceleration.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
  // Some Electron/Chromium builds still start a GPU process before the
  // hardware-acceleration setting is observed. Explicitly disable the GPU
  // command-line path as well; this prevents a compositor/driver crash from
  // leaving a running process with no visible Mybook window.
  app.commandLine.appendSwitch('disable-gpu')
}

// Keep existing notebooks and provider settings when upgrading the brand.
// An explicit profile (including automated tests) must always take precedence.
const legacyProfile = path.join(app.getPath('appData'), '知心')
if (!app.commandLine.hasSwitch('user-data-dir') &&
    !existsSync(path.join(app.getPath('userData'), 'knowmind.db')) &&
    existsSync(path.join(legacyProfile, 'knowmind.db'))) {
  app.setPath('userData', legacyProfile)
}

// The lock is scoped to the effective profile, including --user-data-dir.
// Recovery must never inspect another live instance's recording files.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

let mainWindow: BrowserWindow | null = null
let revealPending = false

/**
 * Desktop environments can restore a BrowserWindow's old position outside
 * the current work area. Always bring the primary window back to a usable
 * visible state when the app starts or a second launch is requested.
 */
function revealMainWindow() {
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    revealPending = true
    return
  }
  revealPending = false
  if (window.isMinimized()) window.restore()
  if (!window.isMaximized()) {
    window.center()
    window.maximize()
  }
  if (!window.isVisible()) window.show()
  window.focus()
}

app.on('second-instance', () => {
  // A second click can arrive while the first instance is still registering
  // IPC handlers. Remember the request so the eventual window is shown.
  revealMainWindow()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Mybook',
    // Explicit icon keeps Linux taskbar/WM identity from falling back to a gear.
    icon: path.join(__dirname, '../../assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    // Show the native window immediately. Waiting for ready-to-show leaves a
    // running process with no visible feedback when renderer startup is slow.
    show: true,
    backgroundColor: '#f7f8fa'
  })

  mainWindow.once('ready-to-show', revealMainWindow)
  // If a renderer fails to emit ready-to-show (for example after a display
  // hot-plug or a stale compositor state), do not leave the process hidden.
  setTimeout(revealMainWindow, 3000)

  const devServer = process.env['KNOWMIND_DEV_SERVER']
  const rendererFile = path.join(__dirname, '..', 'renderer', 'index.html')
  const openExternal = (url: string) => {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) return
      void shell.openExternal(url).catch(error => console.error('[Mybook] external link failed', error))
    } catch { /* Ignore malformed links from imported Markdown. */ }
  }
  const isLocalNavigation = (url: string) => {
    try {
      const target = new URL(url)
      return devServer ? target.origin === new URL(devServer).origin :
        target.protocol === 'file:' && fileURLToPath(target) === rendererFile
    } catch { return false }
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  const preventExternalNavigation = (event: Electron.Event, url: string) => {
    if (isLocalNavigation(url)) return
    event.preventDefault()
    openExternal(url)
  }
  mainWindow.webContents.on('will-navigate', preventExternalNavigation)
  mainWindow.webContents.on('will-redirect', preventExternalNavigation)
  if (devServer) {
    mainWindow.loadURL(devServer)
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  } else {
    mainWindow.loadFile(rendererFile)
  }

  if (revealPending) revealMainWindow()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function registerIpcHandlers() {
  ipcMain.handle('knowmind:ping', () => 'pong')

  // 初始化数据库
  getDb()
  simplifyLegacyTranscripts()
  configureCustomProviders(() => readCustomProviders(getDb()))
  registerWallpaperProtocol()
  registerAppearanceIpc()
  recoverInterruptedSyncs()
  await recoverRecordings()
  void initializeSpeech()

  // 注册各模块 IPC
  registerDbIpc()
  registerDocIpc()
  registerAuthIpc()
  registerInterviewIpc()
  registerRepositoryIpc()
  registerRecordingIpc()
  registerPracticeIpc()
  registerTargetIpc()
  registerCodingIpc()
  registerMobileSyncIpc()
  void restoreMobileSync().catch(error => console.error('恢复手机同步失败:', error))
}

if (primaryInstance) app.whenReady().then(async () => {
  await registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

let shuttingDown = false
app.on('before-quit', event => {
  if (!shuttingDown && recordingInProgress()) {
    event.preventDefault()
    shuttingDown = true
    void shutdownRecording().finally(() => app.quit())
  }
})
app.on('will-quit', () => { cancelAllSyncs(); shutdownMobileSync(); closeDb() })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
