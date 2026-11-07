---
title: "Bộ nhớ ngắn hạn"
sidebar:
  order: 5
aiGenerated: false
---

TomoriBot đọc các tin nhắn gần đây trong kênh đang hoạt động. Bộ nhớ ngắn hạn (STM) mở rộng điều này bằng cách giữ ngữ cảnh làm việc tạm thời:

- **Ngữ cảnh kênh:** Củng cố chủ đề hoặc tình huống đang diễn ra trong kênh hiện tại.
- **Ngữ cảnh giữa các kênh:** Nhắc lại các cuộc trò chuyện gần đây từ các kênh khác và giữa các máy chủ khi tính năng gợi nhớ giữa các máy chủ được bật.

Bot chỉ nhớ các cuộc trò chuyện mà bot đã tham gia. Bot cập nhật bản tóm tắt của kênh khi trả lời và không vào bất kỳ thời điểm nào khác, vì vậy một kênh bận rộn mà không ai nói chuyện với bot sẽ không để lại bộ nhớ nào. Bộ nhớ ngắn hạn của mỗi kênh sẽ hết hạn sau 24 giờ theo mặc định. Nếu bạn từ chối tham gia trong `/personal config`, tin nhắn của bạn sẽ bị loại trừ khỏi bộ nhớ ngắn hạn.

Bộ nhớ ngắn hạn mới và bộ nhớ mang nội dung từ các kênh khác nằm ngay phía trên bốn lượt người nói mới nhất. Bộ nhớ cũ hơn từ kênh này sẽ ở phía trên cuộc trò chuyện theo cài đặt mặc định. Một độ sâu nông hơn được cấu hình có thể giữ nội dung ở gần tin nhắn mới nhất hơn. Xem [Bên trong prompt](/features/knowledge/inside-the-prompt/) để biết toàn bộ bố cục.

## Ví dụ giữa các kênh

- **Kênh công khai:** Bạn thảo luận về gợi ý album với TomoriBot trong `#music`. Vài phút sau trong `#general`, bạn hỏi bot đã gợi ý album nào. Vì bot đã trả lời trong `#music`, bot sẽ nhớ lại ngữ cảnh đó trong `#general`.
- **Kênh riêng tư:** Nếu cuộc trò chuyện đó diễn ra trong một kênh riêng tư, bot sẽ không nhớ lại nó trong `#general`. Các bản tóm tắt từ các kênh riêng tư vẫn được giữ tách biệt trừ khi quản trị viên bật Bỏ qua quyền riêng tư STM trong `/config` > `Permissions`.

## Quản lý bộ nhớ ngắn hạn
<!-- anchor: managing-short-term-memory -->

Bạn có thể xem hoặc chỉnh sửa bản tóm tắt của kênh hiện tại trong `/config` > `Persona` > `Memories`.
Quản lý máy chủ có thể điều chỉnh các tham số hoặc tắt bộ nhớ ngắn hạn trong `/config` > `Hành vi` > `Bộ nhớ nâng cao`, đồng thời xem lại hoặc xóa các bản tóm tắt kênh đang hoạt động trong `/memories` > `Ngắn hạn`.
`/refresh` xóa bộ nhớ của kênh hiện tại.
