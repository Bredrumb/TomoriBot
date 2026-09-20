---
title: "Thiết lập: Codex CLI qua ChatMock"
sidebar:
  order: 5
---

Nếu bạn muốn TomoriBot sử dụng tài khoản ChatGPT của mình thông qua một cầu nối tương thích OpenAI cục bộ, bạn có thể chạy [ChatMock](https://github.com/RayBytes/ChatMock) và trỏ nhà cung cấp `custom` của TomoriBot vào đó.

## ChatMock hoạt động như thế nào

- ChatMock chạy một máy chủ API tương thích OpenAI cục bộ
- TomoriBot có thể sử dụng máy chủ cục bộ đó thông qua nhà cung cấp `custom`

## 1. Khởi động ChatMock

Cài đặt và khởi động ChatMock theo hướng dẫn trên GitHub của dự án:

- [Kho lưu trữ ChatMock](https://github.com/RayBytes/ChatMock)

Sau khi cài đặt, hãy chạy:
```sh
chatmock login
chatmock serve
```

Theo mặc định, ChatMock lắng nghe tại `http://127.0.0.1:8000/v1`

## 2. Cấu hình TomoriBot sử dụng ChatMock

Trong Discord, cấu hình nhà cung cấp `custom` của TomoriBot và sử dụng:

- **Endpoint URL**: `http://127.0.0.1:8000/v1`
- **Model Name**: chuỗi model chính xác mà ChatMock sẽ nhận, chẳng hạn như `gpt-5.4` hoặc `gpt-5.3-codex`

Địa chỉ dạng rút gọn `http://127.0.0.1:8000` cũng hoạt động: TomoriBot sẽ chuẩn hóa thành `/v1` trước khi thêm `/chat/completions`.

Bật các cờ tính năng sau cho ChatMock:
- **Function Calling / Tools**: Có
- **Image Understanding**: Có
- **Video Understanding**: Không
- **Structured Output**: Có

**Lưu ý**: Codex CLI không cho phép thay đổi prompt `system`, do đó prompt `system` của TomoriBot được chuyển thành lượt `user` trong ngữ cảnh như một giải pháp thay thế. Vui lòng cấu hình biến môi trường `CHATMOCK_PORT` trong `.env` để khớp với cổng ChatMock thực tế của bạn nhằm giúp giải pháp này hoạt động chính xác (mặc định là 8000).
