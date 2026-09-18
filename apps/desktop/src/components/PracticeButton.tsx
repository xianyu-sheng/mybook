import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Target } from 'lucide-react'

export default function PracticeButton({ source, id, index }: { source: 'recording' | 'interview' | 'card'; id: string; index?: number }) {
  const [itemId, setItemId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const add = async () => {
    if (lock.current) return
    lock.current = true; setPending(true); setError('')
    try {
      const item = source === 'recording' ? await window.knowmind.practice.fromRecording(id, index!) : source === 'interview' ? await window.knowmind.practice.fromInterview(id) : await window.knowmind.practice.fromCard(id)
      setItemId(item.id)
      window.dispatchEvent(new Event('knowmind:practice-changed'))
    } catch (error: any) { setError(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')) }
    finally { lock.current = false; setPending(false) }
  }
  return <div className="mt-3">
    {itemId ? <Link to={`/practice?item=${itemId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400"><Check size={14} />已加入 · 去练习</Link> : <button type="button" disabled={pending} onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950 px-3 py-2 text-xs font-medium text-primary-700 dark:text-primary-300 disabled:opacity-50">{pending ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}加入专项练习</button>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600 break-words">{error}</p>}
  </div>
}
