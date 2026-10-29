---
title: "CosyVoice 3"
aiGenerated: true
---

Tổng hợp giọng nói tự nhiên, đa ngôn ngữ của nhân vật với khả năng truyền tải cảm xúc dựa trên hướng dẫn bằng cách sử dụng [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) của Alibaba.

CosyVoice 3 cung cấp tính năng nhân bản giọng nói zero-shot và cross-lingual trên 9 ngôn ngữ và hơn 18 phương ngữ tiếng Trung. TomoriBot bọc runtime chính thức trong `servers/tts/cosyvoice3/` để cung cấp giao diện giọng nói `POST /synthesize` tiêu chuẩn. Trình cài đặt đi kèm mặc định sử dụng model không lượng hóa chính thức `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, chạy trong 16 GB VRAM.

CosyVoice hỗ trợ chín ngôn ngữ và các phương ngữ tiếng Trung. Nếu phát âm tiếng Nhật kém, upstream khuyến nghị chuyển đổi văn bản sang katakana.

Sử dụng Script Markup `Plain` và cung cấp hướng dẫn ngữ điệu thông qua `voice_instructions`. Bản ghi văn bản tham chiếu khớp sẽ kích hoạt tính năng nhân bản zero-shot; nếu không có bản ghi, máy chủ sẽ sử dụng tính năng nhân bản cross-lingual. Các hướng dẫn sẽ sử dụng âm thanh tham chiếu mà không cần bản ghi văn bản.

## Phần cứng

Phần cứng được khuyến nghị:

- GPU NVIDIA với 16 GB VRAM
- Python 3.10
- Driver NVIDIA tương thích với CUDA 12
- `git`
- `ffmpeg` để chuẩn hóa mẫu giọng nói
- `sox` và `libsox-dev` trên Linux nếu xảy ra sự cố tương thích âm thanh

Model 0.5B tham số dễ dàng vừa vặn trong 16 GB VRAM mà không cần lượng hóa. Bản tải xuống checkpoint bao gồm các model flow, speech tokenizer, text model và trọng số reinforcement learning, yêu cầu khoảng 10 GB dung lượng ổ đĩa cộng với các phần phụ thuộc Python.

Mặc dù suy luận trên CPU được hỗ trợ về mặt kỹ thuật ở upstream, nhưng nó quá chậm đối với các tương tác giọng nói trên Discord.

## Cài đặt

### Linux và WSL2 (khuyến nghị)

Từ thư mục gốc repo TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Hoặc khởi động đồng thời máy chủ đã cấu hình và TomoriBot:

```bash
bun run launch --cosyvoice3
```

Trình cài đặt tải xuống các revision runtime và model đã ghim, và từ chối ghi đè lên checkout có các thay đổi chưa được commit.

Các yêu cầu upstream cài đặt PyTorch 2.3.1 với các gói CUDA 12.1, các gói ONNX Runtime CUDA 12 trên Linux và các gói TensorRT 10.13 trên Linux. Nếu GPU của bạn yêu cầu bản dựng PyTorch mới hơn, hãy cài đặt bản dựng PyTorch tương thích bên trong môi trường ảo sau khi hoàn tất thiết lập.

### Windows PowerShell

Bản Windows gốc được cung cấp dưới dạng phương thức cố gắng tối đa (best-effort):

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

WSL2 rất được khuyến nghị khi sử dụng GPU NVIDIA trên Windows. Các yêu cầu upstream cài đặt ONNX Runtime chỉ dùng CPU trên Windows, trong khi Linux và WSL2 cài đặt các gói tăng tốc GPU.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và cấu hình endpoint giọng nói:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Voice Source Mode: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Sau khi lưu kết nối, chọn kết nối đó và thêm một model Speech. Một code model rõ ràng là `Fun-CosyVoice3-0.5B-2512`.

Sau đó mở `/config` > Models > Switch Models và kích hoạt endpoint giọng nói CosyVoice 3.

## Gán giọng nói persona

Đối với nhân bản giọng nói zero-shot:

1. Chuẩn bị một đoạn âm thanh rõ ràng từ 3 đến 30 giây với một giọng nói và giảm thiểu tiếng ồn nền.
2. Mở `/config` trong Models > TTS Parameters & Voices và tải mẫu lên.
3. Nhập bản ghi văn bản tương ứng nếu có. CosyVoice 3 token hóa bản ghi này dưới dạng tiền tố prompt cho nhân bản zero-shot; bản ghi này nên mô tả 30 giây đầu tiên của âm thanh.
4. Mở `/config` trong Persona > Voice và gán mẫu cho persona.

Wrapper sẽ cắt âm thanh tham chiếu về 30 giây đầu tiên. Nhân bản cross-lingual có thể sử dụng mẫu tham chiếu được nói bằng ngôn ngữ khác với văn bản được tạo.

## Thử nghiệm với `/generate voice-message`

Sử dụng `/generate voice-message` để kiểm tra tổng hợp mà không cần chờ trigger trò chuyện tự động. Bạn có thể thử nghiệm với mẫu đã gán của persona hoặc tải lên một clip dùng một lần kèm theo bản ghi văn bản của nó.

Để định hướng cảm xúc và cách truyền đạt, hãy nhập hướng dẫn trong modal hoặc để prompt của persona cung cấp `voice_instructions`. Giữ văn bản nói dưới dạng hội thoại thuần; các tag kiểu nội tuyến sẽ bị loại bỏ trước khi tổng hợp.

## Các biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Thư mục checkpoint cục bộ |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết của wrapper; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Cổng wrapper |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Bật bộ tạo streaming nội bộ của CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Hệ số nhân tốc độ dạng số toàn cục được truyền vào suy luận upstream |
| `COSYVOICE3_DEFAULT_INSTRUCT` | để trống | Hướng dẫn tùy chọn được thêm vào khi yêu cầu không cung cấp |
| `COSYVOICE3_FP16` | `0` | Yêu cầu runtime chính thức sử dụng chế độ fp16 của nó |
| `COSYVOICE3_LOAD_TRT` | `0` | Bật nạp TensorRT upstream khi được chuẩn bị đúng cách |
| `COSYVOICE3_LOAD_VLLM` | `0` | Bật nạp vLLM upstream khi đã cài đặt các phần phụ thuộc riêng của nó |

Theo mặc định, TensorRT, vLLM và fp16 vẫn bị tắt. Runtime PyTorch tiêu chuẩn chạy thoải mái trên GPU 16 GB mà không cần các phần phụ thuộc runtime bổ sung.

## Các biến thể model

Để thử các trọng số RL đi kèm, hãy sao chép thư mục model, đổi tên `llm.rl.pt` thành `llm.pt` trong bản sao và đặt `COSYVOICE3_MODEL_DIR` trỏ tới đó. Các runtime tùy chọn vLLM và TensorRT yêu cầu các phần phụ thuộc riêng biệt.

## Giấy phép

Codebase CosyVoice và các trọng số `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` được phát hành theo giấy phép Apache-2.0.

Model card upstream lưu ý rằng các tài liệu trình diễn dành cho đánh giá học thuật. TomoriBot không phân phối các trọng số model. Hãy xem lại giấy phép và điều khoản upstream cho trường hợp sử dụng cụ thể của bạn trước khi triển khai thương mại.
