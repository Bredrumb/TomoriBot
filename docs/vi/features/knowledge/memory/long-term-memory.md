---
title: "Bộ nhớ dài hạn"
sidebar:
  order: 1
aiGenerated: false
---

Bộ nhớ dài hạn là các dữ kiện ngắn gọn mà TomoriBot lưu giữ cho đến khi có người xóa chúng. Chúng tồn tại qua `/refresh` và khởi động lại. Bot cũng ghi nhớ qua [Tài liệu](/features/knowledge/memory/documents/), [Lorebook](/features/knowledge/memory/lorebooks/) và [Bộ nhớ ngắn hạn](/features/knowledge/memory/short-term-memory/); `/memories` có một tab cho từng loại. Về tính cách và hành vi, hãy xem [Nhiều persona](/features/chatting-personality/multiple-personas/).

## Bộ nhớ cá nhân và bộ nhớ máy chủ
<!-- anchor: personal-vs-server-memories -->

Bộ nhớ cá nhân là các dữ kiện về bạn. Chúng theo bạn qua các máy chủ và được sử dụng khi bạn tham gia vào một cuộc trò chuyện. Bộ nhớ máy chủ chứa thông tin dành cho mọi người trong máy chủ đó.

Mỗi persona có bộ nhớ cá nhân và bộ nhớ máy chủ riêng. Bộ nhớ cá nhân được thêm trên trang Toàn cục của `/personal memories` áp dụng cho mọi persona. Quản lý bộ nhớ cá nhân bằng `/personal memories` và bộ nhớ máy chủ bằng `/memories`.

Các dịch vụ proxy tin nhắn được hỗ trợ cho phép TomoriBot giữ bộ nhớ cá nhân riêng biệt cho các danh tính proxy đã xác minh. Tài khoản Discord của máy chủ lưu trữ kiểm soát quyền riêng tư và phân quyền. Xem [Hỗ trợ proxy tin nhắn](/features/integrations/message-proxy-support/) để biết cách thiết lập và các giới hạn.

## Lưu bộ nhớ

Bạn có thể tự lưu bộ nhớ, hoặc TomoriBot có thể quyết định lưu chúng trong cuộc trò chuyện. Khi bot lưu một bộ nhớ, bot sẽ gửi một embed xác nhận những gì mình đã học được. Nếu không có xác nhận đó, thông tin vẫn chỉ nằm trong lịch sử trò chuyện thay vì bộ nhớ dài hạn.

Nếu bạn muốn bot lưu điều gì đó, hãy bảo bot ghi nhớ hoặc tự thêm vào. Quản lý máy chủ có thể tắt tính năng tự động lưu trong `/config` > `Permissions`.

## Giới hạn bộ nhớ
<!-- anchor: how-many-memories -->

Mỗi persona có thể chứa mặc định 100 bộ nhớ cá nhân và 100 bộ nhớ máy chủ. Bộ nhớ cá nhân toàn cục tính vào giới hạn cá nhân của từng persona. Người self-hosting có thể thay đổi các giới hạn bằng `MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES` và `MAX_MEMORY_LENGTH`.

:::tip
Nên ưu tiên nhiều bộ nhớ ngắn thay vì ít bộ nhớ dài. Bộ nhớ sử dụng `MAX_MEMORY_LENGTH` tăng cao sẽ được gửi đầy đủ mỗi khi hoạt động, trong khi các vị trí bổ sung trong `MAX_PERSONAL_MEMORIES` và `MAX_SERVER_MEMORIES` không tốn chi phí cho đến khi được lấp đầy. Văn bản tham khảo dài thuộc về [tài liệu](/features/knowledge/memory/documents/), vốn được tìm kiếm thay vì gửi toàn bộ.
:::

### Suy giảm bộ nhớ

