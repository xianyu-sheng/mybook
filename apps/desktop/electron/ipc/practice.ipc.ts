import { ipcMain } from 'electron'
import { getDb } from '../db/connection.js'
import { createPracticeService } from '../practice/service.js'

export function registerPracticeIpc() {
  const service = createPracticeService(getDb())
  service.recover()
  ipcMain.handle('knowmind:practice:from-recording', (_, id: string, questionIndex: number) => service.fromRecording(id, questionIndex))
  ipcMain.handle('knowmind:practice:from-interview', (_, turnId: string) => service.fromInterview(turnId))
  ipcMain.handle('knowmind:practice:from-card', (_, cardId: string) => service.fromCard(cardId))
  ipcMain.handle('knowmind:practice:list', () => service.list())
  ipcMain.handle('knowmind:practice:get', (_, id: string) => service.get(id))
  ipcMain.handle('knowmind:practice:attempt', (_, id: string, answer: unknown) => service.attempt(id, answer))
  ipcMain.handle('knowmind:practice:retry', (_, attemptId: string) => service.retry(attemptId))
  ipcMain.handle('knowmind:practice:set-status', (_, id: string, status: unknown) => service.setStatus(id, status))
  ipcMain.handle('knowmind:practice:delete', (_, id: string) => service.delete(id))
}
