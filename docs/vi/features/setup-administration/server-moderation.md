---
title: "Kiểm duyệt máy chủ"
sidebar:
  order: 2
---

TomoriBot cung cấp cho người quản lý máy chủ khả năng kiểm soát chi tiết về mức sử dụng, chi phí, quyền và kênh thông qua `/moderation` và `/config`. Hầu hết các điều khiển này đều yêu cầu sự cho phép của `Quản lý máy chủ`. Để biết danh sách lệnh đầy đủ, hãy xem [Tham khảo lệnh](/features/command-reference/).

## Kiểm soát chi phí: Hạn ngạch
<!-- anchor: cost-control-quotas -->

Việc tạo điện sẽ tốn tiền, cho dù được thanh toán từ tài khoản nhà cung cấp của bạn hay bởi các thành viên của bạn. Hạn mức sử dụng giới hạn cho mỗi người dùng và trên toàn máy chủ:

- **Định cấu hình giới hạn**: trong `/moderation` > `Hạn ngạch`, định cấu hình giới hạn hàng ngày cho mỗi người dùng và nhóm đặt lại trên toàn máy chủ để tạo văn bản, hình ảnh và video. Đặt giới hạn cho mỗi người dùng thành `0` không giới hạn.
- **Đặt lại thủ công**: chạy `/quota reset user` để xóa mức sử dụng hàng ngày của thành viên hoặc `/quota reset global` để đặt lại toàn bộ nhóm máy chủ.

Nhóm trên toàn máy chủ tự động đặt lại theo khoảng thời gian có thể định cấu hình tính bằng ngày.

## BYOK người dùng (Bring Your Own Key)
<!-- anchor: user-byok-bring-your-own-key -->

Trong `/moderation` > `Quyền thành viên`, bạn có thể kiểm soát liệu các thành viên có thể sử dụng AI do máy chủ tài trợ hay không:

- **Cho phép model máy chủ** (mặc định): thành viên sử dụng nhà cung cấp được định cấu hình máy chủ.
- **Yêu cầu nhà cung cấp cá nhân**: thành viên phải định cấu hình khóa API của riêng họ thông qua `/personal providers`. Máy chủ không trả tiền cho các tin nhắn do thành viên khởi tạo. Các hành động do máy chủ khởi tạo (chẳng hạn như lời chào tự động hoặc tác vụ đã lên lịch) vẫn sử dụng nhà cung cấp máy chủ.

