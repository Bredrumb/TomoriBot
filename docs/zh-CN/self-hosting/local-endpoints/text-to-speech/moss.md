---
title: "MOSS-TTS"
aiGenerated: true
---

使用 [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) 通过统一的语音端点在本地评估语音克隆与自然语言语音设计。

默认的 4B 克隆模型和 1.7B VoiceGenerator 会在语音模式切换时在 GPU 显存中进行互换，因此模式切换后的首次请求耗时更长。8B 克隆模型需要更多显存。

## 安装

在 TomoriBot 代码仓库根目录下使用 Python 3.12 以及兼容 CUDA 12.8 的驱动程序执行以下命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux 或 WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

在启动服务器之前，预取（prefetch）命令会将克隆模型、VoiceGenerator 和音频分词器下载到你的 Hugging Face 缓存中。如果磁盘空间受限，可将 `HF_HOME` 设置到容量更大的分区。若只需下载单一模型，可传入 `--mode clone` 或 `--mode voice-design`。

默认端点为 `http://127.0.0.1:8018`。运行 `bun run launch --moss` 可与 TomoriBot 一同启动服务器。自动模式默认从本地缓存预热克隆模型。设置 `MOSS_TTS_WARM_MODE=voice-design` 可改为预热 VoiceGenerator，设置 `MOSS_TTS_WARM_MODE=none` 则采用延迟初始化。调用 `GET /health` 可检查当前活动的 `warm_mode`、`active_mode` 和 `model_id`。包装脚本使用了 Hugging Face 的 `trust_remote_code=True`，因此在更新前请审查上游代码。

## 在 TomoriBot 中注册

在 `/providers` 中选择 `+ 添加新自定义端点`，将 API 兼容性设置为 `tts-clone`，端点 URL 填写 `http://127.0.0.1:8018`。添加一个语音模型，将“语音源模式”设为“自动”，“脚本标记”设为“纯文本”。在 `/config` > 模型 > 切换模型下激活该模型。

对于语音克隆，在 `/config` > 模型 > TTS 参数与语音下上传干净的参考音频片段，并在人格 > 语音下分配该音频。较短且干净的音频片段能产生最一致的效果。对于语音设计，在人格 > 语音下保存自然语言描述。注意 MOSS-VoiceGenerator 专为英语和中文设计。虽然 4B 克隆模型支持日语，但显式指定语言标签可以改善合成清晰度。

TomoriBot 的克隆适配器不会自动发送语言标签。对于单一语言环境，请在启动服务器前设置 `MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（或 `English`、`Chinese` 等）。手动的 `/synthesize` 调用可以直接传递 `language`。

服务器仅读取其自身所在的 shell 环境变量；bot 的 `.env` 中的设置不会自动应用到独立启动的 Python 终端。

若要在具备更大显存的硬件上运行 8B 模型，请在执行预取前设置 `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE` 和 `MOSS_TTS_MAX_NEW_TOKENS` 均可在 `.env.optional.example` 中找到并配置。如果模型互换或 CPU 执行导致超时，请调大 TomoriBot 中的 `TTS_SYNTHESIZE_TIMEOUT_MS`。
