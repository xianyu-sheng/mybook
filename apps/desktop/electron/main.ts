import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerDbIpc } from './ipc/db.ipc.js'
import { registerDocIpc } from './ipc/doc.ipc.js'
import './ipc/ai.ipc.js'
import { registerAuthIpc } from './ipc/auth.ipc.js'
import { getDb, closeDb } from './db/connection.js'
import { registerInterviewIpc } from './ipc/interview.ipc.js'
import { registerRepositoryIpc } from './ipc/repository.ipc.js'
import { recoverInterruptedSyncs, cancelAllSyncs } from './repository/repository.js'
import { registerRecordingIpc } from './ipc/recording.ipc.js'
import { registerPracticeIpc } from './ipc/practice.ipc.js'
import { registerTargetIpc } from './ipc/target.ipc.js'
import { registerCodingIpc } from './ipc/coding.ipc.js'
import { initializeSpeech, recoverRecordings, recordingInProgress, shutdownRecording } from './recording/service.js'

protocol.registerSchemesAsPrivileged([{ scheme: 'mybook-audio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

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

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function registerIpcHandlers() {
  ipcMain.handle('knowmind:ping', () => 'pong')

  // 初始化数据库
  getDb()
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
app.on('will-quit', () => { cancelAllSyncs(); closeDb() })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
