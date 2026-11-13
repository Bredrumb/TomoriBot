---
title: Chính sách quyền riêng tư
description: Cách TomoriBot chính thức được host thu thập, sử dụng và xóa dữ liệu của bạn.
aiGenerated: false
---

*Bản dịch này chỉ nhằm mục đích thuận tiện cho bạn tham khảo. Trong trường hợp có sự mâu thuẫn giữa bản dịch và bản tiếng Anh, bản tiếng Anh sẽ được ưu tiên áp dụng.*

Cập nhật lần cuối: 2026-10-22

Chính sách này áp dụng cho TomoriBot chính thức được host trên Discord, gồm sử dụng cá nhân, trong Máy chủ và các yêu cầu được tài trợ. Nếu bạn self-hosting TomoriBot, bạn kiểm soát dữ liệu của mình; chính sách này không áp dụng cho bản sao đó.

## Tóm tắt về quyền riêng tư

- TomoriBot đọc tin nhắn gần đây để trả lời và gửi ngữ cảnh liên quan đến nhà cung cấp AI đã chọn. Bản ghi cuộc trò chuyện tùy chọn lưu các trích đoạn tin nhắn sau khi chủ sở hữu bản ghi xác nhận; chế độ tin nhắn xung quanh có thể bao gồm những người tham gia khác. Bộ nhớ ngắn hạn tùy chọn lưu các bản tóm tắt.
- Chúng tôi giữ các cài đặt, bộ nhớ và tệp mà bạn hoặc Máy chủ chọn lưu. Một số bộ nhớ máy chủ có thể mô tả thành viên không cung cấp thông tin đó.
- Gói thành viên trả phí bổ sung liên kết tài khoản, tài trợ và bản ghi sử dụng để cung cấp quyền lợi và theo dõi hạn mức dùng chung. Chúng tôi không thu thập mật khẩu Patreon hay thông tin thẻ của bạn.
- Bạn có thể xem hoặc xóa phần lớn dữ liệu đã lưu bằng lệnh. Bản ghi gói đăng ký cần yêu cầu riêng qua hỗ trợ. Xóa dữ liệu bot không hủy việc tính phí trên Patreon.

## 1) Đối tượng áp dụng

Bao gồm cả thành viên có tin nhắn được TomoriBot đọc dù chưa bao giờ dùng lệnh. Người quản lý Máy chủ phải thông báo cho thành viên về bot và chính sách này. Đọc tài liệu hiện hành bằng `/legal privacy-policy` và `/legal terms-of-service`, hoặc xem [Điều khoản dịch vụ](/legal/terms-of-service/).

## 2) Dữ liệu lưu trữ và mục đích

Chúng tôi dùng dữ liệu đã lưu để cung cấp tính năng bạn chọn, ghi nhớ tùy chọn, quản lý quyền truy cập trả phí và duy trì dịch vụ.

### 2.1) Tài khoản và tùy chọn

Chúng tôi lưu ID người dùng Discord, lựa chọn quyền riêng tư cùng thông tin hồ sơ và tùy chọn mà bạn chọn lưu. Chúng tôi cũng giữ tổng mức sử dụng để bạn xem thống kê của mình, Máy chủ và các persona của Máy chủ. Các tùy chọn đã lưu của bạn bao gồm việc persona có được phép tag bạn để bắt đầu cuộc trò chuyện hay không (Persona tag bạn).

### 2.2) Bộ nhớ và cài đặt Máy chủ

Chúng tôi giữ bộ nhớ cá nhân và máy chủ, tùy chỉnh persona, lời nhắc và cài đặt Máy chủ để cung cấp các tính năng bạn cấu hình.

Khi một persona tự mình bắt đầu cuộc trò chuyện (Natural Nudges), chúng tôi ghi lại persona nào đã nói, kênh, liệu có ai trả lời hay không và thành viên được tag. Chúng tôi cũng lưu mục tiêu riêng của persona cho cuộc trò chuyện đó, mục tiêu này có thể đề cập đến thành viên đó.

Bộ nhớ ngắn hạn tùy chọn lưu bản tóm tắt cuộc trò chuyện. Các bộ nhớ đã lưu khác có thể mô tả những người không viết chúng. Chúng được giữ lại cho đến khi bị xóa, ngoại trừ việc tính năng suy giảm bộ nhớ có thể xóa một bộ nhớ không dùng để nhường chỗ khi bot lưu một bộ nhớ mới. Các bộ nhớ mà ai đó đã thêm hoặc chỉnh sửa bằng `/memories` hoặc `/personal memories` không bao giờ bị xóa theo cách này.

