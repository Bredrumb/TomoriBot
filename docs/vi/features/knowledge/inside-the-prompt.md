---
title: "Bên trong prompt"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot gom nhóm các chỉ dẫn và bộ nhớ ở phía trên cuộc trò chuyện, sau đó đặt thông tin hay thay đổi ở gần các tin nhắn mới nhất. [NovelAI](/features/integrations/novelai/) sử dụng bố cục riêng, và [preset SillyTavern](/features/integrations/sillytavern-support/) có thể sắp xếp lại các khối phía trước.

| Vị trí | Những gì TomoriBot nhận được | Nơi quản lý |
|---|---|---|
| Phần hệ thống | Prompt hệ thống, kênh và persona; thuộc tính persona; hướng dẫn công cụ; thông tin máy chủ; hạn chế giữa persona và người dùng; bộ nhớ máy chủ; emoji, sticker và sprite; các mục lorebook Luôn bật (Always On); điều chỉnh hành vi. | `/config`, `/memories`, `/moderation`, `/expressions` và `/conditioning` |
| Phía trên cuộc trò chuyện | Hồ sơ người tham gia, bí danh, bộ nhớ cá nhân, lời nhắc và nhiệm vụ của persona; bộ nhớ ngắn hạn cũ hơn trong cùng kênh ở vị trí mặc định; định nghĩa công cụ văn bản khi cần. | `/personal memories`, `/memories` và `/config` |
| Ví dụ và hội thoại | Hội thoại mẫu, tiếp theo là các tin nhắn gần đây từ kênh này. | `/config` > `Persona` > `Danh tính & Tính cách`; `Hành vi` > `Hành vi chung` |
| Ngay phía trên bốn lượt người nói mới nhất | Bộ nhớ ngắn hạn mới hoặc bộ nhớ mang nội dung từ các kênh khác, các mục lorebook kích hoạt theo từ khóa hoặc tỷ lệ phần trăm, tài liệu truy xuất, thông tin hiện diện của người tham gia và thời gian hiện tại cùng dòng thông tin kênh. | `/memories` và `/config` |
| Giữa các tin nhắn gần đây | Ghi chú ngữ cảnh ở độ sâu bạn đã chọn, cùng lời nhắc về công cụ và nhận thức thời gian. | `/config` > `Hành vi` > `Hành vi chung`; `Persona` > `Nâng cao`; `Kênh` > `Ghi đè kênh` |

Một lượt người nói (speaker turn) nhóm các tin nhắn liên tiếp từ một người hoặc một persona. Bốn lượt người nói có thể chứa nhiều tin nhắn. Trong một cuộc trò chuyện ngắn, TomoriBot sẽ đếm lùi sang các hội thoại mẫu liền kề nếu có. Bộ nhớ ngắn hạn có thể nằm gần tin nhắn mới nhất hơn nếu bạn cấu hình độ sâu nông hơn. Các khối tùy chọn khi để trống sẽ không tốn token.

Tin nhắn gần đây tăng dần trong một phạm vi, sau đó loại bỏ các tin nhắn cũ hơn theo từng đợt. Mỗi đợt chiếm 30% giới hạn tin nhắn của bạn, làm tròn xuống số chẵn. Với giới hạn mặc định là 80, mỗi đợt là 24: một cửa sổ đầy sẽ giữ nguyên tin nhắn bắt đầu trong khi các tin nhắn mới tiếp tục đến, rồi tiến thêm 24 khi vượt quá 80. Một lượt tương tác hai tin nhắn thông thường sẽ để lại 58 tin nhắn sau lần tiến đó. Các cuộc trò chuyện ngắn, việc làm mới (/refresh) và dung lượng khả dụng của model có thể để lại ít tin nhắn hơn.

Ghi chú ngữ cảnh được đặt trước nhóm thông tin hay thay đổi sẽ di chuyển qua lịch sử cũ hơn sau mỗi phản hồi của bot và làm giảm hiệu quả lưu bộ nhớ đệm (cache) prompt. Giữ ghi chú này gần tin nhắn mới nhất sẽ tránh được sự gián đoạn bộ nhớ đệm không đáng có đó.

