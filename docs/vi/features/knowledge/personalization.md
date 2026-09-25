---
title: "Cá nhân hóa"
sidebar:
  order: 3
---

TomoriBot có thể được cấu hình **dành riêng cho bạn** bằng các lệnh `/personal`: các cài đặt này đi theo bạn qua mọi máy chủ bạn dùng chung với bot, độc lập với cấu hình của bất kỳ máy chủ nào.

## Bộ nhớ cá nhân

Các dữ kiện bot nhớ về bạn sẽ đi theo bạn giữa các máy chủ. Việc quản lý chúng (thêm, xóa, xuất) được trình bày trên trang [Bộ nhớ](/vi/features/knowledge/memory/#personal-vs-server-memories).

## Hồ sơ và tên theo persona

Lệnh `/personal config` lưu trữ ba tùy chọn độc lập không bắt buộc: bản dạng giới, đại từ xưng hô và kiểu xưng hô. TomoriBot không bao giờ suy diễn tùy chọn này từ tùy chọn khác. Kiểu xưng hô chọn biến thể đặt tên nam tính, nữ tính hoặc trung tính của persona, và Trung tính là mặc định được chọn sẵn. Các trường để trống sẽ bị xóa và bỏ qua khỏi ngữ cảnh prompt. Các trường hồ sơ thô chỉ hiển thị ở mức quyền riêng tư Tối thiểu (Minimal).

Lệnh `/personal config` mở một cửa sổ nhập tên cho phạm vi toàn cục hoặc phạm vi persona. Tùy chọn theo phạm vi persona sẽ đi theo nguồn gốc ổn định của persona đó qua các máy chủ. Biệt danh kế thừa từ tùy chọn persona đến tùy chọn toàn cục và sau đó là tên hiển thị trực tiếp trên Discord. Biệt danh toàn cục để trống sẽ tiếp tục lấy theo Discord, bao gồm cả những thay đổi tên hiển thị sau đó. Việc lưu biệt danh toàn cục sẽ cố định giá trị tùy chỉnh đó cho đến khi bị xóa. Tiền tố hoặc hậu tố để trống cũng kế thừa theo cách tương tự, và văn bản đã nhập sẽ ghi đè giá trị này, vì vậy `Master Mirri-san` có thể kết hợp các giá trị từ các cấp độ khác nhau mà không làm thay đổi đối tượng mention cơ bản trên Discord. Để bỏ một danh xưng mà persona tự thêm vào, hãy yêu cầu trực tiếp persona đó ("đừng gọi tôi là Master nữa"); điều này sẽ loại bỏ danh xưng đó đối với riêng persona này trong khi vẫn giữ nguyên các persona khác của bạn.

Người quản lý máy chủ có thể cấu hình mặc định cho persona bằng `/config` > Persona > Identity & Personality. Một từ xưng hô độc lập như `fam` tách biệt với tên được định dạng và chỉ khả dụng đối với văn bản prompt do persona tạo ra. Tính năng Cập nhật thông tin người dùng được bật mặc định cho phép persona áp dụng các thay đổi có cấu trúc rõ ràng được yêu cầu trong cuộc trò chuyện. Việc tắt tính năng này sẽ dừng các cập nhật công cụ tự động nhưng không tắt `/personal config`.

Lệnh `/personal config` chỉ lưu trữ độ lệch UTC dạng số từ -12 đến +14. Lệnh không lưu trữ hoặc suy luận vị trí địa lý hoặc múi giờ IANA.

## Nhà cung cấp riêng của bạn
<!-- anchor: your-own-providers -->

Các nhà cung cấp cá nhân cho phép *các yêu cầu của chính bạn* sử dụng API key và model của *chính bạn* thay vì mặc định của máy chủ. Đây là hình thức tự mang theo API key (BYOK) ở cấp độ cá nhân.

Có hai phạm vi được áp dụng, và bạn nên nắm rõ sự khác biệt giữa chúng:

- **Mặc định của máy chủ**: thông tin xác thực và danh mục dùng chung trong `/providers`, với định tuyến được chọn qua `/model` bởi các thành viên có quyền cần thiết trong máy chủ. Cài đặt này áp dụng cho tất cả mọi người tại đó.
- **Tùy chỉnh cá nhân**: cấu hình chỉ được sử dụng cho các yêu cầu của riêng bạn. Khi được bật, cài đặt này sẽ thay thế mặc định của máy chủ cho tính năng đó **trên mọi máy chủ** mà bạn sử dụng TomoriBot, không chỉ máy chủ mà bạn đã thiết lập.

**Thiết lập:**

1. `/personal providers` lưu một nhà cung cấp (khóa của bạn được mã hóa). Thao tác này cũng bật ngay tùy chỉnh `Văn bản` cá nhân của bạn, sử dụng model văn bản mặc định của nhà cung cấp đó.
2. `/personal config` cho phép chọn một model khác cho tùy chỉnh văn bản cá nhân của bạn. Việc chọn model tại đây vẫn duy trì trạng thái bật của Văn bản.
3. Quay lại `/personal providers` bất cứ khi nào bạn cần cập nhật thông tin xác thực, quản lý các endpoint tùy chỉnh, hoặc thêm và chỉnh sửa các đăng ký model cá nhân.

Việc chọn một model bằng `/personal config` sẽ kích hoạt tính năng đó cho các yêu cầu của bạn.

Vì các bước 1 và 2 chuyển bạn sang chế độ tùy chỉnh ưu tiên liên máy chủ, TomoriBot sẽ yêu cầu bạn xác nhận trước khi lưu bất cứ khi nào một tính năng chuyển từ mặc định của máy chủ sang tùy chỉnh cá nhân. Việc đổi key trên một nhà cung cấp đang phản hồi các yêu cầu của bạn sẽ bỏ qua bước xác nhận này, vì định tuyến không thay đổi.

Nhật ký suy nghĩ sẽ ghi nhận các lượt tương tác đó cho bạn, và bạn có thể tinh chỉnh chúng bằng `/personal config`. Điều này ảnh hưởng đến các yêu cầu của bạn ở mọi nơi và không bao giờ chạm vào cài đặt của máy chủ này. Bạn cũng có thể đăng ký các endpoint tùy chỉnh cá nhân bằng `/personal providers`; xem [Endpoint tùy chỉnh](/vi/features/setup-administration/providers-and-models/#custom-endpoints).

Nếu một yêu cầu không thành công trong khi sử dụng nhà cung cấp cá nhân của bạn, mẹo "Những gì bạn có thể làm" trong thông báo lỗi sẽ nêu tên các lệnh cá nhân thực sự có thể khắc phục được (`/personal providers`, `/personal config`) thay vì các lệnh dành cho người quản lý máy chủ.

:::note[Máy chủ yêu cầu BYOK]
Một máy chủ có thể yêu cầu nhà cung cấp do thành viên tự cung cấp bằng chế độ User BYOK ([Kiểm duyệt máy chủ](/vi/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)). Khi chế độ đó bật, các tin nhắn do bạn kích hoạt cần có nhà cung cấp cá nhân trước khi bot có thể phản hồi. Các nhà cung cấp cá nhân áp dụng trên mọi máy chủ mà bạn sử dụng bot.
:::

## Các cài đặt cá nhân khác

- `/personal config`: thay đổi cách bot gọi bạn.
- `/personal config`: các thẻ ngoại hình của riêng bạn (kiểu booru), được sử dụng khi [tạo ảnh](/vi/features/capabilities/media-generation/image-generation/#tag-customization) có tham chiếu đến bạn. Gửi một ô trống để xóa chúng.
- `/personal config`: kiểm soát khả năng hiển thị của bạn đối với bot, lên đến mức **hoàn toàn vô hình** (từ chối hoàn toàn các tính năng bộ nhớ).
- `/personal config`: tùy chỉnh cá nhân cho [Chế độ kích hoạt có chủ đích](/vi/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- `/personal config`: chọn tham gia chia sẻ bộ nhớ ngắn hạn liên máy chủ; `/personal memories` sẽ xóa STM của bạn.
- `/personal config`: đặt một prompt có thể tái sử dụng khi bot mạo danh bạn thông qua `/impersonate user`.

## Spotlight cá nhân
<!-- anchor: personal-spotlight -->

**Spotlight cá nhân: lựa chọn persona theo từng kênh.** Spotlight cho phép *bạn* thu hẹp danh sách persona mà bạn có thể kích hoạt trong một kênh, và tùy chọn chỉ định một persona tự động kích hoạt cho các tin nhắn của chính bạn tại đó. Tính năng này được giới hạn cho **bạn + một kênh** và không ảnh hưởng đến bất kỳ ai khác.

**Thiết lập spotlight** bằng `/personal config`, chọn:

- thời lượng tính theo giờ (dùng **0** để giữ cho đến khi bạn xóa theo cách thủ công),
- kênh mục tiêu,
- các persona bạn muốn đưa vào spotlight.

Sau khi chọn persona, bạn có thể tùy chọn chọn một persona làm **persona tự động kích hoạt cá nhân**: persona phản hồi dự phòng cho các tin nhắn của bạn trong kênh đó. Kích hoạt trực tiếp vẫn sẽ nhắm vào bất kỳ persona nào bạn gọi tên rõ ràng. Nhấn Finish để bỏ qua.

**Các quy tắc quan trọng:**

- Spotlight chỉ **thu hẹp** quyền truy cập; không bao giờ mở rộng quyền truy cập. Các persona đã chọn là những persona *duy nhất* bạn có thể kích hoạt tại đó.
- Tính năng này vẫn tuân thủ các giới hạn persona ở cấp máy chủ được cấu hình thông qua `/moderation`.
- Chuỗi ủy nhiệm (proxy chains) bị chặn: nếu spotlight của bạn chỉ bao gồm Alice, phản hồi của Alice không thể chuyển tiếp sang Bob cho chuỗi tin nhắn của bạn.

Xem lại hoặc xóa các mục bằng `/personal config` (bỏ chọn để xóa; spotlight có đặt thời gian sẽ tự hết hạn). Trong `/help`, chọn `Hành vi`, rồi chọn `Spotlight cá nhân`, để xem bản tóm tắt trên Discord.
