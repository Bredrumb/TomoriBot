---
title: "Máy chủ MCP"
sidebar:
  label: "Tổng quan"
  groupLabel: "Máy chủ MCP"
  order: 8
---

Cấu hình phiên bản TomoriBot self-hosting của bạn để hỗ trợ quy trình đăng nhập OAuth hoặc chạy các máy chủ Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) cục bộ song song với bot.

| Hướng dẫn | Mục đích |
|---|---|
| [Thiết lập đăng nhập MCP](/self-hosting/mcp-servers/mcp-sign-in/) | Đặt `TOMORI_PUBLIC_BASE_URL` để quản trị viên có thể hoàn tất OAuth trên trình duyệt khi thêm máy chủ MCP từ xa. |
| [Máy chủ MCP cục bộ](/self-hosting/mcp-servers/setup-local-mcp/) | Chạy máy chủ MCP HTTP/SSE trên `localhost` hoặc mạng riêng của bạn và đăng ký nó trong Discord. |
| [slop-guard](/self-hosting/mcp-servers/setup-slop-guard/) | Chạy trình kiểm tra văn phong `slop-guard` đóng gói trong container qua MCP Streamable HTTP cho mục kiểm tra quy tắc của Duyệt phản hồi. |

Để thêm, kiểm tra hoặc xóa máy chủ MCP trong Discord, hãy xem [Máy chủ MCP](/features/capabilities/tools-and-extensions/mcp-servers/).
