---
title: "So sánh engine TTS"
aiGenerated: false
sidebar:
  order: 1
---

So sánh thời gian tổng hợp và các mẫu âm thanh từ cùng một môi trường thử nghiệm bên dưới.

## Nhân bản giọng nói tiếng Anh & đa ngôn ngữ

### Prompt benchmark

- **Standard Prompt** *(sử dụng cho Chatterbox Standard/Turbo/Nano, MOSS-TTS, CosyVoice 3, VoxCPM2, Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- **Fish Audio S2 Pro Prompt** *(được thử nghiệm với các tag biểu cảm trong ngoặc vuông)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Hiệu năng & so sánh âm thanh

Thời gian đo lường báo cáo cả toàn bộ thời gian tạo (tổng số giây theo thời gian thực từ lúc yêu cầu đến khi âm thanh hoàn tất) và Real-Time Factor (RTF), được xác định là thời gian tạo chia cho thời lượng âm thanh:

- **RTF < 1.0 (in đậm):** Engine tạo giọng nói nhanh hơn thời gian thực (ví dụ, `0.50× RTF` kết xuất đoạn clip 10 giây trong 5 giây). Chỉ những engine này mới có thể theo kịp cuộc gọi thoại trực tiếp, tính năng mà TomoriBot hiện chưa triển khai.
- **RTF > 1.0:** Quá trình tạo mất nhiều thời gian hơn thời lượng âm thanh được nói. TomoriBot gửi mỗi tin nhắn thoại dưới dạng một tệp hoàn chỉnh, vì vậy RTF cao hơn chỉ đồng nghĩa với việc phải chờ lâu hơn.

| Engine | Windows Native<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Mẫu âm thanh |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8-10 phút<sup>(2)</sup><br/>*(~65× RTF)* | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox (Turbo, Mặc định)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~5.0s *(clip 8.7s)*<br/>0.57× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox (Nano)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~3.0s *(clip 8.0s)*<br/>0.38× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox (Tiêu chuẩn)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~6.0s *(clip 7.8s)*<br/>0.77× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | ~12.0s *(clip 8.8s)*<br/>1.36× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | ~6.0s *(clip 13.9s)*<br/>0.43× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | ~8.0s *(clip 7.4s)*<br/>1.09× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | ~10.0s *(clip 9.2s)*<br/>1.09× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> **Môi trường thử nghiệm**: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) trên Windows 11 (thực thi gốc) sử dụng mẫu âm thanh tham chiếu mono 24 kHz dài 26.6 giây với bản ghi văn bản khớp từng từ.
- <sup>(2)</sup> **Fish Audio S2 Pro**: Thực thi trên Windows chạy ở eager mode chưa biên dịch (~65× RTF) do độ trễ khởi chạy CUDA kernel qua 76 lần đánh giá layer cho mỗi token. Khuyến nghị chạy trên Linux hoặc WSL2 với OpenAI Triton compiler fusion (`torch.compile`) để tránh nghẽn dispatch này.

---

## Nhân bản giọng nói tiếng Nhật

### Prompt benchmark tiếng Nhật

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Hiệu năng tiếng Nhật & so sánh âm thanh

| Engine | Windows Native<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Mẫu âm thanh |
|---|---|---|---|---|
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~4.0s *(clip 8.5s)*<br/>0.47× RTF | Chưa thử nghiệm | Chưa thử nghiệm | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Được đo lường trong cùng môi trường thử nghiệm RTX 4070 Ti SUPER Windows 11.

---

## So sánh các engine

TomoriBot trả về các tệp WAV hoàn chỉnh. Kích thước model tính theo số lượng tham số; các con số bộ nhớ GPU là hướng dẫn thiết lập. Thời gian đo ở trên đến từ một máy Windows.

Độ dài clip tham chiếu bao gồm các khuyến nghị ở upstream và giới hạn runtime. Hãy kiểm tra từng hướng dẫn engine để biết chi tiết.

