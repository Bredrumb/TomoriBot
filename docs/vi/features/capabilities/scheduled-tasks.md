---
title: "Tác vụ theo lịch"
sidebar:
  order: 2
---

TomoriBot có thể đặt lời nhắc và lên lịch tác vụ cho sau này (một lần hoặc định kỳ). Cách dễ nhất
là chỉ cần **yêu cầu bot**; bot sẽ tạo tác vụ thông qua công cụ `create_task`. Các tác vụ theo
lịch được liên kết riêng với từng persona.

Mỗi persona luôn giữ các tác vụ tự thực hiện đang chờ xử lý trong ngữ cảnh mỗi khi phản hồi, bất kể
thành viên nào xuất hiện trong cuộc trò chuyện gần đây. Lời nhắc nhắm đến người dùng sẽ có chọn lọc
hơn: đối tượng mục tiêu phải có mặt hoặc được tham chiếu trong ngữ cảnh trò chuyện đang hoạt động,
và lời nhắc phải thuộc về persona đang hoạt động.

## Tạo một tác vụ

Chỉ cần nói với bot trong đoạn chat:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
```

Bot sẽ phân tích thời gian cùng tần suất lặp lại và lên lịch tác vụ. Lời nhắc sẽ **ping người dùng mục tiêu**
khi đến giờ kích hoạt; tác vụ là các hành động tự thực hiện âm thầm mà persona tiến hành vào thời gian đã định.

## Múi giờ

Thời gian tuyệt đối ("lúc 14:30", "vào thứ Sáu lúc 20:00") mặc định được hiểu theo **múi giờ của máy chủ**
(`/config` > Engine > General). Nếu bạn đã đặt múi giờ cá nhân bằng `/personal config`, AI sẽ nhìn thấy
đồng hồ địa phương của bạn trong ngữ cảnh và gắn nhãn thời gian của bạn kèm độ lệch UTC khi tạo tác vụ; bot
sau đó sẽ thực hiện chuyển đổi một cách chính xác, vì vậy "nhắc tôi lúc 9 giờ sáng" nghĩa là 9 giờ sáng của
*bạn* ngay cả khi máy chủ ở một châu lục khác. Thời gian tương đối ("trong 2 giờ nữa") không phụ thuộc
múi giờ và luôn an toàn.

Khi một lời nhắc nhắm đến người dùng có múi giờ cá nhân khác với máy chủ, embed xác nhận sẽ hiển thị
**cả hai đồng hồ** (giờ máy chủ và giờ địa phương của mục tiêu), giúp bạn nhận ra ngay thời gian bị gắn sai
nhãn và sửa bằng tin nhắn tiếp theo hoặc qua `/scheduled-task edit`.

## Quản lý tác vụ

Hai lệnh slash cho phép bạn xem lại và điều chỉnh các lịch trình hiện có:

- `/scheduled-task edit`: thay đổi nội dung tác vụ, thời gian kích hoạt tiếp theo, khoảng thời gian lặp lại,
  hoặc điều chỉnh xem đó có phải là lời nhắc hay không. Đặt khoảng thời gian thành `0` để tắt tính năng lặp lại.
- `/scheduled-task remove`: xóa một lời nhắc hoặc tác vụ.

Cả hai lệnh đều mở một bảng chọn liệt kê các lịch trình hiện có của bạn (persona, thời gian, kênh và tần suất
lặp), vì vậy bạn không cần phải ghi nhớ ID.

## Cách thức gửi hoạt động

Lời nhắc được gửi bởi bộ lập lịch trong ứng dụng và chỉ được đánh dấu là hoàn tất **sau khi gửi thành công**:
nếu một lần gửi bị hủy hoặc hàng đợi kênh bị xóa, tác vụ sẽ tự động được thử lại. Độ trễ thử lại không làm thay
đổi chu kỳ lặp lại ban đầu.

Các lần thử tự động không gửi thông báo lỗi mỗi lần. Nếu việc gửi vẫn thất bại sau giới hạn số lần thử lại,
TomoriBot sẽ đăng một cảnh báo chứa nội dung đã lên lịch không thay đổi kèm ID của tác vụ. Lời nhắc người dùng
bị thất bại sẽ ping đối tượng mục tiêu để không bị bỏ lỡ lời nhắc; tác vụ tự thực hiện bị thất bại sẽ không
ping bất kỳ ai. Các lịch trình một lần sau đó sẽ bị xóa, trong khi lịch trình định kỳ vẫn hoạt động cho lần diễn
ra ban đầu tiếp theo và có thể được quản lý bằng `/scheduled-task edit` hoặc `/scheduled-task remove`. Để biết
chi tiết về runtime, hãy xem [tổng quan kiến trúc](/en/architecture/#runtime-extensions).

---

Lên lịch là một trong nhiều tính năng agentic; xem
[Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/) để có cái nhìn toàn diện.
