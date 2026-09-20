---
title: "Nhiều persona"
head:
  - tag: title
    content: "TomoriBot | Bạn đồng hành AI & Persona cho máy chủ Discord của bạn"
description: "Chạy nhiều bạn đồng hành AI trong một máy chủ Discord. Tùy chỉnh persona với avatar, từ kích hoạt và phong cách nói chuyện riêng."
sidebar:
  order: 2
---

Cá tính của TomoriBot nằm trong một **persona**: tên, avatar, đặc điểm tính cách, phong cách nói
chuyện và hành vi của bot. Bạn có thể chạy nhiều persona cùng lúc, mỗi persona là một nhân vật riêng
biệt có từ kích hoạt và avatar webhook riêng. Trang này nói về *cách bot hành xử*; còn về *những gì
bot biết* (sự thật và ký ức), hãy xem [Bộ nhớ](/vi/features/knowledge/memory/).

## Tạo persona

- `/persona create`: tự tạo một cá tính tùy chỉnh từ đầu.
- `/persona generate`: để AI tự động tạo một cá tính từ mô tả và hình ảnh. Yêu cầu một nhà cung cấp
  hỗ trợ đầu ra có cấu trúc (structured output). Bạn cũng có thể tải lên một preset TomoriBot hiện có
  hoặc thẻ SillyTavern tại đây để chuyển đổi một nhân vật có sẵn (xem
  [Hỗ trợ SillyTavern](/vi/features/integrations/sillytavern-support/)).
- `/persona default`: chuyển sang một trong các cá tính mặc định tích hợp sẵn để làm nền tảng.
- `/persona export` / `/persona import`: chia sẻ hoặc sao lưu một persona dưới dạng tệp. Tính năng nhập
  hỗ trợ đưa một persona vào dưới dạng một **alter** với từ kích hoạt và avatar webhook riêng.
- `/persona remove`: xóa một persona alter.

Quy trình bắt đầu hiệu quả: chọn một persona mặc định hoặc tạo tự động, sau đó tinh chỉnh bằng các
thuộc tính và mẫu hội thoại bên dưới.

## Persona alter

Các persona alter cho phép nhiều nhân vật cùng tồn tại trong một máy chủ:

- Mỗi alter có cá tính, từ kích hoạt và **avatar webhook** riêng, nhờ đó các nhân vật khác nhau xuất
  hiện với tên và hình ảnh khác nhau trong cùng một kênh.
- Nhiều alter có thể cùng phản hồi một tin nhắn, tối đa theo giới hạn trong `/config` > Engine > Trigger.
- **Trả lời tin nhắn webhook** sẽ tiếp tục cuộc trò chuyện với tư cách là persona đó.
- Thêm các alter qua lệnh `/persona import` (tùy chọn alter); quản lý chúng bằng `/persona` và
  `/persona remove`.

Điều này giúp việc nhập vai theo nhóm và các máy chủ đa nhân vật trở nên khả thi. Để biết chi tiết
về runtime của cách từ kích hoạt định tuyến đến persona và cách định danh webhook hoạt động, hãy xem tài
liệu tham khảo kiến trúc về [hành vi đa persona](/en/architecture/subsystems/multi-persona/).

## Định hình tính cách

Hai lệnh thực hiện hầu hết công việc dạy bot cách nói chuyện và hành xử:

### Thuộc tính
<!-- anchor: attributes -->

`/config` > Persona > Identity & Personality thêm các nét tính cách hoặc đặc điểm ngoại hình, ví dụ
`thân thiện`, `tóc đỏ`, hoặc `kết thúc câu bằng *Nya~*`. Xóa chúng bằng
`/config` > Persona > Identity & Personality.

### Mẫu hội thoại
<!-- anchor: sample-dialogues -->

`/config` > Persona > Identity & Personality dạy bot *cách nói chuyện* thông qua ví dụ. Sử dụng các
trình giữ chỗ `{user}` và `{bot}` để các đoạn hội thoại hoạt động cho tất cả mọi người (và khi bạn
chia sẻ persona):

- `{user}`: được thay thế bằng tên/biệt danh thực tế của người dùng
- `{bot}`: được thay thế bằng tên hiện tại của bot

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

Mẹo để tạo mẫu hội thoại hiệu quả:

