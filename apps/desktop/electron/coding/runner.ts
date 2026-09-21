import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface CodeRunInput {
  language: string
  code: string
  stdin?: string
  timeoutMs?: number
}

export interface CodeComplexityEstimate {
  time: string
  space: string
  notice: string
}

export interface CodeRunResult {
  ok: boolean
  output: string
  error: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  complexity: CodeComplexityEstimate
}

type Program = { command: string; args: string[]; compile?: { command: string; args: string[] } }

const MAX_CODE = 30000
const MAX_STDIN = 20000
const MAX_OUTPUT = 64 * 1024
const DEFAULT_TIMEOUT = 5000
const MAX_TIMEOUT = 15000

function normalizeLanguage(value: string): string {
  const language = value.trim().toLowerCase().replace(/\s+/g, '')
  if (language === 'javascript' || language === 'js' || language === 'node') return 'javascript'
  if (language === 'typescript' || language === 'ts') return 'typescript'
  if (language === 'python' || language === 'python3' || language === 'py') return 'python'
  if (language === 'c++' || language === 'cpp') return 'cpp'
  if (language === 'c') return 'c'
  if (language === 'golang') return 'go'
  if (language === 'rs') return 'rust'
  return language
}

/** A deliberately conservative static estimate. Exact asymptotic complexity
 * cannot be measured by executing one input; the AI review remains the final
 * explanation shown with the attempt. */
export function estimateComplexity(code: string): CodeComplexityEstimate {
  const source = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/#.*/g, '')
  const loops = [...source.matchAll(/\b(?:for|while|do)\b/g)].length
  const nesting = Math.min(4, loops)
  const recursive = /\b([A-Za-z_]\w*)\s*\([^;{}]*\)[^{;]*\{[\s\S]{0,500}\b\1\s*\(/.test(source)
  const time = recursive ? '递归：需结合递推式确认' : loops === 0 ? 'O(1)（未识别循环）' : `O(n${nesting > 1 ? `^${nesting}` : ''})（循环层数估算）`
  const allocated = /\b(?:new\s+|make\s*\(|append\s*\(|Array\s*\(|Map\s*\(|Set\s*\(|vector\s*<)/.test(source)
  const space = allocated ? 'O(n)（检测到动态容器或数组）' : 'O(1)（未识别线性额外存储）'
  return { time, space, notice: '这是基于源码的保守估算；运行耗时不能证明渐进复杂度，提交后可查看 AI 复盘结论。' }
}

function safeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH || '', LANG: 'C.UTF-8' }
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME']) if (process.env[key]) env[key] = process.env[key]
  // Keep the compiler/runtime lookup predictable while allowing users to add
  // a local toolchain directory explicitly through PATH.
  if (process.platform === 'win32' && process.env.PATHEXT) env.PATHEXT = process.env.PATHEXT
  return env
}

function programFor(language: string, directory: string): Program {
  const win = process.platform === 'win32'
  const python = win ? 'python' : 'python3'
  switch (normalizeLanguage(language)) {
    case 'javascript': return { command: win ? 'node.exe' : 'node', args: [join(directory, 'main.js')] }
    case 'python': return { command: python, args: [join(directory, 'main.py')] }
    case 'go': return { command: win ? 'go.exe' : 'go', args: ['run', join(directory, 'main.go')] }
    case 'rust': return { command: join(directory, win ? 'main.exe' : 'main'), args: [], compile: { command: win ? 'rustc.exe' : 'rustc', args: [join(directory, 'main.rs'), '-O', '-o', join(directory, win ? 'main.exe' : 'main')] } }
    case 'c': return { command: join(directory, win ? 'main.exe' : 'main'), args: [], compile: { command: win ? 'gcc.exe' : 'gcc', args: [join(directory, 'main.c'), '-O2', '-o', join(directory, win ? 'main.exe' : 'main')] } }
    case 'cpp': return { command: join(directory, win ? 'main.exe' : 'main'), args: [], compile: { command: win ? 'g++.exe' : 'g++', args: [join(directory, 'main.cpp'), '-O2', '-std=c++17', '-o', join(directory, win ? 'main.exe' : 'main')] } }
    case 'java': return { command: win ? 'java.exe' : 'java', args: ['-cp', directory, 'Main'], compile: { command: win ? 'javac.exe' : 'javac', args: [join(directory, 'Main.java')] } }
    case 'typescript': throw new Error('当前环境不执行 TypeScript，请切换 JavaScript 或先安装可用的 TypeScript 运行器。')
    default: throw new Error(`暂不支持直接运行 ${language || '该语言'}，可用语言：Python、JavaScript、Java、C、C++、Go、Rust`)
  }
}

function runProcess(command: string, args: string[], input: string, timeoutMs: number, cwd: string): Promise<{ output: string; error: string; exitCode: number | null; signal: string | null; timedOut: boolean }> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try { child = spawn(command, args, { cwd, env: safeEnv(), shell: false, windowsHide: true }) } catch (error) {
      resolve({ output: '', error: error instanceof Error ? error.message : String(error), exitCode: null, signal: null, timedOut: false }); return
    }
    let output = ''; let error = ''; let timedOut = false; let settled = false
    const append = (target: 'output' | 'error', chunk: Buffer | string) => {
      if (settled) return
      const text = chunk.toString()
      if (target === 'output') output += text.slice(0, Math.max(0, MAX_OUTPUT - output.length))
      else error += text.slice(0, Math.max(0, MAX_OUTPUT - error.length))
      if (output.length >= MAX_OUTPUT || error.length >= MAX_OUTPUT) {
        error += '\n输出超过 64KB，已停止进程。'
        child.kill()
      }
    }
    child.stdout?.on('data', chunk => append('output', chunk))
    child.stderr?.on('data', chunk => append('error', chunk))
    child.on('error', spawnError => { error += (error ? '\n' : '') + spawnError.message })
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs)
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      resolve({ output: output.trimEnd(), error: error.trimEnd(), exitCode, signal, timedOut })
    })
    if (input) child.stdin?.write(input)
    child.stdin?.end()
  })
}