Tính năng suy giảm bộ nhớ áp dụng cho bộ nhớ máy chủ và bộ nhớ cá nhân. Nếu một model embedding được thiết lập, chúng tôi lưu trữ dữ liệu tìm kiếm được tính toán từ từng bộ nhớ và ghi lại mức độ gần đây của từng bộ nhớ khi xuất hiện trong cuộc trò chuyện, để bot có thể gợi lại các bộ nhớ có liên quan. Dữ liệu tìm kiếm được xóa cùng với bộ nhớ tương ứng. Cài đặt quyền riêng tư ngăn chặn việc dùng bộ nhớ cá nhân cũng đồng thời loại trừ những bộ nhớ đó khỏi tính năng tìm kiếm.

### 2.3) Khóa API và dịch vụ kết nối

Chúng tôi lưu khóa API, địa chỉ dịch vụ và thông tin xác thực bạn cung cấp cho nhà cung cấp AI, endpoint tùy chỉnh và máy chủ MCP, cùng liên kết giữa kênh Discord và phòng Matrix. Dịch vụ được host cũng quản lý thông tin xác thực truy cập qua gói đăng ký. Thông tin xác thực đã lưu được mã hóa.

### 2.4) Tệp bạn lưu

Chúng tôi giữ văn bản và thông tin tệp của tài liệu cơ sở kiến thức để bot tìm kiếm. Chúng tôi cũng lưu ảnh persona và, với nhân bản giọng nói, mẫu giọng cùng bản chép lời.

### 2.5) Bản ghi dịch vụ

Bản ghi lỗi và hiệu suất giúp điều tra sự cố. Chúng có thể gồm ID Discord, tên lệnh và chi tiết lỗi, nhưng không gồm cuộc trò chuyện hay nội dung tin nhắn. Chúng tôi cũng giữ mã định danh tin nhắn để quản lý tin nhắn bot đã gửi.

### 2.6) Thành viên và sử dụng gói đăng ký

Liên kết Patreon kết nối tài khoản Discord với tư cách thành viên Patreon của bạn. Chúng tôi nhận cấp gói, trạng thái thanh toán và ngày tính phí từ Patreon để xác định quyền lợi.

Chúng tôi giữ thông tin tài trợ, sự cho phép tài trợ, tổng hạn mức và chi tiêu, cùng chi tiết yêu cầu như model, tính năng, chi phí, số token, thời gian và mã định danh. Mức sử dụng tại Máy chủ được tài trợ gắn với Máy chủ đó và trừ vào hạn mức của người tài trợ.

Bản ghi đăng nhập và cập nhật thành viên tạm thời giúp bảo vệ liên kết tài khoản và tránh cập nhật trùng lặp. Token đăng nhập Patreon của chính bạn không được giữ sau khi liên kết.

### 2.7) Bản ghi cuộc trò chuyện

[Bản ghi cuộc trò chuyện](/features/setup-administration/conversation-recordings/) là tính năng tùy chọn và nằm trong phạm vi
của chủ sở hữu bản ghi và Máy chủ. Sau khi xác nhận, một tin nhắn thực tế mới từ chủ sở hữu có thể lưu tin nhắn đó và tối đa
mười tin nhắn đủ điều kiện đứng trước trong cùng một kênh hoặc luồng, ngay cả khi bot không trả lời. Ngữ cảnh
có thể gửi trước khi kích hoạt. Chế độ tin nhắn xung quanh có thể bao gồm các thành viên khác, bot và webhook mà
những người tham gia không bắt đầu ghi âm.

Chúng tôi lưu trữ văn bản tin nhắn và embed đã chuẩn hóa, dấu thời gian, ranh giới trích đoạn có thứ tự, nhãn người nói, mối quan hệ
trả lời đủ điều kiện và siêu dữ liệu loại/số lượng tệp đính kèm. Chúng tôi không lưu byte tệp đính kèm, tên tệp,
URL đính kèm, OCR hoặc mô tả phương tiện được tạo ra thông qua tính năng này. Văn bản embed bao gồm tiêu đề,
mô tả, các trường, tên tác giả và chân trang, với việc thay thế danh tính tương tự như văn bản tin nhắn. Mã định danh
nguồn bị hạn chế hỗ trợ quyền sở hữu, khử trùng lặp, loại trừ quyền riêng tư và các chỉnh sửa/xóa được ghi nhận.

