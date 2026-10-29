---
title: "VoxCPM2"
aiGenerated: true
---

Tổng hợp giọng nói 48 kHz đầy biểu cảm trên 30 ngôn ngữ bằng model text-to-speech [VoxCPM2](https://github.com/OpenBMB/VoxCPM) của OpenBMB.

VoxCPM2 là model giọng nói đa ngôn ngữ 2B tham số hỗ trợ nhân bản giọng nói, Ultimate Cloning hỗ trợ bản ghi văn bản và Voice Design bằng ngôn ngữ tự nhiên. TomoriBot kết nối với thư viện Python `voxcpm` chính thức thông qua máy chủ trong `servers/tts/voxcpm2/`, chạy checkpoint BF16 `openbmb/VoxCPM2` không lượng hóa chính thức một cách thoải mái trong 16 GB VRAM.

## Giấy phép

Mã nguồn và trọng số model VoxCPM2 được phát hành theo Apache-2.0, bao gồm cả việc sử dụng thương mại tuân theo các điều khoản giấy phép. TomoriBot không phân phối lại các trọng số; trình cài đặt tải chúng từ kho lưu trữ Hugging Face chính thức.

Các tài nguyên upstream chính thức:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 trên Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Tài liệu VoxCPM](https://voxcpm.readthedocs.io/)

## Các ngôn ngữ được hỗ trợ

VoxCPM2 chính thức hỗ trợ 30 ngôn ngữ mà không cần tag ngôn ngữ:

Tiếng Ả Rập, tiếng Miến Điện, tiếng Trung, tiếng Đan Mạch, tiếng Hà Lan, tiếng Anh, tiếng Phần Lan, tiếng Pháp, tiếng Đức, tiếng Hy Lạp, tiếng Do Thái, tiếng Hindi, tiếng Indonesia, tiếng Ý, tiếng Nhật, tiếng Khmer, tiếng Hàn, tiếng Lào, tiếng Mã Lai, tiếng Na Uy, tiếng Ba Lan, tiếng Bồ Đào Nha, tiếng Nga, tiếng Tây Ban Nha, tiếng Swahili, tiếng Thụy Điển, tiếng Tagalog, tiếng Thái, tiếng Thổ Nhĩ Kỳ và tiếng Việt.

OpenBMB cũng ghi nhận tài liệu cho một số phương ngữ tiếng Trung. TomoriBot vẫn có thể gửi trường `language` để tương thích với giao ước TTS chung, nhưng VoxCPM2 tự phát hiện ngôn ngữ từ văn bản tổng hợp và wrapper không bắt buộc tag ngôn ngữ.

## Các chế độ giọng nói

Sử dụng markup `Auto` và `Plain` cho nhân bản và thiết kế giọng nói. Bản ghi văn bản tham chiếu sẽ bật tính năng Ultimate Cloning; hướng dẫn ngữ điệu sẽ được ưu tiên hơn và bỏ qua bản ghi văn bản đối với yêu cầu đó.

## Phần cứng và runtime

Khuyến nghị khởi đầu:

- Python 3.10-3.12
- GPU NVIDIA với 8 GB VRAM trở lên cho runtime BF16 chính thức; 12-16 GB mang lại khoảng trống thoải mái
- Driver NVIDIA hiện tại và bản dựng PyTorch hỗ trợ CUDA để tăng tốc GPU
- CPU được hỗ trợ dưới dạng dự phòng nhưng chậm hơn đáng kể

Gói chính thức cũng cung cấp khả năng lựa chọn thiết bị CPU và Apple MPS. Đối với TomoriBot trên Windows, gói Python tiêu chuẩn có thể chạy gốc; không bắt buộc phải dùng WSL. Trình cài đặt Windows PowerShell cài đặt bản dựng PyTorch hỗ trợ CUDA (`cu124`) theo mặc định.

Để cài đặt rõ ràng trên máy chỉ có CPU, hãy truyền cờ `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Nếu bản cài đặt PyTorch trên Windows gốc của bạn cần cài đặt lại thủ công hoặc căn chỉnh lại driver, hãy cài đặt bản dựng PyTorch hỗ trợ CUDA trực tiếp vào môi trường ảo của máy chủ:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## Cài đặt

Máy chủ ghim gói `voxcpm` 2.0.3 ổn định hiện tại và tải `openbmb/VoxCPM2` vào cache Hugging Face thông thường.

### Linux và WSL Bash

Từ thư mục gốc repository TomoriBot:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

Từ thư mục gốc repository TomoriBot:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

Lần thiết lập đầu tiên sẽ tải xuống vài gigabyte trọng số model. Để cài đặt môi trường Python mà không cần prefetch model, hãy đặt `VOXCPM2_PREFETCH=0`; thư viện chính thức sau đó sẽ tải xuống checkpoint khi khởi động máy chủ lần đầu.

Linux và WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Sau khi thiết lập, `bun run launch --voxcpm2` sẽ khởi động máy chủ cùng với TomoriBot. Endpoint mặc định là `http://127.0.0.1:8016`.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và cấu hình endpoint Speech:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Voice Source Mode: `Auto`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Sau khi lưu kết nối, chọn kết nối đó và sử dụng dropdown model của nó để thêm một model Speech. Sau đó mở `/config` > Models > Switch Models và chọn model giọng nói VoxCPM2.

`Auto` được khuyến nghị vì cùng một máy chủ hỗ trợ cả nhân bản bằng âm thanh tham chiếu và Voice Design. Bạn không cần các tiến trình VoxCPM2 riêng biệt cho hai chế độ.

## Nhân bản giọng nói persona

Đối với persona cần nhân bản một người nói hiện có:

1. Chuẩn bị một clip tham chiếu rõ ràng với một giọng nói và ít hoặc không có nhạc nền. Upstream coi 5 đến 30 giây là khoảng thực tế.
2. Mở `/config` dưới mục Models > TTS Parameters & Voices và tải clip lên.
3. Thêm bản ghi văn bản chính xác của clip tham chiếu khi có sẵn. VoxCPM2 sử dụng bản ghi này cho Ultimate Cloning và có thể tái tạo nhiều hơn nhịp điệu, cảm xúc và phong cách của bản tham chiếu.
4. Mở `/config` dưới mục Persona > Voice, chọn persona và gán mẫu đã lưu.

Nếu không có bản ghi văn bản nào được lưu, VoxCPM2 vẫn thực hiện nhân bản bằng âm thanh tham chiếu thông thường.

## Thiết kế giọng nói persona

Đối với persona cần được tạo từ mô tả giọng nói bằng văn bản thay vì một mẫu âm thanh:

1. Mở `/config` trong Persona > Voice và chọn VoiceDesign.
2. Chọn persona.
3. Nhập mô tả bằng ngôn ngữ tự nhiên chẳng hạn như `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

Đối với giọng nói nhân bản, các hướng dẫn ngữ điệu dùng một lần sẽ được ưu tiên hơn bản ghi văn bản tham chiếu.

## Các biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID model Hugging Face hoặc thư mục model cục bộ |
| `VOXCPM2_DEVICE` | `auto` | Thiết bị runtime: `auto`, `cuda`, `cuda:N`, `cpu`, hoặc `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Bật đường dẫn tối ưu hóa / biên dịch của runtime chính thức |
| `VOXCPM2_LOAD_DENOISER` | `0` | Nạp bộ khử nhiễu upstream tùy chọn; tắt theo mặc định để tiết kiệm bộ nhớ |
| `VOXCPM2_CFG_VALUE` | `2.0` | Cường độ hướng dẫn |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Các bước suy luận flow-matching; nhiều bước hơn có thể cải thiện chất lượng nhưng giảm tốc độ |
| `VOXCPM2_MAX_LEN` | `4096` | Độ dài tạo tối đa |
| `VOXCPM2_NORMALIZE` | `0` | Bật chuẩn hóa văn bản upstream |
| `VOXCPM2_RETRY_BADCASE` | `1` | Bật hành vi thử lại ở upstream cho các trường hợp tạo bất thường |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Số lần tự động thử lại tối đa |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Ngưỡng tỷ lệ độ dài trường hợp bất thường ở upstream |
| `VOXCPM2_PREFETCH` | `1` | Chỉ dành cho trình cài đặt: tải xuống model trong quá trình thiết lập |
| `VOXCPM2_PORT` | `8016` | Cổng máy chủ cục bộ VoxCPM2 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết máy chủ cục bộ; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) |

Âm thanh tham chiếu phải là một container WAV không rỗng, tối đa 10 MB sau khi giải mã; wrapper kiểm tra điều này trước khi ghi tệp tạm thời.
