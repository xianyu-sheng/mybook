/** 只允许局域网/回环地址访问同步服务，避免电脑接入公共网络时暴露。 */
export function isPrivateAddress(address: string): boolean {
  const value = (address || '').replace(/^::ffff:/i, '')
  if (!value) return false
  if (value === '::1' || value === '127.0.0.1') return true
  if (value.includes(':')) {
    return /^fe[89ab][0-9a-f]:/i.test(value) || /^f[cd][0-9a-f]{2}:/i.test(value)
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (parts[0] === 127 || parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return parts[0] === 169 && parts[1] === 254
}
