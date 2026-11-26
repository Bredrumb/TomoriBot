---
title: "Tác vụ theo lịch"
sidebar:
  order: 2
---

Đặt lời nhắc cho chính bạn hoặc lên lịch thông báo định kỳ mà không cần rời khỏi cuộc trò chuyện. Hãy hỏi trực tiếp bot và cô ấy sẽ tạo lịch trình cho bạn. Nhiệm vụ theo lịch trình thuộc về persona tích cực.

Lời nhắc sẽ thông báo cho người dùng mục tiêu khi họ kích hoạt, trong khi tự thực hiện nhiệm vụ là những hành động mà cá nhân đó tự thực hiện vào thời gian đã lên lịch.

## Tạo một tác vụ

Nói với cô ấy những gì cần lên lịch trong cuộc trò chuyện:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
on the 31st of every month, remind me to pay rent
```

Cô phân tích thời gian được yêu cầu và sự lặp lại. Lời nhắc ping người dùng mục tiêu khi họ kích hoạt. Nhiệm vụ là những hành động thầm lặng mà cá nhân thực hiện khi thời điểm đến.

Lịch trình có thể lặp lại theo phút, giờ hoặc tháng. Hãy yêu cầu một số lần gửi nhất định hoặc thời điểm kết thúc để lịch trình tự động dừng. Nếu bạn nói "nhắc tôi mỗi giờ" mà không nêu thời gian bắt đầu, lời nhắc đầu tiên sẽ đến hạn sau một giờ. Lịch trình theo phút và giờ cũng có thể dùng khung giờ hằng ngày theo múi giờ của máy chủ, chẳng hạn từ 09:00 đến 17:00. Lần kích hoạt ngoài khung giờ sẽ dời sang thời điểm mở khung giờ tiếp theo. Lịch lặp lại hàng tháng giữ nguyên ngày và giờ. Vào tháng không có ngày đó, tác vụ sẽ chạy vào ngày cuối cùng của tháng (ngày 30 tháng 4 đối với ngày 31) và quay trở lại ngày 31 vào tháng sau.

## Múi giờ

Thời gian tuyệt đối (chẳng hạn như "lúc 14:30" hoặc "vào thứ Sáu lúc 8 giờ tối") sử dụng múi giờ của máy chủ (`/config` > `Hành vi` > `Hành vi chung`) theo mặc định. Nếu bạn đặt múi giờ của riêng mình bằng `/personal config`, bot sẽ tự động chuyển đổi giờ địa phương của bạn. "nhắc tôi lúc 9 giờ sáng" nghĩa là 9 giờ sáng của bạn, ngay cả khi máy chủ ở múi giờ khác. Thời gian tương đối (chẳng hạn như "trong 2 giờ") không phụ thuộc vào múi giờ và luôn an toàn.

Khi lời nhắc nhắm mục tiêu đến người dùng có múi giờ cá nhân khác với múi giờ của máy chủ, xác nhận sẽ hiển thị cả hai đồng hồ: giờ máy chủ và giờ địa phương của mục tiêu. Nếu thời gian bị gắn nhãn sai, hãy sửa nó bằng tin nhắn tiếp theo hoặc `/scheduled-task edit`.

## Quản lý tác vụ

Hai lệnh gạch chéo cho phép bạn xem lại và điều chỉnh lịch trình hiện có:

- `/scheduled-task edit`: thay đổi nội dung của tác vụ, thời gian kích hoạt tiếp theo, khoảng cách lặp lại (theo phút, giờ hoặc tháng), giới hạn lặp lại hoặc người nhận lời nhắc. Nhập khoảng cách như `15m`, `2h` hoặc `1mo`. Đặt thành `0` cho tác vụ một lần. Xóa trống trường giới hạn để lặp lại vô thời hạn.
- `/scheduled-task remove`: xóa lời nhắc hoặc tác vụ.

Cả hai lệnh đều mở một bộ chọn liệt kê các lịch trình hiện có của bạn theo persona, thời gian, kênh và tần suất lặp lại.

:::tip
Thành viên có quyền `Quản lý máy chủ` có thể xem mọi lịch trình trong máy chủ, trong đó các mục của thành viên khác sẽ hiển thị tên người tạo. Những người khác chỉ thấy lịch trình của riêng mình.

Yêu cầu TomoriBot xóa lịch trình trong cuộc trò chuyện cũng tuân theo quy tắc này: bạn có thể xóa các lịch do mình tạo hoặc nhắc nhở bạn, và thành viên có quyền `Quản lý máy chủ` có thể xóa bất kỳ lịch nào.
:::

Một máy chủ có thể lưu tối đa 100 lời nhắc và tác vụ đang chờ xử lý cùng một lúc. Khi đạt giới hạn, TomoriBot sẽ thông báo cho bạn thay vì thêm mới; hãy xóa các mục cũ bằng `/scheduled-task remove` để có thêm chỗ trống.

Mỗi lần một lịch trình bạn đã tạo chạy trên model AI của máy chủ, lịch trình đó sẽ dùng một lượt trả lời văn bản trong [hạn mức](/features/setup-administration/server-moderation/#cost-control-quotas) của bạn trên máy chủ. Khi bạn dùng hết hạn mức, lời nhắc vẫn được gửi dưới dạng tin nhắn thường không có AI, còn tác vụ sẽ đăng thông báo ping bạn thay vì chạy. Lần chạy tiếp theo vẫn giữ nguyên thời gian thông thường.

Nếu người kiểm duyệt đưa bạn vào danh sách đen, các lịch trình của bạn sẽ tạm dừng âm thầm: lịch định kỳ sẽ bỏ qua các lần chạy và tiếp tục lại nếu bạn được gỡ khỏi danh sách đen, còn lịch một lần đến hạn sẽ bị hủy bỏ.

## Cách thức gửi hoạt động

Lời nhắc chỉ được đánh dấu là hoàn thành sau khi gửi thành công. Nếu quá trình phân phối bị gián đoạn, TomoriBot sẽ tự động thử lại mà không làm thay đổi lịch định kỳ.

Nếu quá trình phân phối không thành công liên tục và đạt đến giới hạn thử lại, TomoriBot sẽ đăng một cảnh báo kèm theo nội dung và ID tác vụ đã lên lịch. Lời nhắc của người dùng không thành công sẽ ping mục tiêu để lời nhắc không bị bỏ lỡ, trong khi các tác vụ tự thực hiện không thành công sẽ không gửi ping. Sau đó, lịch trình một lần sẽ bị xóa, trong khi lịch trình định kỳ vẫn hoạt động cho lần xuất hiện tiếp theo và có thể được quản lý bằng `/scheduled-task edit` hoặc `/scheduled-task remove`.

---

Để biết thêm các tính năng, hãy xem [Công cụ & tiện ích mở rộng](/features/capabilities/tools-and-extensions/built-in-tools/).
