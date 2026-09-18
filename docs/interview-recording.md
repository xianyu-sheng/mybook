# Mybook 面试录音与复盘

## 使用

1. 左侧进入「面试录音」，填写名称、企业、岗位、JD 和标签，关联包含项目文档的笔记本。
2. 选择麦克风和「系统声音 / 耳机输出」。戴耳机时选择该耳机对应的输出设备；更换设备后刷新列表。可单独录一路，也可导入已有音频。
3. 点击「开始录音」，结束后「停止并保存」。在其他页面也能看到录音状态和停止按钮。
4. 点击「本地转写」。首次使用需安装转写引擎并下载 Whisper small（模型约 500 MB）。支持中文、英语、自动识别。
5. 试听并校对文字和说话人。编辑草稿可跨页面、跨录音暂存，保存后更新检索索引。重新转写成功会替换校对文本并清除旧复盘，操作前可导出 Markdown。
6. 点击「AI 面试复盘」。模型结合企业/JD、关联项目和全局知识，给出实际回答、评分、缺陷、参考答案和追问题；点击引用时间回听，答案可折叠。
   每题的「本题检索参考资料」保留资料标题与来源编号，导出 Markdown 时一并保留，方便核对参考答案。
7. 默认勾选「参与所有笔记本的知识检索」。转写与复盘自动进入全局索引，之后的问答可引用；取消勾选后不参与检索，仍可在全局录音页管理。
8. 对需要重答的题目点击「加入专项练习」，保留本次复盘的题目与参考，之后独立作答并逐项比较。

## 保存方式

- 原音频在本地用户配置的 `recordings/<录音 ID>/` 中。Linux 每路为独立 16 kHz 单声道 FLAC，Windows 原生助手保存为独立 16 kHz 单声道 WAV；同目录自动保存 `interview.md`。
- 转写、评分、标签和全文索引也保存在本地 SQLite 数据库。删除录音会清理音频、文档和索引；归档关联笔记本会保留内容与录音关联，可以恢复。已加入专项练习的题目保留独立快照。
- 转写在本机运行。点击 AI 复盘时，转写文本与检索到的资料会发送给所配置的模型服务。
- 模型失败通过现有模型目录自动切换，取消或失败保留原音频及已保存的文档。修改原文或企业/JD/关联项目后，旧评分会被清除，需重新复盘。
- 意外退出后会尝试恢复已录到的音频；修复损坏的 FLAC/WAV 时保留同格式的 `.interrupted-*` 原件。再次打开相同资料库会聚焦已有窗口。
- 校对保存期间暂停编辑；若切页后又有新草稿，较早请求完成时不会清除它。草稿本地空间不足会持续提示，此时请保存后再退出。

## 实现选择与依据

- [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)：本地 CPU int8 转写，使用其 Whisper small 多语言模型。
- [NAudio](https://github.com/naudio/NAudio)：Windows 原生 `WasapiCapture` 与 `WasapiLoopbackCapture`，由随安装器携带的 .NET helper 负责麦克风和耳机输出采集。
- [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)：调研过的本地转写替代方案，本版本未集成。
- [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily)：调研录音/转写工作流；未复制整个应用。Linux 音频问题参考 [#273](https://github.com/Zackriya-Solutions/meetily/issues/273) 和 [#701](https://github.com/Zackriya-Solutions/meetily/issues/701)。
- FFmpeg 的 [PulseAudio](https://ffmpeg.org/ffmpeg-devices.html#pulse) 输入设备：Linux 读取 PulseAudio/PipeWire 输入和输出监视器，使用发行版 FFmpeg，因为通用静态构建不包含 PulseAudio 输入设备。Windows 的实时采集由 NAudio/WASAPI helper 完成，随包附带的静态 FFmpeg 只用于导入音频和格式探测。

## 当前边界

- 原生双轨录音支持 Linux 和 Windows。Linux 设备枚举依赖 `pactl`、系统 FFmpeg 与正在运行的 PipeWire/PulseAudio；Windows 使用发布包内置的 .NET/NAudio helper 和 WASAPI。macOS 当前可导入已有录音，原生捕获尚未实现。
- Windows 首次录音需要在「设置 → 隐私和安全性 → 麦克风」允许 Mybook（或桌面应用）访问麦克风；系统声音通过输出回环捕获，不需要关闭耳机。若耳机刚刚插拔，请刷新设备列表并重新选择它。
- 「本人/对方」是按麦克风/系统音轨给的默认标签，不是声纹识别；多人或导入的混合音频需要校对说话人。
- AI 评分和参考答案需要结合原始项目资料核实，不代表企业正式评价。
- 测试使用隔离配置和虚拟音频设备，验证双轨信号、设备参数与停止恢复；发布流水线会编译 Windows helper 并检查其随安装器打包。实体耳机通话和数小时连续录音仍需要在目标设备上验收。
