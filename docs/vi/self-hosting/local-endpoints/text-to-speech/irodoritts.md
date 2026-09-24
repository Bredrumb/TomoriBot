---
title: "IrodoriTTS"
---

Irodori-TTS v4.1 là một model TTS tập trung vào tiếng Nhật với khả năng sao chép giọng nói và thiết kế giọng nói VoiceDesign dựa trên chú thích trong cùng một checkpoint. TomoriBot chạy model này thông qua FastAPI wrapper cục bộ trong `servers/tts/irodoritts/`.

Model mặc định là `Aratako/Irodori-TTS-v4.1-Small`. Các checkpoint Hugging Face tương thích có thể được chọn với `IRODORI_TTS_MODEL_ID`, bao gồm các bản tinh chỉnh cộng đồng như `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Cài đặt

Irodori hiện sử dụng `uv` để quản lý phần phụ thuộc và backend PyTorch. Hãy cài đặt `uv` trước, sau đó chạy tập lệnh thiết lập từ thư mục gốc của kho lưu trữ TomoriBot.

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

Các tập lệnh thiết lập tạo `servers/tts/irodoritts/.venv`, vì vậy `bun run launch --irodoritts` tiếp tục hoạt động sau khi cài đặt.

Các backend khả dụng là:

- `cu128`: NVIDIA CUDA 12.8 trên Windows/Linux
- `cpu`: Chỉ CPU, hoặc macOS CPU/MPS thông qua PyPI
- `rocm`: AMD ROCm trên Linux/WSL
- `xpu`: Intel XPU trên Windows/Linux

URL endpoint mặc định là `http://127.0.0.1:8013`.

## Sử dụng một checkpoint khác

Model mặc định là `Aratako/Irodori-TTS-v4.1-Small`. Các kho lưu trữ Hugging Face tương thích, các bản tinh chỉnh cộng đồng (chẳng hạn như `phasefield-audio/Irodori-TTS-v4.1-Anime`), hoặc các tệp checkpoint cục bộ có thể được định cấu hình qua các biến môi trường.

Khi khởi động máy chủ (trực tiếp bằng Python hoặc qua `bun run launch --irodoritts`), máy chủ sẽ tự động đọc tệp `.env` ở thư mục gốc của kho lưu trữ (hoặc tệp `.env` cục bộ trong `servers/tts/irodoritts/`) và ghi log ID model đang hoạt động khi khởi động.

### Qua `.env` (Cố định)

Thêm vào tệp `.env` của bạn ở thư mục gốc TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Qua biến môi trường theo phiên

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

Nếu bạn đã tải xuống tệp checkpoint (`.pt` hoặc `.safetensors`) về máy cục bộ, hãy đặt `IRODORI_TTS_CHECKPOINT` thành đường dẫn của tệp:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

Irodori hiện tại tải checkpoint cùng với bất kỳ tài nguyên tokenizer nào được đóng gói trong repo Hugging Face. Các biến thể thư mục con trên Hugging Face cũng được hỗ trợ bởi `IRODORI_TTS_MODEL_ID` khi repo model cung cấp chúng.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn **Add New Custom Endpoint**, và sử dụng độ tương thích API giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm một model Speech. Đối với v4.1, các cài đặt được khuyến nghị là:

- `Voice Source Mode`: `Auto`
- `Script Markup Style`: `Emoji`

`Auto` cho phép cùng một endpoint Irodori hỗ trợ cả hai chế độ giọng nói của TomoriBot, nhờ đó các gợi ý cảm xúc vẫn còn khi gửi:

- Các persona có mẫu giọng nói được chỉ định dưới phần Persona > Voice sẽ gửi đoạn clip tham chiếu đã lưu để sao chép giọng nói.
- Các persona có prompt VoiceDesign được đặt dưới phần Persona > Voice sẽ gửi prompt ngôn ngữ tự nhiên đã lưu làm điều kiện chú thích của Irodori.

Bạn vẫn có thể chọn `Voice Clone` làm Voice Source Mode nếu bạn chỉ muốn sao chép giọng nói bằng âm thanh tham chiếu.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói persona

### Sao chép giọng nói

1. Chuẩn bị một đoạn clip giọng nói tiếng Nhật rõ ràng với một người nói và không có nhạc nền. Khoảng 30 giây là đã đủ: vượt quá mốc đó, phần âm thanh thêm vào hầu như không cải thiện độ trung thực của âm sắc mà còn làm tăng kích thước tải lên và thời gian suy luận.
2. Mở `/config` trong phần Models > TTS Parameters & Voices và tải clip lên.
3. Mở `/config` trong phần Persona > Voice, sau đó chọn persona và mẫu giọng nói.

