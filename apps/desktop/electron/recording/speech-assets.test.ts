import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(fileURLToPath(new URL('../../assets/speech/transcribe.py', import.meta.url)), 'utf8')
const installer = readFileSync(fileURLToPath(new URL('./speech.ts', import.meta.url)), 'utf8')

describe('speech worker protocol', () => {
  it('emits UTF-8 JSON regardless of the Windows pipe code page', () => {
    expect(worker).toContain("sys.stdout.reconfigure(encoding='utf-8')")
    expect(worker).toContain("sys.stderr.reconfigure(encoding='utf-8'")
  })
  it('pins a PyAV release that still supports metadata_errors', () => {
    expect(installer).toContain("'av==15.1.0'")
  })
  it('asks Whisper for Simplified Chinese and keeps proper nouns', () => {
    expect(worker).toContain("initial_prompt='以下是普通话技术面试对话，请用简体中文转写，保留专有名词。'")
  })
})
