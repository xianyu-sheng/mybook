import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryDb } from '../test-utils/memory-db.js'
import { deleteInterviewSession } from './service.js'

let db: Database.Database
beforeEach(() => {
  db = memoryDb()
  db.prepare("INSERT INTO notebook(id,title) VALUES ('book','Interview notebook')").run()
  db.prepare("INSERT INTO interview_session(id,notebook_id,title,company,role) VALUES ('session','book','模拟面试','字节跳动','后端')").run()
  db.prepare("INSERT INTO interview_turn(id,session_id,question,answer,feedback) VALUES ('turn','session','问题','回答','点评')").run()
  db.prepare("INSERT INTO supplement(id,notebook_id,title,content,source_type,reference_id) VALUES ('jd','book','岗位准备','JD','manual','session')").run()
  db.prepare("INSERT INTO supplement(id,notebook_id,title,content,source_type,reference_id) VALUES ('qa','book','复习','知识','qa','turn')").run()
  db.prepare("INSERT INTO supplement(id,notebook_id,title,content,source_type) VALUES ('other','book','保留','其他','manual')").run()
})
afterEach(() => db.close())

describe('deleteInterviewSession', () => {
  it('deletes the session, turns, and linked knowledge notes atomically', () => {
    expect(deleteInterviewSession(db, 'session')).toBe('book')
    expect(db.prepare('SELECT id FROM interview_session WHERE id=?').get('session')).toBeUndefined()
    expect(db.prepare('SELECT id FROM interview_turn WHERE session_id=?').all('session')).toHaveLength(0)
    expect(db.prepare('SELECT id FROM supplement WHERE id IN (?,?)').all('jd', 'qa')).toHaveLength(0)
    expect(db.prepare('SELECT id FROM supplement WHERE id=?').get('other')).toBeTruthy()
  })

  it('reports a missing interview instead of deleting unrelated notes', () => {
    expect(() => deleteInterviewSession(db, 'missing')).toThrow('模拟面试不存在')
    expect(db.prepare('SELECT id FROM supplement WHERE id=?').get('other')).toBeTruthy()
  })
})
