---
title: "Macro prompt"
sidebar:
  order: 5.5
---

Macro prompt giúp chèn tên hiện tại, công cụ khả dụng và các giá trị khác khi TomoriBot chuẩn bị câu trả lời. Hãy dùng khối điều kiện để chỉ đưa một chỉ dẫn vào khi điều kiện đó áp dụng.

## Macro tên
<!-- anchor: names -->

Dùng macro tên trong prompt đã lưu, thuộc tính, hội thoại mẫu, lorebook và bộ nhớ.
Trong ghi chú ngữ cảnh, hãy dùng `{@userId}`.

| Macro | Giá trị được chèn | Ví dụ |
| --- | --- | --- |
| `{bot}`, `{char}` | Tên của persona đang hoạt động. | `You are {char}.` trở thành `You are Lilya.` khi Lilya đang hoạt động. |
| `{user}` | Người đã kích hoạt phản hồi. Trong prompt dùng chung, thuộc tính, lorebook và bộ nhớ máy chủ, macro này trở thành `User`. Trong bộ nhớ cá nhân, nó là tên của người được bộ nhớ mô tả. | Trong hội thoại mẫu, `Hi, {user}!` trở thành `Hi, Mirri!` khi Mirri kích hoạt phản hồi. |
| `{user_formatted}` | Tên của người dùng kích hoạt kèm tiền tố và hậu tố mà persona đang hoạt động sử dụng. | Preset tiếng Anh của Lilya đổi `Hi, {user_formatted}!` thành `Hi, Mirri-senpai!` cho Mirri. |
| `{user_term}` | Từ xưng hô của persona đang hoạt động dành cho người dùng kích hoạt. | Preset tiếng Anh của Rose dùng `fam` (trung tính), `bro` (nam) hoặc `sis` (nữ). |
| `{@123456789012345678}` | Biệt danh của người dùng Discord có ID đó, ngay cả khi người khác kích hoạt phản hồi. | Khi `Navigator` được lưu làm biệt danh của họ, `Ask {@123456789012345678}.` trở thành `Ask Navigator.` |

Các macro có tên chấp nhận ngoặc nhọn đơn hoặc đôi và không phân biệt chữ hoa thường. Ví dụ: `{{char}}` và `{CHAR}` đều hoạt động. Trong prompt hệ thống hoặc prompt persona dùng chung, hãy dùng `{user_formatted}` hoặc `{user_term}` để gọi người đã kích hoạt phản hồi. Hai macro này được giữ nguyên trong phần prefill phản hồi. Hãy đặt một từ xưng hô trung tính trong phần `Thói quen xưng hô` của persona trước khi dùng `{user_term}` trong nội dung của persona đó.

### Nhắc đến một người dùng Discord cụ thể
<!-- anchor: refer-to-a-specific-discord-user -->

