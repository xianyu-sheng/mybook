# Mybook Windows 音频助手

这个目录是供 Windows 打包使用的独立 .NET 8 helper。它使用 NAudio 2.2.1 的 `WasapiCapture` 录制活动麦克风端点，使用 `WasapiLoopbackCapture` 录制活动播放端点（包含耳机输出）。它不调用 shell、不联网，也不依赖 FFmpeg。

## 构建

Windows 开发机安装 .NET 8 SDK 后，从 `apps/desktop` 执行：

```powershell
npm run build:platform
```

也可以在本目录直接构建：

```powershell
dotnet publish -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true -o publish
```

产物位于 `apps/desktop/native/windows-audio/publish/mybook-windows-audio.exe`，Electron 打包时复制到 `resources/windows-audio/mybook-windows-audio.exe`。本目录不把构建结果提交进仓库。

## 协议

stdout 和 stderr 使用 UTF-8。`list` 输出一行 JSON，然后退出：

```json
{"devices":[{"name":"设备唯一 ID","label":"设备名称","monitor":false,"isDefault":true,"muted":false}]}
```

设备来自 Windows 的 active capture/render endpoints。`monitor=false` 是麦克风，`monitor=true` 是播放端点，后者通过 WASAPI loopback 录制，即使使用耳机也能捕获对方声音。`name` 使用 MMDevice 的稳定 ID；`default` 也可作为输入 ID，让 Windows 在启动时选择当前默认端点。

调用：

```powershell
.\mybook-windows-audio.exe capture --inputs '[{"source":"设备唯一 ID","kind":"microphone","file":"C:\\Temp\\mic.wav"},{"source":"播放端点 ID","kind":"system","file":"C:\\Temp\\system.wav"}]'
```

所有输入成功进入 `CaptureState.Capturing` 后，stdout 输出单独一行 `ready` 并刷新。之后 stdin 收到 `q`/`Q` 或 EOF 时停止；其他字节会忽略。成功关闭全部 WAV 后以退出码 0 退出；设备不存在、格式非法、无法启动或任一路运行时错误会写 stderr、停止全部输入并以退出码 1 退出。参数/JSON 错误以退出码 2 退出。

每路输出都是 16 kHz、16-bit、单声道 PCM WAV，调用者负责提供不同的绝对 `.wav` 路径。文件父目录不存在时 helper 会创建。

## 静音与时间轴

WASAPI loopback 在完全静音时可能不产生 `DataAvailable` 事件。helper 为每路使用同一个启动后的 `Stopwatch`，每个数据块按其墙钟结束时间写入；回调之间缺少的帧用零填充，停止时补到共同的墙钟长度。因此系统音轨在静音期间仍与麦克风音轨保持合理的绝对时间轴，不会因为无回调而被压缩到文件开头。这里是按墙钟的容错对齐，不能恢复静音时本来不存在的音频内容。

当前 Linux 开发环境没有 .NET SDK/Windows 音频设备，无法执行 `dotnet publish` 或 WASAPI 实机录音。Windows CI 应至少验证 `list`、麦克风+耳机双路、完全静音区间的 WAV 时长、q/EOF 停止、拔出任一路时整体失败及权限错误。

启动与停止共用生命周期锁，全部输入完成启动登记前不会提前完成会话。任一路停止或写入失败都会请求其余输入停止，回调异常会转为失败退出；退出时先等待采集线程停止，再关闭 WAV writer 和设备。无真实设备的 CI 可以验证编译、参数校验、无设备时的 `list` 和打包资源；双路、静音时间轴、设备断连及磁盘写入失败仍需 Windows 实机验证。
