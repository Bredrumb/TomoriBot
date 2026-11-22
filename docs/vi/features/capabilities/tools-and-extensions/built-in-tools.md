---
title: "Công cụ tích hợp"
sidebar:
  order: 0
---

Các công cụ phụ thuộc vào nhà cung cấp và model đang hoạt động có hỗ trợ gọi công cụ hay không. Nhiều công cụ được kiểm soát bởi cờ tính năng (`/config` > Quyền hạn), quyền Discord, tính năng của model hoặc API key tùy chọn.

:::tip
Nếu một tính năng có vẻ không khả dụng, hãy hỏi mình lý do. Mình có thể báo cáo các cờ tính năng của máy chủ và liệu model đang hoạt động có hỗ trợ gọi công cụ hay không, qua đó thường chỉ ra cài đặt cần khắc phục.
:::

| Công cụ | Macro prompt | Yêu cầu | Chức năng |
|---|---|---|---|
| Đánh giá tính năng | `{capabilities_tool}` | - | Kiểm tra khả năng trò chuyện, lệnh hoặc cài đặt hiện tại trước khi trả lời. |
| Tạo / cập nhật bộ nhớ dài hạn | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Lưu hoặc thay thế thông tin máy chủ ổn định hoặc tùy chọn của người dùng. |
| Cập nhật bộ nhớ ngắn hạn | `{short_term_memory_tool}` | - | Lưu bộ nhớ làm việc tạm thời cho kênh hoặc mạch truyện hiện tại. |
| Tạo / cập nhật tác vụ | `{task_tool}` / `{task_update_tool}` | - | Lên lịch hoặc chỉnh sửa lời nhắc và nhiệm vụ tự thực hiện (xem [Tác vụ đã lên lịch](/features/capabilities/scheduled-tasks/)). |
| Tin nhắn đa kênh | `{cross_channel_tool}` | - | Hoạt động trong kênh hoặc chủ đề khác, kèm báo cáo lại tùy chọn. |
| Tạo chủ đề | `{create_thread_tool}` | `thread_creation_enabled` + quyền chủ đề | Mở một chủ đề công khai và đăng tin nhắn khởi đầu. |
| Đổ xúc xắc | - | `dice_rolling_enabled` | Đổ xúc xắc công khai và sử dụng kết quả trong roleplay. |
| Chọn sticker | `{sticker_tool}` | `sticker_usage_enabled` | Thêm sticker máy chủ phù hợp hoặc biểu cảm tùy chỉnh vào câu trả lời. |
| Quản lý tin nhắn | `{manage_message_tool}` | `manage_message_enabled` | Ghim, chỉnh sửa hoặc xóa các tin nhắn gần đây (ghim cần quyền Quản lý tin nhắn). |
| Chặn / bỏ chặn người dùng | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Tắt tiếng/chặn người dùng trong phạm vi persona (không ảnh hưởng đến bộ nhớ). |
| Tương tác với tin nhắn gần đây | `{message_interaction_tool}` | - | Thả cảm xúc hoặc gửi phản hồi ngắn cho tin nhắn gần đây. |
| Xem ảnh đại diện | `{profile_picture_tool}` | model thị giác hoặc `vision_llm` | Kiểm tra ảnh đại diện của người dùng hoặc persona. |
| Đọc tài liệu | `{document_tool}` | - | Trích xuất văn bản từ PDF hoặc tệp văn bản UTF-8: mã nguồn (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` và tệp đính kèm không nhị phân. |
| Tiết lộ siêu dữ liệu tin nhắn | `{message_metadata_tool}` | - | Chú thích các lượt gần đây bằng handle và dấu thời gian để nhắm mục tiêu chính xác. |
| Xử lý video YouTube | `{youtube_tool}` | model hỗ trợ video | Phân tích liên kết YouTube cụ thể theo yêu cầu. |
| Phân tích hình ảnh | `{image_analysis_tool}` | đã cấu hình `vision_llm` | Ủy thác hiểu hình ảnh cho model thị giác riêng biệt. |
| Tạo hình ảnh / ảnh anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + nhà cung cấp phù hợp | Tạo hoặc chỉnh sửa hình ảnh (xem [Tạo phương tiện](/features/capabilities/media-generation/image-generation/)). |
| Tra cứu thẻ Danbooru | `{tag_search_tool}` | `danbooru_enabled` | Chuyển tên nhân vật, biệt danh và thẻ đoán thành thẻ Danbooru chính xác (xem [Tra cứu thẻ Danbooru](/features/capabilities/tools-and-extensions/danbooru/)). |
| Tìm kiếm tranh Danbooru | `{booru_post_search_tool}` | `danbooru_enabled` | Đăng tối đa 4 ảnh Danbooru có sẵn cho 1 hoặc 2 thẻ (xem [Tìm kiếm tranh và đọc bài đăng](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading)). |
| Đọc bài đăng Danbooru | - | `danbooru_enabled` | Đọc các thẻ đã nhóm của một bài đăng Danbooru từ ID hoặc liên kết. |
| Tạo tin nhắn thoại | `{voice_message_tool}` | ElevenLabs key + giọng persona + `voice_message_enabled` | Gửi câu trả lời bằng giọng nói trên Discord. |

### Khối prompt có điều kiện
<!-- anchor: conditional-prompt-blocks -->

Dùng [macro công cụ](/features/prompt-macros/#tool-macros) để chèn tên hàm vào các hướng dẫn đã lưu. Dùng [khối có điều kiện](/features/prompt-macros/#conditional-prompt-blocks) để chỉ đưa các hướng dẫn đó vào khi công cụ hoặc tính năng khả dụng.
