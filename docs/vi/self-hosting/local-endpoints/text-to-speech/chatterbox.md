---
title: "Chatterbox TTS"
aiGenerated: true
---

Nhân bản giọng nói tiếng Anh với các tag cảm xúc bằng cách sử dụng máy chủ text-to-speech cục bộ [Chatterbox](https://github.com/resemble-ai/chatterbox).

Chatterbox chạy cục bộ qua `servers/tts/chatterbox/server.py`. Nó mặc định dùng model Chatterbox-Turbo nhanh (350M tham số) với các tag sự kiện cảm xúc nội tuyến như `[laugh]` và `[sigh]`. Bạn cũng có thể cấu hình model Chatterbox-Nano nhẹ (110M tham số) cho các cấu hình CPU hoặc model tiêu chuẩn 0.5B để tinh chỉnh classifier-free guidance (`cfg_weight`) và `exaggeration` cảm xúc. Wrapper này không tải Chatterbox Multilingual V3.

## Cài đặt

Chạy các lệnh này từ thư mục gốc repo TomoriBot, thư mục nơi bạn đã clone TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Giữ terminal đó mở trong khi TomoriBot đang sử dụng Chatterbox. URL endpoint mặc định là `http://127.0.0.1:8011`; đặt `CHATTERBOX_PORT` để sử dụng cổng khác.

### Tùy chọn: sử dụng Chatterbox-Nano

Nano yêu cầu bản dựng Chatterbox với tùy chọn loader `nano=True`. Sau quá trình thiết lập thông thường ở trên, hãy cài đặt revision upstream đã ghim trong cùng môi trường ảo. Commit hash cố định phiên bản nguồn tương thích; đây không phải là một đảm bảo bảo mật. Lệnh này yêu cầu `git` và giữ lại các phần phụ thuộc runtime đã được cài đặt:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Sau đó đặt `CHATTERBOX_FAST_MODEL=nano` trước khi khởi động wrapper. Để trống biến này cho Turbo. Trên Windows PowerShell, đặt bằng `$env:CHATTERBOX_FAST_MODEL = "nano"`; trên Linux hoặc macOS, sử dụng `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. Phản hồi `/health` báo cáo `fast_model` để bạn có thể xác minh lựa chọn đã tải. Nano và Turbo sử dụng cùng yêu cầu nhân bản và các tag sự kiện được hỗ trợ. Cả hai đều chỉ hỗ trợ tiếng Anh.

Nút bật tắt fast-model trong `/config` phải luôn được bật để sử dụng Nano hoặc Turbo. Việc tắt nút này sẽ chọn model Chatterbox 0.5B tiêu chuẩn để tinh chỉnh trọng số CFG và độ phóng đại cảm xúc.

### Chatterbox tiêu chuẩn

Để sử dụng model Tiêu chuẩn, hãy tắt `Fast Model (Turbo)` trong `/config` > Models > TTS Parameters & Voices. Model tiêu chuẩn hỗ trợ tinh chỉnh `cfg_weight` và `exaggeration`, nhưng không hỗ trợ các tag sự kiện trong ngoặc vuông.

## Đăng ký trong TomoriBot

Bao gồm `Chatterbox` trong nhãn endpoint hoặc tên model. TomoriBot chỉ nhận diện endpoint Chatterbox qua tên đó (hoặc URL endpoint chứa tên đó), vì vậy danh sách cho phép tag Turbo, việc loại bỏ tag của model tiêu chuẩn và các tùy chọn Chatterbox trong `/generate voice-message` chỉ áp dụng khi có tên này.

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng API Compatibility cho giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Sau khi lưu kết nối, chọn kết nối đó và chọn `+ Add new Speech Model` từ dropdown model. Chọn `Voice Clone` làm `Voice Source Mode` và `Bracket Tags` làm `Script Markup Style` để các delivery tag không bị mất khi gửi.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói persona

1. Chuẩn bị một clip thoại rõ ràng dài 10 giây với một giọng nói và không có nhạc nền.
2. Mở `/config` trong Models > TTS Parameters & Voices và tải clip lên.
3. Mở `/config` trong Persona > Voice, sau đó chọn persona và mẫu giọng nói.

Chatterbox yêu cầu âm thanh dài hơn 5 giây. Hãy hướng tới 10 giây; model sử dụng một phần giới hạn của các clip dài hơn để làm điều kiện tạo âm thanh.

## Tinh chỉnh tùy chọn

Trong `/config` > Models > TTS Parameters & Voices, điều chỉnh `cfg_weight` và `exaggeration` cho model Tiêu chuẩn. Cả hai đều mặc định là `0.5`; giá trị cao hơn tương ứng sẽ bám sát giọng tham chiếu hơn và tăng độ biểu cảm.

Các tag sự kiện Turbo/Nano được hỗ trợ là `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` và `[laugh]`. Các mô tả không được hỗ trợ như `[excited]`, `[whisper]` hoặc `[smiles]` sẽ bị loại bỏ thay vì được gửi tới TTS.
