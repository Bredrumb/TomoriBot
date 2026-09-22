---
title: "Qwen3-TTS"
---

Sử dụng `servers/tts/qwen3tts/server.py` cho cả hai chế độ Qwen3-TTS 12Hz 1.7B, lựa chọn TTS có kích thước lớn nhưng chính xác nhất trong số các tùy chọn hiện tại của TomoriBot. Theo mặc định, server khởi động ở chế độ tự động, tự động chọn model sao chép giọng nói Base hoặc model VoiceDesign từ cấu trúc của mỗi yêu cầu.

## Cài đặt

Chạy các lệnh này từ thư mục gốc của kho lưu trữ TomoriBot, thư mục nơi bạn đã sao chép TomoriBot:

### Sử dụng Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Sử dụng Linux/macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

URL endpoint mặc định ở chế độ tự động là `http://127.0.0.1:8012`. Bạn cũng có thể chỉ định rõ chế độ tự động:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

Chế độ tự động kiểm tra từng yêu cầu `/synthesize`: các yêu cầu có `ref_audio` sẽ sử dụng model sao chép, trong khi các yêu cầu có `instruct` sẽ sử dụng model VoiceDesign. Server chỉ giữ một model được nạp trong bộ nhớ tại một thời điểm và hoán đổi các model khi loại yêu cầu thay đổi, vì vậy yêu cầu đầu tiên sau khi hoán đổi có thể chậm hơn.

## Đăng ký trong TomoriBot

Đối với hầu hết người dùng, hãy đăng ký máy chủ ở chế độ tự động để một endpoint có thể hỗ trợ cả persona sao chép giọng nói lẫn persona VoiceDesign.

Chạy `/providers`, chọn **Add New Custom Endpoint**, và sử dụng độ tương thích API giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm một model Speech. Biểu mẫu model yêu cầu **Voice Source Mode** và **Script Markup**; hãy chọn `Auto` và `Plain` cho máy chủ ở chế độ tự động.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói persona

### Sao chép giọng nói

Sử dụng tính năng này cho các persona cần bắt chước một đoạn clip tham chiếu:

1. Chuẩn bị một đoạn clip giọng nói rõ ràng dài 10-20 giây với một người nói và không có nhạc nền.
2. Mở `/config` trong phần Models > TTS Parameters & Voices và tải clip lên.
3. Mở `/config` trong phần Persona > Voice, sau đó chọn persona và mẫu giọng nói.

Qwen3-TTS quảng cáo khả năng sao chép nhanh chỉ từ 3 giây âm thanh tham chiếu, và runtime của nó không tài liệu hóa cũng không áp đặt giới hạn thời lượng tham chiếu. Vì vậy, độ dài clip là một sự đánh đổi về chất lượng do bạn kiểm soát, chứ không phải một giới hạn mà máy chủ kiểm tra.

### VoiceDesign

Sử dụng tính năng này cho các persona cần sử dụng mô tả giọng nói bằng văn bản thay vì một mẫu âm thanh:

1. Mở `/config` trong phần Persona > Voice và chọn VoiceDesign.
2. Chọn persona.
3. Nhập prompt mô tả giọng nói bằng ngôn ngữ tự nhiên, chẳng hạn như độ tuổi, tông giọng, chất giọng địa phương, và cách truyền đạt của người nói.

Xóa prompt VoiceDesign của một persona khỏi Persona > Voice trong `/config`. Trong quá trình tạo, TomoriBot gửi prompt đã lưu trong phần thân JSON của `/synthesize` dưới dạng `instruct`; các `voice_instructions` dùng một lần từ công cụ sẽ được thêm vào.

Chế độ tự động duy trì cả hai thiết lập. Các persona được định cấu hình dưới phần Persona > Voice trong `/config` sẽ sử dụng tổng hợp sao chép hoặc tổng hợp VoiceDesign theo lựa chọn của họ.

## (Tùy chọn) Máy chủ chỉ chạy VoiceDesign

Khởi động cùng một máy chủ ở chế độ VoiceDesign khi cung cấp `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

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

Bạn cũng có thể truyền `--mode voice-design` thay vì đặt `TOMORI_TTS_MODE`. URL endpoint mặc định chỉ chạy VoiceDesign là `http://127.0.0.1:8014`.

Đăng ký máy chủ theo cách tương tự như chế độ tự động, nhưng sử dụng URL endpoint `http://127.0.0.1:8014` và chọn `VoiceDesign` làm Voice Source Mode trên model Speech.