export async function runCode(input: CodeRunInput): Promise<CodeRunResult> {
  const language = normalizeLanguage(String(input.language || ''))
  const code = String(input.code || '')
  const stdin = String(input.stdin || '')
  if (!code.trim()) throw new Error('请先写入代码')
  if (code.length > MAX_CODE) throw new Error(`代码不能超过 ${MAX_CODE} 个字符`)
  if (stdin.length > MAX_STDIN) throw new Error(`测试输入不能超过 ${MAX_STDIN} 个字符`)
  const timeoutMs = Math.min(MAX_TIMEOUT, Math.max(500, Number(input.timeoutMs) || DEFAULT_TIMEOUT))
  const directory = await mkdtemp(join(tmpdir(), 'mybook-code-'))
  const started = Date.now()
  try {
    const fileName = language === 'java' ? 'Main.java' : language === 'python' ? 'main.py' : language === 'javascript' ? 'main.js' : language === 'go' ? 'main.go' : language === 'rust' ? 'main.rs' : language === 'c' ? 'main.c' : 'main.cpp'
    await writeFile(join(directory, fileName), code, 'utf8')
    const program = programFor(language, directory)
    if (program.compile) {
      const compile = await runProcess(program.compile.command, program.compile.args, '', Math.min(timeoutMs, 10000), directory)
      if (compile.exitCode !== 0 || compile.timedOut) return { ok: false, output: compile.output, error: compile.timedOut ? '编译超时。' : compile.error || '编译失败。', exitCode: compile.exitCode, signal: compile.signal, durationMs: Date.now() - started, timedOut: compile.timedOut, complexity: estimateComplexity(code) }
    }
    const result = await runProcess(program.command, program.args, stdin, timeoutMs, directory)
    return { ...result, ok: !result.timedOut && result.exitCode === 0, durationMs: Date.now() - started, complexity: estimateComplexity(code) }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
