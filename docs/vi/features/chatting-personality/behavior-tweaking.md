---
title: "Tinh chỉnh hành vi"
sidebar:
  order: 3
---

Hành vi của TomoriBot (**những gì bot được phép làm và cách bot tạo phản hồi**) được kiểm soát bởi
`/config` > Permissions và `/config`, bên cạnh tính cách ([Nhiều persona](/vi/features/chatting-personality/multiple-personas/))
và tri thức ([Bộ nhớ](/vi/features/knowledge/memory/)). Trang này là tập hợp các tùy chọn cấu hình
giá trị cao; mọi lệnh đầy đủ đều có trong [Danh mục lệnh](/vi/features/command-reference/).

## Tính năng: Những gì bot được phép làm

`/config` > Permissions cho phép bật và tắt các tính năng của bot: tạo hình ảnh, sử dụng sticker, tạo
luồng, quản lý tin nhắn, chặn người dùng, tự học hỏi, tin nhắn thoại và nhiều hơn nữa. Mỗi nút bật tắt
là một cờ tính năng kiểm soát công cụ tương ứng (xem
[Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/)). Khi bạn tắt một tính năng,
bot chỉ đơn giản là không thể thực hiện nó, bất kể người dùng có yêu cầu gì.

## Tinh chỉnh quá trình tạo phản hồi

- `/config` > Models > Text Samplers & Parameters: các tham số lấy mẫu (temperature, top-p, …): mức độ sáng tạo/ngẫu nhiên.
  Temperature cao hơn sẽ tạo ra phản hồi đa dạng hơn.
- `/config` > Engine > General: mức độ tự nhiên như con người trong câu trả lời của bot (humanizer). Tùy chọn `scope`
  áp dụng mức độ này trên toàn máy chủ (`Global`, mặc định) hoặc cho một persona đơn lẻ
  (`Persona`), rất tiện lợi khi một persona cần nhắn tin thân mật ở mức độ 3 trong khi persona khác lại nhắn tin như một cuốn tiểu thuyết. Lựa chọn "Inherit" của persona sẽ xóa tùy chỉnh ghi đè của nó.
- `/config` > Engine > General: số lượng tin nhắn gần đây mà bot lấy làm ngữ cảnh cho mỗi lần kích hoạt.
  Một công cụ hữu ích: tăng lên để bot hiểu rõ cuộc trò chuyện hơn, giảm xuống để tiết kiệm chi phí token.

## Prompt hệ thống

Prompt hệ thống nằm trên persona và định hình hành vi tổng thể:

- `/config` > Engine > General: thiết lập chỉ dẫn hệ thống tùy chỉnh (tối đa 16.000 ký tự).
- `/config` > Engine > General: chọn từ các prompt hệ thống tạo sẵn.
- `/config` > Engine > General: đặt lại về mặc định. Hộp thoại xác nhận sẽ hiển thị lại prompt vừa bị
  xóa để bạn có thể sao chép lại nếu lỡ xóa nhầm.

Khi một [preset SillyTavern](/vi/features/integrations/sillytavern-support/) đang hoạt động, prompt hệ thống dự phòng
tích hợp sẵn sẽ được thay thế, nhưng prompt tùy chỉnh do bạn thiết lập tại đây vẫn sẽ được gửi đi.

## Đầu ra không kiểm duyệt

TomoriBot **không có bộ lọc nội dung riêng**: bot không phải là một hệ thống kiểm duyệt và không bổ sung
thêm rào chắn an toàn nào lên trên model. Bất cứ điều gì nhà cung cấp bên dưới trả về đều là những gì bot sẽ
nói. Do đó, `/nsfw jailbreaks` không "mở khóa" bất kỳ điều gì bên trong TomoriBot; tính năng này tồn tại
hoàn toàn để giải quyết các bộ lọc **phía nhà cung cấp** vốn khắt khe hơn mức bạn mong muốn.

Lệnh này bật/tắt ba kỹ thuật độc lập (tất cả đều tắt theo mặc định):

- **Prompt injection**: thêm một khối chỉ dẫn jailbreak vào ngữ cảnh để định hướng model tránh các từ chối
  không cần thiết.
- **Dấu cách Unicode**: hoán đổi dấu cách thông thường bằng dấu cách Unicode trông tương tự để bộ lọc từ
  khóa/token không khớp với các cụm từ, áp dụng trên cả văn bản gửi tới model và trên phản hồi của bot.
- **Sanitize**: làm xáo trộn một tập hợp các từ nhạy cảm vì lý do tương tự, cũng áp dụng trên cả yêu cầu
  và phản hồi.

Không có kỹ thuật nào trong số này thay đổi *năng lực* của model; chúng chỉ giảm tần suất một bộ lọc quá
nhạy của nhà cung cấp chặn các đầu ra vốn dĩ bình thường. Một số tùy chọn này bị giới hạn độ tuổi; xem
[Lệnh giới hạn độ tuổi](/vi/features/setup-administration/age-restricted-commands/).

## Diện mạo & thời gian

- `/config` > Persona > Identity & Personality: tên bot tự gọi chính mình.
- `/config` > Engine > General: múi giờ của máy chủ, được sử dụng cho các phản hồi nhận biết thời gian và lời nhắc.

---

Bạn đang tìm kiếm các biện pháp kiểm soát quản trị/chi phí (hạn ngạch, danh sách trắng, BYOK) thay vì tinh chỉnh
hành vi? Những cài đặt đó nằm trong [Kiểm duyệt máy chủ](/vi/features/setup-administration/server-moderation/).
