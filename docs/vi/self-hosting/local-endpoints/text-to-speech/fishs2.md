---
title: "Fish Audio S2 Pro"
---

Fish Audio S2 Pro là một model TTS 4B đa ngôn ngữ tập trung vào việc sao chép giọng nói có độ trung thực cao và cách truyền đạt biểu cảm. TomoriBot sử dụng model này thông qua wrapper cục bộ trong `servers/tts/fishs2/`.

Thiết lập mặc định của TomoriBot sử dụng các trọng số BF16 chính thức (`fishaudio/s2-pro`) để cung cấp độ trung thực tổng hợp cao nhất và tránh sự không tương thích do lượng tử hóa. Đối với người dùng có GPU tiêu dùng bị giới hạn bộ nhớ, lượng tử hóa chỉ tính trọng số INT8 tùy chọn (`Imagilux/fishaudio-s2-pro`) được hỗ trợ thông qua việc ghi đè biến môi trường.

Fish S2 Pro hỗ trợ các thẻ biểu cảm trong ngoặc vuông như `[whisper]`, `[excited]`, và `[angry]`. Hãy cấu hình endpoint với markup **Bracket Tags** để TomoriBot giữ lại các tùy chọn điều khiển này trong kịch bản giọng nói được tạo.

## Giấy phép

Mã nguồn Fish Speech và trọng số model S2 Pro được phân phối theo Giấy phép Nghiên cứu Fish Audio (Fish Audio Research License). Việc nghiên cứu và sử dụng phi thương mại được cho phép theo các điều khoản của giấy phép; việc sử dụng thương mại yêu cầu phải có giấy phép Fish Audio riêng biệt.

TomoriBot không phân phối lại trọng số model. Mỗi người dùng self-hosting sẽ tải trực tiếp Fish S2 Pro từ Hugging Face và chịu trách nhiệm tuân thủ Giấy phép Nghiên cứu Fish Audio. Ghi nhận tác giả bắt buộc là: **Built with Fish Audio**.

## Phần cứng & Hệ điều hành

> [!IMPORTANT]
> **Sử dụng Linux hoặc WSL2 cho Fish Speech:** Fish Audio chính thức nhắm mục tiêu đến Linux và WSL2. Fish S2 Pro sử dụng kiến trúc Dual-Autoregressive (Dual-AR) (36 lớp transformer chậm + 10 lượt codebook nhanh = 76 lượt đánh giá lớp trên mỗi token). Trên Linux, OpenAI Triton có thể biên dịch vòng lặp lồng nhau này thành các GPU kernel hợp nhất (`torch.compile(backend="inductor")`), điều mà các benchmark thượng nguồn đã chứng minh là cho phép tổng hợp theo thời gian thực trên các GPU máy chủ Linux. Wrapper tắt tính năng biên dịch theo mặc định, vì vậy hãy đặt `FISH_S2_COMPILE=1` để sử dụng.
>
> Trên Windows gốc, Triton không được hỗ trợ, buộc PyTorch phải chuyển sang chế độ eager mode chưa biên dịch với hơn 120.000 lượt điều phối CUDA kernel tuần tự thông qua driver Windows WDDM. Điều này gây ra tình trạng nghẽn điều phối nghiêm trọng, làm chậm quá trình tạo xuống còn **~8-10 phút** (~65 giây tính toán cho mỗi giây âm thanh) cho cùng một đoạn clip. Để suy luận khả thi, **hãy chạy Fish S2 Pro bên trong Linux hoặc WSL2**.

Phần cứng được khuyến nghị:

- **Linux hoặc WSL2 (Được khuyến nghị mạnh mẽ)**
- GPU NVIDIA với **16 GB đến 24 GB VRAM** (BF16 vừa vặn thoải mái trong ~16-18 GB VRAM với bộ nhớ đệm KV và offload)
- Khuyến nghị Python 3.12
- `git`, `ffmpeg`, và các thư viện âm thanh tiêu chuẩn theo yêu cầu của Fish Speech

## Cài đặt

### Linux / WSL2 (Được khuyến nghị)

Từ thư mục gốc của kho lưu trữ TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

Trình cài đặt thực hiện:

1. sao chép `Imagilux/fish-speech` vào `servers/tts/fishs2/fish-speech/` và chuyển sang commit runtime đã được ghim;
2. tạo môi trường ảo `.venv` cô lập;
3. cài đặt Fish Speech cùng các phần phụ thuộc wrapper của TomoriBot; và
4. tải checkpoint BF16 chính thức `fishaudio/s2-pro` vào `fish-speech/checkpoints/fish-speech-s2-pro/`.

