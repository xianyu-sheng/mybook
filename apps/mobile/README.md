# Mybook Mobile (Android)

离线优先的 Mybook 安卓客户端。当前 Phase 0 聚焦：

- 知识卡片：本地保存、AI 生成、Markdown/代码查看
- 知识问答：基于本机卡片回答，会话保存在手机
- 文字模拟面试：一题一轮，评分、点评、参考答案和下一题
- 与电脑通过 **USB 网络共享** 直连同步：卡片、问答、模拟面试、AI 供应商配置

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

1. 电脑端 Mybook → 设置 → 手机同步 → 开启同步
2. 电脑端会显示本机地址（例如 `http://192.168.42.1:47821`）和配对码
3. 手机开启「USB 网络共享」，用数据线连接电脑
4. 手机 Mybook → 设置 → 与电脑同步，填写地址和配对码
5. 先「测试连接」，再「立即同步」

数据包使用配对码派生的 AES-256-GCM 加密；电脑端本地 HTTP 服务只做数据线两端之间的同步，不连接第三方服务器。

当前同步不处理删除墓碑：手机本地删除卡片不会传播到电脑，电脑删除也不会传播到手机。后续版本补。
