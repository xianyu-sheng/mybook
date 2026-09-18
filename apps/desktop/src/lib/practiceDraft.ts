const memory = new Map<string, { answer: string; warning: string }>()
const key = (id: string) => `mybook:practice-draft:${id}`
const warning = '草稿目前仅保留在本次运行中；请先复制答案，关闭应用后可能丢失。'
export function readPracticeDraft(id: string) {
  if (memory.has(id)) return memory.get(id)!
  try { return { answer: localStorage.getItem(key(id)) || '', warning: '' } }
  catch { return { answer: '', warning } }
}
export function writePracticeDraft(id: string, answer: string) {
  const draft = { answer, warning: '' }
  memory.set(id, draft)
  try { if (answer) localStorage.setItem(key(id), answer); else localStorage.removeItem(key(id)) }
  catch { draft.warning = warning }
  return draft.warning
}
export function clearPracticeDraft(id: string, submitted?: string) {
  // An older request must never erase a newer draft made after navigation.
  if (submitted === undefined || memory.get(id)?.answer === submitted) memory.delete(id)
  try { if (submitted === undefined || localStorage.getItem(key(id)) === submitted) localStorage.removeItem(key(id)) }
  catch { /* Saved answers remain in SQLite; volatile drafts stay in memory. */ }
}
