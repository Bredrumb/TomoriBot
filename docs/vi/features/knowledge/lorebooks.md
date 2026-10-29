---
title: "Lorebook"
sidebar:
  order: 2
aiGenerated: false
---

Lorebook là bộ nhớ nâng cao cho thế giới nhập vai, nhân vật và các chi tiết cốt truyện định kỳ. Dùng
Bộ nhớ cho các cuộc trò chuyện hàng ngày. Các mục lorebook sẽ gợi lại những chi tiết bạn đã viết khi
từ khóa của chúng xuất hiện trong các tin nhắn gần đây.

Quản lý lorebook trong `/memories` > `Lorebook`. Mọi thành viên đều có thể đọc các mục trong phạm vi;
chỉ những thành viên có quyền `Quản lý Máy chủ` mới có thể thêm, sửa, nhập, xuất hoặc xóa chúng.

## Lorebook Toàn máy chủ và Persona

Lorebook có hai phạm vi:

- Sách **Toàn máy chủ** áp dụng cho mọi persona trong máy chủ. Chọn một cuốn sách trước, sau đó chọn một mục trong đó.
- Các mục **Persona** thuộc về một nguồn gốc persona. Chúng tiếp tục được áp dụng sau khi persona bị xóa và được nhập lại.

Dùng các nút `Toàn máy chủ` và `Persona` ở đầu trang để chuyển đổi phạm vi. Danh sách persona
nhóm các persona có chung nguồn gốc, vì chúng dùng chung một cuốn sách. Giới hạn kênh và phạm vi
Toàn máy chủ/Persona là các quyền kiểm soát riêng biệt: phạm vi quyết định ai sở hữu mục đó, trong khi kênh
quyết định nơi mục đó có thể xuất hiện.

## Viết một mục

Cung cấp cho mỗi mục một tiêu đề, từ khóa và nội dung tối đa 4.000 ký tự. Từ khóa là các từ hoặc
cụm từ phân tách bằng dấu phẩy. Việc khớp từ khóa sẽ bỏ qua phân biệt chữ hoa/thường và dạng toàn phần/bán phần.

Để trống từ khóa cho các thông tin bối cảnh không cần khớp từ khóa. Thêm lại từ khóa để khôi phục
tính năng khớp từ khóa. Các mục mới sử dụng vị trí đặt sau persona; các mục đã nhập vẫn giữ nguyên vị trí đặt của chúng.
Các vị trí world info của preset SillyTavern sẽ kiểm soát nơi nhóm trước và sau xuất hiện.

## Khi nào các mục kích hoạt

Một mục đang bật cần khớp từ khóa trừ khi để trống phần từ khóa. Giới hạn phạm vi và kênh vẫn
áp dụng cho các mục không có từ khóa.

`Quy tắc kích hoạt` kiểm soát các từ khóa phụ, số lượng tin nhắn gần đây được tìm kiếm (1-100), tỷ lệ
kích hoạt và thứ tự chèn. Từ khóa phụ có thể yêu cầu khớp bất kỳ từ khóa nào (OR), khớp tất cả (AND), không khớp
từ nào (NOR) hoặc ít hơn tất cả các từ (NAND). Số thứ tự chèn nhỏ hơn sẽ xuất hiện trước.

Tỷ lệ kích hoạt chạy từ 0% đến 100%. Số 0 sẽ ngăn việc kích hoạt, bao gồm cả các mục không có từ khóa.
Xác suất bị thiếu hoặc mang giá trị null trong tệp đã nhập sẽ mặc định là 100%; mức 0% rõ ràng sẽ giữ nguyên ở mức 0%.
Các mục `Đã tắt` vẫn được lưu nhưng không được đưa vào prompt.

Khớp từ khóa theo nghĩa đen. Các khóa có dạng regex như `/a+/` được giữ nguyên văn và không hoạt động như
biểu thức chính quy.

## Những gì đến được prompt

Các mục đã kích hoạt được gửi trong một khối `World Info` cho mỗi vị trí đặt, theo thứ tự chèn. Cả hai khối
dùng chung giới hạn 8.000 ký tự; mục nào vượt quá giới hạn sẽ bị bỏ qua để các mục sau vẫn có thể
vừa vặn.

Nội dung có thể sử dụng `{{user}}`, `{{char}}` và `{{bot}}`. TomoriBot thay thế chúng bằng các tên hiện tại.
Các macro `{{...}}` khác và khối điều kiện được giữ nguyên như văn bản đã viết.

## Giới hạn kênh

Các giới hạn kênh Toàn máy chủ thuộc về bộ sưu tập và áp dụng cho tất cả các mục trong đó. Thiết lập chúng bằng
`Kênh` bên cạnh nút trạng thái của bộ sưu tập. Lorebook của persona giữ giới hạn kênh trên từng
mục. Để trống kênh sẽ cho phép mọi kênh; các luồng tuân theo kênh cha của chúng.

