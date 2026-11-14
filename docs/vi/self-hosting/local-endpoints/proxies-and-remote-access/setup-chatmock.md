---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
---

Kết nối TomoriBot với một cầu nối Chat Completions cục bộ bằng [ChatMock](https://github.com/RayBytes/ChatMock).

:::danger[Tự chịu rủi ro khi dùng proxy tài khoản CLI]
Việc truy cập của bên thứ ba qua tài khoản CLI có thể vi phạm điều khoản của nhà cung cấp và có nguy cơ bị tạm khóa tài khoản. Gói đăng ký không đồng nghĩa với quyền sử dụng cho bot hoặc API. Hãy xem [hướng dẫn về rủi ro tài khoản](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk) trước khi đăng nhập; TomoriBot không đưa ra bất kỳ đảm bảo an toàn tài khoản nào.
:::

## 1. Khởi động ChatMock

1. Cài đặt ChatMock theo [hướng dẫn trong kho lưu trữ](https://github.com/RayBytes/ChatMock).
2. Nếu tài khoản và phương thức truy cập của bạn cho phép sử dụng theo cách này, hãy xác thực và khởi động máy chủ:

```sh
chatmock login
chatmock serve
```

3. Xác nhận API cục bộ có thể truy cập tại `http://127.0.0.1:8000/v1`.

## 2. Cấu hình TomoriBot

1. Chạy `/providers` hoặc `/personal providers` và thêm một endpoint tùy chỉnh `Tương thích OpenAI`.
2. Nhập cài đặt kết nối:

| Trường | Giá trị |
|---|---|
| `URL endpoint` | `http://127.0.0.1:8000/v1` khi bot chạy trên chính máy này ngoài môi trường production |
| `Token xác thực` | Client key của cầu nối nếu đã bật xác thực |

3. Chọn endpoint đã lưu và thêm một `Model văn bản` với đúng ID API mà ChatMock cung cấp. Đăng ký thêm các ID khác dưới cùng một kết nối để chuyển đổi giữa các model.

- Địa chỉ trần `http://127.0.0.1:8000` tự động chuẩn hóa thành `/v1`; không thêm `/chat/completions`.
- Cho phép `127.0.0.1:8000` trong cài đặt `ALLOW_PRIVATE_NETWORK` ở môi trường phát triển của TomoriBot. Địa chỉ loopback trong Docker trỏ vào chính container đó.
- Chỉ bật công cụ, hình ảnh hoặc đầu ra có cấu trúc sau khi đã kiểm tra cầu nối và model đã chọn. Luôn tắt video.
- Với bot production được lưu trữ riêng, hãy làm theo hướng dẫn [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/). Môi trường production yêu cầu HTTPS công khai. Cơ chế phát hiện prompt ChatMock dựa trên loopback/cổng trực tiếp không áp dụng cho hostname công khai của tunnel, vì vậy hãy kiểm tra riêng hành vi của chỉ dẫn hệ thống. Việc đăng nhập tài khoản chỉ ủy quyền cho các yêu cầu thượng nguồn của ChatMock, không xác thực client truy cập vào endpoint công khai của bạn. Hãy xem mục [rủi ro đã biết](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks) trong hướng dẫn tunnel trước khi chia sẻ.

:::note[Xử lý system prompt và cấu hình cổng]
TomoriBot phát hiện endpoint loopback trên `CHATMOCK_PORT` (mặc định `8000`) và chuyển đổi các chỉ dẫn hệ thống thành lượt người dùng ban đầu để tương thích với ChatMock. Hãy đặt `CHATMOCK_PORT` khớp với cổng ChatMock cục bộ khác nếu bạn thay đổi cổng.
:::
