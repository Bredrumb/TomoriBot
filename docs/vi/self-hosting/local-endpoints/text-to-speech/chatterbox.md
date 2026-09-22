---
title: "Chatterbox TTS"
---

Sử dụng `servers/tts/chatterbox/server.py` để sao chép giọng nói tiếng Anh với các thẻ sự kiện được hỗ trợ. Đường dẫn model nhanh mặc định là Chatterbox-Turbo (350M tham số). Bạn có thể chọn Chatterbox-Nano (110M tham số) cho các triển khai nhỏ hơn hướng tới CPU. Wrapper này không tải Chatterbox Multilingual V3.

## Cài đặt

Chạy các lệnh này từ thư mục gốc của kho lưu trữ TomoriBot, thư mục nơi bạn đã sao chép TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Giữ cửa sổ terminal đó mở trong khi TomoriBot đang sử dụng Chatterbox. URL endpoint mặc định là `http://127.0.0.1:8011`.

### Tùy chọn: sử dụng Chatterbox-Nano

Nano yêu cầu bản dựng Chatterbox có tùy chọn trình tải `nano=True`. Sau khi thiết lập thông thường ở trên, hãy cài đặt bản sửa đổi thượng nguồn được ghim trong cùng môi trường ảo. Mã băm commit cố định phiên bản nguồn tương thích; đây không phải là một bảo đảm an ninh. Lệnh này yêu cầu `git` và giữ lại các phần phụ thuộc runtime đã được cài đặt:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Sau đó đặt `CHATTERBOX_FAST_MODEL=nano` trước khi khởi động wrapper. Để trống biến này đối với Turbo. Trên Windows PowerShell, hãy đặt biến bằng `$env:CHATTERBOX_FAST_MODEL = "nano"`; trên Linux hoặc macOS, sử dụng `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. Phản hồi `/health` báo cáo `fast_model` để bạn có thể xác minh lựa chọn đã tải. Nano và Turbo sử dụng cùng yêu cầu sao chép và các thẻ sự kiện được hỗ trợ. Cả hai đều chỉ hỗ trợ tiếng Anh.

Nút bật tắt model nhanh trong `/config` phải luôn được bật để sử dụng Nano hoặc Turbo. Việc tắt nút này sẽ chọn model Chatterbox 0.5B tiêu chuẩn để tinh chỉnh trọng số CFG và độ phóng đại.

### Chatterbox tiêu chuẩn (0.5B với CFG & độ phóng đại)

Model Chatterbox 0.5B gốc (`ChatterboxTTS`) được tích hợp trực tiếp vào server wrapper. Model này đánh đổi các thẻ sự kiện trong ngoặc vuông nội dòng của Turbo để lấy khả năng kiểm soát giọng nói chi tiết bằng cách sử dụng **Classifier-Free Guidance (`cfg_weight`)** và **`exaggeration`** (độ phóng đại cảm xúc).

Cách sử dụng model Tiêu chuẩn:
1. Khởi động server wrapper như bình thường.
2. Trong Discord, chạy `/config` > **Models** > **TTS Parameters & Voices**.
3. Chuyển nút bật tắt tùy chọn **Fast Model (Turbo)** sang **TẮT**.
4. Ở lần tạo tiếp theo, wrapper sẽ tải trễ và nạp model 0.5B tiêu chuẩn vào bộ nhớ.

Cả hai giá trị đều là các trường văn bản trong cửa sổ tương tác **Edit Parameters**. Chúng luôn có thể chỉnh sửa được, và trang có lưu ý rằng chúng sẽ bị bỏ qua khi model nhanh được bật:
- **`cfg_weight`** (mặc định `0.5`): Điều chỉnh mức độ âm thanh tổng hợp bám sát theo nhịp độ và phong cách giọng nói tham chiếu.
- **`exaggeration`** (mặc định `0.5`): Kiểm soát cường độ cảm xúc và ngữ điệu kịch tính khi truyền đạt.

> [!NOTE]
> Chatterbox tiêu chuẩn không hỗ trợ các thẻ sự kiện trong ngoặc vuông nội dòng (chẳng hạn như `[laughs]` hoặc `[sigh]`). TomoriBot tự động loại bỏ các thẻ trong ngoặc vuông khỏi văn bản prompt khi nút bật tắt Fast Model bị tắt.

## Đăng ký trong TomoriBot

Bao gồm `Chatterbox` trong nhãn endpoint hoặc tên model. TomoriBot chỉ nhận diện endpoint Chatterbox qua tên đó (hoặc URL endpoint chứa tên đó), vì vậy danh sách cho phép thẻ Turbo, việc loại bỏ thẻ của model tiêu chuẩn, và các tùy chọn Chatterbox trong `/generate voice-message` chỉ áp dụng khi có tên này.

Chạy `/providers`, chọn **Add New Custom Endpoint**, và sử dụng độ tương thích API giọng nói:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm một model Speech. Chọn `Voice Clone` làm Voice Source Mode và `Bracket Tags` làm Script Markup để các thẻ truyền đạt vẫn còn khi gửi.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Thiết lập giọng nói persona

1. Chuẩn bị một đoạn âm thanh giọng nói rõ ràng dài 10 giây với một người nói và không có nhạc nền.
2. Mở `/config` trong phần Models > TTS Parameters & Voices và tải đoạn âm thanh lên.
3. Mở `/config` trong phần Persona > Voice, sau đó chọn persona và mẫu giọng nói.

Đoạn âm thanh dài hơn không mang lại thêm giá trị nào cho Chatterbox, và cũng không bị từ chối. Runtime của nó cắt đoạn tham chiếu trước khi điều kiện hóa, nên phần âm thanh vượt quá cửa sổ vẫn được tải lên, lưu trữ, rồi sau đó bị bỏ qua ([`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py), [`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)):

- Prompt âm học là 10 giây đầu tiên trên mọi biến thể.
- Ngữ cảnh token giọng nói là 15 giây đầu tiên trên Turbo và Nano, và 6 giây trên Standard.

Những cửa sổ này là hằng số trong runtime của thượng nguồn chứ không phải hướng dẫn được công bố: README của kho lưu trữ không nêu độ dài đoạn tham chiếu, và tên tệp ví dụ chỉ là `your_10s_ref_clip.wav`. Độ dài duy nhất mà runtime thực sự áp đặt là mức tối thiểu, yêu cầu prompt dài hơn 5 giây.

Vì vậy, mười giây là mục tiêu thực tế. Độ dài này lấp đầy prompt âm học, nơi quyết định âm sắc và cách truyền đạt, và một đoạn từ 10 đến 15 giây chỉ bổ sung ngữ cảnh token giọng nói trên Turbo và Nano. Embedding của người nói vẫn được tính từ toàn bộ đoạn âm thanh, nên kéo dài hơn không làm thay đổi danh tính người nói, mà chỉ thay đổi lượng prompt bị bỏ đi mà không được đọc.

Turbo và Nano có thể sử dụng các thẻ sự kiện trong ngoặc vuông như `[laugh]` và `[sigh]` khi nút bật tắt model nhanh được bật.

## Tinh chỉnh tùy chọn

Sử dụng `/config` trong phần Models > TTS Parameters & Voices để tinh chỉnh payload yêu cầu Chatterbox:

- Nút bật tắt model nhanh mặc định là bật. TomoriBot giữ lại các thẻ sự kiện Turbo/Nano được hỗ trợ và loại bỏ các thẻ mô tả trong ngoặc vuông không được hỗ trợ trước khi wrapper gọi `ChatterboxTurboTTS.generate(...)`.
- `cfg_weight` mặc định là `0.5`. Giá trị tối thiểu là `0`; TomoriBot không đặt mức tối đa cứng. Giá trị này chỉ áp dụng khi `turbo` là `false`; các giá trị thấp hơn có thể giúp làm chậm các giọng nói tham chiếu nhanh, trong khi các giá trị cao hơn sẽ bám sát giọng tham chiếu mạnh mẽ hơn.
- `exaggeration` mặc định là `0.5`. Giá trị tối thiểu là `0`; TomoriBot không đặt mức tối đa cứng. Giá trị này chỉ áp dụng khi `turbo` là `false`; các giá trị cao hơn làm cho cách truyền đạt giàu cảm xúc hoặc kịch tính hơn và có thể tăng tốc độ nói.

Các thẻ sự kiện Turbo/Nano được hỗ trợ là `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]`, và `[laugh]`. Các thẻ mô tả không được hỗ trợ như `[excited]`, `[whisper]`, hoặc `[smiles]` sẽ bị loại bỏ thay vì được gửi đến TTS.

Khi `turbo` bị tắt, TomoriBot sẽ loại bỏ tất cả các thẻ mô tả trong ngoặc vuông trước khi gửi văn bản đến TTS, sau đó wrapper sẽ tải trễ model `ChatterboxTTS` tiêu chuẩn và gọi `model.generate(..., cfg_weight, exaggeration)`.
