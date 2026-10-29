---
title: "Natural Nudges"
description: "Cho phép các persona của TomoriBot chủ động bắt đầu cuộc trò chuyện khi kênh Discord trở nên yên ắng và tham gia vào những chủ đề phù hợp với sở thích của mình, với nhịp độ theo sát mức độ hoạt động của máy chủ."
sidebar:
  order: 4
aiGenerated: true
---

Natural Nudges cho phép TomoriBot lên tiếng mà không cần được tag trước, theo hai cách:

- **Gợi ý nhàn rỗi**: khi một kênh trở nên yên ắng, một trong các persona của bạn sẽ chọn một việc để làm, chẳng hạn như hỏi thăm ai đó, nối lại cuộc trò chuyện trước đó, nêu ra chủ đề mới hoặc diễn một hoạt cảnh ngắn với persona khác, rồi đăng tin nhắn bằng chính giọng điệu của mình.
- **Gợi ý chủ động**: khi các thành viên đang thảo luận về điều gì đó mà một persona yêu thích, persona đó sẽ tự động tham gia vào cuộc trò chuyện.

Các gợi ý này được thiết kế để mang lại cảm giác tự nhiên như một người bạn ghé qua hỏi thăm:

- **Nhịp độ bám sát máy chủ**: các máy chủ nói chuyện với TomoriBot mỗi ngày sẽ nhận được khoảng một gợi ý nhàn rỗi mỗi ngày; các máy chủ hiếm khi trò chuyện với bot sẽ không nhận được gợi ý nào, kể cả gợi ý chủ động.
- **Bot chờ đợi khoảng lặng tự nhiên**: gợi ý nhàn rỗi chỉ bắt đầu trong kênh đã yên ắng từ một đến ba giờ, vào khung giờ mà máy chủ của bạn thường thức và hoạt động.
- **Bot giữ im lặng khi không ai phản hồi**: mỗi gợi ý nhàn rỗi không được trả lời sẽ khiến lần tiếp theo phải đợi lâu hơn, và sau ba lần liên tiếp không ai trả lời, bot sẽ dừng lại cho đến khi có người trò chuyện lại.
- **Khi lưỡng lự, bot không nói gì**: nếu ai đó gửi tin nhắn trước, kênh bỗng trở nên bận rộn hoặc không tìm thấy điều gì phù hợp, gợi ý sẽ được hủy bỏ.

Natural Nudges chỉ hoạt động trong máy chủ, không bao giờ chạy trong tin nhắn trực tiếp (DM).

## Gợi ý chủ động
<!-- anchor: active-nudges -->

Gợi ý chủ động xảy ra khi một persona tham gia vào một cuộc trò chuyện đang diễn ra vì chủ đề đó trùng khớp với sở thích của mình. Quy trình diễn ra như sau:

1. Khi các thành viên trò chuyện trong kênh hợp lệ, TomoriBot sẽ đếm số lượng tin nhắn. Tin nhắn trong thread được tính là một phần của kênh mẹ, và số đếm sẽ đặt lại từ đầu mỗi khi có persona lên tiếng.
2. Định kỳ (nhanh hơn ở máy chủ đông đúc và thường xuyên hơn ở mức tần suất cao), bot sẽ đọc năm tin nhắn gần nhất và đánh giá xem cuộc trò chuyện có thực sự tập trung vào sở thích của persona nào hay không. Một lời nhắc thoáng qua sẽ không được tính.
3. Persona có sở thích đó sẽ trả lời. Nếu nhiều persona cùng chung sở thích, persona nào ít lên tiếng gần đây hơn thường sẽ được chọn, trong khi persona vừa nói chuyện sẽ nhường lượt. Đôi khi một persona khác sẽ lên tiếng thay thế, thường là persona ít khi được máy chủ trò chuyện cùng.
4. Câu trả lời sẽ xuất hiện sau 15 đến 45 giây, với đúng tính cách bình thường của persona. Nếu có persona khác lên tiếng trước, các thành viên chuyển chủ đề hoặc kênh trở nên bận rộn, bot sẽ không nói gì.

