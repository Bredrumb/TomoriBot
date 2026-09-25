---
title: "Phiên âm WhisperX"
sidebar:
  order: 1
---

WhisperX là giải pháp phiên âm cục bộ được khuyến nghị và thân thiện với người mới bắt đầu.

## Cài đặt

Chạy các lệnh này từ thư mục gốc của kho lưu trữ TomoriBot, thư mục nơi bạn đã sao chép TomoriBot. Lệnh đầu tiên chuyển vào thư mục máy chủ STT:

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

Giữ cửa sổ terminal đó mở trong khi TomoriBot đang sử dụng WhisperX. URL endpoint mặc định là `http://127.0.0.1:8021`.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm `large-v3`, hoặc
bất kỳ giá trị nào mà `WHISPERX_MODEL` được thiết lập, làm model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản phiên âm

Sau khi đăng ký, TomoriBot sẽ phiên âm các tệp âm thanh đính kèm trong nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Engine > Notices nếu bạn cũng muốn các bản phiên âm được gửi hiển thị rõ ràng trong đoạn chat.
