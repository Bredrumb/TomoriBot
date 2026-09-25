---
title: "Xử lý dữ liệu"
sidebar:
  order: 4
---

TomoriBot được xây dựng nhằm đảm bảo tính minh bạch về dữ liệu của bạn. Bạn có thể xuất, nhập hoặc xóa mọi thứ mà bot lưu trữ, và trang này nêu rõ chi tiết những dữ liệu đó. Để xem văn bản pháp lý, hãy tham khảo `/legal privacy-policy` và `/legal terms-of-service`.

:::note
Trang này trình bày các biện pháp kiểm soát theo từng người dùng trong Discord. **Bạn đang tự chạy phiên bản riêng (self-hosting)?** Việc sao lưu và khôi phục toàn bộ cơ sở dữ liệu là thao tác ở phía máy chủ lưu trữ; hãy xem [Bảo trì và sao lưu](/vi/self-hosting/maintenance/).
:::

## Những gì bot lưu trữ

**Được lưu trữ:**

- Bộ nhớ máy chủ và bộ nhớ cá nhân
- Cài đặt và dữ liệu persona của bot
- Cấu hình máy chủ
- API key đã được mã hóa

**Không lưu trữ:**

- Tin nhắn Discord của bạn
- Lịch sử trò chuyện

**Được gửi đến nhà cung cấp AI của bạn:** bất cứ khi nào được kích hoạt, bot sẽ lấy **các tin nhắn mới nhất** trong kênh cùng với bất kỳ **bộ nhớ liên quan** nào làm ngữ cảnh cho model. Bot không theo dõi hoặc đọc tin nhắn bên ngoài các lần kích hoạt đó.

:::note
Nhà cung cấp AI bạn chọn (Google, OpenRouter, NovelAI, …) xử lý tin nhắn theo chính sách quyền riêng tư của *chính họ*. Đừng bao giờ chia sẻ thông tin cá nhân nhạy cảm với bất kỳ AI nào.
:::

## Xuất dữ liệu của bạn

Mọi dữ liệu có thể xuất sẽ được gửi đến tin nhắn trực tiếp (DM) của bạn dưới dạng tệp JSON:

- `/export config`: các giá trị cấu hình máy chủ (không bao gồm API key, thông tin xác thực hoặc cài đặt nhà cung cấp).
- `/export personal config`: cài đặt cá nhân của bạn (hồ sơ, quyền riêng tư, giao diện, chế độ phản hồi).
- `/export memories`: bộ nhớ máy chủ, trong phạm vi persona chính, một persona đã chọn, hoặc từng persona riêng biệt.
- `/export personal memories`: bộ nhớ cá nhân của bạn, trong phạm vi toàn cục, một persona, hoặc từng persona riêng biệt.
- `/persona export`: định nghĩa persona đầy đủ.

## Nhập dữ liệu của bạn

Đính kèm tệp đã xuất trước đó để khôi phục:

- `/import config`: cấu hình máy chủ; yêu cầu quyền **Manage Server**. Chọn các phần đã phát hiện để áp dụng.
- `/import personal config`: cài đặt cá nhân của bạn. Chọn các phần đã phát hiện để áp dụng.
- `/import memories`: bộ nhớ máy chủ; yêu cầu quyền **Manage Server**. Hợp nhất hoặc thay thế, và ánh xạ từng persona nguồn nếu tệp có nhiều hơn một persona.
- `/import personal memories`: bộ nhớ cá nhân của bạn. Hợp nhất hoặc thay thế, và ánh xạ từng persona nguồn nếu tệp có nhiều hơn một persona.
- `/persona import`: khôi phục persona. Lệnh này cũng chấp nhận thẻ SillyTavern định dạng PNG, JSON và tệp lưu trữ `.charx` Character Card V3, chỉ nhập phần văn bản của nhân vật (xem [Hỗ trợ SillyTavern](/vi/features/integrations/sillytavern-support/)).

## Xóa dữ liệu của bạn

Các thao tác này sẽ xóa vĩnh viễn hoặc đặt lại dữ liệu: **không thể hoàn tác**:

