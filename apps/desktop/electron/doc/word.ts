import mammoth from 'mammoth'

export async function parseWord(filePath: string): Promise<string> {
  const fs = await import('node:fs')
  const buffer = fs.promises.readFile(filePath)
  const result = await mammoth.extractRawText({ buffer: await buffer })
  return result.value
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}