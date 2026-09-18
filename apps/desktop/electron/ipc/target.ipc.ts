import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb } from '../db/connection.js'

const input = z.object({
  company: z.string().trim().min(1, '请先填写企业').max(120),
  department: z.string().trim().max(200).default(''),
  role: z.string().trim().min(1, '请先填写岗位').max(200),
  jd: z.string().trim().max(18000).default(''),
})

export function registerTargetIpc(): void {
  ipcMain.handle('knowmind:targets:list', () => getDb().prepare('SELECT * FROM target_role ORDER BY updated_at DESC, rowid DESC').all())
  ipcMain.handle('knowmind:targets:save', (_, value: unknown, existing?: string) => {
    const target = input.parse(value)
    const db = getDb()
    const id = existing ? z.string().uuid().parse(existing) : randomUUID()
    if (existing) {
      const result = db.prepare("UPDATE target_role SET company=?, department=?, role=?, jd=?, updated_at=datetime('now') WHERE id=?")
        .run(target.company, target.department, target.role, target.jd, id)
      if (!result.changes) throw new Error('目标岗位已删除，请另存为新目标')
    } else {
      // Repeated clicks on an unchanged form should not make duplicate targets.
      const same = db.prepare('SELECT * FROM target_role WHERE company=? AND department=? AND role=? AND jd=?').get(target.company, target.department, target.role, target.jd)
      if (same) return same
      db.prepare('INSERT INTO target_role(id,company,department,role,jd) VALUES(?,?,?,?,?)').run(id, target.company, target.department, target.role, target.jd)
    }
    return db.prepare('SELECT * FROM target_role WHERE id=?').get(id)
  })
  ipcMain.handle('knowmind:targets:delete', (_, id: string) => { getDb().prepare('DELETE FROM target_role WHERE id=?').run(z.string().uuid().parse(id)) })
}
