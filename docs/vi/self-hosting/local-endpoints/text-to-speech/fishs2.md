---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Tổng hợp lời nói của nhân vật đa ngôn ngữ, có tính biểu cảm cao với các tag cảm xúc chi tiết bằng [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

Fish Audio S2 Pro là model text-to-speech 4B tham số đa ngôn ngữ được thiết kế để nhân bản giọng nói có độ trung thực cao. TomoriBot kết nối với model thông qua wrapper cục bộ trong `servers/tts/fishs2/`. Nó mặc định sử dụng các trọng số BF16 chính thức (`fishaudio/s2-pro`), với checkpoint lượng hóa INT8 tùy chọn (`Imagilux/fishaudio-s2-pro`) dành cho GPU có 8 đến 12 GB VRAM.

Fish S2 Pro hỗ trợ các tag biểu cảm trong ngoặc vuông như `[whisper]`, `[excited]` và `[angry]`. Cấu hình endpoint với markup `Bracket Tags` để TomoriBot giữ lại các điều khiển này trong script giọng nói được tạo.

## Giấy phép

Mã nguồn Fish Speech và các trọng số model S2 Pro được phân phối theo Giấy phép Nghiên cứu Fish Audio (Fish Audio Research License). Nghiên cứu và sử dụng phi thương mại được cho phép theo các điều khoản của giấy phép; việc sử dụng thương mại yêu cầu phải có giấy phép Fish Audio riêng biệt.

TomoriBot không phân phối lại các trọng số model. Mỗi người dùng self-hosting sẽ tải trực tiếp Fish S2 Pro từ Hugging Face và chịu trách nhiệm tuân thủ Giấy phép Nghiên cứu Fish Audio. Ghi nhận tác giả bắt buộc là: Built with Fish Audio.

## Phần cứng và hệ điều hành

> [!IMPORTANT]
> Sử dụng Linux hoặc WSL2 để có tốc độ suy luận thực tế. Wrapper tắt tính năng biên dịch theo mặc định; đặt `FISH_S2_COMPILE=1` để bật tính năng biên dịch Triton. Windows gốc có thể mất 8:10 phút cho mỗi clip.

Phần cứng được khuyến nghị:

- **Linux hoặc WSL2 (Rất khuyến nghị)**
- GPU NVIDIA có 16 GB đến 24 GB VRAM (BF16 vừa vặn thoải mái trong ~16-18 GB VRAM với KV cache và offload)
- Khuyến nghị Python 3.12
- `git`, `ffmpeg` và các thư viện âm thanh tiêu chuẩn theo yêu cầu của Fish Speech

## Cài đặt

### Linux và WSL2 (khuyến nghị)

Từ thư mục gốc repo TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

Trình cài đặt tải xuống runtime Fish Speech đã ghim và checkpoint BF16 chính thức. Đặt `FISH_S2_MODEL_REVISION` thành một revision bất biến để tải xuống model có thể tái lập.

Model Hugging Face bị kiểm soát quyền truy cập. Trước tiên hãy chấp nhận giấy phép của model trên Hugging Face. Nếu quá trình tải xuống yêu cầu xác thực, hãy chạy:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Sau đó chạy lại trình cài đặt.

### Windows PowerShell (chỉ hỗ trợ mức tối đa)

Windows gốc chỉ được cung cấp để đánh giá. Do độ trễ dispatch của driver ở eager mode chưa biên dịch, quá trình tạo sẽ cực kỳ chậm (~8-10 phút mỗi clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

Trình cài đặt PowerShell nhắm mục tiêu tăng tốc GPU CUDA (`cu124`) theo mặc định. Để cài đặt trên máy chỉ có CPU không có GPU NVIDIA, hãy truyền `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Nếu PyTorch trên Windows cần được cài đặt hoặc cập nhật thủ công với hỗ trợ CUDA, hãy chạy:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot dừng chờ tin nhắn thoại sau `TTS_SYNTHESIZE_TIMEOUT_MS` (mặc định 240000 ms), khoảng thời gian này ngắn hơn thời gian tạo của một clip trên Windows gốc. Hãy tăng giá trị này trong `.env` của TomoriBot (ví dụ `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) khi đánh giá trên Windows.

## Bản ghi văn bản tham chiếu bắt buộc

> [!WARNING]
> Fish S2 Pro yêu cầu bản ghi văn bản chính xác của clip tham chiếu. Hãy nhập vào `Reference transcript` trong `/config` > Models > TTS Parameters & Voices; wrapper sẽ từ chối các yêu cầu nếu thiếu trường này.

## Đăng ký trong TomoriBot

Trong `/providers`, chọn `Thêm endpoint tùy chỉnh mới` và cấu hình:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Voice Source Mode: `Clone`
- Script Markup: `Bracket Tags`
- API key: để trống. Wrapper không có xác thực; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access).