- `/personal memories`, `/memories`
- `/reset config`: đặt lại cấu hình máy chủ trên 29 bảng cấu hình về mặc định của cơ sở dữ liệu.
  - **Dữ liệu đơn lẻ được khôi phục về mặc định DDL (18 bảng):** cấu hình trò chuyện, cấu hình model, quyền thành viên, tính năng, thông báo embed, cấu hình nsfw, cấu hình giọng nói, cấu hình tự động kích hoạt, cấu hình phạm vi kênh, cấu hình hành vi kích hoạt, cấu hình tạo ảnh NovelAI, cấu hình BYOK, cấu hình bộ nhớ, cấu hình bộ nhớ ngắn hạn, cấu hình chào mừng, cấu hình hạn ngạch hình ảnh, cấu hình hạn ngạch văn bản và cấu hình hạn ngạch video.
  - **Cấu hình được giữ lại (hai nhóm):** ID model đang hoạt động, thông tin xác thực và các tham số endpoint tùy chỉnh trong `server_model_configs` (`llm_id`, `embedding_model_id`, `diffusion_model_id`, `video_model_id`, `vision_llm_id`, `api_key`, `key_version`, `custom_endpoint_url`, `custom_model_name`, `custom_num_ctx`, `other_model_codename`, `other_model_capabilities`, `other_model_capabilities_fetched_at`), cùng với định danh model khuếch tán NovelAI đang hoạt động (`nai_diffusion_model_id` trong `server_novelai_imagegen_configs`).
  - **Tập hợp bị xóa (11 bảng):** `server_auto_trigger_persona_overrides`, `stm_categories`, `random_triggers`, `channel_llm_overrides`, `channel_prompt_overrides`, `channel_context_notes`, `personalization_blacklist`, `persona_user_blocks`, `channel_whitelist`, `role_whitelist` và `channel_persona_whitelist`.
  - **Phạm vi được bảo toàn:** Persona và cài đặt persona, bộ nhớ máy chủ, bộ nhớ ngắn hạn, biểu cảm (emoji và sticker), mức tiêu thụ hạn ngạch đã ghi nhận, cấu hình nhà cung cấp đã lưu và các tích hợp bên ngoài (Matrix và MCP).
  - **Ngữ cảnh và quyền hạn:** Yêu cầu quyền Manage Server trong máy chủ. Được hỗ trợ trong tin nhắn trực tiếp (DM) bằng cách sử dụng snowflake không gian làm việc của người dùng gọi lệnh.
- `/reset personal config`: đặt lại cấu hình người dùng và spotlight kênh cá nhân trên tất cả các máy chủ về mặc định của cơ sở dữ liệu.
  - **Các trường được đặt lại:** Khôi phục `users.language_pref` ('en-US') và `users.privacy_level` (0), khôi phục tất cả 13 cột trong `user_personalization_configs` (biệt danh, đồng ý chia sẻ liên máy chủ, thẻ ngoại hình, URL tham chiếu nhân vật, prompt mạo danh, DTM cá nhân, chế độ công cụ có chủ đích, độ lệch múi giờ, tiền tố/hậu tố tùy chỉnh ưu tiên, bản dạng giới, đại từ xưng hô, kiểu xưng hô) về mặc định cấu trúc, và xóa tất cả `user_persona_naming_preferences`.
  - **Tập hợp bị xóa:** Xóa tất cả `personal_spotlights` của người dùng trên các không gian làm việc, phân tầng xóa tiếp `personal_spotlight_personas`.
  - **Phạm vi cá nhân được bảo toàn:** Danh tính tài khoản người dùng, ngôn ngữ đăng ký, bộ nhớ cá nhân, cấu hình nhà cung cấp đã lưu (`user_saved_provider_configs`), endpoint tùy chỉnh, cùng các tác vụ đã lên lịch/lời nhắc.
  - **Ngữ cảnh:** Khả dụng cho tất cả người dùng trong cả máy chủ và DM.

## Từ chối tham gia

- `/personal config`: kiểm soát khả năng hiển thị của bạn đối với bot, lên đến mức **hoàn toàn vô hình** (từ chối hoàn toàn các tính năng bộ nhớ).
- `/config` > Permissions: quản trị viên máy chủ có thể tắt tính năng tự học và các tính năng khác.

Xem [Bộ nhớ](/vi/features/knowledge/memory/) để biết cách bộ nhớ hoạt động hàng ngày.
