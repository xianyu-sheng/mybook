import { ipcMain, shell } from 'electron'
import { createCodingService } from '../coding/service.js'
import { getDb } from '../db/connection.js'
import type { CodingAttemptInput, CodingProblemStatus, CodingStrategyInput, CodingStrategyStatus } from '../../src/types/coding.js'

let registered = false

export function registerCodingIpc(): void {
  if (registered) return
  registered = true
  const service = createCodingService(getDb())
  ipcMain.handle('knowmind:coding:strategies:list', () => service.listStrategies())
  ipcMain.handle('knowmind:coding:strategies:get', (_event, id: string) => service.getStrategy(id))
  ipcMain.handle('knowmind:coding:strategies:create', (_event, input: CodingStrategyInput) => service.createStrategy(input))
  ipcMain.handle('knowmind:coding:strategies:update', (_event, id: string, patch: Partial<CodingStrategyInput> & { status?: CodingStrategyStatus }) => service.updateStrategy(id, patch))
  ipcMain.handle('knowmind:coding:strategies:delete', (_event, id: string) => service.deleteStrategy(id))
  ipcMain.handle('knowmind:coding:strategies:search', (_event, id: string) => service.search(id))
  ipcMain.handle('knowmind:coding:strategies:plan', (_event, id: string) => service.plan(id))
  ipcMain.handle('knowmind:coding:strategies:problems', (_event, id: string) => service.getStrategy(id).problems)
  ipcMain.handle('knowmind:coding:problems:status', (_event, id: string, status: CodingProblemStatus) => service.updateProblemStatus(id, status))
  ipcMain.handle('knowmind:coding:attempts:save', (_event, input: CodingAttemptInput) => service.saveAttempt(input))
  ipcMain.handle('knowmind:coding:attempts:review', (_event, id: string) => service.review(id))
  ipcMain.handle('knowmind:coding:sync', (_event, id: string, platform: 'leetcode' | 'nowcoder') => service.sync(id, platform))
  // Keep strategy-scoped aliases so the renderer API reads naturally and old previews can be upgraded safely.
  ipcMain.handle('knowmind:coding:strategies:attempt', (_event, input: CodingAttemptInput) => service.saveAttempt(input))
  ipcMain.handle('knowmind:coding:strategies:review', (_event, id: string) => service.review(id))
  ipcMain.handle('knowmind:coding:strategies:sync', (_event, id: string, platform: 'leetcode' | 'nowcoder') => service.sync(id, platform))
  ipcMain.handle('knowmind:coding:open-source', async (_event, id: string, url: string) => {
    if (!service.canOpenSource(id, url) || !/^https?:\/\//i.test(url)) throw new Error('链接不属于当前刷题策略的来源')
    await shell.openExternal(url)
  })
}
