/**
 * 简易文本分块器
 * 基于段落 + token 窗口，默认 512 tokens/块
 */
export interface ChunkInput {
  content: string
  chunkIndex: number
}

export function chunkText(
  text: string,
  maxTokens: number = 512,
  overlapTokens: number = 50
): ChunkInput[] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0)
  const chunks: ChunkInput[] = []
  let current: string[] = []
  let currentTokens = 0
  let index = 0

  for (const p of paragraphs) {
    const pt = estimateTokens(p)

    // 超大段落：如果单个段落本身就超过 maxTokens，强制拆分为独立块
    if (pt > maxTokens && current.length > 0) {
      chunks.push({ content: current.join('\n\n'), chunkIndex: index++ })
      current = []
      currentTokens = 0
    }

    if (pt > maxTokens) {
      // 对超大段落按句子切分
      const subChunks = splitLongParagraph(p, maxTokens)
      for (const sc of subChunks) {
        chunks.push({ content: sc, chunkIndex: index++ })
      }
      // 上一个子块作为重叠上下文
      const last = subChunks[subChunks.length - 1] || ''
      current = last ? [last] : []
      currentTokens = estimateTokens(last)
      continue
    }

    if (currentTokens + pt > maxTokens && current.length > 0) {
      chunks.push({ content: current.join('\n\n'), chunkIndex: index++ })
      // 按 token 数保留重叠部分
      let overlapAcc = 0
      const overlapSegments: string[] = []
      for (let i = current.length - 1; i >= 0; i--) {
        const seg = current[i]
        overlapSegments.unshift(seg)
        overlapAcc += estimateTokens(seg)
        if (overlapAcc >= overlapTokens) break
      }
      current = overlapSegments
      currentTokens = overlapAcc
    }
    current.push(p)
    currentTokens += pt
  }

  if (current.length > 0) {
    chunks.push({ content: current.join('\n\n'), chunkIndex: index++ })
  }

  return chunks
}

/** 把超长段落按句子拆分为小段 */
function splitLongParagraph(text: string, maxTokens: number): string[] {
  const sentences = text.split(/(?<=[。！？.!?])\s*/)
  const result: string[] = []
  let buf: string[] = []
  let bufTokens = 0

  for (const s of sentences) {
    const st = estimateTokens(s)
    if (bufTokens + st > maxTokens && buf.length > 0) {
      result.push(buf.join(''))
      buf = []
      bufTokens = 0
    }
    buf.push(s)
    bufTokens += st
  }

  if (buf.length > 0) result.push(buf.join(''))
  return result.length > 0 ? result : [text]
}

/**
 * Token 估算：
 * - 中文字符（含 CJK 统一汉字全范围、全角标点）：2 token
 * - 空格/换行：0
 * - 英文/数字/半角标点：0.3 token
 */
function estimateTokens(text: string): number {
  let tokens = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) || 0
    if (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK 统一汉字
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK 扩展 A
      (cp >= 0x20000 && cp <= 0x2A6DF) || // CJK 扩展 B
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK 兼容汉字
      (cp >= 0x3000 && cp <= 0x303F) ||   // CJK 符号和标点
      (cp >= 0xFF00 && cp <= 0xFFEF)      // 全角标点
    ) {
      tokens += 2
    } else if (/[\s\n\r\t]/.test(ch)) {
      tokens += 0
    } else {
      tokens += 0.3
    }
  }
  return Math.max(1, Math.ceil(tokens))
}