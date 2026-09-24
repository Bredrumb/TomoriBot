---
title: "CosyVoice 3"
---

CosyVoice 3 là thế hệ hiện tại của dự án TTS đa ngôn ngữ CosyVoice từ Alibaba/QwenAudio. TomoriBot đóng gói runtime chính thức trong `servers/tts/cosyvoice3/` và cung cấp cùng giao diện `POST /synthesize` được sử dụng bởi các endpoint giọng nói cục bộ khác.

TomoriBot mặc định sử dụng checkpoint chính thức **`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`**. Đây là bản phát hành CosyVoice 3 hiện tại được thượng nguồn khuyến nghị, sử dụng model không lượng tử hóa thông thường, và đủ nhỏ để chạy thoải mái trên GPU NVIDIA 16 GB trong khi vẫn giữ nguyên thiết kế độ trễ thấp của CosyVoice.

## Các tính năng hỗ trợ

Bản phát hành CosyVoice 3 hiện tại hỗ trợ:

- Tiếng Trung, tiếng Anh, tiếng Nhật, tiếng Hàn, tiếng Đức, tiếng Tây Ban Nha, tiếng Pháp, tiếng Ý và tiếng Nga
- Hơn 18 phương ngữ và giọng địa phương tiếng Trung
- sao chép giọng nói zero-shot
- sao chép giọng nói đa ngôn ngữ và chéo ngôn ngữ
- hướng dẫn bằng ngôn ngữ tự nhiên cho ngôn ngữ, phương ngữ, cảm xúc, tốc độ nói và âm lượng
- các điều khiển chi tiết trong runtime thượng nguồn, bao gồm `[breath]` và `[laughter]`
- streaming nhập văn bản và xuất âm thanh trong runtime thượng nguồn

Các ví dụ chính thức của CosyVoice 3 hiện bao gồm một lưu ý quan trọng về tiếng Nhật: văn bản tiếng Nhật được hiển thị sau khi chuyển đổi sang katakana. Tiếng Nhật là một ngôn ngữ được hỗ trợ, nhưng nếu chữ viết tiếng Nhật thông thường cho phát âm kém, việc chuyển đổi văn bản tổng hợp sang katakana là giải pháp tạm thời được thượng nguồn khuyến nghị.

## Cách TomoriBot ánh xạ các yêu cầu

Wrapper chấp nhận các trường chuẩn của sidecar sao chép giọng nói:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

Wrapper lựa chọn API CosyVoice 3 hiện tại như sau:

| Yêu cầu | Đường dẫn CosyVoice 3 |
|---|---|
| Âm thanh tham chiếu + bản phiên âm | `inference_zero_shot` |
| Âm thanh tham chiếu không có bản phiên âm | `inference_cross_lingual` |
| `instruct` hoặc `language` rõ ràng | `inference_instruct2` |

Để có chất lượng sao chép thông thường tốt nhất, hãy cung cấp cả âm thanh tham chiếu và bản phiên âm khớp với âm thanh đó. API hướng dẫn hiện tại của CosyVoice 3 điều kiện hóa theo âm thanh tham chiếu nhưng không chấp nhận đồng thời bản phiên âm tham chiếu, do đó các yêu cầu sử dụng `instruct` sẽ chuyển sang đường dẫn `inference_instruct2` chính thức.

### Điều khiển phong cách và cảm xúc

Đăng ký endpoint với markup **Plain**. Chỉ dẫn truyền đạt thuộc về trường `voice_instructions` toàn cục của endpoint, không phải trong các thẻ ngoặc vuông nội dòng tùy ý. Điều này bảo toàn ý nghĩa của hướng dẫn cho toàn bộ câu nói và tránh việc xử lý một kịch bản như `[happy] Hello. [sad] Goodbye.` thành hai hướng dẫn toàn cục mâu thuẫn nhau. Hỗ trợ gốc cho `[breath]` và `[laughter]` được chủ ý hoãn lại cho đến khi TomoriBot có thể thông báo một tính năng thẻ nhận biết nhà cung cấp chính xác.

