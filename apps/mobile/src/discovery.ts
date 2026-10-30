import { Capacitor, registerPlugin } from '@capacitor/core'
import type { DiscoveredDevice } from './types'

interface MobileSyncDiscoveryPlugin {
  discover(): Promise<{ devices: DiscoveredDevice[] }>
}

const MobileSyncDiscovery = registerPlugin<MobileSyncDiscoveryPlugin>('MobileSyncDiscovery')

/**
 * 只在手机 App 内可用。通过原生 UDP 插件扫描同一 Wi-Fi / 热点 / USB 网络共享
 * 里的电脑，返回电脑端广播的地址。配对码不参与发现，仍然需要手动输入。
 */
export async function discoverComputers(): Promise<DiscoveredDevice[]> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('自动发现仅支持手机 App，请手动填写电脑地址')
  }
  try {
    const result = await MobileSyncDiscovery.discover()
    return Array.isArray(result?.devices) ? result.devices : []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('not implemented') || message.includes('not available')) {
      throw new Error('当前手机端版本不支持自动发现，请安装最新版 APK')
    }
    throw new Error(message || '局域网扫描失败')
  }
}
