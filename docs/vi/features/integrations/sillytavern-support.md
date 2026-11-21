---
title: "Hỗ trợ SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Dùng thẻ nhân vật SillyTavern trong Discord"
description: "Nhập thẻ nhân vật và preset prompt SillyTavern vào Discord với TomoriBot. Mang các nhân vật có sẵn vào máy chủ của bạn."
sidebar:
  order: 2
---

TomoriBot có thể nhập các tài nguyên từ [SillyTavern](https://github.com/SillyTavern/SillyTavern): preset Trình quản lý prompt (điều khiển cấu trúc prompt), thẻ nhân vật (định nghĩa nhân vật) và lorebook (Character Book đính kèm hoặc tệp world info độc lập). Nếu bạn chưa từng sử dụng SillyTavern, bạn có thể yên tâm bỏ qua trang này.

## Nhập thẻ nhân vật

Đưa nhân vật SillyTavern hiện có vào Discord bằng `/persona import`. Lệnh này chấp nhận:

- **Thẻ PNG** có siêu dữ liệu `chara` hoặc `char` được nhúng.
- **Thẻ JSON kiểu v2** có thuộc tính cấp cơ sở (`name`, `description`, `first_mes`).
- **Thẻ JSON v3** (`spec: "chara_card_v3"` với đối tượng `data` lồng nhau).
- **Kho lưu trữ `.charx`** (Gói Thẻ nhân vật V3).

Tệp `.charx` là tệp lưu trữ ZIP chứa định nghĩa `card.json`. TomoriBot nhập văn bản nhân vật từ `card.json` và bỏ qua các tệp tài nguyên đi kèm (biểu tượng, sprite, âm thanh, video). Bạn có thể đặt avatar trong `/config` > Persona > Identity & Personality và thêm sprite trong `/config` > Persona > Sprites.

Nếu tệp đã tải lên là thẻ SillyTavern hợp lệ không có siêu dữ liệu TomoriBot thì quá trình nhập sẽ tự động chuyển đổi tệp đó. Bạn cũng có thể truyền thẻ vào `/persona generate` để tạo một persona mới lấy cảm hứng từ nhân vật đó.

Quá trình nhập được xác thực trước khi lưu (giới hạn mặc định: 5.000 ký tự cho mỗi trường văn bản, 200 thuộc tính, 100 đoạn hội thoại mẫu mỗi bên, 100 từ kích hoạt). Để biết cơ chế chuyển đổi và ánh xạ trường, hãy xem [kiến trúc hỗ trợ thẻ](/architecture/integrations/sillytavern/card-support/).

:::tip
Character Book của thẻ sẽ trở thành [lorebook](/features/knowledge/memory/lorebooks/) của persona đó. Các mục đã tắt vẫn sẽ ở trạng thái tắt. Việc nhập lại thẻ sẽ thay thế toàn bộ lorebook của persona, bao gồm cả các mục bạn tự thêm.
:::

## Xuất thẻ nhân vật

Dùng `/persona export` với `output_format` đặt thành `PNG tương thích SillyTavern` để đưa một persona
vào SillyTavern. Thẻ bao gồm avatar, tính cách, hội thoại mẫu, prompt của persona
và lorebook của persona. Thẻ không có lời chào mở đầu; hãy thêm một lời chào trong SillyTavern trước khi bắt đầu trò chuyện.

Các cài đặt riêng của TomoriBot, như từ kích hoạt, gợi ý, cài đặt giọng nói và giới hạn kênh của lorebook,
bị loại trừ. Hãy chọn `Thẻ TomoriBot` hoặc `JSON thuần` để giữ lại cài đặt persona của TomoriBot.
`Gói TomoriBot` còn mang theo sprite và ảnh tham chiếu nhân vật, cộng thêm âm thanh giọng tham chiếu khi
được yêu cầu. Tệp ZIP này là định dạng của TomoriBot; hãy dùng `PNG tương thích SillyTavern` cho SillyTavern.

## Preset prompt
<!-- anchor: prompt-presets -->

Preset Trình quản lý prompt SillyTavern kiểm soát thứ tự và bố cục của prompt gửi đến model. Mở `/config` > Plugin > SillyTavern Presets để nhập preset, bật tắt từng node riêng lẻ, chuyển đổi preset đang hoạt động hoặc khôi phục định dạng mặc định.

:::tip
Nhập một preset có tên đã tồn tại sẽ thay thế preset đó, bao gồm các node bạn đã bật hoặc tắt, đồng thời kích hoạt preset mới. Hãy đặt cho mỗi biến thể một tên khác nếu bạn muốn giữ lại cả hai.
:::

### Những gì preset kiểm soát

- Thứ tự prompt và vị trí đặt đánh dấu
- Các node prompt tùy chỉnh
- Các node sau lịch sử và node tiêm sâu
- Trạng thái bật ban đầu cho các node đã nhập

### Những gì preset không thay thế

Một preset định hình bố cục prompt; nó không thay thế các nguồn văn bản điền vào đó:

- Chỉ dẫn hệ thống và các trường persona: `/config` > Hành vi > Hành vi chung, `/config` > Persona > Nâng cao và `/config` > Persona > Danh tính & Tính cách.
- Lịch sử trò chuyện trực tiếp, ngữ cảnh tài liệu được truy xuất và các mục lorebook đã kích hoạt.
- Ngữ cảnh tự động: bộ nhớ máy chủ, dữ liệu emoji và sticker, danh sách người tham gia và bộ nhớ ngắn hạn.

### Cách các khối mặc định ánh xạ

Các khối gốc ánh xạ trực tiếp tới các thành phần prompt của TomoriBot:

- `main`: ghi đè prompt kênh, khi được cấu hình
- `charDescription`: `/config` > Persona > Nâng cao
- `charPersonality`: `/config` > Persona > Danh tính & Tính cách
- `dialogueExamples`: `/config` > Persona > Danh tính & Tính cách
- `chatHistory`: lịch sử tin nhắn kênh trực tiếp
- `worldInfoBefore` và `worldInfoAfter`: các mục lorebook cho vị trí đặt đó, sau đó là ngữ cảnh tài liệu được truy xuất

### Quy tắc prompt hệ thống

Khi một preset đã nhập đang hoạt động, nó sẽ kiểm soát hoàn toàn prompt hệ thống. Prompt tích hợp của TomoriBot và bất kỳ prompt tùy chỉnh nào từ `/config` > Hành vi > Hành vi chung đều không được gửi, và các nút prompt hệ thống ở đó sẽ bị khóa. Prompt tùy chỉnh của bạn vẫn được giữ lại và sẽ hoạt động trở lại khi bạn tắt preset trong `/config` > Plugin > SillyTavern Presets.

### Macro preset
<!-- anchor: preset-macros -->

Dùng [macro preset](/features/prompt-macros/#sillytavern-preset-macros) để chèn chi tiết persona, tin nhắn người dùng mới nhất hoặc giờ máy chủ vào một node preset.

### Chỉ dẫn có điều kiện
<!-- anchor: conditional-instructions -->

Dùng [điều kiện preset](/features/prompt-macros/#preset-conditionals) để chọn chỉ dẫn dựa trên một giá trị, chẳng hạn persona có mô tả hay không.

### Lưu ý về độ tương thích

- Các node bị tắt trong `prompt_order` vẫn không hoạt động cho đến khi được bật trong `/config` > Plugin > SillyTavern Presets. Các node trống và chỉ có nhận xét không bao giờ được gửi.
- Thứ tự marker là nguyên văn: đặt `chatHistory` trước `dialogueExamples` sẽ đặt lịch sử trò chuyện lên trước. Marker world info định vị lore Luôn bật (Always On); lore được kích hoạt, tài liệu truy xuất, thông tin hiện diện và đồng hồ nằm gần bốn lượt người nói mới nhất. Bộ nhớ ngắn hạn mới hoặc từ kênh khác cũng nằm gần các tin nhắn đó, hoặc gần hơn nếu được cấu hình.
- Nội dung chèn sau lịch sử sẽ hợp nhất vào lịch sử hội thoại hiện có thay vì gửi dưới dạng tin nhắn độc lập.
- Không hỗ trợ xử lý hậu kỳ Regex, các tham số lấy mẫu do preset định nghĩa (nhiệt độ, top-p) và preset phân lớp. Nhập các preset hoàn thành văn bản cũ sẽ bị loại bỏ các khối chỉ dành riêng cho ST.

Trong `/help`, chọn `Plugin`, sau đó là `Preset SillyTavern` để xem hướng dẫn trên Discord. Để biết cách xử lý preset nội bộ, hãy xem [kiến trúc hệ thống preset](/architecture/integrations/sillytavern/preset-system/).