Một lần cài đặt lại thông thường sẽ giữ nguyên commit runtime đã ghim `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` thay vì đi theo một nhánh đang thay đổi. Bản sửa đổi model mặc định là `main`; hãy ghim `FISH_S2_MODEL_REVISION` vào một bản sửa đổi Hugging Face cố định khi quá trình triển khai cần khả năng tái lập. Các cài đặt trình cài đặt được liệt kê trong [Biến bộ cài đặt](#biến-bộ-cài-đặt).

Model Hugging Face bị giới hạn quyền truy cập. Hãy chấp nhận giấy phép của model trên Hugging Face trước. Nếu quá trình tải xuống yêu cầu xác thực, hãy chạy:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Sau đó chạy lại trình cài đặt.

### Windows PowerShell (Chỉ áp dụng theo khả năng tốt nhất)

Bản Windows gốc chỉ được cung cấp cho mục đích đánh giá. Do độ trễ điều phối driver ở chế độ eager mode chưa biên dịch, việc tạo âm thanh sẽ cực kỳ chậm (~8-10 phút mỗi clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

Trình cài đặt PowerShell nhắm mục tiêu tăng tốc GPU CUDA (`cu124`) theo mặc định. Để cài đặt trên máy chỉ có CPU không có GPU NVIDIA, hãy truyền tham số `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Nếu PyTorch trên Windows cần được cài đặt thủ công hoặc cập nhật với hỗ trợ CUDA, hãy chạy:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot dừng chờ tin nhắn thoại sau `TTS_SYNTHESIZE_TIMEOUT_MS` (mặc định 240000 ms), mức thời gian này ngắn hơn thời gian tạo một clip trên Windows gốc. Hãy tăng giá trị này trong tệp `.env` của TomoriBot (chẳng hạn như `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) khi đánh giá trên Windows.

## Bắt buộc có bản phiên âm tham chiếu

> [!WARNING]
> **Văn bản tham chiếu (`ref_text`) là bắt buộc để sao chép giọng nói:** Cơ chế cross-attention của Fish S2 Pro yêu cầu bản phiên âm của âm thanh tham chiếu để căn chỉnh các token ngữ âm với các mã âm học.
>
> Nếu bạn tải lên một mẫu giọng nói mà không cung cấp bản phiên âm tham chiếu khớp, Fish Speech **sẽ âm thầm loại bỏ các token âm thanh tham chiếu** và rơi vào trạng thái tạo giọng nói ngẫu nhiên không có tham chiếu. Wrapper Fish của TomoriBot sẽ xác thực và từ chối các yêu cầu tổng hợp thiếu văn bản tham chiếu với lỗi `400 Bad Request` để ngăn chặn việc tạo giọng nói không được điều kiện hóa ngoài ý muốn.

Khi thêm giọng nói persona trong `/config` dưới phần **Models > TTS Parameters & Voices**, hãy luôn điền vào trường **Reference transcript** văn bản chính xác từng từ được nói trong đoạn âm thanh tham chiếu của bạn.

## Đăng ký trong TomoriBot

Trong `/providers`, chọn **Add New Custom Endpoint** và cấu hình:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Voice Source Mode: `Clone`
- Script Markup: `Bracket Tags`
- API key: để trống cho thiết lập loopback mặc định. Nếu bật xác thực bearer, hãy nhập chính xác giá trị `FISH_S2_API_KEY`.

Sau đó thêm mục model của endpoint và kích hoạt mục đó qua `/config` dưới phần Models > Switch Models.

## Thêm giọng nói persona

1. Chuẩn bị một đoạn clip tham chiếu rõ ràng dài 10-20 giây với một người nói và ít hoặc không có tiếng ồn nền.
2. Trong `/config`, mở Models > TTS Parameters & Voices và tải mẫu giọng nói lên.
3. **Nhập chính xác bản phiên âm** được nói trong đoạn clip tham chiếu vào trường văn bản tham chiếu.
4. Trong `/config`, mở Persona > Voice và gán mẫu cho persona.
5. Tạo tin nhắn thoại bằng `/generate voice-message` hoặc để TomoriBot tạo tin nhắn qua công cụ tin nhắn thoại của bot.

## Điều khiển biểu cảm

Fish S2 Pro có thể thay đổi cách truyền đạt trong cùng một câu nói bằng cách sử dụng các thẻ trong ngoặc vuông. Ví dụ:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Vì endpoint sử dụng markup `Bracket Tags`, TomoriBot sẽ giữ lại các thẻ này thay vì loại bỏ chúng trước khi tổng hợp.

## Cấu hình

| Biến | Mặc định | Mục đích |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Thư mục runtime Fish Speech |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Thư mục checkpoint S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Kho lưu trữ model và nhãn siêu dữ liệu trạng thái cho checkpoint đã cấu hình |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết của wrapper TomoriBot |
| `FISH_S2_PORT` | `8015` | Cổng wrapper Fish; dự phòng về `TOMORI_TTS_PORT` khi chưa đặt |
| `TOMORI_TTS_PORT` | chưa đặt | Ghi đè cổng dùng chung tương thích ngược |
| `FISH_S2_API_KEY` | chưa đặt | Bearer token tùy chọn, cũng bắt buộc đối với các liên kết từ xa có xác thực |
| `TOMORI_TTS_API_KEY` | chưa đặt | Dự phòng bearer token dùng chung khi `FISH_S2_API_KEY` chưa được đặt |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | Cho phép liên kết ngoài loopback một cách rõ ràng mà không cần bearer token |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | Kích thước WAV tham chiếu sau giải mã tối đa |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | chưa đặt | Dự phòng giới hạn âm thanh tham chiếu sau giải mã dùng chung |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | Địa chỉ liên kết API Fish nội bộ |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Cổng API Fish nội bộ |
| `FISH_S2_COMPILE` | `0` | Bật `torch.compile` của Fish Speech (yêu cầu Linux/WSL2 với Triton) |
| `FISH_S2_HALF` | `0` | Yêu cầu chế độ runtime FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Độ dài phân đoạn prompt lặp lại của Fish |
| `FISH_S2_TOP_P` | `0.8` | Top-p lấy mẫu |
| `FISH_S2_TEMPERATURE` | `0.8` | Nhiệt độ lấy mẫu |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Hình phạt lặp lại |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Số lượng token ngữ nghĩa tối đa được tạo trên mỗi yêu cầu |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Lưu bộ nhớ đệm giọng nói tham chiếu đã mã hóa trong runtime Fish |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | Độ dài kịch bản tối đa được wrapper chấp nhận |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | Thời gian tối đa để chờ API Fish lồng nhau |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` | Thời gian tối đa để chờ một yêu cầu tổng hợp thượng nguồn |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | Thời gian `bun run launch --fishs2` chờ kiểm tra tình trạng của wrapper |

### Biến bộ cài đặt

Được đọc bởi `install-fishs2.sh` và `install-fishs2.ps1`. Hãy ghi lại bất kỳ giá trị nào bạn ghi đè để việc triển khai có thể tái lập.

| Biến | Mặc định | Mục đích |
|---|---|---|
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` | Kho lưu trữ runtime Fish Speech, ví dụ một bản mirror đã được kiểm duyệt |
| `FISH_S2_RUNTIME_REF` | `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` | Commit runtime được lấy ra khi cài đặt |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Kho lưu trữ Hugging Face cần tải về |
| `FISH_S2_MODEL_REVISION` | `main` | Bản sửa đổi Hugging Face cần tải về |
| `FISH_S2_UPDATE` | `0` | Đặt thành `1` để chủ động cập nhật runtime và tải lại model |
| `FISH_S2_UPDATE_REF` | chưa đặt | Bản sửa đổi runtime cho một bản cập nhật. Nếu không có, `FISH_S2_RUNTIME_REF` rõ ràng sẽ được giữ lại; nếu không, bản cập nhật sử dụng `main` |
| `FISH_S2_UPDATE_MODEL_REVISION` | chưa đặt | Bản sửa đổi model cho một bản cập nhật, với thứ tự ưu tiên tương tự như `FISH_S2_UPDATE_REF` |

Âm thanh tham chiếu phải là một tệp PCM RIFF/WAVE không nén và không rỗng. Giới hạn kích thước sau khi giải mã được kiểm tra trước khi suy luận để ngăn yêu cầu base64 quá lớn tiêu tốn bộ nhớ không giới hạn.

## Tùy chọn VRAM thấp (Lượng tử hóa INT8)

Người dùng chạy trên GPU có VRAM hạn chế (chẳng hạn 8-12 GB) không thể vừa với checkpoint BF16 chính thức có thể chọn model lượng tử hóa INT8 (`Imagilux/fishaudio-s2-pro`).

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

Khởi động `server.py` từ cùng một shell, hoặc đặt cùng ba biến đó trước khi khởi chạy, để wrapper tải thư mục INT8 thay vì mặc định BF16.

Checkpoint INT8 giảm trọng số transformer từ ~10.3 GB xuống ~5.1 GB trong khi vẫn giữ audio embedding và các lớp codec ở dạng BF16, vừa vặn bên trong tổng lượng VRAM ~10 GB.
