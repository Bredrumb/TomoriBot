---
title: "Phiên âm KoboldCPP"
sidebar:
  order: 3
---

KoboldCPP có hỗ trợ STT dựa trên Whisper, nhưng cấu trúc endpoint có thể khác nhau tùy theo bản dựng. Bộ chuyển đổi Phase 4 của TomoriBot yêu cầu `POST /v1/audio/transcriptions` tương thích OpenAI.

## Cài đặt

Khởi động KoboldCPP với Whisper/STT được bật và xác nhận bản dựng của bạn cung cấp:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` hoặc `GET /models`

Giữ KoboldCPP chạy trong khi TomoriBot đang sử dụng. Nếu bản dựng của bạn chỉ cung cấp `/api/extra/transcribe` hoặc cấu trúc tùy chỉnh khác, hãy sử dụng một wrapper cho đến khi TomoriBot có bộ chuyển đổi chuyên dụng.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn **Add New Custom Endpoint**, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: thư mục gốc máy chủ KoboldCPP của bạn

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm tên model mà
máy chủ của bạn báo cáo dưới dạng model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản phiên âm

Sau khi đăng ký, TomoriBot sẽ phiên âm các tệp âm thanh đính kèm trong nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Engine > Notices nếu bạn cũng muốn các bản phiên âm được gửi hiển thị rõ ràng trong đoạn chat.