Bật `Chế độ nhà phát triển` và sao chép ID người dùng của người đó. Xem [hướng dẫn sao chép ID của Discord](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
Đặt dãy số sau `@` vào bên trong cặp ngoặc nhọn đơn, ví dụ `Treat {@123456789012345678} as the ship's navigator.`

TomoriBot ưu tiên dùng biệt danh của người đó dành cho persona đang hoạt động, sau đó đến biệt danh toàn cục trong `/personal config` > `Hồ sơ`, rồi đến tên người dùng Discord của họ. Nếu máy chủ tắt bộ nhớ cá nhân, người đó bị đưa vào danh sách đen hoặc quyền riêng tư của họ đặt là `Đầy đủ`, bot sẽ dùng tên người dùng Discord của họ. Nếu không thể phân giải tên, macro sẽ được giữ nguyên như đã viết.

Cuộc trò chuyện trực tiếp giữ nguyên macro như đã viết, bao gồm cả đoạn chat được trích dẫn nguyên văn trong bộ nhớ ngắn hạn hoặc được sao chép vào preset bằng `{{input}}` hay `{{lastChatMessage}}`. Thuộc tính được chia sẻ qua hồ sơ công khai của persona cũng giữ nguyên macro khi persona khác đọc nó.

### Lượt nhắc và liên kết Discord

Lượt nhắc người dùng (`<@userId>` và `<@!userId>`) sử dụng biệt danh toàn cục đã lưu của người đó khi bộ nhớ cá nhân được bật. Nếu không, chúng dùng biệt danh máy chủ hoặc tên người dùng, kể cả đối với người dùng trong danh sách đen. Dùng `{@userId}` để phân giải biệt danh riêng theo persona.

Lượt nhắc kênh (`<#channelId>`) hoặc liên kết kênh hay tin nhắn Discord sẽ cung cấp nhãn kênh dễ đọc khi TomoriBot phân giải được kênh đó. Lượt nhắc vai trò (`<@&roleId>`) trở thành tên như `@Raid Guides` nếu vai trò đó tồn tại trong máy chủ hiện tại. Các lượt nhắc vai trò chưa phân giải được sẽ giữ nguyên như đã viết.

## Lựa chọn ngẫu nhiên

Dùng `{{random: north, south}}` hoặc `{{random::north::south}}` để chọn ngẫu nhiên một tùy chọn trong quá trình lắp ráp prompt. Dạng hai dấu hai chấm cho phép chứa dấu phẩy bên trong một tùy chọn. Cả hai dạng cũng chấp nhận ngoặc nhọn đơn.

## Macro công cụ
<!-- anchor: tool-macros -->

Dùng macro công cụ để chèn tên hàm khả dụng cho nhà cung cấp và model hiện tại.
Macro tích hợp không có công cụ khả dụng sẽ mở rộng thành `an unavailable tool`. Hãy đặt chỉ dẫn vào trong một [khối có điều kiện](#conditional-prompt-blocks) để lược bỏ khi công cụ không khả dụng.
Để biết chức năng của từng công cụ và cài đặt nào bật nó, xem [Công cụ tích hợp](/features/capabilities/tools-and-extensions/built-in-tools/).

### Macro công cụ tích hợp

| Macro | Tên hàm cho điều kiện `tool:` | Ví dụ chỉ dẫn cố định |
| --- | --- | --- |
| `{capabilities_tool}` | `review_capabilities` | `Use {capabilities_tool} to check what you can do here before promising a feature such as stickers or voice messages.` |
| `{memory_tool}` | `create_long_term_memory` | `Save lasting member preferences, such as favorite party games, with {memory_tool} so you can use them in future chats.` |
| `{memory_update_tool}` | `update_long_term_memory` | `Use {memory_update_tool} to revise the existing memory when a member corrects a saved preference or a moderator changes a recurring event.` |
| `{short_term_memory_tool}` | `update_short_term_memory` | `At roleplay scene breaks, use {short_term_memory_tool} to record where the party stopped, what clues they found, and what they plan to do next.` |
| `{task_tool}` | `create_task` | `Schedule game-night and poll reminders with {task_tool} when members request them. Confirm the scheduled time afterward.` |
| `{task_update_tool}` | `update_task` | `Use {task_update_tool} to reschedule the existing reminder when a member changes its time or repeat schedule.` |
| `{cross_channel_tool}` | `cross_channel_message` | `When asked to publish event results, post them in #announcements with {cross_channel_tool} and report back here.` |
| `{create_thread_tool}` | `create_thread` | `When members explicitly ask for a spoiler discussion thread, use {create_thread_tool} and open with a question about the episode.` |
| `{sticker_tool}` | `select_sticker_for_response` | `Celebrate raid clears with {sticker_tool} when the server has a sticker that fits the moment.` |
| `{manage_message_tool}`, `{pin_tool}` | `manage_message` | `Pin guides and event recaps with {manage_message_tool} when a moderator asks.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Use {message_interaction_tool} to react with 🎉 to new tournament result announcements.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Use {conditioning_interaction_tool} for requested victory hugs after major wins.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `When members ask for avatar feedback, inspect the avatar with {profile_picture_tool} before commenting on the design.` |
| `{document_tool}` | `read_file` | `Use {document_tool} to read attached rules PDFs before answering questions about scoring or eligibility.` |
| `{message_metadata_tool}`, `{timestamp_refresh_tool}` | `reveal_message_metadata` | `Use {message_metadata_tool} when members ask for the exact send time or reactions on a recent poll or announcement.` |
| `{gif_tool}` | `process_gif` | `Use {gif_tool} to inspect an attached reaction GIF when its motion matters to the conversation.` Chỉ khả dụng trong môi trường phát triển. |
| `{youtube_tool}` | `process_youtube_video` | `Use {youtube_tool} when members ask about a specific move shown in a linked YouTube guide.` |
| `{image_analysis_tool}` | `analyze_image` | `When helping with an error screenshot, read the visible error with {image_analysis_tool} before suggesting a fix.` |
| `{image_generation_tool}` | `generate_image` | `For requested event banners, use {image_generation_tool} and leave room for the event title.` |
| `{anime_image_generation_tool}` | `generate_image_nai` | `Use {anime_image_generation_tool} for requested anime-style roleplay art. Keep the characters' established outfits.` |
| `{tag_search_tool}` | `danbooru_search_tags` | `Resolve character nicknames and alternate spellings with {tag_search_tool} before searching for fan art.` |
| `{booru_post_search_tool}` | `danbooru_search_posts` | `When members ask to browse existing anime fan art, post a small selection with {booru_post_search_tool}.` |
| `{voice_message_tool}` | `generate_voice_message` | `Send quest briefings and dramatic recaps with {voice_message_tool} when players ask to hear them aloud.` |
| `{block_user_tool}` | `block_user` | `Use {block_user_tool} to apply a persona mute when a moderator asks to stop a member from triggering you for a set time.` |
| `{unblock_user_tool}` | `unblock_user` | `Use {unblock_user_tool} to lift a persona mute early when a moderator asks.` |
| `{user_info_tool}` | `update_user_info` | `Save a member's requested nickname or honorific for this persona with {user_info_tool}.` |

`{pin_tool}` và `{timestamp_refresh_tool}` là các bí danh tương thích.

### Macro tìm kiếm và URL

Các macro này có thể chọn một công cụ máy chủ MCP thay cho hàm tích hợp. Nếu cả hai đều không khả dụng, chúng sẽ chèn phần mô tả của công cụ.

| Macro | Công cụ được chọn |
| --- | --- |
| `{web_search_tool}` | Một công cụ tìm kiếm web hoặc `web_search` tích hợp. |
| `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}` | Công cụ tìm kiếm cho loại phương tiện được yêu cầu, dự phòng bằng tìm kiếm web. |
| `{url_fetch_tool}` | Trình đọc URL hoặc `fetch_url` tích hợp. |
| `{url_metadata_tool}` | Công cụ MCP có thể kiểm tra URL, hoặc `fetch_url` tích hợp. |

## Khối prompt có điều kiện
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| Điều kiện | Khi nào nhánh của nó xuất hiện |
| --- | --- |
| `{{if tool:<function_name>}}` | Công cụ chính xác đó khả dụng cho nhà cung cấp và model. |
| `{{if capability:<name>}}` | Tính năng được nêu tên đang bật. |
| `{{if tool_family:url_fetch}}` | Trình đọc URL tích hợp hoặc công cụ thay thế từ máy chủ MCP khả dụng. |

Thêm dấu `!` vào trước điều kiện, như `{{if !capability:time_awareness}}`, để kiểm tra trạng thái vắng mặt của nó. Mỗi khối dùng tối đa một `{{else}}` và đóng từng khối bằng `{{/if}}`. Có thể lồng khối tới 32 cấp. Dùng các khối lồng nhau khi có nhiều yêu cầu.

Các tên tính năng được hỗ trợ là `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` và `time_awareness`. `tool_use` là sai khi model đang hoạt động không thể gọi công cụ.

Điều kiện công cụ kiểm tra các công cụ khả dụng tại thời điểm lắp ráp prompt, bao gồm các hạn chế từ `Chế độ công cụ có chủ ý`. Quyền Discord được kiểm tra khi công cụ chạy. Tên tính năng không xác định được đánh giá là sai và tạo ra cảnh báo. TomoriBot lược bỏ các khối sai định dạng và giữ nguyên thẻ điều kiện như đã viết nếu mức lồng vượt quá giới hạn.

## Macro preset SillyTavern
<!-- anchor: sillytavern-preset-macros -->

Các macro bổ sung này hoạt động bên trong các node preset SillyTavern. Node preset cũng chấp nhận các macro danh tính, lựa chọn ngẫu nhiên và macro công cụ được mô tả ở trên.

| Macro | Giá trị được chèn |
| --- | --- |
| `{{user}}`, `<USER>` | Thành viên đã kích hoạt phản hồi. |
| `{{char}}`, `{{bot}}`, `<BOT>` | Tên của persona đang hoạt động. |
| `{{personality}}` | Các thuộc tính của persona. |
| `{{description}}` | Prompt của persona. |
| `{{scenario}}` | Trống. Kịch bản của thẻ được nhập sẽ gộp thành thuộc tính persona. |
| `{{mesExamples}}` | Hội thoại mẫu. |
| `{{lastChatMessage}}`, `{{input}}` | Tin nhắn người dùng mới nhất trong lịch sử trò chuyện được cung cấp. |
| `{{time}}`, `{{date}}`, `{{weekday}}` | Giờ, ngày hoặc thứ của máy chủ bằng tiếng Anh, chẳng hạn như `3:45 PM`, `October 28, 2026` hoặc `Wednesday`. |
| `{{isotime}}`, `{{isodate}}` | Giờ máy chủ ở định dạng `HH:mm` hoặc ngày ở định dạng `YYYY-MM-DD`. |
| `{{model}}`, `{{provider}}` | ID model và nhà cung cấp đã cấu hình. Các lựa chọn từ bộ chọn ngẫu nhiên mỗi lượt và model dự phòng giữ nguyên các giá trị này. |
| `{{char_version}}` | Trống. TomoriBot không lưu phiên bản thẻ. |
| `{{roll:2d6}}` | Tổng của một lần tung xúc xắc, tối đa 100 viên xúc xắc và 1.000 mặt mỗi viên. |
| `{{// notes}}` | Trống. Dùng cho ghi chú bên trong preset. |
| `{{trim}}` | Xóa khoảng trắng ở đầu và cuối node. |
| `{{setvar::key::value}}`, `{{addvar::key::value}}` | Đặt hoặc nối thêm văn bản vào một biến dùng chung qua các node của preset. |
| `{{getvar::key}}` | Giá trị của biến, hoặc trống nếu chưa đặt. |

`<USER>` và `<BOT>` là các token tương thích phân biệt chữ hoa thường. Năm macro ngày và giờ dùng chung một giá trị đồng hồ và độ lệch UTC cố định của máy chủ. Hãy đổi độ lệch máy chủ khi giờ mùa hè thay đổi. Cả năm macro đều trống khi `Nhận biết thời gian tốt hơn` tắt. Hãy đặt chúng trong các node ở cuối hoặc node tiêm sâu để giữ cho phần văn bản phía trước đủ điều kiện dùng bộ nhớ đệm prompt.

### Điều kiện preset
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

Một tên trần như `description` có nghĩa là `{{description}}`. Bạn có thể đặt trực tiếp macro giá trị vào điều kiện, như `{{#if {{input}}}}`. TomoriBot bỏ qua chữ hoa thường và khoảng trắng xung quanh khi kiểm tra giá trị. Văn bản trống, `false` và `0` là sai. Các macro giá trị không được nhận diện được tính là trống.

Các khối này có thể lồng nhau cùng với [điều kiện công cụ và tính năng](#conditional-prompt-blocks).
Đóng `#if` bằng `{{/if}}` và `#unless` bằng `{{/unless}}`. Khối preset chưa đóng sẽ kết thúc ở cuối node của nó. TomoriBot bỏ các thẻ đóng và thẻ `{{else}}` thừa, đồng thời lược bỏ các khối có `{{else}}` thứ hai hoặc thẻ đóng không khớp. Giới hạn 32 cấp cũng áp dụng cho các khối trộn lẫn.

Điều kiện preset nhìn thấy các khai báo biến nằm trước đó theo thứ tự node, kể cả phần nằm trước trong cùng node. Khai báo nằm trong nhánh preset bị bỏ qua không có tác dụng. Một `{{getvar::key}}` nằm ngoài điều kiện thấy giá trị cuối cùng sau khi TomoriBot duyệt qua các node đang bật. Điều kiện công cụ và tính năng chạy sau phần gán biến.

## Kiểm tra macro

Chạy `/tool prompt snapshot` cho persona và kênh bạn muốn kiểm tra. Mở tệp xuất ra và tìm chỉ dẫn đã kết xuất. Dùng `/context` để xem phần nào của prompt đang chiếm dung lượng. Xem [Kiểm tra prompt](/features/knowledge/inside-the-prompt/#inspecting-the-prompt).
