import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// PDF.js 的 worker 不能用 Windows 绝对路径直接交给 ESM loader；必须转成 file:// URL。
// 打包后 worker 由 extraResources 放到 resources/pdf.worker.mjs，避免 asar 内 ESM 解析问题。
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const devWorker = path.join(__dirname, '..', '..', '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
const packagedWorker = path.join(process.resourcesPath, 'pdf.worker.mjs')
const workerPath = app.isPackaged && existsSync(packagedWorker) ? packagedWorker : devWorker
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

export async function parsePdf(filePath: string): Promise<string> {
  const fs = await import('node:fs')
  const data = new Uint8Array(fs.readFileSync(filePath))

  const doc = await pdfjsLib.getDocument({ data }).promise
  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item: any) => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) pages.push(text)
  }

  return pages.join('\n\n')
}