Thành viên định cấu hình nhà cung cấp cá nhân của họ trong [Cá nhân hóa](/features/knowledge/personalization/#your-own-providers).

Bạn cũng có thể khởi động máy chủ mà không cần nhà cung cấp văn bản phía máy chủ bằng cách chọn `BYOK người dùng` trong `/setup`.

## Kiểm soát truy cập: Danh sách trắng

Sử dụng `/moderation` > `Whitelist` để hạn chế vị trí và cách TomoriBot phản hồi:

- **Kênh**: chọn kênh nào cho phép bot phản hồi và đặt ghi đè thời gian hồi chiêu dành riêng cho kênh. Các kênh kế thừa thời gian hồi chiêu chung trừ khi đặt ghi đè.
- **Personas**: hạn chế các kênh mà một cá nhân cụ thể có thể kích hoạt.
- **Vai trò**: hạn chế tương tác của bot đối với các thành viên có vai trò Discord cụ thể.

Định cấu hình thời gian hồi chiêu phản hồi toàn cầu trên toàn máy chủ trong `/config` > `Hành vi` > Hành vi kích hoạt.

## Kiểm soát học tập và quyền riêng tư

- **Quyền của thành viên**: trong `/moderation` > Quyền thành viên, nhấp vào `Sửa quyền hạn` để kiểm soát xem các thành viên không có `Quản lý máy chủ` có thể quản lý bộ nhớ máy chủ, kiểm tra snapshot prompt hoặc xuất persona hay không. Tính năng dạy bộ nhớ máy chủ bị tắt theo mặc định và cho phép các thành viên xem bộ nhớ của chính mình, thêm bộ nhớ mới, và chỉnh sửa hoặc xóa bộ nhớ của mình. Khi bị tắt, chỉ những thành viên có `Quản lý máy chủ` mới có thể xem hoặc quản lý bộ nhớ máy chủ. Việc xem và quản lý tài liệu cùng lorebook yêu cầu `Quản lý máy chủ`.
- **Xuất persona**: bị tắt theo mặc định đối với thành viên không có `Quản lý máy chủ`. Bật `Xuất persona` trong `/moderation` > `Quyền thành viên` > `Sửa quyền hạn` để cho phép thành viên dùng mọi định dạng của `/persona export`. Điều này bao gồm các gói kèm sprite, ảnh tham chiếu nhân vật, và tùy chọn âm thanh giọng nói cùng bản chép lời được gán. Bản xuất thành công luôn hiển thị công khai trong kênh. Thành viên bị từ chối quyền truy cập sẽ nhận được phản hồi riêng tư hướng dẫn họ liên hệ người quản lý máy chủ. Người quản lý có thể xuất bất kể cài đặt này.
- **Danh sách đen người dùng**: trong `/moderation` > `Blacklist người dùng`, chọn thành viên cho TomoriBot để bỏ qua hoàn toàn. Các thành viên trong danh sách đen không thể kích hoạt cô ấy hoặc chạy lệnh và tin nhắn của họ không bao giờ đến được ngữ cảnh nhanh chóng. Bạn cũng có thể đặt khối thành viên dành riêng cho từng cá nhân.
- **Quy tắc kênh**: trong `/config` > `Kênh` > `Quy tắc kênh`, đánh dấu các kênh văn bản công khai là riêng tư hoặc thêm danh sách chặn công cụ liên kênh. Các kênh Discord bị giới hạn sẽ tự động là riêng tư. Kênh riêng tư không có nhật ký suy nghĩ hoặc công cụ liên kênh gửi đến, bao gồm xem trước tin nhắn, tạo luồng và các tác vụ đã lên lịch từ những kênh khác. STM của các kênh này không thể rời khỏi trừ khi `Chia sẻ STM kênh riêng tư` là `Được phép`, nhưng chúng vẫn gợi nhớ STM từ các kênh công khai. Bạn vẫn có thể yêu cầu bot làm việc trong một kênh riêng tư hoặc giao tác vụ ra bên ngoài; tác vụ gửi ra ngoài có thể chứa thông tin từ cuộc trò chuyện của bạn.

`/config` yêu cầu `Quản lý máy chủ` trong máy chủ, bao gồm cả xem thuộc tính persona, hội thoại mẫu, sprite và bộ nhớ ngắn hạn. Thuộc tính persona và hội thoại mẫu chỉ có thể được chỉnh sửa bởi người quản lý máy chủ. Chủ sở hữu DM giữ quyền truy cập vào không gian làm việc của riêng mình. Quyền xuất cấp quyền truy cập vào `/persona export`; nó không cấp quyền truy cập vào `/config` hoặc nút `Xuất sprite` trong đó. Tải xuống toàn bộ prompt sử dụng quyền `Ảnh chụp nhanh prompt` riêng biệt.

Cơ chế riêng tư tự động kiểm tra quyền hạn của vai trò: `@everyone` phải có quyền xem kênh, và không vai trò nào bị từ chối quyền `Xem kênh` một cách rõ ràng. Thiết lập quyền riêng cho từng thành viên không ảnh hưởng đến việc phân loại này. Do đó, các máy chủ có vai trò xác minh hoặc vai trò giới hạn từ chối quyền xem có thể có những kênh bị đánh dấu là riêng tư ngay cả khi thành viên thông thường vẫn đọc được. Bảng điều khiển phân biệt quyền riêng tư tự động với các lựa chọn thủ công. Việc gỡ bỏ một lựa chọn thủ công không thể ghi đè các giới hạn của Discord.

## Tính minh bạch: Nhật ký suy nghĩ

Trong `/config` > `Kênh` > `Nhật ký & Lời chào`, nhấp vào `Đặt kênh nhật ký` để chỉ định kênh nơi TomoriBot đăng suy luận nội bộ, thông báo dự phòng và các lệnh gọi công cụ thành công. Điều này rất hữu ích để kiểm tra những gì bot đang thực hiện, bao gồm cả từ kích hoạt nào đã hiển thị một công cụ trong [Chế độ công cụ có chủ đích](/features/capabilities/tools-and-extensions/deliberate-tool-mode/).

Nhật ký sử dụng cùng cơ chế kiểm tra quyền riêng tư theo vai trò như STM. Hoạt động trong các kênh riêng tư và luồng của chúng sẽ không xuất hiện trong nhật ký. Kênh nhật ký phải nằm trong cùng một máy chủ.

:::tip
Kênh nhật ký có thể được giới hạn cho đội ngũ kiểm duyệt của bạn trong khi vẫn nhận hoạt động từ các kênh mở cho mọi vai trò.
:::

## Lời chào mừng

Trong `/config` > `Kênh` > Nhật ký & Chào mừng, định cấu hình lời chào tự động cho thành viên mới trong kênh đã chọn. TomoriBot đợi cho đến khi thành viên mới hoàn thành việc sàng lọc và giới thiệu các quy tắc của Discord trước khi gửi lời chào. Nếu một thành viên rời đi trước khi kết thúc buổi chiếu, sẽ không có lời chào nào được gửi đi. Nhấp vào `Xóa lời chào` trên cùng trang đó để tắt lời chào.

## Biểu cảm

Chạy `/expressions initialize` để lập chỉ mục các biểu tượng cảm xúc và sticker tùy chỉnh trên máy chủ của bạn để các cá nhân có thể sử dụng chúng một cách chính xác trong cuộc trò chuyện. Để biết cách các cá nhân sử dụng biểu tượng cảm xúc, sticker và phản ứng, hãy xem [Biểu cảm & Phản ứng](/features/chatting-personality/chatting-and-triggers/#expressions--reactions).
