---
title: "Phiên âm WhisperX"
sidebar:
  order: 1
aiGenerated: true
---

Thiết lập tính năng chuyển giọng nói thành văn bản cục bộ, chính xác cho TomoriBot bằng máy chủ [WhisperX](https://github.com/m-bain/whisperX) đi kèm. WhisperX cung cấp khả năng sao chép âm thanh nhanh chóng với khả năng căn chỉnh theo cấp độ từ.

## Cài đặt

Chạy các lệnh này từ kho lưu trữ gốc TomoriBot:

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

Giữ terminal đó mở trong khi TomoriBot đang sử dụng WhisperX. URL endpoint mặc định là `http://127.0.0.1:8021`. Trên Windows, hãy sử dụng `127.0.0.1` thay vì `localhost`.

## Chọn model

Đặt `WHISPERX_MODEL` trước khi khởi động máy chủ.

| `WHISPERX_MODEL` | Kích thước | Mục đích sử dụng |
|---|---|---|
| `large-v3` | 1.55B | Độ chính xác đa ngôn ngữ tốt nhất; tốn nhiều hơn khoảng 0.6 GiB VRAM so với turbo |
| `large-v3-turbo` | 809M | Đa ngôn ngữ, bộ giải mã nhanh hơn; tiếng Nhật kém hơn một chút |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | Chỉ tiếng Nhật; chính xác hơn turbo trên các đoạn âm thanh kiểm thử tiếng Nhật, ở cùng tốc độ |

Trên các đoạn âm thanh ngắn, bộ mã hóa chiếm ưu thế, vì vậy cả ba đều chạy ở tốc độ tương đương nhau. Hãy chọn theo ngôn ngữ và VRAM.
`small` và `base` giảm độ chính xác tiếng Nhật quá nhiều nên không được khuyến nghị. Các model Whisper vẫn có thể tự tạo thêm chữ trên các đoạn âm thanh rất ngắn hoặc gần như không có tiếng.

## GPU

Máy chủ sẽ tự động sử dụng GPU NVIDIA khi có sẵn. Kiểm tra `http://127.0.0.1:8021/health`: `device` phải hiển thị `cuda`. Trên Windows, tính năng nhận dạng giọng nói cần các DLL cuBLAS và cuDNN của CUDA 12 trong `PATH` của bạn. Nếu thiếu chúng, máy chủ sẽ in ra `GPU found but unusable` khi khởi động và chạy trên CPU, vốn chậm hơn rất nhiều: hãy cài đặt chúng và khởi động lại máy chủ. Nếu bạn đặt `WHISPERX_DEVICE=cuda`, máy chủ sẽ dừng ngay khi khởi động thay vì chạy tiếp.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm chính xác giá trị của `WHISPERX_MODEL` (mặc định là `large-v3`, hoặc ID repo đầy đủ như `kotoba-tech/kotoba-whisper-v2.0-faster`) làm model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản ghi

Sau khi đăng ký, TomoriBot sẽ chép lại các tệp đính kèm âm thanh ở chế độ nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Hành vi > Hành vi thông báo nếu bạn cũng muốn bản ghi được đăng rõ ràng trong cuộc trò chuyện.
