---
title: "IrodoriTTS"
aiGenerated: true
---

Tạo giọng nói tiếng Nhật tự nhiên bằng tính năng nhân bản giọng nói, VoiceDesign dựa trên chú thích (caption) và markup emoji biểu cảm bằng [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 là model text-to-speech tập trung vào tiếng Nhật, hỗ trợ cả nhân bản giọng nói và VoiceDesign được mô tả bằng văn bản trong một checkpoint duy nhất. TomoriBot kết nối với Irodori thông qua wrapper FastAPI cục bộ trong `servers/tts/irodoritts/`, mặc định sử dụng `Aratako/Irodori-TTS-v4.1-Small`.

Các checkpoint Hugging Face tương thích có thể được chọn bằng `IRODORI_TTS_MODEL_ID`, bao gồm các bản fine-tune của cộng đồng như `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Cài đặt

Irodori sử dụng `uv` để quản lý phần phụ thuộc và backend PyTorch. Máy chủ duy trì `pyproject.toml` riêng với các phần phụ thuộc Irodori và `dacvae` đã được ghim để cài đặt có thể tái lập. Hãy cài đặt `uv` trước, sau đó chạy script thiết lập từ thư mục gốc của repository TomoriBot:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

Các script thiết lập tạo `servers/tts/irodoritts/.venv`, do đó `bun run launch --irodoritts` vẫn tiếp tục hoạt động sau khi cài đặt.

Các backend khả dụng:

- `cu128`: NVIDIA CUDA 12.8 trên Windows và Linux
- `cpu`: Chỉ CPU, hoặc macOS CPU/MPS thông qua PyPI
- `rocm`: AMD ROCm trên Linux/WSL
- `xpu`: Intel XPU trên Windows và Linux

URL endpoint mặc định là `http://127.0.0.1:8013`.

## Sử dụng một checkpoint khác

Model mặc định là `Aratako/Irodori-TTS-v4.1-Small`. Bạn có thể chọn các checkpoint chính thức khác (bao gồm model Large 3.29B tham số và các biến thể lượng hóa của nó), các bản fine-tune cộng đồng hoặc các tệp checkpoint cục bộ thông qua các biến môi trường.

### Các checkpoint và biến thể

| Model / `IRODORI_TTS_MODEL_ID` | Tham số | Kích thước checkpoint | VRAM khuyến nghị | Ghi chú |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | Model mặc định: suy luận nhanh và mức sử dụng bộ nhớ thấp. |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | Model Large đầy đủ không lượng hóa với backbone văn bản T5Gemma 2. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | Trọng số FP8 với activation BF16: khuyến nghị cho NVIDIA Ada (RTX 40-series) trở lên. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | Trọng số INT8 đa dụng với tính toán BF16 trên NVIDIA CUDA. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | Biến thể Large nhỏ nhất: yêu cầu NVIDIA Ampere (RTX 30-series) trở lên. |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | Bản fine-tune cộng đồng dành cho cách phát âm phong cách anime. |

Đối với nhân bản giọng nói, Small mang lại chất lượng tương đương với tốc độ suy luận nhanh hơn. Large có bộ mã hóa văn bản mạnh hơn và bám sát các mô tả VoiceDesign hơn.

Máy chủ đọc `.env` ở thư mục gốc của repository hoặc `servers/tts/irodoritts/.env` cục bộ.

### Qua .env (bền vững)

Thêm vào `.env` trong thư mục gốc TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Qua biến môi trường cho từng phiên

Trong Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

Trên Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Sử dụng tệp checkpoint cục bộ

Nếu bạn đã tải tệp checkpoint (`.pt` hoặc `.safetensors`) về máy cục bộ, hãy đặt `IRODORI_TTS_CHECKPOINT` trỏ tới đường dẫn của tệp đó:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

Irodori hiện tại tải checkpoint cùng với bất kỳ asset tokenizer nào đi kèm trong repo Hugging Face. Các biến thể thư mục con trên Hugging Face cũng được hỗ trợ bởi `IRODORI_TTS_MODEL_ID` khi repo model cung cấp chúng.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng API Compatibility cho giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Sau khi lưu kết nối, chọn kết nối đó và sử dụng dropdown model của nó để thêm một model Speech. Đối với v4.1, các cài đặt được khuyến nghị là:

- `Voice Source Mode`: `Auto`
- `Script Markup Style`: `Emoji`

`Auto` cho phép cùng một endpoint Irodori hỗ trợ cả hai chế độ giọng nói của TomoriBot, nhờ đó các tín hiệu cảm xúc không bị mất khi gửi:

- Các persona có mẫu giọng nói được gán trong Persona > Voice sẽ gửi clip tham chiếu đã lưu để nhân bản giọng nói.
- Các persona có prompt VoiceDesign được thiết lập trong Persona > Voice sẽ gửi prompt bằng ngôn ngữ tự nhiên đã lưu làm điều kiện caption cho Irodori.

Bạn vẫn có thể chọn `Voice Clone` làm Voice Source Mode nếu chỉ muốn nhân bản giọng nói từ âm thanh tham chiếu.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói persona

### Nhân bản giọng nói

1. Chuẩn bị một clip thoại tiếng Nhật rõ ràng với một giọng nói và không có nhạc nền. Khoảng 30 giây là đã đủ: vượt qua mốc đó âm thanh bổ sung hầu như không mang lại thêm độ trung thực âm sắc mà lại tốn dung lượng tải lên và thời gian suy luận.
2. Mở `/config` trong Models > TTS Parameters & Voices và tải clip lên.
3. Mở `/config` trong Persona > Voice, sau đó chọn persona và mẫu giọng nói.

Irodori mặc định giới hạn tham chiếu 120 giây và cắt ngắn các clip dài hơn. Đặt `IRODORI_MAX_REF_SECONDS` để thay đổi giới hạn này.

### VoiceDesign

1. Mở `/config` trong Persona > Voice.
2. Chọn persona.
3. Nhập mô tả bằng ngôn ngữ tự nhiên về giọng nói và cách phát âm mong muốn.

TomoriBot gửi prompt này dưới dạng `instruct`; wrapper Irodori sẽ ánh xạ nó tới điều kiện `caption` của v4.1. Yêu cầu VoiceDesign không cần clip tham chiếu đã lưu.

TomoriBot loại bỏ cú pháp custom emoji của Discord trước khi gửi văn bản tới TTS. Với `script_markup: emoji`, emoji Unicode được giữ nguyên cho việc điều kiện hóa văn bản của Irodori.

### Điều khiển phong cách bằng emoji

IrodoriTTS hỗ trợ các chú thích emoji trong văn bản đầu vào để tác động đến hiệu ứng âm thanh, phong cách nói và biểu cảm cảm xúc. Khi `Script Markup Style` của TomoriBot được đặt thành `Emoji`, các emoji Unicode này sẽ được giữ lại và gửi tới Irodori.

Để biết các emoji được hỗ trợ và ý nghĩa của chúng, hãy xem [chú thích emoji ở upstream](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md). Emoji đóng vai trò là các tín hiệu phong cách và kết quả có thể thay đổi.

## Tin nhắn thoại dài

Văn bản dài được chia thành các đoạn (chunk) và trả về dưới dạng một tin nhắn thoại duy nhất. Các yêu cầu dài có thể vượt quá thời gian chờ mặc định 240 giây; hãy điều chỉnh `TTS_SYNTHESIZE_TIMEOUT_MS` nếu cần. Đặt `IRODORI_CHUNKING_ENABLED=false` để tắt chia đoạn hoặc `IRODORI_CHUNK_MIN_CHARS` để điều chỉnh ngưỡng phân chia.

## Suy luận nhanh hơn với sway sampling

Mặc định vẫn là lấy mẫu tuyến tính 40 bước chất lượng cao hơn của Irodori. Để có độ trễ thấp hơn, hãy thử Sway Sampling với ít bước hơn:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Đây là sự đánh đổi giữa chất lượng suy luận và tốc độ, vì vậy hãy thử nghiệm với checkpoint và giọng nói đã chọn trước khi thiết lập cố định.

## Các biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repo model Hugging Face hoặc nguồn repo/subfolder được hỗ trợ |
| `IRODORI_TTS_CHECKPOINT` | không đặt | Checkpoint `.pt` hoặc `.safetensors` cục bộ tùy chọn; ghi đè model Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết máy chủ; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Cổng máy chủ |
| `IRODORI_MODEL_DEVICE` | `auto` | Thiết bị model (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Thiết bị codec |
| `IRODORI_MODEL_PRECISION` | `bf16` trên CUDA, nếu không thì `fp32` | Độ chính xác của model |
| `IRODORI_CODEC_PRECISION` | `fp32` | Độ chính xác của codec |
| `IRODORI_COMPILE_MODEL` | `false` | Bật `torch.compile` cho model Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Bật hình dạng động khi biên dịch |
| `IRODORI_NUM_STEPS` | `40` | Các bước lấy mẫu Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Lịch lấy mẫu (`linear` hoặc `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Hệ số sway khi sử dụng lịch `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Tỷ lệ hướng dẫn văn bản |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Tỷ lệ hướng dẫn Caption / VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Tỷ lệ hướng dẫn người nói tham chiếu |
| `IRODORI_MAX_REF_SECONDS` | mặc định theo checkpoint | Giới hạn tùy chọn cho thời lượng âm thanh tham chiếu |
| `IRODORI_CHUNKING_ENABLED` | `true` | Chia văn bản dài tại các ranh giới dấu câu hợp lệ và nối các đoạn đã tạo |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Số ký tự không phải khoảng trắng tối thiểu trước khi chia tại ranh giới câu mạnh; dấu phẩy là ranh giới dự phòng ở mức khoảng 1.5 lần giá trị này |
