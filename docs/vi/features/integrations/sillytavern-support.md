---
title: "Hỗ trợ SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Dùng thẻ nhân vật SillyTavern trong Discord"
description: "Nhập thẻ nhân vật và preset prompt SillyTavern vào Discord với TomoriBot. Mang các nhân vật có sẵn vào máy chủ của bạn."
sidebar:
  order: 2
---

TomoriBot có thể nhập hai thành phần từ [SillyTavern](https://github.com/SillyTavern/SillyTavern) mà bạn có thể đã có: **preset Prompt Manager** (cách sắp xếp prompt) và **thẻ nhân vật** (chính nhân vật đó). Đây là tính năng chuyên biệt dành cho người dùng SillyTavern, vì vậy nếu bạn chưa từng dùng SillyTavern, bạn có thể bỏ qua trang này.

## Nhập thẻ nhân vật

Đưa một nhân vật SillyTavern có sẵn trực tiếp vào Discord bằng lệnh `/persona import`. Lệnh này chấp nhận:

- **Thẻ PNG** có nhúng siêu dữ liệu `chara` / `char`,
- **Thẻ JSON kiểu v2** (`name`, `description`, `first_mes` ở cấp gốc, …),
- **Thẻ JSON v3** (`spec: "chara_card_v3"` với đối tượng `data` lồng nhau),
- **Tệp lưu trữ `.charx`** (Character Card V3, định dạng mặc định mà các trang thẻ nhân vật cung cấp).

Tệp `.charx` là một tệp zip có chứa `card.json` nắm giữ thông tin nhân vật. TomoriBot đọc thẻ đó và bỏ qua mọi thứ khác trong tệp lưu trữ: các biểu tượng đi kèm, sprite cảm xúc, âm thanh và video đều không được nhập, và phản hồi nhập sẽ nêu rõ điều này. Hãy đặt ảnh đại diện bằng `/server avatar` và thêm sprite tại `/config` > Persona > Sprites.

Nếu tệp không có siêu dữ liệu TomoriBot nhưng là một thẻ ST v2/v3 hợp lệ, quá trình nhập sẽ tự động xử lý qua quy trình chuyển đổi SillyTavern. Bạn cũng có thể đưa thẻ vào `/persona generate` để biến đổi thẻ thành một persona hoàn toàn mới.

Dữ liệu nhập sẽ đi qua một bộ quy chuẩn xác thực trước khi được lưu lại (giới hạn mặc định: 5.000 ký tự mỗi chuỗi, 200 thuộc tính, 100 đoạn hội thoại mẫu mỗi bên, 100 từ kích hoạt; người self-hosting có thể tinh chỉnh các biến môi trường `PRESET_MAX_*`). Quá trình đọc tệp lưu trữ được giới hạn riêng bởi các biến môi trường `MAX_CHARX_*`, vì kích thước nén của tệp lưu trữ không thể hiện kích thước sau khi giải nén. Để biết chi tiết về ánh xạ trường và chuyển đổi chính xác, hãy xem [kiến trúc hỗ trợ thẻ nhân vật](/en/architecture/integrations/sillytavern/card-support/).

## Preset prompt
<!-- anchor: prompt-presets -->

Một preset Prompt Manager của SillyTavern kiểm soát **bố cục** của prompt. Dùng `/config` > Plugins > SillyTavern Presets để nhập preset, kiểm tra các node đang bật, chuyển đổi giữa các preset hoặc quay lại bố cục thông thường.

### Những gì preset kiểm soát

- Thứ tự prompt và vị trí đặt marker
- Các node prompt tùy chỉnh
- Các node chèn sau lịch sử hoặc chèn theo độ sâu
- Các node đã nhập nào bắt đầu ở trạng thái bật hoặc tắt

### Những gì preset *không* thay thế

Một preset nắm quyền kiểm soát *bố cục*, chứ không phải mọi nguồn văn bản. Những thành phần sau vẫn tồn tại song song:

- Các khối hệ thống/persona của bạn: `/config` > Engine > General, `/config` > Persona > Advanced, các hành động thuộc tính và hội thoại mẫu trên `/config` > Persona > Identity & Personality.
- Lịch sử trò chuyện trực tiếp và ngữ cảnh tài liệu được truy xuất.
- Ngữ cảnh tự động của TomoriBot: bộ nhớ máy chủ, ngữ cảnh emoji/sticker, người dùng trong cuộc trò chuyện, bộ nhớ ngắn hạn, điều hòa hành vi và các khối tương tự.

### Cách các khối mặc định ánh xạ

- `main` → prompt hệ thống hiện tại (`/config` > Engine > General, nếu không sẽ dùng phương án dự phòng tích hợp sẵn)
- `charDescription` → `/config` > Persona > Advanced
- `charPersonality` → `/config` > Persona > Identity & Personality
- `dialogueExamples` → `/config` > Persona > Identity & Personality
- `chatHistory` → lịch sử kênh trò chuyện trực tiếp
- `worldInfoBefore` / `worldInfoAfter` → ngữ cảnh tài liệu được truy xuất (không phải lorebook của ST)

### Quy tắc prompt hệ thống

Khi một preset đang hoạt động, prompt hệ thống dự phòng tích hợp sẵn sẽ bị gỡ bỏ, nhưng nếu *bạn* tự đặt prompt riêng bằng `/config` > Engine > General, prompt đó vẫn được gửi đi.

### Lưu ý về độ tương thích

Những bất ngờ thường gặp khi preset có vẻ bị bỏ qua:

- Nhập vào ≠ được gửi đi: các node bị tắt trong `prompt_order` sẽ tiếp tục tắt cho đến khi bạn bật lên trong `/config` > Plugins > SillyTavern Presets. Các node chỉ chứa ghi chú hoặc trống sẽ không bao giờ được gửi; các marker không xác định sẽ bị bỏ qua.
- Thứ tự là chính xác tuyệt đối: đặt `chatHistory` trước `dialogueExamples` sẽ gửi trò chuyện trực tiếp lên trước.
- Các mục chèn sau lịch sử hoặc chèn theo độ sâu sẽ được hợp nhất vào các mục lịch sử trò chuyện hiện có thay vì trở thành tin nhắn độc lập; nhiều node ở cùng một độ sâu sẽ được gom nhóm lại.
- Xử lý hậu kỳ Regex, tùy chỉnh ưu tiên nhiệt độ/top-p/model từ phía preset và các preset phân lớp đều không được hỗ trợ. Các preset hoàn thành văn bản kế thừa được nhập qua quy trình hỗ trợ tối đa, tự động loại bỏ các khối chỉ có ở ST (kịch bản, anchor, stop string, …).

Trong `/help`, chọn **Integrations**, rồi chọn `Preset SillyTavern`, để xem tài liệu tham khảo trong Discord. Về cơ chế nội bộ của bộ máy nhập, hãy xem [kiến trúc hệ thống preset](/en/architecture/integrations/sillytavern/preset-system/).
