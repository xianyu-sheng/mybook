import { useEffect, useState } from 'react'
import type { RecordingState } from '@/types/recording'

const initial: RecordingState = { active: null, job: null, setup: { running: false, message: '', ready: false } }
export function useRecordingState() {
  const [state, setState] = useState(initial)
  useEffect(() => {
    let alive = true
    const off = window.knowmind.recordings.onState(value => { if (alive) setState(value) })
    window.knowmind.recordings.state().then(value => { if (alive) setState(value) }).catch(console.error)
    return () => { alive = false; off() }
  }, [])
  return state
}