- Viết các lượt trao đổi tự nhiên như trò chuyện ngoài đời.
- Lồng ghép các thuộc tính và nét tính cách mà bạn muốn bot thể hiện.
- Thể hiện rõ giọng điệu bạn hướng tới, và thêm sự đa dạng để bot học cách khái quát hóa.

Xóa các ví dụ bằng `/config` > Persona > Identity & Personality.

### Tên và avatar

- `/config` > Persona > Identity & Personality: đặt tên bot tự gọi chính mình.
- `/config` > Persona > Identity & Personality: đặt ảnh đại diện của bot cho máy chủ này.

Bạn cũng có thể đặt một prompt hệ thống tùy chỉnh với `/config` > Engine > General để định hình thêm
hành vi; xem [Tinh chỉnh hành vi](/vi/features/chatting-personality/behavior-tweaking/).

## Sprite (Avatar cảm xúc)
<!-- anchor: sprites-emotion-avatars -->

Sprite là các hình ảnh avatar thay thế mà một persona có thể chuyển đổi giữa cuộc trò chuyện để thể
hiện một cảm xúc hoặc hoàn cảnh (hãy coi chúng như biểu cảm khuôn mặt của bot). Mỗi sprite là một hình
ảnh có gắn nhãn (ví dụ `happy`, `mad`, `embarrassed`) mà bot hiển thị thay cho avatar thông thường khi
phù hợp với thời điểm.

Cách bot sử dụng chúng: danh sách sprite khả dụng và ghi chú sử dụng được cung cấp cho model trong mỗi
lượt. Để hiển thị một sprite, bot bắt đầu một dòng trả lời với `PersonaName (label):`; dòng đó sau đó
được gửi kèm hình ảnh sprite tương ứng. Nếu không có sprite nào phù hợp, bot sẽ trả lời bình thường.

Quản lý sprite của một persona trên `/config` > Persona > Sprites (việc thêm và xóa yêu cầu quyền
**Manage Server**):

- `/config` > Persona > Sprites: thêm hoặc thay thế một sprite: chọn persona, đặt cho nó một **nhãn**
  (label), tải lên **hình ảnh** (PNG, JPG, hoặc GIF), và tùy chọn thêm **hướng dẫn sử dụng** để bảo bot
  khi nào nên dùng. Dùng lại một nhãn sẽ thay thế sprite đó. Mỗi persona có một số lượng sprite tối đa.
- `/config` > Persona > Sprites: thay đổi tên, hình ảnh, hướng dẫn hoặc nút bật/tắt danh tính của một
  sprite hiện có.
- `/config` > Persona > Sprites: xóa sprite khỏi một persona.
- Xuất và nhập trên `/config` > Persona > Sprites: sao lưu hoặc chia sẻ toàn bộ bộ sprite của một
  persona dưới dạng tệp.

Nút bật/tắt **danh tính** (identity) trang trí tên tin nhắn thành `Label (Persona)` trong Discord, rất
hữu ích cho các [persona alter](#persona-alter) nói chuyện với tư cách là những nhân vật riêng biệt.

Thay đổi avatar của một persona mặc định sẽ xóa các sprite đi kèm với nó, vì chúng hiển thị khuôn mặt của
nhân vật gốc. Các sprite bạn tự thêm sẽ được giữ lại. Hãy chạy lệnh `/persona default` để khôi phục lại các
sprite mặc định.

## Chọn persona theo kênh

Bạn muốn kiểm soát persona nào trả lời *bạn* trong một kênh cụ thể mà không làm thay đổi thiết lập của
toàn máy chủ? Đó là Tiêu điểm cá nhân; xem
[Cá nhân hóa](/vi/features/knowledge/personalization/#personal-spotlight).

## Cách xưng hô riêng theo từng persona

Quản lý máy chủ có thể sử dụng `/config` > Persona > Identity & Personality để cung cấp cho mỗi persona
các tiền tố, hậu tố và danh xưng độc lập cho nam giới, nữ giới và trung tính. Tùy chỉnh ghi đè theo phạm vi
persona của chính người dùng được liên kết theo nguồn gốc persona ổn định, do đó hai persona có thể gọi Sparrow
bằng các tên khác nhau trong cùng một phản hồi đa persona trong khi cả hai vẫn nhắm tới cùng một người dùng
Discord. Việc chỉnh sửa một con trỏ chính thức trước tiên sẽ tạo ra một bản sao độc lập; thao tác này không
bao giờ làm thay đổi danh mục chia sẻ hoặc persona của máy chủ khác.
