import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 配置 worker 路径：编译后 pdf.js 在 dist/electron/doc/，需要向上 3 层到 apps/desktop/
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  __dirname, '..', '..', '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'
)

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