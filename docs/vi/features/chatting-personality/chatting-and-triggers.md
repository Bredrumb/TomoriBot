---
title: "Trò chuyện & từ kích hoạt"
sidebar:
  order: 1
---

TomoriBot chỉ phản hồi khi có điều gì đó kích hoạt bot. Trang này trình bày các cách để kích hoạt bot,
cách trò chuyện rảnh tay với tính năng tự động kích hoạt, và cách ngăn việc kích hoạt ngoài ý muốn với
Chế độ kích hoạt có chủ đích.

## Cách kích hoạt bot {#how-to-trigger-her}

Theo mặc định, bot sẽ trả lời khi bạn:

- **Nhắc đến bot (mention)**: `@TomoriBot`
- **Trả lời (reply)** vào một trong các tin nhắn của bot (bao gồm cả tin nhắn webhook của một persona)
- **Sử dụng từ kích hoạt**: bất kỳ từ thông thường nào bạn đã đăng ký, được nói ở bất kỳ đâu trong tin nhắn
- **Sử dụng `/respond`**: yêu cầu bot trả lời thủ công

Từ kích hoạt là cách thuận tiện nhất: khi một từ đã được đăng ký, chỉ cần nhắc đến từ đó là bot sẽ được
kích hoạt. Trong tin nhắn trực tiếp (DM), bạn chỉ cần nói xin chào (không cần từ kích hoạt).

### Quản lý từ kích hoạt {#managing-trigger-words}

Người quản lý máy chủ sử dụng `/config` > Persona > Triggers để thêm hoặc xóa các từ kích hoạt của
persona đã chọn. Các thành viên thông thường có thể xem trang này, nhưng các nút điều khiển chỉnh sửa sẽ
bị vô hiệu hóa.

## Biểu cảm & cảm xúc phản hồi {#expressions--reactions}

Khi trả lời, bot có thể sử dụng các emoji tùy chỉnh và sticker của máy chủ bạn, đồng thời thả cảm xúc vào
các tin nhắn:

- Các emoji tùy chỉnh được sử dụng tự nhiên trong cuộc trò chuyện theo cú pháp `:name:` không phân biệt chữ hoa chữ thường.
- Sticker có thể đi kèm phản hồi; bot cũng có thể thêm cảm xúc emoji.
- Chạy lệnh `/expressions initialize` để đăng ký các emoji và sticker của máy chủ bạn nhằm giúp bot sử dụng chúng chính xác.

## Kênh nhập vai {#roleplay-channels}

Các kênh nhập vai sẽ ẩn việc sử dụng emoji tùy chỉnh và sticker trong câu trả lời của bot. Mọi người cũng
có thể sử dụng `/tool delete turn` tại đó để xóa lượt phản hồi mới nhất của bot mà không cần quyền Manage Server.

Cấu hình các kênh này từ trang Quy tắc kênh (Channel Rules) trong `/config`.

## Nhận biết ngữ cảnh xung quanh

Ngoài nội dung tin nhắn, bot được cung cấp một bản ghi nhanh ngữ cảnh Discord mỗi khi trả lời, nhờ đó bot
có thể trò chuyện về *nơi* và *thời điểm* cuộc trò chuyện đang diễn ra, chứ không chỉ những gì vừa được nói.
Ngữ cảnh này bao gồm:

- **Nơi bot đang hiện diện**: tên và mô tả của máy chủ hiện tại (hoặc thông tin đó là Tin nhắn trực tiếp),
  cùng kênh hiện tại.
- **Thời gian hiện tại**: giờ địa phương và thời điểm tương đối trong ngày của máy chủ, dựa trên
  `/config` > Engine > General, cộng với giờ địa phương của từng người nếu họ đã thiết lập trong `/personal config`.
- **Những người tham gia cuộc trò chuyện**: tên hiển thị của người tham gia, cách nhắc đến họ, mọi thẻ
  ngoại hình, cùng các lời nhắc đang chờ xử lý của họ.
