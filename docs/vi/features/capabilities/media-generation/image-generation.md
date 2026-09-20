---
title: "Tạo hình ảnh"
sidebar:
  order: 1
---

TomoriBot có thể tạo hình ảnh từ lời nhắc văn bản hoặc bằng cách chỉnh sửa ảnh tham chiếu. Hãy sử
dụng lệnh `/generate image`, hoặc chỉ cần yêu cầu bot ("vẽ cho mình một chú gấu trúc đỏ đang uống cà phê").

## Những việc bot có thể làm

- **Text-to-image**: tạo ảnh từ prompt.
- **Image-to-image**: chỉnh sửa hoặc đổi phong cách cho toàn bộ ảnh tham chiếu.
- **Inpainting**: vẽ lại một vùng cụ thể trong khi vẫn giữ nguyên phần còn lại.
- **Outpainting**: mở rộng khung vẽ ra ngoài khung hình gốc.
- **Tùy chỉnh tỷ lệ khung hình**.
- **Ảnh tham chiếu** có thể lấy từ tệp đính kèm tin nhắn, sticker, emoji, hoặc avatar của người dùng/persona.
  Hãy chỉ định cho bot một tin nhắn, hoặc gọi tên người dùng/persona để lấy avatar của họ làm ảnh
  tham chiếu.

Các chế độ chỉnh sửa khả dụng phụ thuộc vào backend. Text-to-image và image-to-image hoạt động
trên các nhà cung cấp đám mây tích hợp sẵn (Google, Vertex, OpenRouter), trong khi **inpainting và
outpainting được cung cấp bởi các endpoint tùy chỉnh [ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/)
cục bộ** và phụ thuộc vào các tính năng được khai báo của endpoint đó. Bất kỳ tính năng nào backend
không thể thực hiện sẽ bị ẩn đi, vì vậy bot sẽ không cung cấp chế độ mà cấu hình của bạn không
hỗ trợ.

Khi tạo hình ảnh, bot sử dụng ngữ cảnh Ngoại hình (Physical Appearance) của persona cùng các thẻ tag tích cực
và tiêu cực mặc định (nơi backend hỗ trợ prompt tiêu cực). Kết quả được gửi dưới dạng thư viện phương tiện Discord kèm chi
tiết tại thời điểm tạo, bao gồm mọi người dùng hoặc persona được tham chiếu.

## Tùy chỉnh thẻ tag
<!-- anchor: tag-customization -->

Mọi nguồn thẻ tag ở trên đều có thể chỉnh sửa, mỗi nguồn ở một phạm vi khác nhau. Tất cả các tùy chọn này đều mở một
cửa sổ modal được điền sẵn các thẻ hiện tại, giúp bạn chỉnh sửa trực tiếp:

- **`/config` > Persona > Appearance**: các thẻ **Ngoại hình** (Physical Appearance) của persona đã chọn (cách *bot*
  xuất hiện). Yêu cầu quyền Manage Server.
- **`/personal config`**: các thẻ ngoại hình của *chính bạn*, được áp dụng khi một lượt tạo ảnh
  tham chiếu đến bạn. Thiết lập này theo bạn trên mọi máy chủ (xem
  [Cá nhân hóa](/vi/features/knowledge/personalization/)).
- **Thẻ tag tích cực và tiêu cực mặc định** tại **`/config` > Models > Image Generation Defaults**:
  các thẻ mặc định trên toàn máy chủ được thêm vào (hoặc tránh xa) trong mỗi lượt tạo ảnh. Thẻ
  tiêu cực chỉ có hiệu lực khi backend hỗ trợ prompt tiêu cực. Gửi modal với một ô trống sẽ đặt
  lại danh sách đó về giá trị mặc định tích hợp sẵn.

## Thiết lập

1. Cấu hình model hình ảnh bằng `/config` > Models > Switch Models.
2. Đảm bảo tính năng tạo hình ảnh được cho phép: được kiểm soát bởi tính năng `imagegen_enabled`
   (`/config` > Permissions).
3. Yêu cầu bot tạo ảnh, hoặc chạy `/generate image`.

## Hỗ trợ nhà cung cấp

Tính năng tạo hình ảnh nguyên bản khả dụng trên **Google, Vertex AI, Vertex AI Express, OpenRouter,
Z.ai, NVIDIA NIM**, và **NovelAI** (phong cách anime; inpainting nguyên bản đã được xây dựng và sắp
ra mắt, hiện đang tạm tắt trong khi hoàn thiện tính năng hòa trộn viền). Để xem bảng tương thích đầy
đủ và cách thêm nhà cung cấp, hãy xem
[Nhà cung cấp & model](/vi/features/setup-administration/providers-and-models/#supported-providers).

Để tạo hình ảnh **cục bộ** bằng phần cứng của riêng bạn qua ComfyUI, hãy xem
[Cài đặt: ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/).