:::tip
Một số model sử dụng thông tin ở gần đầu hoặc cuối của một prompt dài đáng tin cậy hơn thông tin ở giữa. Đối với các nhà cung cấp sử dụng ghi chú ngữ cảnh, hãy thử đặt hướng dẫn gần tin nhắn mới nhất. Hiệu quả phụ thuộc vào model và tác vụ. Xem [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) và [Lost in the Haystack](https://arxiv.org/abs/2505.18148).
:::

`/tool prompt snapshot` đưa gói chính xác của một cá nhân vào một tệp. Đó là sự thật cơ bản mà ký ức hiện đang hoạt động, liệu tài liệu có trùng khớp hay không và mức độ thực sự phù hợp của cuộc trò chuyện.

`/context` vẽ cùng một gói dưới dạng lưới màu của cửa sổ ngữ cảnh của model, một màu cho mỗi nhóm khối ở trên, do đó bạn có thể xem nhanh những gì lấp đầy nó và còn lại bao nhiêu chỗ trống. Một vòng tròn đánh dấu một nhóm nhỏ hơn một hình vuông. Nó cũng hiển thị chi phí đầu vào ước tính cho mỗi câu trả lời và số lượng mã thông báo đầu vào mà nhà cung cấp đã báo cáo cho câu trả lời thực tế cuối cùng.

`/tool estimate cost` chia nhỏ gói tương tự theo kích thước, điều này rất hữu ích để tìm ra những gì đang ảnh hưởng đến bối cảnh của bạn trước khi bạn tăng bất kỳ giới hạn nào.

### Công cụ được định nghĩa ở đâu?

Đối với các nhà cung cấp hỗ trợ gọi công cụ, TomoriBot gửi các định nghĩa công cụ thông qua giao diện được hỗ trợ của nhà cung cấp.

### Tại sao TomoriBot quên?

| Chuyện gì đã xảy ra | Tại sao |
|---|---|
| Cô ấy đã quên một điều gì đó từ đầu ngày hôm nay | Nó đã cuộn qua giới hạn tin nhắn mà không được lưu làm bộ nhớ dài hạn. |
| Cô ấy quên cái gì đó ở kênh khác | Tin nhắn gần đây là riêng cho từng kênh. Bộ nhớ máy chủ, bộ nhớ người tham gia và bộ nhớ ngắn hạn cung cấp thông tin được chọn từ các kênh khác. |
| `/refresh` khiến cô ấy quên mất | Làm mới sẽ cắt các tin nhắn gần đây và xóa bộ nhớ ngắn hạn của kênh này, nhưng không nên xóa bộ nhớ dài hạn. Xóa phần nhúng làm mới để loại bỏ phần giới hạn. |

Nếu bạn muốn thứ gì đó tồn tại được sau tất cả những điều trên thì nó phải trở thành trí nhớ lâu dài. Xem [Bộ nhớ](/features/knowledge/memory/long-term-memory/).

## Mẹo và thủ thuật

- `/config` > Hành vi > Hành vi chung mở rộng cửa sổ hội thoại (20-100 tin nhắn). Nhiều ngữ cảnh hơn đồng nghĩa với nhiều token hơn cho mỗi câu trả lời.
- `/config` > Hành vi > Hành vi chung chèn một lời nhắc ngắn ở độ sâu đã chọn. Vì nằm ở vị trí thấp trong gói ngữ cảnh, gần với các tin nhắn gần đây, bot sẽ có nhiều khả năng thực hiện theo lời nhắc đó hơn so với nội dung trong prompt hệ thống. Đây là nơi tốt nhất để nhắc bot lưu bộ nhớ thường xuyên hơn.
- `/personal memories` và `/memories` ghi trực tiếp vào `Bộ nhớ máy chủ` và Người tham gia cuộc trò chuyện, đây là một trong những cách đảm bảo để giữ tri thức vĩnh viễn trong ngữ cảnh của TomoriBot.
