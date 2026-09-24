---
title: "MOSS-TTS"
---

Sử dụng `servers/tts/moss/server.py` để thử nghiệm tính năng sao chép giọng nói và thiết kế giọng nói qua mô tả văn bản của MOSS thông qua một endpoint cục bộ. Chế độ tự động sẽ chọn model sao chép khi TomoriBot gửi `ref_audio` và chọn MOSS-VoiceGenerator khi bot gửi `instruct`. Endpoint này chỉ duy trì một model được nạp trong bộ nhớ tại một thời điểm. Đây là một sidecar thử nghiệm, không phải là tích hợp kênh thoại trực tiếp dạng streaming trên Discord.

Model sao chép mặc định là [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), được chọn làm điểm khởi đầu thực tế cho GPU 16 GB. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) là một lựa chọn thay thế 8B nhưng nhìn chung sẽ cần nhiều hơn 16 GB VRAM ở định dạng BF16. Tính năng thiết kế giọng nói sử dụng [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (khoảng 1.7B). Chế độ tự động hoán đổi các model thay vì giữ cả hai trong VRAM, vì vậy việc thay đổi chế độ vẫn gây ra độ trễ nạp vào GPU.

## Cài đặt

Chạy từ thư mục gốc của kho lưu trữ TomoriBot. Sử dụng Python 3.12 và driver CUDA tương thích với các bánh xe PyTorch CUDA 12.8 của thượng nguồn. Gói mở rộng runtime của thượng nguồn ghim PyTorch và Torchaudio 2.9.1+cu128; hãy giữ sidecar này trong môi trường ảo riêng của nó. Các ngăn xếp CUDA hoặc CPU khác cần có một bản cài đặt được xác thực riêng.

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

Lệnh prefetch tải model sao chép, VoiceGenerator, và audio tokenizer của từng model vào bộ nhớ đệm Hugging Face trước khi máy chủ khởi động. Lệnh này kiểm tra dung lượng ổ đĩa còn trống của phân vùng bộ nhớ đệm trước khi tải từng kho lưu trữ và sử dụng lại các tệp đã lưu trong bộ nhớ đệm, nhưng cả hai model đều cần dung lượng đáng kể. Nếu quá trình kiểm tra không thành công, hãy giải phóng dung lượng hoặc đặt `HF_HOME` sang một phân vùng lớn hơn trong shell trước khi tải trước và khởi động máy chủ. Hãy chạy lại lệnh prefetch sau khi thay đổi bất kỳ ID model nào. Để chỉ tải một chế độ cho một lần thử nghiệm giới hạn, hãy truyền `--mode clone` hoặc `--mode voice-design`; chế độ còn lại vẫn có thể tải về ở lần sử dụng đầu tiên.

Endpoint là `http://127.0.0.1:8018`, và `bun run launch --moss` khởi động máy chủ cùng với TomoriBot. Chế độ tự động làm ấm model sao chép từ bộ nhớ đệm cục bộ trước khi báo cáo quá trình khởi động hoàn tất. Nếu bản sao chép chưa được tải trước, quá trình khởi động sẽ báo lỗi thay vì tải xuống bất ngờ. `MOSS_TTS_WARM_MODE=voice-design` sẽ làm ấm VoiceGenerator; `MOSS_TTS_WARM_MODE=none` giữ nguyên cách khởi động nạp trễ trước đây. Chỉ một chế độ được giữ trong bộ nhớ GPU. Kiểm tra `GET /health` để biết `warm_mode`, `active_mode`, và `model_id`. Wrapper sử dụng tùy chọn Hugging Face `trust_remote_code=True`, vì vậy chỉ cài đặt từ nguồn bạn tin cậy và xem xét các thay đổi thượng nguồn trước khi cập nhật.

## Đăng ký trong TomoriBot

Trong `/providers`, chọn **Add New Custom Endpoint**, đặt API Compatibility thành `tts-clone`, và sử dụng URL endpoint `http://127.0.0.1:8018`. Thêm một model Speech với **Voice Source Mode** là `Auto` và **Script Markup** là `Plain`. Sau đó kích hoạt model dưới phần `/config` > Models > Switch Models.

Đối với sao chép, hãy tải lên một đoạn clip tham chiếu rõ ràng dưới phần `/config` > Models > TTS Parameters & Voices và gán đoạn clip đó dưới phần Persona > Voice. Thượng nguồn không ghi nhận độ dài tham chiếu được khuyến nghị nào cho MOSS-TTS và cũng không có giới hạn thời lượng trong runtime của nó, vì vậy độ dài clip do bạn tự điều chỉnh; những clip ngắn và rõ ràng hơn vẫn là lựa chọn mặc định an toàn hơn. Đối với thiết kế giọng nói, hãy lưu mô tả giọng nói bằng ngôn ngữ tự nhiên dưới phần Persona > Voice. MOSS-TTS sử dụng tham chiếu âm thanh; model này không sử dụng bản phiên âm tham chiếu tùy chọn của TomoriBot. MOSS-VoiceGenerator được tài liệu hóa cho tiếng Anh và tiếng Trung, không phải tiếng Nhật. Model sao chép 4B hỗ trợ tiếng Nhật, nhưng một thẻ ngôn ngữ đã biết sẽ cải thiện khả năng tổng hợp đa ngôn ngữ.

Bộ chuyển đổi sao chép hiện tại của TomoriBot không gửi thẻ ngôn ngữ. Đối với một thử nghiệm đơn ngôn ngữ, hãy đặt `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (hoặc `English`, `Chinese`, v.v.) trước khi khởi động máy chủ. Một yêu cầu `/synthesize` thủ công có thể cung cấp `language` cho từng yêu cầu. Hãy để trống biến này cho việc sử dụng kết hợp nhiều ngôn ngữ; hãy đánh giá đầu ra tiếng Nhật trước khi dựa vào nó.

Sidecar đọc môi trường tiến trình riêng của nó. Việc thêm một giá trị vào tệp `.env` của bot không tự động chuyển giá trị đó sang một tiến trình Python được khởi động riêng biệt.

Để thử nghiệm model 8B đầu bảng trên máy có đủ bộ nhớ, hãy đặt `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` trước khi prefetch. Các biến `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` và `MOSS_TTS_MAX_NEW_TOKENS` cũng có thể định cấu hình trong `.env.optional.example`. Biến `TTS_SYNTHESIZE_TIMEOUT_MS` của bot có thể cần tăng lên cho các lần hoán đổi chế độ hoặc suy luận trên CPU.