Trước khi lưu nội dung, các danh tính Discord có cấu trúc cùng tên/biệt danh duy nhất đã biết chính xác sẽ trở thành
các trình giữ chỗ dễ đọc như `[SELF]` và `[PARTICIPANT_1]`. Các tên trùng lặp mơ hồ sẽ bị bỏ qua;
các từ thông thường được dùng làm tên có thể bị thay thế ngay cả khi chúng mang nghĩa khác. Emoji tùy chỉnh bị mất
ID số và liên kết tin nhắn Discord trở thành dấu hiệu chung. Văn bản tự do và URL bên ngoài thông thường
vẫn có thể nhận diện được người gửi. Việc thay thế là nỗ lực tối đa và không làm cho bản ghi trở nên ẩn danh.

Người vận hành bot lưu trữ các bản ghi này và có thể có quyền truy cập cơ sở hạ tầng. Các bộ điều khiển Discord chỉ cho phép
chủ sở hữu trong Máy chủ hiện tại xuất hoặc xóa chúng, người quản lý không thể ghi đè. Việc ghi âm
không thực hiện cuộc gọi tự động nào tới nhà cung cấp AI và không bắt đầu quy trình huấn luyện nào.

## 3) Dữ liệu đọc nhưng không lưu

TomoriBot tạm đọc tin nhắn gần đây, nội dung đa phương tiện liên quan, thông tin Máy chủ và kênh, cùng trạng thái hiện diện có sẵn để trả lời. Việc xử lý câu trả lời thông thường không tự lưu trữ lịch sử trò chuyện. Các bản ghi tùy chọn, bản tóm tắt bộ nhớ ngắn hạn và tệp bạn chủ động lưu được xử lý tại Mục 2.

## 4) Bên nhận dữ liệu

- **Nhà cung cấp AI:** nhà cung cấp đã chọn nhận prompt, ngữ cảnh trò chuyện liên quan, thông tin persona và nội dung đa phương tiện cần cho văn bản, ảnh, video, giọng nói hoặc tìm tài liệu. Trước khi persona tag ai đó để bắt đầu trò chuyện, model nhận tên hiển thị, hoạt động hiện tại và bộ nhớ gần đây của họ trừ khi họ đã ẩn chúng. Yêu cầu qua gói đăng ký dùng OpenRouter và các nhà cung cấp của model đã chọn. Chúng tôi kiểm tra chi tiêu với OpenRouter để áp dụng hạn mức.
- **Patreon:** việc liên kết cho phép chúng tôi xác minh tư cách thành viên. Patreon cung cấp cập nhật tài khoản và thành viên; Patreon và các đơn vị thanh toán của họ xử lý thanh toán và thông tin thanh toán.
- **Nhà cung cấp tìm kiếm:** khi dùng tìm kiếm web, nhà cung cấp nhận truy vấn và ngữ cảnh liên quan.
- **Matrix:** khi cấu hình cầu nối, tin nhắn được chia sẻ giữa kênh Discord và phòng Matrix đã liên kết.
- **Nhà cung cấp hosting và lưu trữ:** xử lý và lưu dữ liệu cần thiết để chạy TomoriBot.

Các dịch vụ này có thể xử lý dữ liệu ngoài quốc gia của bạn và có chính sách riêng về quyền riêng tư và thời gian lưu giữ. Chúng tôi không bán dữ liệu cá nhân; chỉ chia sẻ để cung cấp tính năng bạn dùng hoặc khi pháp luật yêu cầu.

## 5) Thời gian lưu giữ

| Dữ liệu | Thời gian lưu |
|---|---|
| Trích đoạn bản ghi cuộc trò chuyện | Không hết hạn theo thời gian trừ khi thiết lập RECORD_RETENTION_DAYS; giới hạn số ngày dương đã cấu hình cũng áp dụng cho dữ liệu hiện có. Hạn ngạch hợp lý 100 MiB cho mỗi chủ sở hữu trên các Máy chủ có thể thu hồi các trích đoạn hoàn chỉnh cũ nhất sớm hơn. |
| Bản tóm tắt bộ nhớ ngắn hạn | Mặc định 90 ngày sau hoạt động gần nhất |
| Nhật ký lỗi | 90 ngày |
| Bản ghi hiệu suất và mã định danh tin nhắn bot | 30 ngày |
| Bản ghi Natural Nudges | 30 ngày; mục tiêu riêng của persona tối đa 90 ngày |
| Bản ghi cập nhật thành viên Patreon | Mặc định 30 ngày |
| Bản ghi đăng nhập Patreon đã hoàn tất hoặc hết hạn | Mặc định đủ điều kiện xóa sau một giờ |
| Chi tiết sử dụng gói đăng ký | 90 ngày; bản ghi kỳ hiện tại giữ đến khi kỳ kết thúc nếu muộn hơn |
| Bản sao phục hồi cơ sở dữ liệu | Bảy ngày |
| Bản sao tự động khi khởi động | Tối đa năm bản; bản cũ bị xóa khi có bản mới |
| Liên kết thành viên, trạng thái truy cập, tài trợ và khóa được quản lý | Trong thời gian liên kết; liên hệ hỗ trợ để hủy liên kết hoặc xóa |
| Mã định danh thành viên và tổng hạn mức/chi tiêu giữ sau hủy liên kết | 90 ngày từ thời điểm muộn nhất trong ba mốc: hủy liên kết, hết kỳ trả phí và hoàn tất xóa khóa nhà cung cấp |
| Cài đặt, bộ nhớ, thông tin xác thực và tệp khác đã lưu | Đến khi xóa bằng các công cụ tại Mục 6 |

