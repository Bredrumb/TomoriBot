---
title: "Thiết lập đăng nhập MCP"
description: "Cho phép bản TomoriBot self-hosting của bạn thêm các máy chủ MCP yêu cầu đăng nhập tài khoản."
sidebar:
  order: 1
---

Một số máy chủ MCP yêu cầu quản trị viên đăng nhập vào tài khoản thay vì dán token. Một bot self-hosting chỉ cung cấp tùy chọn đăng nhập đó khi biến `TOMORI_PUBLIC_BASE_URL` được thiết lập. Nếu không có biến này, chỉ những máy chủ MCP nhận token trong ô `Token xác thực` mới hoạt động.

Nếu bạn sử dụng [bot được triển khai công khai](https://discord.com/oauth2/authorize?client_id=841644102059556915), bạn không cần trang này; hãy xem [Máy chủ MCP](/features/capabilities/tools-and-extensions/mcp-servers/).

## Chọn URL cơ sở

Đặt `TOMORI_PUBLIC_BASE_URL` trong `.env` thành một địa chỉ không có đường dẫn (path), rồi khởi động lại bot:

| Giá trị | Khi nào nên dùng |
|---|---|
| `http://127.0.0.1:8080` hoặc `http://localhost:8080` | Hoàn tất đăng nhập trong trình duyệt trên chính máy chạy bot. Không cần tên miền hoặc tunnel. |
| `https://<your-host>` | Quản trị viên đăng nhập từ máy tính của riêng họ. Bạn cần một địa chỉ HTTPS công khai chuyển tiếp tới bot. |

Việc đặt biến này sẽ khởi động máy chủ HTTP của bot trên cổng `PORT` (mặc định `8080`), và máy chủ đó lắng nghe trên mọi giao diện mạng. Phiên đăng nhập đang diễn ra được lưu trong bộ nhớ, nên nếu khởi động lại bot giữa chừng, bạn cần bắt đầu lại từ Discord.

## Địa chỉ loopback

- Dùng đúng cổng trong `PORT`. Bot sẽ ghi một cảnh báo khi khởi động nếu hai cổng khác nhau.
- Hoàn tất đăng nhập trong trình duyệt trên máy chạy bot. Từ một máy tính khác, hãy chuyển tiếp cổng qua SSH trước, rồi chọn `Đăng nhập` trong trình duyệt của máy tính đó:

  ```sh
  ssh -L 8080:127.0.0.1:8080 "<user>@<bot-host>"
  ```

- Từng dịch vụ sẽ quyết định có chấp nhận địa chỉ loopback hay không. Nếu một dịch vụ từ chối, hãy dùng địa chỉ HTTPS hoặc token thay thế.

## Địa chỉ HTTPS

Chuyển tiếp các đường dẫn sau từ địa chỉ công khai của bạn tới cổng `PORT` của bot:

- `GET /oauth/callback`
- `GET /oauth/mcp/start`
- `POST /oauth/mcp/confirm`
- `GET /oauth/client.json`

Các dịch vụ nhận diện bot của bạn qua `https://<your-host>/oauth/client.json`, vì vậy hãy chọn tên máy chủ trước lần đăng nhập đầu tiên và giữ nguyên tên đó.

## Docker Compose

Compose không công bố cổng của bot. Hãy tạo tệp `docker-compose.override.yaml` bên cạnh `docker-compose.yaml`:

```yaml
services:
  tomoribot:
    ports:
      - "127.0.0.1:8080:8080"
```

Giữ nguyên tiền tố `127.0.0.1:`, vì nếu bỏ tiền tố này, mọi máy tính trong mạng của bạn đều có thể truy cập máy chủ HTTP của bot. Một reverse proxy hoặc tunnel chạy trên cùng máy vẫn có thể chuyển tiếp tới cổng này.
