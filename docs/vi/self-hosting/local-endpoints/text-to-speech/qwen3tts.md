---
title: "Qwen3-TTS"
aiGenerated: true
---

Tổng hợp giọng nói nhân vật đa ngôn ngữ có độ chính xác cao bằng cách sử dụng [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) ở cả hai chế độ nhân bản giọng nói và VoiceDesign được mô tả bằng văn bản.

Qwen3-TTS 12Hz 1.7B cung cấp khả năng tổng hợp giọng nói cục bộ có độ chính xác cao. Việc chạy `servers/tts/qwen3tts/server.py` ở chế độ auto mặc định sẽ tự động chọn model nhân bản Base hoặc model VoiceDesign dựa trên từng yêu cầu đến.

## Cài đặt

Chạy các lệnh này từ thư mục gốc của repo TomoriBot, thư mục nơi bạn đã clone TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux và macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

URL endpoint mặc định của chế độ auto là `http://127.0.0.1:8012`; đặt `QWEN3TTS_PORT` để sử dụng cổng khác. Bạn cũng có thể chỉ định rõ chế độ auto:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

Chế độ auto kiểm tra từng yêu cầu `/synthesize`: các yêu cầu có `ref_audio` sử dụng model nhân bản, trong khi các yêu cầu có `instruct` sử dụng model VoiceDesign. Hệ thống chỉ giữ một model được nạp tại một thời điểm và hoán đổi các model khi loại yêu cầu thay đổi, do đó yêu cầu đầu tiên sau khi hoán đổi có thể chậm hơn.

## Đăng ký trong TomoriBot

Đối với hầu hết người dùng, hãy đăng ký máy chủ ở chế độ auto để một endpoint có thể hỗ trợ cả persona nhân bản giọng nói lẫn persona VoiceDesign.

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng API Compatibility cho giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Sau khi lưu kết nối, chọn kết nối đó và sử dụng dropdown model của nó để thêm một model Speech. Biểu mẫu model yêu cầu `Voice Source Mode` và `Script Markup`; hãy chọn `Auto` và `Plain` cho máy chủ ở chế độ auto.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói persona

### Nhân bản giọng nói

Sử dụng tùy chọn này cho các persona cần mô phỏng một clip tham chiếu:

1. Chuẩn bị một clip thoại rõ ràng dài 10-20 giây với một giọng nói và không có nhạc nền.
2. Mở `/config` trong Models > TTS Parameters & Voices và tải clip lên.
3. Mở `/config` trong Persona > Voice, sau đó chọn persona và mẫu giọng nói.

Qwen3-TTS hỗ trợ các clip tham chiếu ngắn chỉ từ 3 giây.

### VoiceDesign

Sử dụng tùy chọn này cho các persona cần sử dụng mô tả giọng nói bằng văn bản thay vì một mẫu âm thanh:

1. Mở `/config` trong Persona > Voice và chọn VoiceDesign.
2. Chọn persona.
3. Nhập prompt giọng nói bằng ngôn ngữ tự nhiên, chẳng hạn như độ tuổi của người nói, tông giọng, accent và cách truyền đạt.

## Tùy chọn: Máy chủ chỉ dành cho VoiceDesign

Khởi động cùng một máy chủ ở chế độ VoiceDesign khi phục vụ `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

Windows PowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

Bạn cũng có thể truyền `--mode voice-design` thay vì đặt `TOMORI_TTS_MODE`. URL endpoint chỉ dành cho VoiceDesign mặc định là `http://127.0.0.1:8014`.

Đăng ký theo cách tương tự như chế độ auto, nhưng sử dụng URL endpoint `http://127.0.0.1:8014` và chọn `VoiceDesign` làm Voice Source Mode trên model Speech.