Sau đó thêm mục model của endpoint và kích hoạt mục đó qua `/config` dưới mục Models > Switch Models.

## Thêm giọng nói persona

1. Chuẩn bị một clip tham chiếu rõ ràng dài 10-20 giây với một giọng nói và ít hoặc không có tiếng ồn nền.
2. Trong `/config`, mở Models > TTS Parameters & Voices và tải mẫu giọng nói lên.
3. **Nhập chính xác bản ghi văn bản** được nói trong clip tham chiếu vào trường văn bản tham chiếu.
4. Trong `/config`, mở Persona > Voice và gán mẫu cho persona.
5. Tạo tin nhắn thoại bằng `/generate voice-message` hoặc để TomoriBot tạo tin nhắn thông qua công cụ voice-message của bot.

Upstream khuyến nghị các mẫu tham chiếu từ 10-30 giây.

## Điều khiển biểu cảm

Fish S2 Pro có thể thay đổi cách truyền đạt trong cùng một câu nói bằng cách sử dụng các tag trong ngoặc vuông. Ví dụ:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Vì endpoint sử dụng markup `Bracket Tags`, TomoriBot sẽ giữ lại các tag này thay vì loại bỏ chúng trước khi tổng hợp.

## Cấu hình

| Biến | Mặc định | Mục đích |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Thư mục checkpoint S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Kho lưu trữ model và nhãn metadata sức khỏe cho checkpoint đã cấu hình |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết của wrapper; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Cổng wrapper Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Cổng API Fish nội bộ |
| `FISH_S2_COMPILE` | `0` | Bật `torch.compile` của Fish Speech (yêu cầu Linux/WSL2 với Triton) |
| `FISH_S2_HALF` | `0` | Yêu cầu chế độ runtime FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Độ dài phân đoạn prompt lặp lại của Fish |
| `FISH_S2_TOP_P` | `0.8` | Top-p lấy mẫu |
| `FISH_S2_TEMPERATURE` | `0.8` | Nhiệt độ lấy mẫu |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Phạt lặp lại |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Số lượng token ngữ nghĩa tối đa được tạo trên mỗi yêu cầu |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Cache giọng nói tham chiếu đã mã hóa trong runtime Fish |

### Biến trình cài đặt

Được đọc bởi `install-fishs2.sh` và `install-fishs2.ps1`. Hãy ghi lại bất kỳ giá trị nào bạn ghi đè để việc triển khai có thể tái lập.

| Biến | Mặc định | Mục đích |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Kho lưu trữ Hugging Face cần tải về |
| `FISH_S2_MODEL_REVISION` | `main` | Revision Hugging Face cần tải về |

Âm thanh tham chiếu phải là một tệp PCM RIFF/WAVE không nén, không rỗng và tối đa 10 MB sau khi giải mã. Giới hạn này được kiểm tra trước khi suy luận để yêu cầu base64 quá lớn không tiêu tốn bộ nhớ không giới hạn, và chứa được khoảng 237 giây WAV mono 22.05 kHz mà TomoriBot gửi.

## Tùy chọn VRAM thấp (lượng hóa INT8)

Người dùng chạy trên GPU có VRAM bị hạn chế (ví dụ 8-12 GB) không đủ dung lượng cho checkpoint BF16 chính thức có thể chọn sử dụng model lượng hóa INT8 (`Imagilux/fishaudio-s2-pro`).

Để cài đặt và chạy checkpoint INT8:

```bash
# Trong Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# Trong Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Khởi động `server.py` từ cùng shell đó, hoặc đặt ba biến tương tự trước khi khởi chạy, để wrapper nạp thư mục INT8 thay vì mặc định BF16.

Checkpoint INT8 giảm trọng số transformer từ ~10.3 GB xuống ~5.1 GB trong khi vẫn giữ các embedding âm thanh và layer codec ở BF16, vừa vặn bên trong tổng VRAM ~10 GB.
