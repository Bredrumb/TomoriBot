---
title: "Thiết lập: Máy chủ MCP cục bộ"
sidebar:
  order: 6
---

Các máy chủ [MCP](https://modelcontextprotocol.io/) mở rộng TomoriBot bằng các công cụ bên ngoài. Các máy chủ
MCP trực tuyến (HTTPS) hoạt động trên mọi phiên bản bot; xem
[Công cụ và phần mở rộng](/vi/features/capabilities/tools-and-extensions/#mcp-servers). Máy chủ MCP **cục bộ** có
sự khác biệt:

:::caution[Chỉ dành cho self-hosting]
Máy chủ MCP cục bộ **chỉ được hỗ trợ trên các phiên bản self-host**. Phiên bản bot công khai
yêu cầu HTTPS và chặn các địa chỉ cục bộ/riêng tư vì lý do bảo mật, do đó không thể kết nối tới máy chủ trên
`localhost` hoặc mạng LAN của bạn.
:::

## 1. Chạy máy chủ MCP cục bộ

Khởi động bất kỳ máy chủ MCP nào cung cấp giao thức truyền tải HTTP/SSE trên một cổng cục bộ. Ví dụ, nhiều
máy chủ MCP chạy qua Node:

```sh
npx -y <some-mcp-server> --port 3000
```

Lệnh chính xác phụ thuộc vào máy chủ bạn đang chạy. Hãy ghi lại URL và đường dẫn truyền tải mà nó
in ra (thường có dạng như `http://localhost:3000/sse`).

Bộ công cụ của chính TomoriBot yêu cầu **Node.js v20+** khả dụng trên máy chủ lưu trữ cho các công cụ MCP.

## 2. Đăng ký trong Discord

Mở `/config` > Plugins > MCP Servers, chọn **+ Add MCP**, trỏ trường **URL**
vào máy chủ cục bộ của bạn, và giữ nguyên trường bắt buộc **Server Type** ở giá trị mặc định **General Purpose**:

```text
http://localhost:3000/sse
```

Để trống trường **Auth Token**: không cần token xác thực cho các máy chủ cục bộ.

## 3. Quản lý

- Mở trang Cấu hình và chọn **Remove** trên hàng của máy chủ đó. Xác nhận thao tác sẽ hủy đăng ký,
  ngắt kết nối ngay lập tức và giải phóng một vị trí trống.

## Bảo mật

:::danger[Chỉ thêm các máy chủ MCP bạn tin cậy]
Ngay cả một máy chủ cục bộ do chính bạn chạy cũng có thể hoạt động sai trái nếu mã nguồn của nó không đáng tin cậy. Một máy chủ MCP
độc hại có thể tiêm prompt vào model, làm rò rỉ dữ liệu được truyền tới các công cụ của nó, hoặc trả về các
kết quả có hại mà TomoriBot sẽ chuyển tiếp lại. Hãy xem xét kỹ những gì một máy chủ MCP thực hiện trước khi kết nối.
:::

Để biết quy trình sử dụng MCP trực tuyến và toàn bộ cơ sở lý luận về bảo mật, xem
[Công cụ và phần mở rộng → Máy chủ MCP](/vi/features/capabilities/tools-and-extensions/#mcp-servers).
