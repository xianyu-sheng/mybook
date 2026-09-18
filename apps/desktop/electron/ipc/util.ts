/**
 * Shared utilities — parseJson and parseSimpleArray.
 * Legacy text-only JSON compatibility helpers. Model output is never executable.
 */

export function parseJson(text: string): Array<{ title: string; brief_answer: string; detail_answer?: string; tags: string[]; sources?: string[] }> {
  if (!text || !text.trim()) {
    throw new Error('AI response was empty')
  }

  let raw = text.trim()

  // BOM
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)

  // === Layer 1: Extract JSON array ===
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    raw = codeBlockMatch[1].trim()
  }

  const firstBracket = raw.indexOf('[')
  const lastBracket = raw.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    raw = raw.substring(firstBracket, lastBracket + 1)
  }

  // Preserve punctuation and quoted examples in already-valid JSON.
  try {
    const result = JSON.parse(raw)
    if (Array.isArray(result) && result.length > 0) return result
  } catch { /* Try text-only repairs below. */ }

  // === Layer 2: Fix common JSON errors ===
  // Trailing commas
  raw = raw.replace(/,\s*\}/g, '}')
          .replace(/,\s*\]/g, ']')
  // Curly quotes to straight quotes, fullwidth comma to halfwidth
  raw = raw.replace(/“/g, '"')
          .replace(/”/g, '"')
          .replace(/‘/g, "'")
          .replace(/’/g, "'")
          .replace(/，/g, ',')

  // === Layer 3: Parse strategies ===
  const tryParse = (text: string): any[] | null => {
    try {
      const result = JSON.parse(text)
      if (Array.isArray(result) && result.length > 0) return result
    } catch { /* continue */ }
    return null
  }

  // S1: Direct parse
  let r = tryParse(raw)
  if (r) return r

  // S2: Remove trailing markdown fence
  r = tryParse(raw.replace(/```[\s\S]*$/, ''))
  if (r) return r

  // S3: Fix unquoted keys (JS object style)
  const withQuotedKeys = raw.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')
  r = tryParse(withQuotedKeys)
  if (r) return r

  // S4: Fix single quotes to double
  const singleFixed = raw.replace(/'/g, '"')
  r = tryParse(singleFixed)
  if (r) return r

  // S5: Extract individual { ... } objects
  const objects: any[] = []
  const braceRe = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g
  let m
  while ((m = braceRe.exec(raw)) !== null) {
    try {
      const obj = JSON.parse(m[0].replace(/'/g, '"'))
      if (obj.title) objects.push(obj)
    } catch { /* skip broken object */ }
  }
  if (objects.length > 0) return objects

  // S6: Fix unescaped newlines inside strings
  let fixed = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (esc) { fixed += ch; esc = false; continue }
    if (ch === '"') { inStr = !inStr; fixed += ch; continue }
    if (ch === '\\') { esc = true; fixed += ch; continue }
    if (ch === '\n' && inStr) { fixed += '\\n'; continue }
    if (ch === '\r' && inStr) { fixed += '\\r'; continue }
    if (ch === '\t' && inStr) { fixed += '\\t'; continue }
    fixed += ch
  }
  r = tryParse(fixed)
  if (r) return r

  throw new Error(`Cannot parse AI response. First 500 chars: ${raw.substring(0, 500)}`)
}

export function parseSimpleArray(text: string): string[] {
  if (!text || !text.trim()) return []

  let raw = text.trim()

  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) raw = codeBlock[1].trim()

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((x: unknown) => typeof x === 'string')
  } catch { /* ignore */ }

  const m = raw.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const parsed = JSON.parse(m[0])
      if (Array.isArray(parsed)) return parsed.filter((x: unknown) => typeof x === 'string')
    } catch { /* ignore */ }
  }

  return []
}