Trường `instruct` của `/synthesize` được chuyển vào phần điều kiện hóa hướng dẫn của CosyVoice 3. Các ví dụ bao gồm `sound relieved but still tired`, `speak as quickly as possible`, hoặc `speak quietly with restrained excitement`.

## Streaming

CosyVoice 3 hỗ trợ streaming hai chiều ở thượng nguồn. Dự án tài liệu hóa cả streaming nhập văn bản và streaming xuất âm thanh, với độ trễ âm thanh đầu tiên thấp tới khoảng 150 ms trong thiết lập tối ưu hóa của nó.

Giao diện TTS tùy chỉnh hiện tại của TomoriBot yêu cầu một phản hồi âm thanh hoàn chỉnh cho tin nhắn thoại Discord, vì vậy sidecar này trả về một tệp WAV hoàn chỉnh và đặt suy luận thượng nguồn mặc định là `stream=False`. Chỉ đặt `COSYVOICE3_UPSTREAM_STREAM=1` khi thử nghiệm trình tạo thượng nguồn; tùy chọn này không làm giảm độ trễ phản hồi của TomoriBot cho đến khi có phương thức truyền tải giọng nói dạng streaming.

## Phần cứng

Điểm khởi đầu được khuyến nghị cho TomoriBot:

- GPU NVIDIA với **16 GB VRAM**
- Python **3.10**
- Driver NVIDIA gần đây tương thích với CUDA 12
- `git`
- `ffmpeg` để chuẩn hóa mẫu giọng nói của TomoriBot
- `sox` và `libsox-dev` trên Linux nếu xảy ra sự cố tương thích âm thanh thượng nguồn

Bản thân model có 0.5B tham số và không cần lượng tử hóa để vừa với card 16 GB. Tệp tải về checkpoint Hugging Face lớn hơn nhiều so với số lượng tham số gợi ý vì nó cũng chứa flow model, speech tokenizer, model văn bản tiếng Anh, cùng cả trọng số LLM cơ sở lẫn RL. Hãy chuẩn bị khoảng 10 GB dung lượng ổ đĩa cho gói model hiện tại, cộng với môi trường Python và runtime.

Suy luận trên CPU có thể thực hiện được thông qua runtime thượng nguồn nhưng không phải là giải pháp được khuyến nghị cho việc sử dụng giọng nói độ trễ thấp trên Discord.

## Cài đặt

### Linux / WSL2 (khuyến nghị)

Từ thư mục gốc của kho lưu trữ TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Hoặc khởi động đồng thời sidecar đã định cấu hình và TomoriBot:

```bash
bun run launch --cosyvoice3
```

Trình cài đặt thực hiện:

