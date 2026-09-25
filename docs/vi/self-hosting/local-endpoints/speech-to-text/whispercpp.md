---
title: "Phiên âm whisper.cpp"
sidebar:
  order: 2
---

whisper.cpp có thể được sử dụng khi máy chủ HTTP của nó cung cấp endpoint `POST /v1/audio/transcriptions` tương thích OpenAI.

## Cài đặt

Khởi động máy chủ HTTP whisper.cpp của bạn và xác nhận máy chủ cung cấp endpoint phiên âm tương thích OpenAI:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` hoặc `GET /models`

Giữ máy chủ chạy trong khi TomoriBot đang sử dụng. URL của endpoint là thư mục gốc của máy chủ, chẳng hạn như `http://127.0.0.1:8022`.

Nếu bản dựng whisper.cpp của bạn cung cấp một cấu trúc endpoint khác, hãy đặt một wrapper mỏng phía trước để ánh xạ các yêu cầu sang cấu trúc tương thích OpenAI mà TomoriBot yêu cầu.

## Đăng ký trong TomoriBot

Chạy `/providers`, chọn `Thêm endpoint tùy chỉnh mới`, và sử dụng độ tương thích API phiên âm:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: thư mục gốc máy chủ whisper.cpp của bạn

Sau khi lưu kết nối, hãy chọn kết nối đó và sử dụng menu thả xuống model để thêm tên model mà
máy chủ của bạn báo cáo dưới dạng model Transcription.

Sử dụng `/providers` để đăng ký endpoint và thiết lập model. Sau đó mở `/config` > Models > Switch Models để chọn và kích hoạt endpoint đã đăng ký.

## Sử dụng bản phiên âm

Sau khi đăng ký, TomoriBot sẽ phiên âm các tệp âm thanh đính kèm trong nền và thêm văn bản vào ngữ cảnh trò chuyện. Chỉ sử dụng `/config` > Engine > Notices nếu bạn cũng muốn các bản phiên âm được gửi hiển thị rõ ràng trong đoạn chat.
