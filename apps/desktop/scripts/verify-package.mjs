import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
const { listPackage } = builderRequire('@electron/asar')
const platform = process.argv[2] || process.platform
assert.ok(['linux', 'win32'].includes(platform), 'Expected linux or win32')
const resources = fileURLToPath(new URL(`../release/${platform === 'win32' ? 'win' : 'linux'}-unpacked/resources/`, import.meta.url))
const files = listPackage(path.join(resources, 'app.asar')).map(file => file.replaceAll('\\', '/'))
const allowedRoots = new Set(['assets', 'dist', 'node_modules', 'package.json', 'index.html'])
const unexpected = files.filter(file => !allowedRoots.has(file.split('/')[1]))
assert.deepEqual(unexpected, [], 'The archive contains files outside the application allowlist')

const applicationFiles = files.filter(file => !file.startsWith('/node_modules/'))
const forbidden = applicationFiles.filter(file => /(?:\.(?:db(?:-wal|-shm)?|sqlite3?|wav|flac|mp3|m4a|pdf|docx)$|\.test\.|\/(?:recordings|data|repository-cache|\.env|test-utils)(?:\/|$))/.test(file))
assert.deepEqual(forbidden, [], 'The archive contains private data or development fixtures')
for (const file of ['/dist/electron/main.js', '/dist/electron/preload.cjs', '/dist/renderer/index.html', '/assets/icon.png']) {
  assert.ok(files.includes(file), `Missing application file: ${file}`)
}
const required = ['speech/transcribe.py']
if (platform === 'win32') {
  required.push('windows-audio/mybook-windows-audio.exe',
    'app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe',
    'app.asar.unpacked/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe')
} else {
  assert.ok(!files.some(file => /^\/node_modules\/ff(?:mpeg|probe)-static(?:\/|$)/.test(file)), 'Linux requires system FFmpeg with PulseAudio support')
}
for (const file of required) assert.ok(existsSync(path.join(resources, file)), `Missing packaged resource: ${file}`)
console.log(JSON.stringify({ platform, archiveEntries: files.length, allowedRoots: [...allowedRoots], requiredResources: required, result: 'passed' }))