1. kiểm tra và tải commit `QwenAudio/CosyVoice` đã duyệt `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` một cách đệ quy vào `servers/tts/cosyvoice3/CosyVoice/`;
2. tạo `servers/tts/cosyvoice3/.venv`;
3. cài đặt các yêu cầu CosyVoice thượng nguồn hiện tại cùng bộ phụ thuộc wrapper gọn nhẹ; và
4. tải `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` tại bản sửa đổi Hugging Face `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` vào `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

Các lần chạy lại giữ nguyên các bản sửa đổi chính xác đó; để chuyển sang bản mới hơn, hãy thay đổi cả hai giá trị đã ghim trong trình cài đặt. Trình cài đặt từ chối cài đặt lại lên bản tải về runtime có thay đổi cục bộ.

Các phần phụ thuộc thượng nguồn hiện sử dụng PyTorch 2.3.1 với chỉ mục gói CUDA 12.1, các gói ONNX Runtime CUDA 12 trên Linux, và các gói TensorRT 10.13 trên Linux. Nếu bạn đang sử dụng phần cứng yêu cầu bản dựng PyTorch CUDA mới hơn, hãy cài đặt bản dựng PyTorch tương thích trong venv của sidecar sau các yêu cầu thượng nguồn và kiểm tra với driver của bạn.

### Windows PowerShell

Bản chạy Windows gốc được cung cấp theo khả năng tốt nhất:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

Đối với GPU NVIDIA, **WSL2 được khuyến nghị**. Các phần phụ thuộc thượng nguồn hiện tại cài đặt ONNX Runtime hỗ trợ GPU trên Linux nhưng cài đặt ONNX Runtime cho CPU trên Windows, do đó WSL2 khớp hơn với cấu hình mà dự án CosyVoice tối ưu hóa và thử nghiệm để đạt độ trễ thấp.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn **Add New Custom Endpoint**, và định cấu hình endpoint giọng nói:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Voice Source Mode: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Sau khi lưu kết nối, hãy chọn kết nối đó và thêm một model Speech. Mã model rõ ràng là `Fun-CosyVoice3-0.5B-2512`.

Sau đó mở `/config` > Models > Switch Models và kích hoạt endpoint giọng nói CosyVoice 3.

## Gán giọng nói persona

Đối với sao chép zero-shot thông thường:

1. Chuẩn bị một mẫu âm thanh rõ ràng dài từ 3 đến 30 giây với một người nói và ít hoặc không có tiếng ồn nền.
2. Mở `/config` trong phần Models > TTS Parameters & Voices và tải mẫu âm thanh lên.
3. Nhập bản phiên âm khớp khi có thể. CosyVoice 3 sử dụng bản phiên âm này cho đường dẫn zero-shot có hỗ trợ bản phiên âm, và nó được token hóa như một tiền tố prompt, nên bản phiên âm phải mô tả âm thanh thực sự được dùng: 30 giây đầu tiên của clip.
4. Mở `/config` trong phần Persona > Voice và gán mẫu âm thanh đó cho persona.

Bộ token hóa giọng nói của CosyVoice hoạt động trên cửa sổ prompt 30 giây, và thượng nguồn thực thi điều đó bằng cách báo lỗi: giao diện web của chính thượng nguồn hướng dẫn giữ âm thanh prompt dưới 30 giây, và bộ token hóa khẳng định giới hạn đó thay vì rút ngắn chính âm thanh. Máy chủ cục bộ thì cắt bớt, nên một clip dài hơn được cắt về 30 giây đầu tiên, quá trình tổng hợp vẫn tiếp tục và việc cắt bớt được ghi log ra console của máy chủ.

Việc cắt bớt đọc clip ngay tại chỗ, nghĩa là embedding người nói được lấy từ đúng 30 giây đầu đó, cùng đoạn với các token giọng nói của prompt. CosyVoice điều kiện hóa dựa trên chính cặp này, nên một tham chiếu dài không mất đi bất cứ thứ gì mà engine vốn sẽ dùng. Tác động thực tế là chỉ 30 giây đầu của một tệp tải lên dài mới định hình giọng nói, còn phần còn lại vẫn được tải lên và lưu trữ mà không được dùng đến.

Giữ mẫu được gán trong khoảng 10 đến 20 giây sẽ nằm trong cửa sổ với biên độ thoải mái, đồng thời giữ cho bản phiên âm đã lưu khớp với âm thanh mà model đọc.

Hỗ trợ sao chép chéo ngôn ngữ. Người nói tham chiếu có thể nói ngôn ngữ khác với văn bản được tạo. Nếu không có bản phiên âm tham chiếu, wrapper sẽ sử dụng đường dẫn chéo ngôn ngữ chuyên dụng của CosyVoice 3.

## Thử nghiệm với `/generate voice-message`

Sử dụng `/generate voice-message` để thử nghiệm endpoint đang hoạt động mà không cần đợi lượt trò chuyện thông thường chọn công cụ giọng nói. Bạn có thể sử dụng mẫu đã định cấu hình của persona hoặc tải lên một mẫu dùng một lần. Khi tải lên mẫu, hãy cung cấp bản phiên âm của mẫu trong cửa sổ tương tác nếu có thể.

Để có cách truyền đạt giàu cảm xúc, hãy nhập chỉ dẫn truyền đạt toàn cục trong cửa sổ tương tác hoặc để công cụ giọng nói gửi `voice_instructions`. Giữ kịch bản đọc dưới dạng văn bản thuần túy; các thẻ phong cách nội dòng tùy ý sẽ bị xóa trước khi tổng hợp thay vì bị diễn giải sai thành các hướng dẫn cho toàn bộ câu nói.

## Biến môi trường

| Biến | Mặc định | Mục đích |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Thư mục checkpoint cục bộ |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Địa chỉ liên kết của wrapper; xem [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Cổng wrapper |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Bật trình tạo streaming nội bộ của CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Hệ số nhân tốc độ dạng số toàn cục được chuyển đến suy luận thượng nguồn |
| `COSYVOICE3_DEFAULT_INSTRUCT` | trống | Hướng dẫn tùy chọn được thêm vào khi một yêu cầu không cung cấp hướng dẫn |
| `COSYVOICE3_FP16` | `0` | Yêu cầu runtime chính thức sử dụng chế độ fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Bật tải TensorRT thượng nguồn khi đã chuẩn bị đúng cách |
| `COSYVOICE3_LOAD_VLLM` | `0` | Bật tải vLLM thượng nguồn khi đã cài đặt các phần phụ thuộc riêng biệt |

Mặc định giữ TensorRT, vLLM, và fp16 ở trạng thái tắt. Runtime PyTorch thông thường đã vừa vặn với GPU 16 GB mục tiêu, dễ cài đặt hơn, và tránh biến đường dẫn mặc định thành một thiết lập đặc thù tối ưu hóa.

## Hiệu năng và các biến thể model

### Mặc định: `Fun-CosyVoice3-0.5B-2512` cơ sở

Đây là mặc định được khuyến nghị cho TomoriBot. Model này có độ tương đồng người nói mạnh mẽ, hỗ trợ tất cả các chế độ sao chép và hướng dẫn hiện tại của CosyVoice 3, và không cần lượng tử hóa trên GPU 16 GB.

### Trọng số RL

Gói checkpoint hiện tại cũng bao gồm `llm.rl.pt`. Thượng nguồn công bố kết quả của bản cơ sở và bản RL riêng biệt. Trọng số RL cải thiện một số chỉ số lỗi nội dung, trong khi kết quả cơ sở giữ điểm số tương đồng người nói cao hơn một chút trong bảng được công bố. Vì TomoriBot nhấn mạnh vào việc sao chép giọng nói persona, wrapper giữ `llm.pt` thông thường làm mặc định.

Trình tải chính thức hiện tại luôn đọc tệp có tên `llm.pt`. Để thử nghiệm với trọng số RL mà không ghi đè lên bản cài đặt mặc định, hãy sao chép thư mục model, thay thế `llm.pt` của bản sao bằng `llm.rl.pt`, và trỏ `COSYVOICE3_MODEL_DIR` vào bản sao đó.

### vLLM và TensorRT

CosyVoice 3 cũng hỗ trợ các đường dẫn tùy chọn vLLM và TensorRT. Thượng nguồn hiện ghi nhận vLLM 0.11.x+ sử dụng engine V1 và vLLM 0.9.0 là đường dẫn cũ. Các runtime này có thêm các ràng buộc về phiên bản và phần cứng, vì vậy TomoriBot không cài đặt hoặc bật chúng theo mặc định.

Chỉ sử dụng chúng sau khi sidecar PyTorch thông thường đã hoạt động ổn định. Đối với khối lượng công việc tin nhắn thoại Discord, việc tránh độ phức tạp runtime bổ sung thường hữu ích hơn là tối ưu hóa một model 0.5B vốn đã nhỏ gọn.

## Giấy phép

Kho lưu trữ mã nguồn CosyVoice hiện tại được cấp phép theo **Apache License 2.0**, và kho lưu trữ Hugging Face `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` cũng được đánh dấu **Apache-2.0**.

Thẻ model thượng nguồn cũng chứa một tuyên bố từ chối trách nhiệm nêu rõ nội dung hiển thị dành cho mục đích trình diễn học thuật và một số ví dụ có thể đến từ internet. Một cuộc thảo luận mở ở thượng nguồn đang yêu cầu làm rõ cụ thể về mối liên hệ giữa tuyên bố từ chối trách nhiệm đó với việc sử dụng thương mại các trọng số. TomoriBot không phân phối lại model. Người tự lưu trữ nên xem xét các điều khoản giấy phép và thẻ model thượng nguồn hiện tại cho việc triển khai của riêng họ, đặc biệt trước khi sử dụng cho mục đích thương mại.