Bản ghi hết hạn được xóa trong đợt dọn dẹp định kỳ. Chúng tôi có thể giữ bản ghi kế toán liên quan lâu hơn vì một tranh chấp cụ thể chưa giải quyết hoặc nghĩa vụ pháp lý, rồi xóa khi không còn cần thiết. Tổng chi tiêu có thể còn sau khi chi tiết sử dụng bị xóa. Dữ liệu đã xóa có thể còn trong bản sao lưu: bản sao phục hồi cơ sở dữ liệu hết hạn sau bảy ngày, còn bản sao lúc khởi động giữ đến khi bị thay thế. Bản sao riêng cho phục hồi hoặc di chuyển được xóa khi công việc hoàn tất.

Gỡ bot vẫn giữ dữ liệu Máy chủ để dùng khi mời lại; hãy chạy `/nuke` trước nếu muốn xóa. Hủy tính phí không xóa bản ghi thành viên.

## 6) Xem, xuất hoặc xóa dữ liệu

| Việc bạn muốn làm | Nơi thực hiện |
|---|---|
| Kiểm soát mức hiển thị tin nhắn và việc dùng bộ nhớ cá nhân | `/personal config` |
| Chặn persona tag bạn để bắt đầu trò chuyện | `/personal config` > `Quyền riêng tư` > `Persona tag bạn` |
| Xem hoặc xóa bộ nhớ cá nhân | `/personal memories` |
| Xem hoặc xóa bộ nhớ và tài liệu Máy chủ | `/memories` |
| Xuất hoặc xóa bản ghi Máy chủ hiện tại của bạn | `/record data`; Markdown hoặc JSON có phiên bản, tệp đính kèm tương tác riêng tư, xóa khoảng thời gian đã xác nhận hoặc toàn bộ bản ghi |
| Dừng thu thập trích đoạn mới mà không xóa các trích đoạn đã lưu | `/record stop` |
| Xuất cài đặt hoặc bộ nhớ cá nhân | `/export personal config`, `/export personal memories` |
| Xuất cài đặt hoặc bộ nhớ Máy chủ | `/export config`, `/export memories` |
| Đặt lại cài đặt cá nhân | `/reset personal config` |
| Xóa dữ liệu cá nhân mô tả dưới đây trên mọi Máy chủ | `/personal nuke` |
| Xóa dữ liệu một Máy chủ (chỉ người quản lý) | `/nuke` |

`/personal nuke` xóa cài đặt cá nhân, bộ nhớ, thông tin xác thực và cấu hình nhà cung cấp đã lưu, số lượt sử dụng, cùng lời nhắc bạn tạo hoặc được đặt cho bạn. Xóa phản hồi của bạn cũng có thể ảnh hưởng cách persona hành xử với thành viên khác.

Bộ nhớ và tài liệu Máy chủ bạn cung cấp vẫn còn, nhưng bỏ liên kết tác giả; hãy nhờ người quản lý xóa bằng `/memories`. Nếu bộ nhớ hoặc tài liệu chung chứa dữ liệu cá nhân về bạn mà bạn không thể yêu cầu xóa, hãy liên hệ trực tiếp theo Mục 9. Không cần người quản lý cho phép để yêu cầu xem xét và xóa.

Cài đặt quyền riêng tư giới hạn mức hiển thị tin nhắn và cá nhân hóa; không xóa bộ nhớ hiện có. Lựa chọn từ chối thu thập được giữ sau khi xóa để việc thu thập không âm thầm bật lại. Lựa chọn Persona tag bạn là một cài đặt cá nhân hóa, vì vậy `/personal nuke` sẽ xóa nó; hãy tắt lại Persona tag bạn sau đó nếu bạn vẫn muốn tắt.

