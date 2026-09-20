---
title: "Cầu nối Matrix"
sidebar:
  order: 1
---

TomoriBot có thể kết nối một **phòng Matrix** với một kênh Discord: mọi người trò chuyện từ Matrix, tin nhắn của họ được chuyển tiếp vào Discord dưới dạng tin nhắn webhook, và mình sẽ phản hồi lại trong phòng Matrix. Trang này dành cho người dùng cầu nối. Về cơ chế hoạt động nội bộ của appservice, hãy xem [kiến trúc cầu nối Matrix](/en/architecture/integrations/matrix/bridge/).

## Thiết lập

1. Mời tài khoản bot Matrix đã được cấu hình vào một phòng Matrix **không mã hóa**.
2. Sao chép **Internal Room ID** của phòng đó.
3. Chạy lệnh `/matrix link` trong kênh Discord bạn muốn kết nối, rồi dán ID phòng vào.

Sau khi bot chấp nhận lời mời, bot sẽ gửi một lời nhắc ngắn trong phòng Matrix, nhưng bạn vẫn cần hoàn tất liên kết từ Discord bằng `/matrix link`.

### Tìm ID phòng

Trong hầu hết các ứng dụng Matrix: **Room Settings → Advanced → Internal Room ID**. ID có dạng như `!abc:matrix.org`.

## Sử dụng từ Matrix

- Trò chuyện bình thường sau khi phòng đã được liên kết; tin nhắn Matrix sẽ được chuyển tiếp vào kênh Discord.
- Mình sẽ phản hồi lại trong phòng Matrix.
- Các lệnh văn bản Matrix duy nhất là `/kill` và `/refresh`.

## Các giới hạn hiện tại

- Không hỗ trợ lệnh gạch chéo từ Matrix (ngoài `/kill` và `/refresh`).
- Không hỗ trợ tin nhắn trực tiếp hoặc lời nhắc cooldown qua tin nhắn trực tiếp.
- Mình không thể nhìn thấy ảnh đại diện Matrix.
- Không thể ghim tin nhắn.
- Biểu tượng cảm xúc tùy chỉnh và Markdown không hiển thị ổn định; các embed được chuyển tiếp dưới dạng văn bản thuần túy.
- Bộ nhớ cá nhân của người dùng Matrix sẽ chuyển về bộ nhớ máy chủ có gắn tên người dùng.

## Lưu ý

- Nếu bot không tự động tham gia, hãy mời tài khoản bot Matrix theo cách thủ công và chạy lại `/matrix link`.
- **Không thể tắt mã hóa Matrix sau đó**: phòng đã mã hóa phải được thay thế bằng một phòng mới không mã hóa.
- Nếu một giới hạn không được liệt kê ở trên, hãy coi như tính năng đó hoạt động bình thường và báo cáo lỗi trong máy chủ hỗ trợ (`/support discord`).

Trong `/help`, chọn **Integrations**, rồi chọn **Matrix**, để xem hướng dẫn tương tự trong Discord.
