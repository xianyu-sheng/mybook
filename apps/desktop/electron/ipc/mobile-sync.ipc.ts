import { ipcMain } from 'electron'
import { mobileSyncStatus, regenerateMobileSyncCode, startMobileSync, stopMobileSync } from '../mobile-sync.js'

export function registerMobileSyncIpc() {
  ipcMain.handle('knowmind:mobile-sync:status', () => mobileSyncStatus())
  ipcMain.handle('knowmind:mobile-sync:start', () => startMobileSync())
  ipcMain.handle('knowmind:mobile-sync:stop', () => stopMobileSync())
  ipcMain.handle('knowmind:mobile-sync:regenerate', () => regenerateMobileSyncCode())
}
