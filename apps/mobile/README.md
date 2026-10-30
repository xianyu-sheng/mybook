# Mybook Mobile (Android)

离线优先的 Mybook 安卓客户端。当前 Phase 0 聚焦：

- 知识卡片：本地保存、AI 生成、Markdown/代码查看
- 知识问答：基于本机卡片和同步到手机的资料片段回答，会话保存在手机
- 资料：只读查看电脑同步下来的笔记本资料、全局知识库文档，支持按标题/正文搜索
- 文字模拟面试：一题一轮，评分、点评、参考答案和下一题
- 与电脑通过**同一 Wi-Fi / 手机热点自动发现**同步；也支持 USB 网络共享：卡片、问答、模拟面试、笔记本资料、全局知识库、AI 供应商配置

不经过云端中转；AI 请求由手机直连用户配置的供应商。面试录音、代码运行、本地 Whisper 暂不在 Phase 0。

## 开发

```bash
cd apps/mobile
npm install
npm run build
npm run dev        # 浏览器预览
```

移动端本地数据库使用 sql.js（SQLite WASM）+ IndexedDB，因此不需要额外的 SQLite 原生插件。

## Android 构建

需要 JDK 17 与 Android SDK（platform 34 / build-tools 34.0.0）。

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

APK 输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

这是通用 Android APK，不依赖 vivo 或某个厂商；安装时需要允许「安装未知来源应用」。正式分发前应替换为自己的 release keystore 并重新签名。

## 与电脑同步

推荐同一 Wi-Fi / 手机热点：

1. 电脑端 Mybook → 设置 → 手机同步 → 开启同步
2. 手机和电脑连同一个 Wi-Fi，或电脑连手机热点
3. 手机 Mybook → 设置 → 与电脑同步，点「扫描电脑」
4. 点选列出的电脑，填入电脑端显示的配对码
5. 先「测试连接」，再「立即同步」

电脑端在 UDP `47822` 上响应局域网发现请求，手机端通过原生 UDP 插件发送 discover 包并接收 announce。发现结果只包含电脑名称、同步端口和设备指纹，**不会广播配对码**。

USB 网络共享仍可用：手机开启 USB 网络共享后，可以手动填写电脑端地址，或再次点「扫描电脑」。如果扫描不到，确认电脑防火墙允许专用网络访问 UDP 47822/TCP 47821，并关闭手机 VPN。

数据包使用配对码派生的 AES-256-GCM 加密；电脑端只允许局域网/回环地址访问，并对配对失败做限流。

当前同步不处理删除墓碑：手机本地删除卡片不会传播到电脑，电脑删除也不会传播到手机。后续版本补。