| Engine | Kích thước model; 16 GB GPU | Ngôn ngữ | Clip tham chiếu | Nguồn giọng nói và khả năng kiểm soát | Tốc độ / đường dẫn streaming | Chọn engine này cho |
|---|---|---|---|---|---|---|
| [Chatterbox](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo (mặc định), 110M Nano, hoặc 500M Tiêu chuẩn; có, Nano có thể dùng CPU | Tiếng Anh | 10 giây; phần dài hơn bị bỏ qua âm thầm khi vượt quá cửa sổ 10 s của prompt | Nhân bản từ tham chiếu, các tag sự kiện được hỗ trợ; model tiêu chuẩn cung cấp CFG/exaggeration | Trọng tâm nhanh/gọn; wrapper trả về WAV đầy đủ | Thiết lập nhân bản tiếng Anh gọn nhẹ hoặc thử nghiệm trên CPU |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 1.7B cho mỗi chế độ; có, các model hoán đổi cho nhau | 10 ngôn ngữ, bao gồm tiếng Anh/tiếng Nhật | Từ 3 giây; không có giới hạn ghi nhận | Nhân bản hoặc VoiceDesign qua mô tả văn bản | Trọng tâm chất lượng; streaming ở upstream, wrapper lưu vào bộ đệm | Nhân bản đa ngôn ngữ đa dụng và VoiceDesign tiếng Nhật |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 4B nhân bản + ~1.7B thiết kế, hoán đổi; 16 GB là mục tiêu thử nghiệm chưa xác minh; bản 8B flagship có thể không vừa | Nhân bản: 31, bao gồm tiếng Nhật; thiết kế: tiếng Anh/tiếng Trung | Không được ghi nhận ở upstream; không có giới hạn runtime | Nhân bản hoặc VoiceGenerator qua mô tả văn bản; tag ngôn ngữ nhân bản | Thử nghiệm; Nhân bản cục bộ có backend streaming ở upstream, wrapper lưu vào bộ đệm | So sánh chất lượng nhân bản MOSS hoặc thiết kế giọng nói tiếng Anh/tiếng Trung |
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~0.8B bản v4.1 Small hiện tại; quan sát ~3-4 GB VRAM trong một lần chạy cục bộ | Chỉ tiếng Nhật | ~30 giây; bị cắt ở giới hạn 120 s của checkpoint | Nhân bản hoặc VoiceDesign; gợi ý phong cách qua emoji | Bước lấy mẫu đánh đổi chất lượng lấy tốc độ; wrapper lưu vào bộ đệm | Giọng tiếng Nhật chiếm ít tài nguyên và cách truyền đạt điều khiển bằng emoji |
| [Fish S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B; mặc định BF16 chính thức (~16-18 GB), tùy chọn INT8 cho 16 GB | 83 ngôn ngữ theo công bố upstream | 10-30 giây; không có giới hạn runtime | Nhân bản từ tham chiếu (cần bản ghi văn bản tham chiếu), tag biểu cảm trong ngoặc vuông tự do | Model Dual-AR nặng; yêu cầu Linux/WSL2 với Triton để tổng hợp nhanh (~65× RTF trên Windows ở eager mode) | Nhân bản biểu cảm chi tiết; hãy kiểm tra các điều khoản giấy phép nghiên cứu |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B; ~8 GB BF16 theo báo cáo upstream | 30 | 5-30 giây; khoảng được ghi nhận, không có giới hạn runtime | Nhân bản, Voice Design, Ultimate Cloning hỗ trợ bản ghi văn bản, hướng dẫn ngữ điệu | ~0.30 RTF trên RTX 4090 upstream; streaming ở upstream, wrapper lưu vào bộ đệm | Một model đa ngôn ngữ với các kiểm soát nguồn giọng nói rộng nhất |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 0.5B phần lõi; 16 GB thoải mái, tải về/runtime lớn hơn | 9 ngôn ngữ, bao gồm tiếng Nhật, cộng với các phương ngữ tiếng Trung | 3-30 giây; phần dài hơn được cắt về 30 giây đầu tiên | Nhân bản, nhân bản chéo ngôn ngữ, truyền đạt bằng ngôn ngữ tự nhiên | Trọng tâm độ trễ thấp; streaming văn bản/âm thanh gốc ở upstream, wrapper lưu vào bộ đệm | Một ứng viên streaming tương lai với khả năng nhân bản chéo ngôn ngữ |

Kích thước model và số lượng ngôn ngữ tuân theo các trang upstream của [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) và [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512). Hãy kiểm tra từng hướng dẫn để biết chi tiết về hệ điều hành, driver, giấy phép, revision model và bộ nhớ. Một GPU 16 GB không nhất thiết có thể chạy đồng thời cả model TTS và LLM cục bộ lớn.

Yêu cầu tự động đầu tiên của Qwen3-TTS bao gồm việc nạp model. MOSS tải trước cả hai model trong quá trình thiết lập và làm ấm model nhân bản khi khởi động theo mặc định, nhưng máy chủ tự động ở cả hai engine vẫn phải nạp model còn lại sau khi chuyển đổi chế độ. TomoriBot đợi tối đa `TTS_SYNTHESIZE_TIMEOUT_MS` (mặc định 240000 ms) cho mỗi phản hồi hoàn chỉnh.
