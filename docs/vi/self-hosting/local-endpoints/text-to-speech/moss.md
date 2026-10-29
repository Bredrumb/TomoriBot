---
title: "MOSS-TTS"
aiGenerated: true
---

Đánh giá tính năng nhân bản giọng nói và thiết kế giọng nói bằng ngôn ngữ tự nhiên tại cục bộ thông qua một endpoint giọng nói thống nhất bằng cách sử dụng [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

Model nhân bản 4B mặc định và VoiceGenerator 1.7B sẽ hoán đổi trong bộ nhớ GPU khi chế độ giọng nói thay đổi, vì vậy yêu cầu đầu tiên sau khi chuyển đổi sẽ mất nhiều thời gian hơn. Model nhân bản 8B yêu cầu nhiều VRAM hơn.

## Cài đặt

Chạy các lệnh từ thư mục gốc của repository TomoriBot bằng Python 3.12 và driver tương thích với CUDA 12.8:

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

### Linux hoặc WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

Lệnh prefetch sẽ tải xuống model nhân bản, VoiceGenerator và các audio tokenizer vào cache Hugging Face của bạn trước khi khởi động máy chủ. Nếu dung lượng ổ đĩa bị hạn chế, hãy đặt `HF_HOME` sang một phân vùng lớn hơn. Để chỉ tải xuống một model, hãy truyền `--mode clone` hoặc `--mode voice-design`.

Endpoint mặc định là `http://127.0.0.1:8018`. Chạy `bun run launch --moss` để khởi chạy máy chủ cùng với TomoriBot. Chế độ Auto sẽ làm ấm trước model nhân bản từ cache cục bộ. Đặt `MOSS_TTS_WARM_MODE=voice-design` để làm ấm trước VoiceGenerator, hoặc `MOSS_TTS_WARM_MODE=none` để khởi tạo lười (lazy initialization). Kiểm tra `GET /health` để xem `warm_mode`, `active_mode` và `model_id` đang hoạt động. Wrapper sử dụng `trust_remote_code=True` của Hugging Face, vì vậy hãy kiểm tra code upstream trước khi cập nhật.

## Đăng ký trong TomoriBot

Trong `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, đặt API Compatibility thành `tts-clone` và sử dụng URL endpoint `http://127.0.0.1:8018`. Thêm một model Speech với `Voice Source Mode` đặt thành `Auto` và `Script Markup` đặt thành `Plain`. Kích hoạt model này trong `/config` > Models > Switch Models.

Đối với nhân bản giọng nói, hãy tải lên một clip tham chiếu rõ ràng trong `/config` > Models > TTS Parameters & Voices và gán nó trong Persona > Voice. Các đoạn âm thanh ngắn, sạch sẽ mang lại kết quả nhất quán nhất. Đối với thiết kế giọng nói, hãy lưu mô tả bằng ngôn ngữ tự nhiên trong Persona > Voice. Lưu ý rằng MOSS-VoiceGenerator được thiết kế cho tiếng Anh và tiếng Trung. Mặc dù model nhân bản 4B hỗ trợ tiếng Nhật, các tag ngôn ngữ rõ ràng sẽ cải thiện độ rõ nét của quá trình tổng hợp.

Adapter nhân bản của TomoriBot không tự động gửi tag ngôn ngữ. Để sử dụng một ngôn ngữ duy nhất, hãy đặt `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (hoặc `English`, `Chinese`, v.v.) trước khi khởi động máy chủ. Các lệnh gọi `/synthesize` thủ công có thể truyền trực tiếp `language`.

Máy chủ đọc môi trường shell của chính nó; các cài đặt trong `.env` của bot không áp dụng cho terminal Python được khởi động độc lập.

Để chạy model 8B trên phần cứng có bộ nhớ cao, hãy đặt `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` trước khi prefetch. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` và `MOSS_TTS_MAX_NEW_TOKENS` có thể được cấu hình trong `.env.optional.example`. Tăng `TTS_SYNTHESIZE_TIMEOUT_MS` trong TomoriBot nếu việc hoán đổi model hoặc thực thi trên CPU gây ra timeout.