Khi đã thiết lập một model embedding, một bộ nhớ trải qua 7 ngày trò chuyện được tính mà không khớp với cuộc trò chuyện sẽ tạm nghỉ: nó vẫn được lưu nhưng rời khỏi prompt thông thường cho đến khi một tin nhắn sau đó gợi lại. Khi danh sách đầy, thao tác tự động lưu có thể quên một bộ nhớ tạm nghỉ, nhưng không bao giờ quên bộ nhớ cá nhân Toàn cục hoặc bộ nhớ mà ai đó đã thêm hoặc chỉnh sửa bằng `/memories` hoặc `/personal memories`. Xem [Suy giảm bộ nhớ](/features/knowledge/memory/memory-decay/).

Đối với các chỉ dẫn luôn cần áp dụng, hãy sử dụng [thuộc tính persona](/features/chatting-personality/multiple-personas/#attributes), prompt persona hoặc [mục lorebook luôn bật](/features/knowledge/memory/lorebooks/).

## Kiểm soát thời điểm bộ nhớ kích hoạt
<!-- anchor: controlling-when-memories-activate -->

Các bộ nhớ đang hoạt động được đưa vào khi chủ sở hữu và phạm vi của chúng khớp với cuộc trò chuyện. Các bộ nhớ tạm nghỉ quay trở lại thông qua tìm kiếm khi có liên quan. Giới hạn kênh thu hẹp phạm vi áp dụng, và bộ nhớ cá nhân cũng có thể dùng thẻ từ khóa.

### Thẻ từ khóa của bộ nhớ cá nhân
<!-- anchor: keyword-tags -->

Bộ nhớ cá nhân có thể mang thẻ từ khóa hoặc thẻ `#kênh`. Bật gắn thẻ trong `/config` > `Hành vi` > `Bộ nhớ nâng cao`. Khi bật, bộ nhớ cá nhân có gắn thẻ chỉ xuất hiện khi một trong các từ khóa của nó có trong cuộc trò chuyện, và bộ nhớ không gắn thẻ vẫn hoạt động. Thẻ `#kênh` giới hạn bộ nhớ trong kênh đó. Sử dụng `/tool prompt snapshot` để xem những bộ nhớ nào đang hoạt động.

Bộ nhớ máy chủ không còn dùng thẻ từ khóa. Nội dung lore tự tạo của máy chủ thuộc về [Lorebook](/features/knowledge/memory/lorebooks/), nơi từ khóa và Luôn bật được đặt cho từng mục.

### Kênh

Bộ nhớ máy chủ và tài liệu có thể được giới hạn trong các kênh đã chọn và luồng của chúng. Bộ nhớ cá nhân sử dụng thẻ `#kênh`. Các mục lorebook cũng chấp nhận lựa chọn kênh.

Các thẻ `#kênh` cũ của bộ nhớ máy chủ và tài liệu đã được chuyển đổi thành các lựa chọn kênh. Nếu kênh được gắn thẻ không còn tồn tại, mục đó vẫn hoạt động trong mọi kênh; `/memories` sẽ xác định các mục này để bạn có thể chọn các kênh mới.

## Conditioning
<!-- anchor: conditioning -->

Conditioning định hướng hành vi của persona trong máy chủ. Các phần thưởng và hình phạt dành cho persona kèm lý do sẽ trở thành conditioning mà bot có thể làm theo. Các tương tác không kèm lý do được kiểm đếm nhưng không xuất hiện trong prompt. Xem lại hoặc xóa conditioning bằng `/conditioning`.

Tương tác vui cũng có thể cho phép persona thưởng hoặc phạt người dùng và các persona khác. Tương tác với người dùng không lưu conditioning; tương tác với persona có thể nhắc chúng phản hồi. Quản lý máy chủ có thể tắt công cụ này trong `/config` > `Plugin` > `Công cụ khả dụng`.

## Quyền riêng tư

Để biết TomoriBot lưu trữ những gì và cách xuất hoặc xóa dữ liệu đó, hãy xem [Xử lý dữ liệu](/features/knowledge/data-handling/) và `/legal privacy-policy`. Bạn có thể chọn không sử dụng bộ nhớ bằng `/personal config`.