Nút `Đang bật` / `Đã tắt` của bộ sưu tập điều khiển toàn bộ sách. Tắt nút này sẽ giữ mọi mục
ở ngoài cuộc trò chuyện mà không làm thay đổi trạng thái riêng của từng mục. Bật lại bộ sưu tập sẽ giữ nguyên
các mục đã bật hoặc đã tắt trước đó.

Các bộ nhớ máy chủ được gắn thẻ từ khóa cũ hơn đã chuyển đổi sang lore Persona có thể vẫn mang tên
`#channel` chưa được giải quyết. Cho đến khi người quản lý lưu lựa chọn kênh, TomoriBot sẽ coi mục đó là đang hoạt động trong
mọi kênh và đánh dấu mục đó trên trang `Lorebook`.

## Nhập một lorebook

Trong phạm vi Toàn máy chủ, chọn `+ Nhập lorebook` trong bộ chọn bộ sưu tập để tạo một cuốn sách từ
tệp đã tải lên. Tên của sách mặc định là tên bên trong tệp, sau đó là tên tệp; bạn có thể nhập một
tên trong hộp thoại nhập. Tên đã tồn tại sẽ bị từ chối, vì vậy việc nhập một cuốn sách mới không thể ghi đè sách cũ.
Dùng `+ Nhập các mục` trong bộ chọn mục của một cuốn sách đã chọn để nối thêm hoặc thay thế các mục trong đó.

Đối với phạm vi Persona, `+ Nhập lorebook` vẫn nằm trong bộ chọn mục vì persona sở hữu một cuốn sách.
Cả hai hình thức nhập đều chấp nhận JSON world info của SillyTavern, JSON Character Book và thẻ nhân vật ở dạng PNG,
CHARX hoặc JSON. Tải lên một thẻ tại đây sẽ chỉ nhập Character Book đính kèm của thẻ đó. Thẻ không có
sách sẽ giữ nguyên lorebook đã chọn.

Nối thêm là mặc định: các mục đã có sẵn sẽ bị bỏ qua và các mục mới được thêm vào. Đánh dấu
`Thay thế lorebook này` để chỉ thay thế cuốn sách đã chọn. Các sách Toàn máy chủ khác vẫn nguyên vẹn.
Mỗi persona có thể chứa tối đa 250 mục, và các sách Toàn máy chủ dùng chung một giới hạn riêng là 250 mục;
lần nhập nào vượt quá giới hạn đó sẽ bị từ chối toàn bộ, vì vậy không có gì bị nhập dở dang. Tệp bị giới hạn
ở mức 2 MB cho JSON; thẻ PNG và CHARX sử dụng giới hạn nhập persona của máy chủ lưu trữ hiển thị trong hộp thoại tải lên.

Biên lai báo cáo số lượng mục đã thêm và số lượng mục đã bỏ qua. Số lượng bỏ qua bao gồm các mục
trùng lặp và các mục bộ chuyển đổi không thể sử dụng, chẳng hạn như các mục không có nội dung. Cài đặt không có
đích đến, chẳng hạn như nhóm, đệ quy, bộ hẹn giờ dính, cooldown và bộ kích hoạt, sẽ được đếm và
bỏ qua. Các vị trí world info từ 2 đến 7 sẽ đến trước persona. Các khóa Regex giữ nguyên không hoạt động. Biên lai nhập tệp xác định các từ khóa và cài đặt không được hỗ trợ.

Character Book của thẻ được nhập dưới dạng lorebook của persona đó bằng `/persona import`; hãy xem
[Hỗ trợ SillyTavern](/features/integrations/sillytavern-support/).

## Xuất một lorebook

`+ Xuất lorebook` trong bộ chọn mục sẽ tải xuống sách Toàn máy chủ hoặc sách Persona đã chọn dưới dạng
JSON world info của SillyTavern. Nhập lại tệp qua cùng giao diện tải lên lorebook. Các cài đặt kích hoạt mục
và trạng thái bật riêng lẻ sẽ đi cùng với tệp; các giới hạn kênh, tên kênh chưa được giải quyết
và trạng thái bộ sưu tập thì không.

Đối với bản sao lưu máy chủ giữ lại các giới hạn và cài đặt bộ sưu tập này, hãy dùng `/export memories`
với `Tất cả persona`. `Persona chính` và `Persona đã chọn` chỉ xuất bộ nhớ và giữ nguyên lore
đích khi được nhập.

## Các trang liên quan

- [Bộ nhớ](/features/knowledge/memory/)
- [Bên trong prompt](/features/knowledge/inside-the-prompt/)
- [Xử lý dữ liệu](/features/knowledge/data-handling/)
