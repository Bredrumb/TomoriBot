---
title: "MOSS-TTS"
---

> **关于这份翻译：** 本页是英文版[MOSS-TTS](https://docs.tomoribot.app/en/self-hosting/local-endpoints/text-to-speech/moss/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

用 `servers/tts/moss/server.py` 可以通过同一个本地端点试用 MOSS 的语音克隆与文字描述的语音设计。自动模式会在 TomoriBot 发送 `ref_audio` 时选择克隆模型，在发送 `instruct` 时选择 MOSS-VoiceGenerator。它一次只加载一个模型。这是一个试用性质的边车服务，不是流式的 Discord 语音聊天集成。

默认的克隆模型是 [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5)（4B），选它是因为它是 16 GB GPU 上比较实际的起点。[MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) 是 8B 的替代方案，但在 BF16 下通常需要超过 16 GB 的显存。语音设计使用 [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)（约 1.7B）。自动模式会切换模型，而不是把两个模型都留在显存里，所以模式切换仍然会有一次 GPU 加载延迟。

## 设置

请在 TomoriBot 仓库根目录运行。请使用 Python 3.12，以及能与上游 CUDA 12.8 的 PyTorch wheel 兼容的 CUDA 驱动。上游的运行时 extra 会固定 PyTorch 与 Torchaudio 2.9.1+cu128；请把这个边车服务放在它自己的虚拟环境里。其他 CUDA 或 CPU 组合需要单独验证过的安装方式。

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

prefetch 命令会在服务器启动之前，把克隆模型、VoiceGenerator 以及每个模型各自的音频分词器下载到 Hugging Face 缓存里。它在下载每个仓库之前都会检查缓存卷的可用磁盘空间，并复用已缓存的文件，但这两个模型都需要相当大的空间。如果检查未通过，请腾出空间，或者在预取和启动服务器之前，在 shell 中把 `HF_HOME` 指向更大的卷。更改任何一个模型 ID 之后，请重新运行 prefetch。若只想为有限的试用下载一种模式，请传入 `--mode clone` 或 `--mode voice-design`；另一种模式在首次使用时仍然可能被下载。

端点是 `http://127.0.0.1:8018`。自动模式会在报告启动完成之前，从本地缓存预热克隆模型。如果没有预先拉取克隆模型，启动会失败，而不是意外去下载它。`MOSS_TTS_WARM_MODE=voice-design` 会改为预热 VoiceGenerator；`MOSS_TTS_WARM_MODE=none` 会保持之前的惰性启动行为。只有一种模式会留在 GPU 内存中。请检查 `GET /health` 查看 `warm_mode`、`active_mode` 和 `model_id`。封装程序使用 Hugging Face 的 `trust_remote_code=True`，所以请只从你信任的来源安装，并在更新之前审阅上游的改动。

## 在 TomoriBot 中注册

在 `/providers` 中选择**添加新自定义端点**，把 API 兼容性设为 `tts-clone`，并使用端点 URL `http://127.0.0.1:8018`。添加一个语音合成模型，把**语音来源模式**设为 `Auto`，把**脚本标记风格**设为 `Plain`。然后在 `/config` > 模型 > 切换模型 下激活它。

要做克隆，请在 `/config` > 模型 > TTS 参数与语音 下上传一段干净的参考音频，并在人格 > 语音 下指定它。要做语音设计，请在人格 > 语音 下改为保存一段自然语言的语音描述。MOSS-TTS 使用音频参考，不使用 TomoriBot 的可选参考文本。MOSS-VoiceGenerator 文档只覆盖英语与中文，不包括日语。4B 克隆模型支持日语，但带上已知的语言标记可以改善多语言合成。

TomoriBot 当前的克隆适配器不发送语言标记。如果要针对单一语言试用，请在启动服务器之前设置 `MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（或 `English`、`Chinese` 等）。手动发起 `/synthesize` 请求时，也可以改为按请求提供 `language`。混合语言使用场景请让该变量保持未设置；在依赖日语输出之前，请先评估它的效果。

边车服务读取的是它自己进程的环境变量。把值加到 bot 的 `.env` 里，并不会自动传递到单独启动的 Python 进程。

要在内存足够的机器上试用 8B 旗舰模型，请在预取之前设置 `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`。`TOMORI_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE`、`MOSS_TTS_MAX_REF_AUDIO_BYTES` 和 `MOSS_TTS_MAX_NEW_TOKENS` 也可以在 `.env.optional.example` 中配置。遇到模式切换或 CPU 推理时，bot 的 `TTS_SYNTHESIZE_TIMEOUT_MS` 可能需要调大。
