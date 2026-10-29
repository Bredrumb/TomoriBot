---
title: "Hỗ trợ SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Dùng thẻ nhân vật SillyTavern trong Discord"
description: "Nhập thẻ nhân vật và preset prompt SillyTavern vào Discord với TomoriBot. Mang các nhân vật có sẵn vào máy chủ của bạn."
sidebar:
  order: 2
aiGenerated: true
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
Character Book của thẻ sẽ trở thành [lorebook](/features/knowledge/lorebooks/) của persona đó. Các mục đã tắt vẫn sẽ ở trạng thái tắt. Việc nhập lại thẻ sẽ thay thế toàn bộ lorebook của persona, bao gồm cả các mục bạn tự thêm.
:::

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

### Chỉ dẫn có điều kiện

Sử dụng các khối Handlebars để chỉ bao gồm các chỉ dẫn khi một giá trị tồn tại:

```text
{{#if description}}Làm theo mô tả nhân vật.{{else}}Dùng giọng điệu trung tính.{{/if}}
{{#unless {{getvar::compact}}}}Bao gồm chi tiết bối cảnh.{{/unless}}
```

Một tên trần như `description` có nghĩa là `{{description}}`. Bạn cũng có thể đặt macro giá trị trực tiếp bên trong một điều kiện, ví dụ như `{{#if {{input}}}}`. Văn bản trống, `false` và `0` là sai sau khi đã cắt khoảng trắng và bỏ qua viết hoa/thường. Các macro không xác định trong điều kiện được tính là trống.

Các khối có thể lồng nhau, bao gồm các khối `{{if capability:web_search}}` và `{{if tool:web_search}}` của TomoriBot. Đóng `#if` bằng `{{/if}}` và `#unless` bằng `{{/unless}}`. Khối sai định dạng (chẳng hạn như có `else` thứ hai hoặc sai thẻ đóng) sẽ bị bỏ qua. Khối Handlebars không có thẻ đóng sẽ kết thúc ở cuối node của nó. Các `else` và thẻ đóng thừa sẽ bị loại bỏ. Lồng quá 32 khối sẽ khiến cú pháp điều kiện không được render. Ghi chú nhập tệp sẽ báo cáo các sự cố này.

`{{setvar::key::value}}` lưu trữ văn bản; `{{addvar::key::value}}` nối thêm văn bản. Khai báo trong nhánh Handlebars không được chọn sẽ không có tác dụng. Các điều kiện nhìn thấy khai báo xuất hiện sớm hơn theo thứ tự node, bao gồm cả phần xuất hiện sớm hơn trong cùng một node. Văn bản `{{getvar::key}}` thông thường thấy giá trị cuối cùng sau khi tất cả các node đang bật đã được duyệt qua. Điều kiện công cụ và tính năng chạy sau đó, vì vậy chúng không kiểm soát việc gán biến.

### Macro preset
<!-- anchor: preset-macros -->

| Macro | Giá trị |
|---|---|
| `{{user}}` | Thành viên đã kích hoạt phản hồi |
| `{{char}}`, `{{bot}}` | Tên của persona đang hoạt động |
| `{{personality}}` | Các thuộc tính của persona |
| `{{description}}` | Prompt của persona |
| `{{scenario}}` | Trống: kịch bản của thẻ được gộp vào thuộc tính của persona |
| `{{mesExamples}}` | Văn bản hội thoại mẫu |
| `{{lastChatMessage}}`, `{{input}}` | Tin nhắn gần đây nhất của người dùng trong cuộc trò chuyện được cung cấp |
| `{{time}}` | Giờ máy chủ, chẳng hạn như `3:45 PM` |
| `{{date}}` | Ngày máy chủ, chẳng hạn như `October 28, 2026` |
| `{{weekday}}` | Tên thứ trong tuần bằng tiếng Anh, chẳng hạn như `Wednesday` |
| `{{isotime}}` | Giờ máy chủ ở định dạng `HH:mm`, chẳng hạn như `15:45` |
| `{{isodate}}` | Ngày máy chủ ở định dạng `YYYY-MM-DD`, chẳng hạn như `2026-10-28` |
| `{{model}}` | ID model đã cấu hình; các lựa chọn từ bộ chọn ngẫu nhiên mỗi lượt và model dự phòng không được phản ánh |
| `{{provider}}` | ID nhà cung cấp đã cấu hình: `google`, `openrouter`, `novelai` hoặc `custom` |
| `{{char_version}}` | Trống: phiên bản thẻ nhân vật không được lưu trữ |

Các macro thời gian dùng chung một giá trị đồng hồ cho mỗi prompt và sử dụng độ lệch UTC bằng số của máy chủ. Giờ mùa hè tuân theo độ lệch bạn đã đặt. Múi giờ cá nhân của thành viên không ảnh hưởng đến chúng. Khi tính năng nhận biết thời gian bị tắt, cả năm macro thời gian đều trống và điều kiện kiểm tra một trong số chúng sẽ là sai. Hãy giữ các macro thời gian trong các node ở cuối hoặc node tiêm sâu: giá trị thay đổi như `{{time}}` sẽ làm mất hiệu lực bộ nhớ đệm prompt của nhà cung cấp đối với mọi thứ phía sau nó.

`{{random: A, B}}` và `{{random::A::B}}` chọn một mục; `{{roll:2d6}}` tung xúc xắc. `{{// notes}}` loại bỏ nhận xét và `{{trim}}` cắt bỏ khoảng trắng xung quanh node. Các macro và câu điều kiện này áp dụng cho các chỉ dẫn của preset. Các mục lorebook chỉ mở rộng `{{user}}`, `{{char}}` và `{{bot}}`.

### Lưu ý về độ tương thích

- Các node bị tắt trong `prompt_order` vẫn không hoạt động cho đến khi được bật trong `/config` > Plugin > SillyTavern Presets. Các node trống và chỉ có nhận xét không bao giờ được gửi.
- Thứ tự khối theo đúng thứ tự: đặt `chatHistory` trước `dialogueExamples` sẽ đặt lịch sử trò chuyện lên đầu tiên trong prompt.
- Nội dung chèn sau lịch sử sẽ hợp nhất vào lịch sử hội thoại hiện có thay vì gửi dưới dạng tin nhắn độc lập.
- Không hỗ trợ xử lý hậu kỳ Regex, các tham số lấy mẫu do preset định nghĩa (nhiệt độ, top-p) và preset phân lớp. Nhập các preset hoàn thành văn bản cũ sẽ bị loại bỏ các khối chỉ dành riêng cho ST.

Trong `/help`, chọn `Plugin`, sau đó là `Preset SillyTavern` để xem hướng dẫn trên Discord. Để biết cách xử lý preset nội bộ, hãy xem [kiến trúc hệ thống preset](/architecture/integrations/sillytavern/preset-system/).
