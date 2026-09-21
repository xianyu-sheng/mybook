import { describe, expect, it } from 'vitest'
import { estimateComplexity, runCode } from './runner.js'

describe('local coding runner', () => {
  it('executes JavaScript with stdin and returns a complexity estimate', async () => {
    const result = await runCode({ language: 'JavaScript', code: "process.stdin.on('data', chunk => process.stdout.write(chunk.toString().trim().toUpperCase()))", stdin: 'hello\n' })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('HELLO')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.complexity.time).toContain('O(1)')
  })

  it('stops an infinite program at the execution deadline', async () => {
    const result = await runCode({ language: 'javascript', code: 'while (true) {}', timeoutMs: 500 })
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.error).toBe('')
  })

  it('rejects unsupported runtimes before creating a process', async () => {
    await expect(runCode({ language: 'TypeScript', code: 'console.log(1)' })).rejects.toThrow('不执行 TypeScript')
  })

  it('labels the estimate as static instead of claiming runtime proves complexity', () => {
    const result = estimateComplexity('for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) {} }')
    expect(result.time).toContain('O(n^2)')
    expect(result.notice).toContain('运行耗时不能证明')
  })
})
