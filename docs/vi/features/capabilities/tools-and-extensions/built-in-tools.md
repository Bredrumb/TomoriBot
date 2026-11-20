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

:::note[Dành cho người tạo prompt]
Khi tùy chỉnh prompt hệ thống hoặc hướng dẫn persona, hãy tham khảo các công cụ bằng **macro prompt** từ bảng trên thay vì viết cứng tên công cụ, vì macro sẽ mở rộng thành tên chính xác khi lắp ráp ngữ cảnh và giảm dần phù hợp khi công cụ không khả dụng.
`{pin_tool}` và `{timestamp_refresh_tool}` vẫn hoạt động như bí danh tương thích cho `{manage_message_tool}` và `{message_metadata_tool}`. Các công cụ tìm kiếm web và URL dưới đây cũng có macro: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` và `{url_metadata_tool}`. Chúng phân giải linh hoạt thành công cụ tốt nhất hiện có, bao gồm cả các công cụ thay thế MCP của máy chủ.
:::

### Khối prompt có điều kiện

Văn bản prompt hỗ trợ các macro công cụ ở trên cũng hỗ trợ các điều kiện có phạm vi:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Dùng `capability:<name>` cho cài đặt TomoriBot đã bật, hoặc `tool:<function_name>` khi văn bản chỉ nên xuất hiện nếu công cụ chính xác đó khả dụng với nhà cung cấp và model đang hoạt động. Dùng `tool_family:url_fetch` khi có sẵn trình đọc URL đi kèm hoặc công cụ thay thế MCP của máy chủ. Thêm dấu `!` vào trước điều kiện để phủ định. Các khối có thể lồng nhau và có thể chứa một `{{else}}`; biểu thức `and`/`or` thông thường không được hỗ trợ.

Các tên tính năng được hỗ trợ là `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` và `time_awareness`.

Các điều kiện công cụ phản ánh hỗ trợ của nhà cung cấp/model, cấu hình máy chủ, backend đã định cấu hình, thay thế MCP và danh sách cho phép của Chế độ công cụ có chủ ý hiện tại. Chúng không bỏ qua hoặc dự đoán kiểm tra quyền hạn Discord khi công cụ thực thi. Tên tính năng không xác định được đánh giá là sai và được ghi log; khối sai định dạng sẽ bị bỏ qua. Tin nhắn trò chuyện thô, đầu ra của model và kết quả công cụ không bao giờ được coi là mẫu có điều kiện.
