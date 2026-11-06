---
title: "WhisperX语音转写"
sidebar:
  order: 1
aiGenerated: true
---

使用捆绑的 [WhisperX](https://github.com/m-bain/whisperX) 服务器为TomoriBot设置本地、准确的语音到文本。WhisperX提供具有字级对齐的快速音频转录。

## 设置

从TomoriBot存储库根运行以下命令：

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

当TomoriBot使用WhisperX时，保持该终端打开。默认端点URL为`http://127.0.0.1:8021`。在 Windows 上，请使用 `127.0.0.1` 代替 `localhost`。

## 选择模型

在启动服务器之前设置 `WHISPERX_MODEL`。

| `WHISPERX_MODEL` | 大小 | 用途 |
|---|---|---|
| `large-v3` | 1.55B | 多语言准确率最高；显存占用比 turbo 多约 0.6 GiB |
| `large-v3-turbo` | 809M | 多语言，解码速度更快；日语效果略逊 |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | 仅支持日语；在日语测试音频上比 turbo 更准确，速度相同 |

在短音频上编码器占主导地位，所以三者运行速度相近。按语言和显存选择。
`small` 和 `base` 损失了太多日语准确率，因此不作推荐。在极短或接近无声的音频上，Whisper 模型仍可能会臆造文字。

## GPU

当存在可用 NVIDIA GPU 时，服务器会自动使用。检查 `http://127.0.0.1:8021/health`：`device` 应该显示为 `cuda`。在 Windows 上，语音识别需要把 CUDA 12 cuBLAS 和 cuDNN DLL 添加到你的 `PATH`。缺少它们时，服务器启动时会输出 `GPU found but unusable` 并改在 CPU 上运行，速度会慢很多：请安装好它们并重启服务器。如果你设置了 `WHISPERX_DEVICE=cuda`，服务器则会在启动时直接停止。

## 在TomoriBot中注册

运行`/providers`，选择`添加新自定义端点`，并使用语音识别专用的API兼容性：

- API兼容性：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

保存连接后，选中它，并用它的模型下拉菜单把与 `WHISPERX_MODEL` 完全一致的值（默认为 `large-v3`，或完整的仓库 ID 如 `kotoba-tech/kotoba-whisper-v2.0-faster`）添加为语音识别模型。

端点注册和模型设置都在`/providers`里做，之后打开`/config` > 模型 > `切换模型`，选中并激活已注册的端点。

## 使用成绩单

注册后，TomoriBot在后台转录音频附件并将文本添加到聊天上下文中。仅当你还希望在聊天中可见地发布文字记录时，才使用`/config` > 行为 > 提示行为。