- **Hoạt động của người dùng (trạng thái hiện diện)**: hoạt động Discord của người dùng: họ đang **chơi** gì,
  **phát trực tiếp** gì, **nghe** gì (ví dụ: bài hát và nghệ sĩ trên Spotify), **xem** gì, hoặc trạng thái tùy chỉnh của họ.

Trạng thái hiện diện được kiểm soát bởi quyền riêng tư: trạng thái này chỉ được chia sẻ đối với người dùng ở mức
riêng tư **Tối thiểu** (Minimal, mặc định: xem `/personal config`) và chỉ khi bot đã bật intent *Guild Presences*
của Discord. Những người dùng nâng cao mức độ riêng tư, hoặc các phiên bản self-host chạy không có intent đó,
sẽ không để lộ hoạt động của mình cho bot.

## Tự động kích hoạt (Trò chuyện rảnh tay)

Tính năng tự động kích hoạt cho phép bot tham gia cuộc trò chuyện mà không cần được gọi tên.

- `/server autotrigger channels`: đặt các kênh mà bot sẽ phản hồi mà không cần lượt nhắc.
- `/server autotrigger threshold`: đặt số lượng tin nhắn tích lũy trước khi bot tham gia trò chuyện.
- `/config` > Behavior > Trigger: thêm một kích hoạt tự động theo xác suất dựa trên bộ đếm thời gian vào một kênh.
- `/config` > Behavior > Trigger: xóa một kích hoạt ngẫu nhiên hiện có.
- ~~`/natres`: tính toán thời gian tự nhiên như con người cho các phản hồi tự động~~ sắp được triển khai

Hãy sử dụng tính năng này trong một kênh chat chuyên dụng, nơi bạn muốn bot mang lại cảm giác như một thành
viên tham gia hơn là một trợ lý được triệu hồi.

## Chế độ kích hoạt có chủ đích {#deliberate-trigger-mode}

Nếu mọi người thường xuyên nhắc đến tên persona trong cuộc trò chuyện thông thường, các từ kích hoạt dạng văn
bản thuần có thể vô tình kích hoạt bot. **Chế độ kích hoạt có chủ đích (DTM)** giải quyết vấn đề này bằng cách
làm cho các từ kích hoạt thuần không còn được tính là một kích hoạt rõ ràng.

Khi DTM bật:

- `@{trigger}` (từ kích hoạt có tiền tố như một lượt nhắc) vẫn hoạt động
- Lượt nhắc Discord vẫn hoạt động
- Trả lời tin nhắn (reply) vẫn hoạt động
- `/respond` vẫn hoạt động
- **Các từ kích hoạt dạng văn bản thuần không còn kích hoạt bot nữa**

Điều này buộc người dùng phải kích hoạt có chủ đích thay vì vô tình kích hoạt.

### Kiểm soát máy chủ và cá nhân

- `/server dtm`: quản trị viên máy chủ bật/tắt hành vi trên toàn máy chủ.
- `/personal config`: mỗi người dùng tự ghi đè cho chính họ, với ba chế độ:
  - **off**: luôn cho phép từ kích hoạt thuần
  - **follow**: tuân theo cài đặt của máy chủ
  - **on**: luôn yêu cầu kích hoạt có chủ đích

Trong `/help`, chọn **Behavior**, sau đó chọn **Deliberate Trigger Mode** để xem bản tóm tắt tương tự trong Discord.

:::note
Đừng nhầm lẫn **Chế độ kích hoạt có chủ đích** (trang này, kiểm soát *cách bot được kích hoạt*) với
**Chế độ công cụ có chủ đích**, vốn kiểm soát *công cụ nào được cung cấp cho model* trong một lượt hội
thoại nhất định. Cả hai đều dùng chung từ viết tắt "DTM" nhưng không liên quan đến nhau. Xem
[Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/#deliberate-tool-mode).
:::
