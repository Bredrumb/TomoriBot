---
title: "Kiểm duyệt máy chủ"
sidebar:
  order: 2
---

TomoriBot cung cấp cho quản trị viên máy chủ các biện pháp kiểm soát cách bot hoạt động trong máy chủ của bạn (ai có thể sử dụng bot, ở đâu và chi phí bao nhiêu) thông qua bảng điều khiển `/config` và các lệnh liên quan. Hầu hết các lệnh đều yêu cầu quyền **Manage Server**. Trang này trình bày các nội dung nổi bật; mọi lệnh đều có trong [Danh mục lệnh](/vi/features/command-reference/).

## Kiểm soát chi phí: Hạn ngạch
<!-- anchor: cost-control-quotas -->

Việc tạo nội dung tốn chi phí (của bạn hoặc của thành viên). Hạn ngạch giới hạn mức sử dụng theo từng người dùng và trên toàn máy chủ:

- `/moderation` → `Hạn ngạch`: cấu hình giới hạn hàng ngày theo từng người dùng và quỹ dùng chung toàn máy chủ được đặt lại định kỳ cho việc tạo văn bản, hình ảnh và video.
- `/quota reset`: đặt lại thủ công hạn ngạch của người dùng hoặc quỹ máy chủ.

Đặt giới hạn theo người dùng thành `0` để không giới hạn. Quỹ toàn máy chủ sẽ được đặt lại theo khoảng thời gian ngày có thể cấu hình.

## User BYOK (Bring Your Own Key)
<!-- anchor: user-byok-bring-your-own-key -->

Lệnh `/moderation` **((Member Access))** mang đến hai lựa chọn trạng thái. **Allow Server Models** là mặc định; **Require Personal Providers** yêu cầu mỗi thành viên phải tự mang theo nhà cung cấp cá nhân của **chính họ** cho các lần kích hoạt của họ, vì vậy máy chủ không phải trả bất kỳ chi phí nào cho các tin nhắn do người dùng khởi xướng. Các kích hoạt do máy chủ khởi xướng vẫn sử dụng nhà cung cấp của máy chủ. Đây là biện pháp kiểm soát chi phí mạnh nhất: chuyển toàn bộ chi tiêu API sang cho các thành viên. Thành viên tự thiết lập mục này trong [Cá nhân hóa → Nhà cung cấp riêng của bạn](/vi/features/knowledge/personalization/#your-own-providers).

Bạn cũng có thể khởi tạo một máy chủ **không có** bất kỳ nhà cung cấp văn bản nào phía máy chủ bằng cách chọn `BYOK người dùng` trong quá trình chạy `/setup`. Tùy chọn này được cung cấp trong máy chủ thay vì trong DM, và sẽ yêu cầu xác nhận trước khi hoàn tất bước nhà cung cấp, vì không gian làm việc khi đó sẽ không có nhà cung cấp nào để dự phòng.

## Kiểm soát truy cập: Danh sách trắng

- `/moderation` → `Whitelist` → `Kênh`: chọn các kênh kích hoạt và tùy chỉnh ưu tiên cooldown tùy chọn.
- `/moderation` → `Whitelist` → `Persona`: giới hạn những kênh mà một persona cụ thể có thể kích hoạt.
- `/moderation` → `Whitelist` → `Vai trò`: giới hạn kích hoạt cho các vai trò cụ thể.
- `/config` > Engine > Trigger: đặt cooldown toàn cục giữa các phản hồi.

Các kênh trong danh sách trắng sẽ kế thừa cooldown toàn cục trừ khi bạn thiết lập tùy chỉnh ưu tiên riêng cho từng kênh.

## Kiểm soát học tập và quyền riêng tư

- `/server memberpermissions`: kiểm soát ai có thể dạy bot những điều mới.
- `/moderation` > User Blacklist: khiến bot bỏ qua hoàn toàn những thành viên cụ thể. Họ không thể kích hoạt
  bot hay dùng các lệnh tương tác, và tin nhắn của họ không bao giờ vào ngữ cảnh của bot.
- `/config` > Channels > Channel Rules: đánh dấu các kênh nơi bộ nhớ ngắn hạn bị cô lập và nhật ký suy nghĩ bị ẩn.

## Tính minh bạch: Nhật ký suy nghĩ

Lệnh `/server thought-logs` thiết lập một kênh nơi suy luận nội bộ và các lệnh gọi công cụ thành công của bot được đăng tải, rất hữu ích để kiểm tra những gì bot đang thực hiện (bao gồm kích hoạt nào đã để lộ một công cụ trong [Chế độ công cụ có chủ đích](/vi/features/capabilities/tools-and-extensions/#deliberate-tool-mode)).

## Lời chào mừng

Lệnh `/config` > Channels > Logs & Welcome cấu hình lời chào tự động cho các thành viên mới trong kênh đã chọn. Theo mặc định, Tomori đợi một phút trước khi chào mừng họ để quá trình tiếp nhận thành viên của máy chủ có thể hoàn tất. Sử dụng nút `Xóa lời chào` trên cùng trang đó để dừng gửi lời chào.

## Biểu cảm

Lệnh `/expressions initialize` đăng ký các emoji và sticker tùy chỉnh của máy chủ để bot sử dụng chính xác (khuyến nghị thực hiện ngay sau khi thiết lập). Để biết bot làm gì với chúng (sử dụng `:emoji:` tự nhiên, sticker, biểu cảm phản ứng), hãy xem [Biểu cảm và phản ứng](/vi/features/chatting-personality/chatting-and-triggers/#expressions--reactions).