Các bản xuất bản ghi vẫn khả dụng sau khi mất quyền truy cập kênh nguồn, tùy thuộc vào các loại trừ quyền
riêng tư hiện tại và thời gian lưu giữ. Khoảng ngày chọn các trích đoạn theo thời gian kích hoạt vào nửa đêm UTC,
với thời điểm bắt đầu được bao gồm và thời điểm kết thúc không được bao gồm. Các chỉnh sửa được ghi nhận sẽ áp dụng lại việc thay thế
danh tính; các thao tác xóa nguồn đơn lẻ hoặc hàng loạt được ghi nhận sẽ xóa bản sao đã lưu. Các loại trừ quyền riêng tư sau đó sẽ cắt tỉa dữ liệu đã lưu bị ảnh hưởng.
Chúng tôi không thể đảm bảo nhận được sự kiện khi bot ngoại tuyến hoặc sau khi thay đổi quyền truy cập. Việc xóa trực tiếp không
thu hồi các bản xuất đã tải xuống hoặc ghi lại bản sao lưu, vốn tuân theo các vòng đời riêng biệt tại Mục 5.
Việc xóa bản ghi vẫn để tính năng thu thập bật trừ khi bạn cũng dừng tính năng đó.

Với gói đăng ký, dùng bảng đăng ký để xem hạn mức, tài trợ hoặc ngừng tài trợ một Máy chủ. Hủy gia hạn trên Patreon; ngừng tài trợ hoặc xóa dữ liệu bot không ngừng tính phí.

Liên hệ theo Mục 9 để truy cập, hủy liên kết hoặc xóa bản ghi gói đăng ký; xuất dữ liệu thông thường và `/personal nuke` không bao gồm chúng. Hủy liên kết xóa liên kết tài khoản, quyền truy cập, tài trợ và chi tiết sử dụng cục bộ, đồng thời yêu cầu xóa khóa nhà cung cấp được quản lý. Một số bản ghi kế toán giới hạn có thể còn như Mục 5 mô tả.

## 7) Bảo vệ dữ liệu

Thông tin xác thực truy cập đã lưu được mã hóa. Kết nối cơ sở dữ liệu được mã hóa và xác minh danh tính máy chủ. Quyền truy cập giới hạn cho môi trường chạy bot và người vận hành có quyền truy cập hạ tầng.

Không hệ thống nào hoàn toàn an toàn. Tránh cung cấp thông tin rất nhạy cảm hoặc dữ liệu cần xử lý đặc biệt.

## 8) Dữ liệu trẻ em

TomoriBot không hướng đến người chưa đủ tuổi tối thiểu của Discord tại quốc gia của họ, ít nhất là 13 tuổi. Chúng tôi không cố ý thu thập dữ liệu của người dưới tuổi đó. Hãy liên hệ nếu bạn cho rằng chúng tôi đang giữ dữ liệu như vậy; chúng tôi sẽ xóa. Một số nhà cung cấp và tính năng đăng ký yêu cầu tuổi cao hơn, như Điều khoản dịch vụ giải thích.

## 9) Liên hệ

Với câu hỏi về quyền riêng tư hoặc yêu cầu không thể thực hiện bằng lệnh, gửi email đến `bredrumb@gmail.com` hoặc liên hệ trong [máy chủ Discord hỗ trợ TomoriBot chính thức](https://discord.gg/bjCfHm9QsB). Dùng email hoặc tin nhắn trực tiếp cho dữ liệu cá nhân và vấn đề bảo mật, thay vì issue GitHub công khai.

## 10) Thay đổi

Chúng tôi thông báo thay đổi quan trọng qua Discord hỗ trợ hoặc repository dự án và cập nhật ngày ở đầu chính sách.

## 11) Người dùng quốc tế và GDPR

Nếu ở EEA, Vương quốc Anh hoặc Thụy Sĩ, luật bảo vệ dữ liệu áp dụng cho bạn quyền truy cập, sửa, xóa, hạn chế và nhận bản sao dữ liệu ở định dạng có thể chuyển, cũng như phản đối xử lý. Dùng các công cụ trên hoặc liên hệ chúng tôi.

Chúng tôi xử lý dữ liệu để thực hiện thỏa thuận với bạn, gồm tính năng bạn yêu cầu và quyền lợi trả phí. Chúng tôi dựa trên lợi ích chính đáng để cung cấp trò chuyện nhóm do Máy chủ cấu hình, bảo vệ dịch vụ, ngăn lạm dụng và cấp hạn mức trùng lặp, duy trì độ tin cậy, đồng thời cân nhắc quyền và lựa chọn riêng tư của thành viên. Người quản lý bật tính năng không có nghĩa mọi thành viên đã đồng ý. Bạn có thể dùng các công cụ riêng tư trên hoặc liên hệ để phản đối xử lý.
