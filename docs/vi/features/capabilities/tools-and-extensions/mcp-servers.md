---
title: "Máy chủ MCP"
sidebar:
  order: 3
---

Các máy chủ [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) mở rộng TomoriBot với những công cụ bên ngoài do chính bạn đăng ký.

### Thêm một MCP trực tuyến

Sử dụng endpoint HTTPS trực tiếp của nhà cung cấp có hỗ trợ MCP Streamable HTTP hoặc SSE:

Thêm endpoint và mọi thông tin xác thực cần thiết trong `/config` > `Plugin` > `MCP server`. Chọn `Trình kiểm tra văn phong` cho công cụ kiểm tra quy tắc của Duyệt phản hồi; các công cụ của máy chủ này sẽ không được gọi trong khi trò chuyện.

Token xác thực được mã hóa khi lưu trữ. Tắt một máy chủ dùng cho tìm kiếm hoặc đọc URL sẽ khôi phục lại công cụ tích hợp sẵn. Danh sách công cụ đã lưu phản ánh lần khám phá thành công gần nhất và không đảm bảo máy chủ hiện vẫn có thể kết nối.

Phản hồi công cụ bị giới hạn ở mức 8 MiB, bao gồm toàn bộ luồng đối với kết nối SSE. Hãy yêu cầu nhà cung cấp phân trang hoặc trả về kết quả nhỏ hơn nếu một công cụ vượt quá giới hạn này.

### Thêm một MCP yêu cầu đăng nhập

Một số dịch vụ, chẳng hạn như Linear và Notion, yêu cầu bạn đăng nhập vào tài khoản thay vì cấp token. Hãy thêm MCP đó và để trống ô `Token xác thực`. Khi máy chủ yêu cầu đăng nhập, bảng điều khiển sẽ hiển thị nút `Đăng nhập`:

1. Chọn `Đăng nhập` và đăng nhập vào dịch vụ trong vòng 10 phút.
2. Trang xác nhận sẽ nêu rõ máy chủ Discord của bạn và địa chỉ của MCP. Chỉ chọn `Kết nối` nếu cả hai thông tin đều đúng và chính bạn là người bắt đầu phiên đăng nhập này.
3. Bảng điều khiển trong Discord sẽ tự động cập nhật sau khi MCP được thêm.

Mọi thành viên sử dụng công cụ của MCP đó đều hành động dưới tư cách tài khoản đã đăng nhập, vì vậy hãy sử dụng một tài khoản có dữ liệu mà cả máy chủ có thể xem.

Khi phiên đăng nhập hết hạn hoặc dịch vụ yêu cầu thêm quyền truy cập, các công cụ của MCP đó sẽ tạm dừng và hàng của nó sẽ hiển thị nút `Kết nối lại`. Hãy chọn nút đó và đăng nhập lại; MCP vẫn giữ nguyên tên, loại và vị trí của mình.

Tính năng đăng nhập chỉ hoạt động khi thêm MCP trong máy chủ, không hỗ trợ trong tin nhắn trực tiếp (DM). Trên bot self-hosting, người vận hành cần thiết lập tính năng này trước; xem [Thiết lập đăng nhập MCP](/self-hosting/mcp-servers/mcp-sign-in/).

### Máy chủ MCP cục bộ

Máy chủ MCP cục bộ chỉ được hỗ trợ trên các bản cài đặt self-hosting, vì bot được lưu trữ công khai yêu cầu HTTPS và chặn các địa chỉ cục bộ/riêng tư. Nếu bạn tự chạy bản cài đặt riêng, hãy xem [Thiết lập: Máy chủ MCP cục bộ](/self-hosting/mcp-servers/setup-local-mcp/).

:::danger[Chỉ thêm các máy chủ MCP mà bạn tin tưởng]
Một máy chủ MCP độc hại có thể tiêm prompt chứa chỉ dẫn ẩn cho TomoriBot, đánh cắp dữ liệu mà người dùng truyền vào công cụ của nó, hoặc trả về kết quả sai lệch hay độc hại để bot chuyển tiếp lại vào máy chủ của bạn. Hãy coi máy chủ MCP giống như tiện ích mở rộng trình duyệt: nếu còn nghi ngờ, đừng thêm vào. Luôn kiểm tra kỹ các công cụ được mô tả của MCP trước khi thêm.
:::