Irodori v4.1 hỗ trợ điều kiện hóa tham chiếu dài hơn so với model v2 cũ, nhưng âm thanh nguồn rõ ràng vẫn quan trọng hơn thời lượng thô.

Runtime của v4.1 giới hạn clip tham chiếu theo giá trị mặc định của checkpoint, và checkpoint v4.1 đặt giá trị này là 120 giây. Phần dài hơn sẽ bị cắt theo giới hạn đó thay vì bị từ chối, và `IRODORI_MAX_REF_SECONDS` sẽ ghi đè giới hạn này. Vì vậy, một clip ở mức trần tải lên 130 giây của TomoriBot vẫn dùng được: Irodori điều kiện hóa trên 120 giây đầu tiên của clip.

Ở đây, dài hơn không có nghĩa là tốt hơn. Tài liệu upstream cho biết khoảng 30 giây giọng nói tham chiếu rõ ràng đã mang lại phần lớn mức cải thiện đo được về độ tương đồng với người nói, và nhiều clip ngắn hơn từ cùng một người nói sẽ tốt hơn một bản ghi dài. Các bước latent tham chiếu tăng thêm khi clip dài hơn cũng làm mọi yêu cầu tổng hợp lâu hơn. Chỉ vượt quá 30 giây khi âm sắc của người nói thay đổi trong suốt bản ghi.

### VoiceDesign

1. Mở `/config` trong phần Persona > Voice.
2. Chọn persona.
3. Nhập mô tả bằng ngôn ngữ tự nhiên về giọng nói và cách truyền đạt mong muốn.

TomoriBot gửi prompt này dưới dạng `instruct`; wrapper Irodori ánh xạ nó sang điều kiện `caption` của v4.1. Các yêu cầu VoiceDesign không cần đoạn clip tham chiếu đã lưu.

TomoriBot loại bỏ cú pháp emoji tùy chỉnh của Discord trước khi gửi văn bản đến TTS. Với `script_markup: emoji`, các Unicode emoji được giữ lại cho quá trình điều kiện hóa văn bản của Irodori.

## Suy luận nhanh hơn với Sway Sampling

Mặc định vẫn là phương pháp lấy mẫu tuyến tính 40 bước chất lượng cao hơn của Irodori. Để có độ trễ thấp hơn, hãy thử Sway Sampling với ít bước hơn:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Đây là sự đánh đổi giữa chất lượng suy luận và tốc độ, vì vậy hãy thử nghiệm với checkpoint và các giọng nói đã chọn trước khi áp dụng cố định.

## Lý do các tập lệnh cài đặt hiện nay đơn giản hơn

Trình cài đặt TomoriBot trước đây đã sao chép và vá tệp `pyproject.toml` của Irodori, cài đặt thủ công `dacvae`, và ghim một commit Irodori cũ thời kỳ v2. Các giải pháp tạm thời đó là cần thiết cho bố cục gói thượng nguồn cũ hơn nhưng không còn phù hợp với Irodori hiện tại.

Máy chủ hiện có tệp `pyproject.toml` riêng và tuân theo thiết lập backend `uv` của thượng nguồn. Irodori và `dacvae` vẫn được ghim vào các commit đã biết tại đó để cài đặt có thể tái lập, nhưng TomoriBot không còn sửa đổi mã nguồn thượng nguồn trong quá trình cài đặt nữa.

## Biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repo model Hugging Face hoặc nguồn repo/thư mục con được hỗ trợ |
| `IRODORI_TTS_CHECKPOINT` | chưa đặt | Checkpoint `.pt` hoặc `.safetensors` cục bộ tùy chọn; ghi đè model Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết máy chủ; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Cổng máy chủ |
| `IRODORI_MODEL_DEVICE` | `auto` | Thiết bị chạy model (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Thiết bị chạy codec |
| `IRODORI_MODEL_PRECISION` | `bf16` trên CUDA, ngược lại `fp32` | Độ chính xác model |
| `IRODORI_CODEC_PRECISION` | `fp32` | Độ chính xác codec |
| `IRODORI_COMPILE_MODEL` | `false` | Bật `torch.compile` cho model Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Bật dynamic shapes khi biên dịch |
| `IRODORI_NUM_STEPS` | `40` | Các bước lấy mẫu Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Lịch trình lấy mẫu (`linear` hoặc `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Hệ số Sway khi sử dụng lịch trình `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Tỷ lệ hướng dẫn văn bản |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Tỷ lệ hướng dẫn chú thích / VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Tỷ lệ hướng dẫn người nói tham chiếu |
| `IRODORI_MAX_REF_SECONDS` | mặc định checkpoint | Giới hạn tùy chọn cho thời lượng âm thanh tham chiếu |
