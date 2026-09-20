---
title: "Bên trong prompt"
sidebar:
  order: 2
---

Mỗi khi bạn kích hoạt TomoriBot, những thành phần sau sẽ được tập hợp và gửi đến model văn bản đã cấu hình làm prompt/ngữ cảnh chính, theo đúng thứ tự này:

| Khối | Tùy chọn? | Lệnh | Mô tả |
|---|---|---|---|
| [**Prompt hệ thống**](/vi/features/chatting-personality/behavior-tweaking/#system-prompt) | | `/config` > Engine > General | Các hướng dẫn cơ bản ở vị trí cao nhất của ngữ cảnh. |

> **Nội dung prompt hệ thống mặc định** (chỉ dùng khi máy chủ chưa đặt prompt hệ thống):
>
> *"You are {bot}. {bot} makes sure to respond short and concisely by default. {bot} only makes lengthy responses if the situation warrants it.
>
> {{if tool:create_long_term_memory}}{bot} proactively uses the available {memory_tool} whenever someone shares a detail or {bot} notices one in the conversation that is actually worth remembering, such as a preference, an interest, or an important fact, preferring to remember things even if it is minor as long as it's not a duplicate of what {bot} already knows. {{/if}}{{if tool:update_long_term_memory}}{bot} uses {memory_update_tool} instead when new information changes or adds onto something {bot} already remembers, rather than saving a duplicate.{{/if}}
>
> {{if tool:review_capabilities}}When someone asks what {bot} can do or why something is unavailable, {bot} checks {capabilities_tool} before answering. {{/if}}{{if tool_family:url_fetch}}When more detail is needed, {bot} uses {url_fetch_tool} on `https://docs.tomoribot.app/llms.txt` for information.{{/if}}"*

| Khối | Tùy chọn? | Lệnh | Mô tả |
|---|---|---|---|
| **Prompt kênh (nối tiếp)** | *(Tùy chọn)* | `/config` > Channels > Channel Overrides | Thay đổi theo từng kênh, được xếp lớp ngay sau prompt hệ thống. Chế độ *thay thế* của cùng trang này sẽ chiếm luôn vị trí prompt hệ thống ở trên thay vì thêm một mục mới. |
| **Prompt persona** | *(Tùy chọn)* | `/config` > Persona > Advanced | Một prompt được viết riêng cho persona đang hoạt động, tách biệt khỏi prompt hệ thống. |
| [**Thuộc tính persona**](/vi/features/chatting-personality/multiple-personas/#attributes) | | `/config` > Persona > Identity & Personality | Các nét tính cách và phong cách nói chuyện của persona đang hoạt động. |
| **Thông tin máy chủ** | | *(không có, lấy từ Discord)* | Tên máy chủ, mô tả và kênh bot đang hiện diện, được lấy trực tiếp từ Discord. |
| [**Chặn người dùng theo persona**](/vi/features/capabilities/tools-and-extensions/#built-in-tools) | *(Tùy chọn)* | `/moderation` để xem/xóa; quản lý qua `/config` > Permissions (User Blocking) | Các hạn chế tắt tiếng/chặn đang hoạt động mà persona này áp dụng đối với người dùng cụ thể. |
| [**Bộ nhớ máy chủ**](/vi/features/knowledge/memory/#personal-vs-server-memories) | | `/memories` | Các dữ kiện dài hạn được lưu cho máy chủ này. |
| [**Emoji máy chủ**](/vi/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Tùy chọn)* | `/config` > Permissions (Emoji Usage) (chỉ bật/tắt), khởi tạo bằng `/expressions initialize` | Các emoji tùy chỉnh hiện diện trong máy chủ. |
| [**Sticker máy chủ**](/vi/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Tùy chọn)* | `/config` > Permissions (Sticker Usage) (chỉ bật/tắt), khởi tạo bằng `/expressions initialize` | Các sticker tùy chỉnh hiện diện trong máy chủ. |
| [**Sprite persona**](/vi/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Tùy chọn)* | `/config` > Persona > Sprites | Các sprite biểu cảm có tên được cấu hình cho persona, nếu có. |
| [**Người tham gia cuộc trò chuyện**](/vi/features/knowledge/memory/#personal-vs-server-memories) | *(Tùy chọn)* | `/personal memories` (quản lý qua `/config` > Permissions (Personalization)) | Những người trong cuộc trò chuyện, biệt danh và tên tag của họ, cùng bộ nhớ cá nhân được lưu về từng người. Được tải khi người đó có tin nhắn trong ngữ cảnh, hoặc khi tên/biệt hiệu của họ được nhắc đến. Khối này cũng mang theo kênh hiện tại và giờ địa phương ở phần chân trang, sử dụng `/config` > Engine > General. |
| [**Bộ nhớ ngắn hạn**](/vi/features/knowledge/memory/#short-term-memory-stm) | | `/config` > Persona > Memories; `/memories` để xóa mục; quản lý qua `/config` > Permissions (Short-Term Memory) | Chứa phần tóm tắt và các tin nhắn gần đây từ các kênh khác nhau. |
| [**Tài liệu**](/vi/features/knowledge/memory/#document-knowledge-base-rag) | *(Tùy chọn)* | `/memories` | Các đoạn dữ liệu liên quan được trích xuất từ cơ sở tri thức bằng RAG. |
| [**Điều hòa hành vi**](/vi/features/knowledge/memory/#conditioning) | *(Tùy chọn)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`, quản lý qua `/conditioning remove` | Các gợi ý điều chỉnh hành vi tích lũy cho persona này trong máy chủ này. |
| [**Hội thoại mẫu**](/vi/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Tùy chọn)* | `/config` > Persona > Identity & Personality | Các ví dụ về cách nói chuyện của persona này, nếu đã được cấu hình. |
| [**Tin nhắn gần đây**](/vi/features/chatting-personality/behavior-tweaking/#generation-tuning) | | `/config` > Engine > General | Cuộc trò chuyện thực tế, tối đa số lượng tin nhắn này (mặc định 80). Ghi chú ngữ cảnh và ghi chú hội ngộ của bạn được chèn trực tiếp bên trong khối này ở độ sâu có thể cấu hình, thay vì đứng thành một khối riêng. |

Các hàng được đánh dấu *(Tùy chọn)* sẽ không đóng góp gì (và không tốn token) khi không có nội dung để truyền tải, ví dụ như không có tài liệu nào khớp, hoặc máy chủ không có emoji tùy chỉnh.

Tin nhắn gần đây là phần lớn nhất và dễ biến động nhất, đó là một cửa sổ trượt tịnh tiến dần khi mọi người trò chuyện. Mọi thứ phía trên đều được dựng lại từ cài đặt đã lưu và có tính ổn định.

Lệnh `/tool prompt snapshot` sẽ xuất toàn bộ gói ngữ cảnh chính xác cho một persona ra tệp. Đây là nguồn chuẩn xác để biết bộ nhớ nào hiện đang hoạt động, tài liệu có khớp hay không và bao nhiêu phần của cuộc trò chuyện thực sự vừa vặn trong ngữ cảnh.

Lệnh `/tool estimate cost` chia nhỏ gói dữ liệu đó theo kích thước, rất hữu ích để tìm ra thành phần nào đang chiếm dụng ngữ cảnh trước khi bạn tăng bất kỳ giới hạn nào.

### Công cụ được định nghĩa ở đâu?

Đối với mọi nhà cung cấp mà TomoriBot hỗ trợ gốc, lược đồ công cụ được gửi qua trường `tools` của chính nhà cung cấp đó, vì vậy điều này phụ thuộc vào nhà cung cấp/công cụ suy luận được cấu hình.

### Tại sao TomoriBot quên?

Thứ tự sắp xếp này giải thích cho hầu hết mọi câu hỏi "tại sao bot không nhớ?":

| Tình huống | Lý do |
|---|---|
| Bot quên điều gì đó từ lúc sớm hơn trong ngày | Nội dung đã cuộn vượt quá giới hạn tin nhắn. Nội dung đó trước giờ chỉ nằm trong **Tin nhắn gần đây**, nếu Tomori không lưu lại thành bộ nhớ dài hạn, nội dung sẽ bị quên khi nằm ngoài cửa sổ tin nhắn. |
| Bot quên điều gì đó ở kênh khác | **Tin nhắn gần đây** hoạt động theo từng kênh. Chỉ có **Bộ nhớ máy chủ**, **Người tham gia cuộc trò chuyện** và **Bộ nhớ ngắn hạn** là xuyên kênh. Bộ nhớ ngắn hạn khắc phục điều này bằng cách tải các tin nhắn gần đây từ các kênh khác nhau, nhưng không đổ toàn bộ dữ liệu vào. |
| `/refresh` làm cho bot quên | Lệnh refresh sẽ cắt đứt **Tin nhắn gần đây** và xóa **Bộ nhớ ngắn hạn** của kênh này, nhưng không xóa bộ nhớ dài hạn. Xóa embed refresh để hủy bỏ điểm ngắt. |
| Bot quên điều gì đó sau khi khởi động lại | **Tin nhắn gần đây** không bao giờ tồn tại qua các lần khởi động lại. |

Nếu bạn muốn một thông tin tồn tại qua tất cả các trường hợp trên, thông tin đó phải trở thành **bộ nhớ dài hạn**. Xem [Bộ nhớ](/vi/features/knowledge/memory/#long-term-memory).

## Mẹo và thủ thuật

- `/config` > Engine > General mở rộng cửa sổ hội thoại (20-100 tin nhắn). Nhiều ngữ cảnh hơn đồng nghĩa với nhiều token hơn cho mỗi câu trả lời.
- `/config` > Engine > General chèn một lời nhắc ngắn ở độ sâu đã chọn. Vì nằm ở vị trí thấp trong gói ngữ cảnh, gần với các tin nhắn gần đây, bot sẽ có nhiều khả năng thực hiện theo lời nhắc đó hơn so với nội dung trong prompt hệ thống. Đây là nơi tốt nhất để nhắc bot lưu bộ nhớ thường xuyên hơn.
- `/personal memories` và `/memories` ghi trực tiếp vào **Bộ nhớ máy chủ** và **Người tham gia cuộc trò chuyện**, đây là một trong những cách đảm bảo để giữ tri thức vĩnh viễn trong ngữ cảnh của TomoriBot.