Mỗi kênh (bao gồm cả thread) chỉ có tối đa một gợi ý chủ động mỗi giờ, kèm theo giới hạn hàng ngày cho toàn bộ máy chủ. Persona cần có sở thích được thiết lập trong trang Gợi ý của mình để tham gia, và các persona Im lặng sẽ không bao giờ tham gia.

## Gợi ý nhàn rỗi
<!-- anchor: idle-nudges -->

Gợi ý nhàn rỗi sẽ chờ cho đến khi kênh yên ắng được một khoảng thời gian, trong những giờ máy chủ của bạn thường hoạt động. Có 28 gợi ý tích hợp sẵn trong 4 danh mục. Bạn có thể điều chỉnh và thêm gợi ý riêng cho toàn máy chủ trong `/nudge-studio`, đồng thời mỗi persona cũng có thể sở hữu các gợi ý nhàn rỗi của riêng mình (xem [Gợi ý nhàn rỗi của persona](#persona-idle-nudges)).

| Danh mục | Hoạt động diễn ra | Điều kiện tiên quyết | Ghi chú |
|---|---|---|---|
| <a id="ping-user"></a>Tag thành viên | Hỏi thăm một thành viên hoặc chia sẻ điều họ có thể thích. | Trò chuyện gần đây với persona này trong máy chủ, có bộ nhớ và được phép tag. Quyền riêng tư đầy đủ, danh sách đen cá nhân hóa và chặn persona sẽ loại trừ thành viên. | Ưu tiên người liên hệ thường xuyên; các lần tag gần đây làm giảm cơ hội lặp lại. Chọn không tham gia trong `/personal config` > `Quyền riêng tư` > `Tag từ Persona`. |
| Nối lại chủ đề | Tiếp tục một cuộc trò chuyện còn dang dở. | Cuộc trò chuyện đang bỏ ngỏ. | N/A |
| Bắt đầu chủ đề | Nêu ra điều gì đó mới, thường về sở thích của persona. | Không có yêu cầu danh mục bổ sung. | N/A |
| <a id="play-scene"></a>Diễn hoạt cảnh | Bắt đầu một đoạn tương tác ngắn giữa 2 hoặc 3 persona. | Một persona khác được phép gợi ý trong kênh đó. | Persona hoạt ngôn tham gia thường xuyên hơn; persona im lặng không bao giờ tham gia. Nếu có thành viên gửi tin nhắn, hoạt cảnh dừng lại và một persona sẽ trả lời họ. Hoạt cảnh bất ngờ không tag đối tượng của chúng. |

### Chọn và tạo gợi ý nhàn rỗi

Mở `/nudge-studio` (yêu cầu `Quản lý máy chủ`) để duyệt qua từng danh mục. Chấm màu cho biết gợi ý đang bật, thiếu điều kiện tiên quyết hay đang tắt. Mỗi hàng kết thúc bằng nguồn của nó: `Tích hợp sẵn`, `Tùy chỉnh máy chủ` hoặc `Dành cho <persona>` đối với gợi ý thuộc về persona. Các danh mục có hơn 12 hàng sẽ tiếp tục ở các trang sau.

`Bật/tắt tính khả dụng...` chọn persona nào có thể dùng gợi ý:

- **Đánh dấu tất cả:** bất kỳ persona nào trong kênh đều có thể dùng, bao gồm cả persona bạn thêm sau này.
- **Đánh dấu một số:** chỉ những persona đó mới được dùng. Persona mới sẽ không tham gia cho đến khi bạn tích chọn.
- **Không đánh dấu ô nào:** gợi ý sẽ tắt.

Gợi ý thuộc về persona chỉ có một ô đánh dấu, `Khả dụng cho <persona>`, vì chỉ chủ sở hữu mới có thể dùng. Bỏ chọn sẽ tắt nó mà không xóa.

Giới hạn một gợi ý máy chủ cho một persona không làm nó chuyển sang trang của persona đó. Nó vẫn là gợi ý máy chủ, và chỉ các mục của riêng persona mới đi kèm thẻ persona.

Bên dưới danh sách, bạn có thể thêm tối đa 25 gợi ý riêng cho toàn máy chủ. Chọn một gợi ý máy chủ hoặc gợi ý thuộc về persona để mở chỉnh sửa, và mục tương tự cũng có thể chỉnh sửa trên trang `Gợi ý` của persona. Các gợi ý mới tạo tại đây luôn là gợi ý máy chủ. `Xóa gợi ý` liệt kê các gợi ý có thể chỉnh sửa trên trang hiện tại, và bỏ chọn một mục sẽ xóa nó. Mỗi mục gồm:

- **Tên**: nhãn hiển thị trong studio.
- **Tóm tắt chỉ dẫn**: điều persona dự định làm. Viết `{persona}` vào vị trí tên persona, `{partner}` cho persona đồng hành và `{target}` cho thành viên được nhắm tới.
- **Mục tiêu ẩn** (tùy chọn): mục tiêu cá nhân nhỏ mà persona tiếp tục theo đuổi sau câu mở đầu.
- **Điều kiện tiên quyết**: điều kiện phải thỏa mãn trước khi chạy, như bộ nhớ gần đây hoặc công cụ khả dụng. Công cụ chọn trong Điều kiện tiên quyết đã mặc định được bao gồm, vì vậy sẽ bị xóa khỏi danh sách công cụ khuyến nghị khi lưu.
- **Công cụ khuyến nghị**: công cụ khuyến khích persona sử dụng khi có sẵn. Gợi ý vẫn chạy được nếu không có chúng.

### Gợi ý nhàn rỗi của persona
<!-- anchor: persona-idle-nudges -->

Một persona có thể mang theo các gợi ý nhàn rỗi thuộc về tính cách của mình, như Rose kiểm tra trang phục cosplay hoặc Aphel giới thiệu một album. Chúng bổ sung vào các gợi ý tích hợp sẵn và gợi ý máy chủ chứ không thay thế chúng.

Mở `/config` > `Persona` > `Gợi ý`. `Gợi ý nhàn rỗi` nằm bên dưới `Sở thích`:

- `Chọn hoặc thêm một gợi ý nhàn rỗi...` thêm mới bằng `+ Thêm <danh mục>` hoặc chỉnh sửa mục hiện có. Cả 4 danh mục đều khả dụng, với các trường tương tự như gợi ý máy chủ. Một persona giữ tối đa 20 mục, tách biệt với 25 mục của máy chủ.
- `Bật/tắt tính khả dụng...` bật hoặc tắt từng mục riêng lẻ cho persona này.
- `Xóa gợi ý nhàn rỗi` xóa các mục bạn bỏ chọn.
- `Khôi phục gợi ý từ preset` xuất hiện cho persona đang tuân theo một preset chính thức và có bản sao danh sách riêng.

Cách thức hoạt động:

- Chỉ persona sở hữu mới khởi xướng chúng. Trong Diễn hoạt cảnh, chủ sở hữu dẫn dắt và bất kỳ persona nào khác được phép gợi ý đều có thể tham gia cùng.
- Chúng tuân theo cùng các điều kiện tiên quyết, giờ yên tĩnh, mức tần suất và giới hạn hàng ngày như mọi gợi ý nhàn rỗi khác. Nhiều mục hơn giúp persona có nhiều lựa chọn hơn nhưng không làm cho nó nói thường xuyên hơn.
- Sở thích thúc đẩy Gợi ý chủ động. Gợi ý nhàn rỗi của persona chỉ thúc đẩy Gợi ý nhàn rỗi.

Preset chính thức đi kèm với các gợi ý nhàn rỗi. Persona vẫn đang theo sát preset sẽ đọc danh sách đó khi preset được cập nhật. Lần đầu tiên bạn thêm, sửa hoặc xóa một mục, persona sẽ nhận bản sao riêng của toàn bộ danh sách, và các cập nhật preset sau này sẽ không còn làm thay đổi nó nữa. Việc bật hoặc tắt một mục không tạo bản sao. `Khôi phục gợi ý từ preset` thay thế danh sách của persona bằng danh sách hiện tại của preset và giữ lại sở thích, độ hoạt ngôn cũng như các lựa chọn bật/tắt cho các mục vẫn còn tồn tại. `Đồng bộ lại với preset` trong `Danh tính & Tính cách` cũng đặt lại danh sách và các lựa chọn bật/tắt.

Thẻ persona (`/persona export`) bao gồm các gợi ý nhàn rỗi của persona, từ preset hoặc từ bản sao riêng, và nhập thẻ sẽ khôi phục chúng. Các lựa chọn bật/tắt chỉ mang tính cục bộ cho máy chủ và không được xuất ra, vì vậy các mục được nhập sẽ bắt đầu ở trạng thái bật. Gợi ý máy chủ không bao giờ nằm trong thẻ. Thẻ cũ hơn mà vẫn khớp với preset chính thức sẽ theo các gợi ý nhàn rỗi hiện tại của preset đó. Các thẻ cũ khác khi nhập sẽ không có gợi ý nhàn rỗi của persona.

### Tag thành viên
<!-- anchor: ping-user -->

Loại gợi ý nhàn rỗi này sẽ tag đích danh một thành viên, vì vậy nó chỉ chọn những người mà persona thực sự quen biết:

- **Họ đã nói chuyện với persona này gần đây**: chỉ những thành viên đã chủ động bắt đầu cuộc trò chuyện với persona đó trong máy chủ này trong vòng 14 ngày qua mới có thể được chọn. Việc chỉ được tag hoặc được nhắc tới trong câu chuyện không được tính, và việc thân thiết ở máy chủ khác cũng không được tính.
- **Persona biết họ**: thành viên đó có bộ nhớ với persona này trong vòng 30 ngày qua, hoặc có bộ nhớ ngắn hạn (STM) gần đây với persona.
- **Họ chưa chọn tắt tính năng**: bất kỳ ai cũng có thể tự tắt tính năng Persona tag bạn trong `/personal config` > Quyền riêng tư. Thành viên chọn mức quyền riêng tư Hoàn toàn, thành viên trong danh sách đen cá nhân hóa của máy chủ và thành viên bị persona chặn sẽ không bao giờ bị chọn.

Trong số các thành viên đủ điều kiện, những ai thân thiết hơn sẽ được chọn thường xuyên hơn: mỗi tin nhắn gửi tới persona đó tại máy chủ này trong 14 ngày qua, và mỗi kênh mà persona vừa trò chuyện với họ, đều làm tăng cơ hội được chọn. Người vừa được persona tag trong vòng ba ngày qua sẽ ít có nguy cơ bị chọn lại hơn. Lời tag chỉ gửi riêng cho thành viên đó; gợi ý tag thành viên không bao giờ tag vai trò, `@everyone` hay bất kỳ ai khác. Bất kỳ phản hồi nào trong kênh đều được tính là câu trả lời.

### Diễn hoạt cảnh
<!-- anchor: play-scene -->

Hoạt cảnh là một màn đối thoại ngắn giữa các persona, dài từ hai đến bốn tin nhắn. Persona mở đầu sẽ khơi mào câu chuyện và chọn một bạn diễn (đôi khi hai bạn diễn) từ những persona khác được phép hoạt động trong kênh đó. Các persona hoạt ngôn sẽ tham gia thường xuyên hơn, và persona Im lặng không bao giờ tham gia.

- **Thành viên luôn là ưu tiên hàng đầu**: khi bất kỳ ai gửi tin nhắn vào kênh trong lúc hoạt cảnh đang diễn ra, các tin nhắn còn lại của hoạt cảnh sẽ bị hủy và persona chuẩn bị nói tiếp sẽ trả lời thành viên đó, giống như khi có người bước vào cuộc trò chuyện. Nếu họ gọi tên hoặc tag đích danh một persona, persona đó sẽ trả lời.
- **Kế hoạch giữ kín riêng tư**: các persona có thể lên kế hoạch tạo bất ngờ vô hại cho một người quen, nhưng hoạt cảnh sẽ không tag thành viên đó.

### Mục tiêu ẩn

Cùng với câu mở đầu, mỗi gợi ý nhàn rỗi cung cấp cho persona một mục tiêu nhỏ riêng tư, chẳng hạn như "tìm xem còn ai thích bộ anime này nữa không". Mục tiêu này gắn liền phía trên câu mở đầu và chỉ persona đó mới nhìn thấy, giúp persona tiếp tục theo đuổi mục tiêu trong các câu trả lời tiếp theo. Trong một hoạt cảnh, mỗi persona nhận được mục tiêu riêng mà persona khác không hề biết. Khi câu mở đầu trôi ra khỏi phạm vi ngữ cảnh mà persona ghi nhớ, mục tiêu sẽ biến mất. Mục tiêu ẩn không bao giờ đòi hỏi thông tin cá nhân, tiền bạc hay bất cứ điều gì ngoài phạm vi cuộc trò chuyện. Các thành viên có quyền xem ảnh chụp nhanh prompt có thể đọc được các mục tiêu này.

## Cài đặt

Natural Nudges được bật theo mặc định và không cần thiết lập gì thêm. Khi mọi người trong máy chủ bắt đầu trò chuyện thường xuyên với TomoriBot, các gợi ý nhàn rỗi và gợi ý chủ động sẽ tự động khởi chạy tại những kênh họ nói chuyện với bot.

Để tùy chỉnh cách hoạt động, mở `/config` > Plugins > Natural Nudges (cần quyền Quản lý máy chủ):

- **Gợi ý nhàn rỗi** và **Gợi ý chủ động**: bật hoặc tắt từng tính năng riêng biệt.
- **Kênh**: hoạt động tự động với các kênh mà mọi người đã trò chuyện với TomoriBot trong 14 ngày qua (ngoại trừ kênh nhập vai). Bạn có thể tự tay chọn kênh cụ thể hoặc xóa danh sách để quay lại chế độ tự động. Kênh nơi các bot khác nhắn tin liên tục sẽ không bao giờ yên ắng, vì vậy bot sẽ tự bỏ qua.
- **Chọn model**: chọn hai model AI mà Natural Nudges sử dụng. Các model Google miễn phí chịu sự chi phối của điều khoản miễn phí của Google, vốn cho phép Google sử dụng các cuộc trò chuyện gửi tới chúng.
  - **Công cụ lập kế hoạch gợi ý nhàn rỗi**: lên kế hoạch cho các gợi ý nhàn rỗi. Mặc định là model trò chuyện của máy chủ. Không phải model nào cũng đảm đương được nhiệm vụ này; nếu model hiện tại không phù hợp, bảng điều khiển sẽ thông báo và cho phép bạn chọn model khác.
  - **Bộ kiểm tra gợi ý chủ động**: thỉnh thoảng xem xét cuộc trò chuyện để xác định xem có trùng khớp với sở thích nào không. Công cụ này chạy thường xuyên hơn nhiều so với bộ lập kế hoạch, vì vậy một model nhỏ, chi phí thấp là phù hợp nhất. Mặc định TomoriBot sẽ tự động chọn cho bạn: một model Quyết định (model nhỏ chuyên giải quyết các câu hỏi chọn một phương án nhanh chóng) nếu máy chủ có khóa OpenRouter, Gemma 4 31B nếu có khóa Google, hoặc dùng chung Công cụ lập kế hoạch gợi ý nhàn rỗi. Bạn có thể tự chọn bất kỳ model nào trong số này, bao gồm cả model Quyết định tùy chỉnh.

Bảng điều khiển hiển thị mức độ hoạt động của máy chủ, số lượng gợi ý nhàn rỗi dự kiến mỗi tuần và tần suất kiểm tra gợi ý chủ động.

### Tần suất hoạt động

- **Tần suất**: đặt nhịp độ riêng cho gợi ý nhàn rỗi và gợi ý chủ động: Hiếm khi, Nhẹ nhàng (mặc định), Bình thường hoặc Sôi nổi. Ngay cả ở mức Sôi nổi, bot vẫn sẽ giữ im lặng ở máy chủ hiếm khi trò chuyện với TomoriBot.
- **Giới hạn hàng ngày**: điều chỉnh theo mức tần suất: Hiếm khi cho phép 1 gợi ý nhàn rỗi và 1 gợi ý chủ động mỗi ngày; Nhẹ nhàng là 3 mỗi loại; Bình thường là 5 gợi ý nhàn rỗi và 6 gợi ý chủ động; Sôi nổi là 8 gợi ý nhàn rỗi và 10 gợi ý chủ động.
- **Giới hạn kiểm tra**: ngăn gợi ý chủ động làm cạn kiệt hạn mức khóa AI: TomoriBot kiểm tra cuộc trò chuyện tối đa 10 lần mỗi ngày ở mức Hiếm khi, 20 lần ở mức Nhẹ nhàng, 40 lần ở mức Bình thường và 60 lần ở mức Sôi nổi. Sau một lần kiểm tra không tìm thấy chủ đề phù hợp, kênh đó sẽ phải đợi lâu hơn trước lần kiểm tra tiếp theo, từ 10 phút lên tới 3 giờ. Nếu nhà cung cấp AI báo rằng khóa đã chạm trần hạn ngạch, gợi ý chủ động sẽ tạm dừng trong 3 giờ.

### Khi tính năng tiếp tục tắt

- **Thống kê sử dụng bị tắt**: TomoriBot đánh giá mức độ hoạt động của máy chủ dựa trên dữ liệu thống kê sử dụng. Nếu người lưu trữ bot tắt tính năng này, các gợi ý sẽ không bao giờ bắt đầu.
- **Thành viên tự dùng khóa riêng (BYOK)**: nếu máy chủ yêu cầu từng thành viên tự dùng khóa AI riêng, không có khóa của ai chi trả cho tin nhắn mà không ai yêu cầu, do đó Natural Nudges sẽ tiếp tục tắt.

## Cài đặt theo Persona

Mỗi persona có một trang **Gợi ý** riêng trong `/config` > Persona:

- **Độ hoạt ngôn**: mức độ thường xuyên persona này là người lên tiếng. Các persona Im lặng không bao giờ khởi xướng gợi ý nhàn rỗi cũng như không tham gia gợi ý chủ động; persona ngại ngùng ít nói hơn, persona hoạt ngôn sẽ nói nhiều hơn.
- **Sở thích**: tối đa 8 chủ đề persona thích nêu ra và tham gia thảo luận, mỗi chủ đề kèm theo mô tả ngắn gọn và ví dụ (chẳng hạn như **anime mecha**: thể loại hư cấu về robot khổng lồ có người lái, như Gundam).
- **Gợi ý nhàn rỗi**: tối đa 20 gợi ý nhàn rỗi chỉ persona này sử dụng, được mô tả tại [Gợi ý nhàn rỗi của persona](#persona-idle-nudges).

Các preset chính thức bao gồm các cài đặt này. `/persona generate` gợi ý sở thích cho các persona mới; `Tạo sở thích` thêm sở thích mới thông qua model văn bản hiện tại của bạn. Bản xuất persona bao gồm cả ba cài đặt.

## Khi nào gợi ý kích hoạt

### Heat
<!-- anchor: heat -->

Heat xác định nhịp độ của cả gợi ý nhàn rỗi và các lượt kiểm tra chủ động cho toàn bộ máy chủ của bạn, giữa các thành viên và persona. Cài đặt Natural Nudges hiển thị Heat đo được, mức điều chỉnh đã lưu của bạn và Heat dùng cho các gợi ý trên thang điểm 50.

#### Tóm tắt: Càng nhiều tin nhắn gửi đến TomoriBot = Heat càng cao = Càng nhiều gợi ý tự động

#### Mức độ hoạt động và sự suy giảm

Heat đo được là giá trị trung bình hằng ngày có trọng số của các lượt tương tác trong 30 ngày qua. Các lượt hội thoại thông thường và lượt `/punish` của con người đóng góp 1 lần; lượt `/reward` của con người đóng góp gấp 3 lần. Các gợi ý được tạo ra và tương tác vui nhộn giữa các persona không đóng góp gì.

Trọng số của một tương tác giảm một nửa sau mỗi ba ngày:

$$
w(d) = 2^{-d/3}
$$

Ở đây, `d` là số ngày trước tính theo ngày UTC: hoạt động hôm nay có trọng số 1, ba ngày trước có trọng số 0.5 và sáu ngày trước có trọng số 0.25. Hoạt động sẽ rời khỏi phép tính sau 30 ngày. Với `E_d` là tổng tương tác có trọng số của mỗi ngày, Heat đo được `A` là:

$$
A = \frac{\sum_{d=0}^{29} E_d \cdot w(d)}{\sum_{d=0}^{29} w(d)}
$$

Hoạt động đều đặn với 10 tương tác có trọng số mỗi ngày sẽ tạo ra khoảng 10 Heat đo được. Mức điều chỉnh đã lưu `Δ` của bạn được cộng sau giá trị trung bình này, sau đó kết quả được giới hạn trong khoảng 0-50:

$$
H = \min(50, \max(0, A + \Delta))
$$

Hoạt động đo được không có giới hạn trần, do đó Heat của một máy chủ bận rộn sẽ suy giảm từ giá trị đầy đủ của nó. Cả hai chế độ đều cần Heat đo được và Heat hiệu dụng từ 1 trở lên. Một mức điều chỉnh sẽ thay đổi nhịp độ khi hoạt động đo được đạt mức tối thiểu đó. Khoảng tạm dừng 14 ngày không có trò chuyện trực tiếp vẫn áp dụng ở bất kỳ mức Heat nào.

#### Khoảng thời gian nhàn rỗi và kiểm tra chủ động

Đối với Heat hiệu dụng `H` từ 1 trở lên, mức tần suất của bạn cung cấp các giá trị sau:

| Tần suất | Số chia nhàn rỗi D | Giới hạn nhàn rỗi hằng ngày C | Hệ số nhân chủ động M |
|---|---|---|---|
| `Rare` | 175 | 1 | 2 |
| `Gentle` | 25 | 2 | 1 |
| `Normal` | 15 | 3 | 0.6 |
| `Lively` | 8 | 6 | 0.35 |

Số lượt gợi ý nhàn rỗi ước tính mỗi ngày `R` tăng theo Heat cho đến khi đạt giới hạn hằng ngày:

$$
R = \min\left(\frac{H}{D}, C\right)
$$

Khoảng thời gian cơ sở là `16 / R` giờ. Mỗi khoảng thời gian nhận một hệ số nhân ngẫu nhiên từ 0.5 đến 1.5, và mỗi lời mời liên tiếp không được trả lời sẽ tăng gấp ba lần khoảng thời gian tiếp theo. Ba lời mời không được trả lời sẽ tạm dừng gợi ý nhàn rỗi cho đến khi có ai đó trò chuyện lại với TomoriBot. Kênh yên ắng, giờ thức giấc, điều kiện tiên quyết và quyết định của người lập kế hoạch vẫn quyết định xem một gợi ý đến hạn có thực sự bắt đầu hay không.

Đối với các lượt kiểm tra chủ động, Heat thay đổi số lượng tin nhắn của con người cần thiết trong một kênh. Đầu tiên tính toán tỷ lệ khoảng thời gian `s`, với đóng góp của Heat được giữ trong khoảng 0.5 đến 4:

$$
s = M \cdot \min\left(4, \max\left(0.5, \frac{15}{H}\right)\right)
$$

Mục tiêu tin nhắn của một lượt kiểm tra được rút ngẫu nhiên trong khoảng từ `max(1, round(15 × s))` đến `max(1, round(40 × s))`, bao gồm cả hai đầu. Việc làm tròn sử dụng tin nhắn nguyên gần nhất, với phần nửa được làm tròn lên. Các luồng dùng chung bộ đếm của kênh cha. Thời gian hồi chiêu và giới hạn hằng ngày vẫn áp dụng, và trình kiểm tra chỉ mời persona lên tiếng khi cuộc trò chuyện phù hợp với một sở thích. Các công thức này kiểm soát thời gian; một lượt kiểm tra có thể không tạo ra câu trả lời nào.

Ví dụ: với cả hai tần suất được đặt thành `Gentle`:

| Heat hiệu dụng | Gợi ý nhàn rỗi ước tính mỗi tuần | Tin nhắn thành viên giữa các lượt kiểm tra chủ động |
|---|---|---|
| Dưới 1 | 0 | Không kiểm tra |
| 5 | Khoảng 1.4 | 45-120 |
| 15 | Khoảng 4.2 | 15-40 |
| 30 | Khoảng 8.4 | 8-20 |
| 45 | Khoảng 12.6 | 8-20 |
| 50 | Lên tới 14 | 8-20 |

Các lượt kiểm tra chủ động đạt khoảng thời gian nhanh nhất ở mức Heat 30. Gợi ý nhàn rỗi đạt giới hạn hằng ngày ở mức Heat 50 cho `Gentle`, 45 cho `Normal` và 48 cho `Lively`. `Rare` đạt ước tính hai gợi ý nhàn rỗi mỗi tuần ở mức Heat 50, với tối đa một lần mỗi ngày. Ước tính hằng tuần là hướng dẫn về nhịp độ; thời gian ngẫu nhiên và việc kiểm tra tính đủ điều kiện sẽ ảnh hưởng đến việc phân phối thực tế. Heat trên 50 không tăng thêm tốc độ lập lịch.

## Dữ liệu được lưu trữ

Cài đặt, gợi ý tùy chỉnh, sở thích và gợi ý nhàn rỗi của persona được lưu cùng với cấu hình máy chủ của bạn. Lịch sử gợi ý (bao gồm việc có ai trả lời hay không và ai đã được tag) được giữ trong 30 ngày. Mục tiêu được giữ tối đa 90 ngày.

- **Cấu hình máy chủ:** `/reset` khôi phục cài đặt gợi ý và xóa các gợi ý tùy chỉnh. Xuất và nhập cấu hình mang theo cài đặt và gợi ý tùy chỉnh, ngoại trừ danh sách kênh dành riêng cho máy chủ. Gợi ý nhàn rỗi của persona vẫn ở lại với persona của chúng sau khi thiết lập lại và thay vào đó sẽ chuyển tiếp trong thẻ persona. `/persona default` và xóa một persona sẽ xóa các gợi ý nhàn rỗi của persona đó.
- **Cấu hình cá nhân:** lựa chọn `Tag từ Persona` của bạn vẫn tồn tại sau `/reset personal config`, được bao gồm trong `/export personal config` và bị xóa bởi `/personal nuke`.
