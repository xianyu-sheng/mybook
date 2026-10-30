import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from './mobile-sync-address.js'

describe('mobile sync address policy', () => {
  it('accepts loopback and private IPv4 ranges', () => {
    for (const address of ['127.0.0.1', '10.0.0.8', '10.239.137.51', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.10.2']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('accepts IPv6 loopback and link-local/private prefixes', () => {
    for (const address of ['::1', 'fe80::1', 'fd12:3456::1', 'fc00::1']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('accepts IPv4-mapped private addresses', () => {
    expect(isPrivateAddress('::ffff:192.168.1.10')).toBe(true)
    expect(isPrivateAddress('::ffff:10.239.137.51')).toBe(true)
  })

  it('rejects public IPv4 addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.1.1', '100.64.0.1']) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })

  it('rejects empty and malformed addresses', () => {
    for (const address of ['', 'not-an-ip', '10.0.0', '10.0.0.999']) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })
})
