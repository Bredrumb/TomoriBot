### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | Tiếng Việt

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> README này là bản tổng quan nhanh. Để xem tài liệu đầy đủ và mới nhất (hướng dẫn cài đặt, giới thiệu tính năng chi tiết, thông tin nhà cung cấp và nhiều nội dung khác), hãy truy cập **[docs.tomoribot.app](https://docs.tomoribot.app/vi/)**.

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Một trợ lý AI cá nhân và hệ thống nhập vai (role-playing) self-hosting có thể tùy chỉnh dành cho Discord với bộ nhớ, nhiều persona, gọi công cụ, đa phương thức cùng khả năng hỗ trợ API và model cục bộ.

<p align="center">
  <strong><a href="https://tomoribot.app/">Trang web chính thức</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Mời TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Máy chủ Discord</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Bản phát hành mới nhất</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Báo lỗi</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Yêu cầu tính năng</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](../assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
## Về dự án

TomoriBot là một trợ lý AI cá nhân và hệ thống nhập vai mã nguồn mở miễn phí, self-hosting dành cho Discord, lấy cảm hứng từ SillyTavern và Clyde đã ngừng hoạt động của Discord. Bot có thể được dùng làm trợ lý thực tế, người bạn đồng hành có thể tùy chỉnh và bạn diễn nhập vai cho riêng bạn trong tin nhắn trực tiếp (DM), hoặc cho mọi người trong máy chủ Discord của bạn.

TomoriBot hỗ trợ bộ nhớ dài hạn, hành vi nhiều persona, các công cụ web và MCP, tạo nội dung đa phương tiện ngay trong cuộc trò chuyện, các lệnh slash Discord và nhiều nhà cung cấp bao gồm các proxy tùy chỉnh cũng như self-hosting model của riêng bạn cho mọi tác vụ từ tạo văn bản đến tạo video.

### Bắt đầu

Bạn có thể [mời TomoriBot công khai](https://discord.com/oauth2/authorize?client_id=841644102059556915) vào máy chủ Discord của bạn, hoặc [self-host phiên bản của riêng bạn](#self-hosting) nếu muốn toàn quyền kiểm soát quyền riêng tư và các API key của mình. TomoriBot áp dụng các biện pháp bảo mật tốt nhất và mã hóa để giữ dữ liệu an toàn, nhưng self-hosting đảm bảo rằng mọi dữ liệu hoàn toàn nằm trên thiết bị của bạn.

Sau khi thêm bot vào máy chủ của bạn bằng một trong hai cách trên, hãy chạy lệnh `/setup` để xem hướng dẫn. Sau đó, bạn chỉ cần gọi tên bot (hoặc @ đề cập bot) để nhận phản hồi.

## Giới thiệu tính năng


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/capabilities/tools-and-extensions/">Trò chuyện với AI dạng tác tử (Agentic AI)</a></h3>
<p align="center">TomoriBot sở hữu RẤT NHIỀU công cụ cho phép bot vượt xa việc trò chuyện thông thường, chẳng hạn như tìm kiếm trên web, thiết lập các tác vụ/lời nhắc định kỳ, tận dụng emote/sticker của máy chủ, cùng các tùy chọn bộ nhớ như RAG và STM giúp bot ghi nhớ ngữ cảnh xuyên suốt các kênh và máy chủ. </p>

<br />


![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/chatting-personality/multiple-personas/">Hỗ trợ nhiều persona</a></h3>
<p align="center">Tính cách, hành vi và ảnh đại diện trong máy chủ của TomoriBot có thể dễ dàng thay đổi, tạo mới cũng như xuất cho người khác dưới dạng Persona (tương tự như các thẻ nhân vật AI có thể chia sẻ). Nhập và thậm chí biến đổi các thẻ SillyTavern yêu thích của bạn thông qua <code>/persona generate</code>. Bạn có thể sở hữu số lượng không giới hạn các persona khác nhau trong một máy chủ duy nhất, mỗi persona có bộ nhớ và mục tiêu riêng. Bạn cũng có thể điều phối chúng phối hợp cùng nhau để thực hiện công việc trong máy chủ (hoặc đơn giản là trêu chọc lẫn nhau).</p>

<br />

![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/capabilities/media-generation/">Đầu vào/Đầu ra đa phương thức hoàn chỉnh</a></h3>
<p align="center">TomoriBot có thể xử lý hình ảnh, âm thanh và video được gửi trực tiếp trong Discord cũng như tạo lại chúng bằng các endpoint model cục bộ của riêng bạn hoặc thông qua các API key, tất cả đều được mã hóa bên trong cơ sở dữ liệu bền vững. Các quy trình (workflow) ComfyUI có sẵn để sử dụng trong <code>assets/comfyui-workflows/</code> và các máy chủ suy luận âm thanh cục bộ trong <code>servers/</code>!</p>

<br />


![Thiết lập hoàn toàn cục bộ với ComfyUI](../assets/img/docs/intro/05-fully-local-setup.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/self-hosting/local-endpoints/">Thiết lập hoàn toàn cục bộ</a></h3>
<p align="center">Bạn có thể chạy TomoriBot và cơ sở dữ liệu của nó ngay trên PC của mình, với một LLM cục bộ cho các cuộc trò chuyện, ComfyUI để tạo hình ảnh và các model giọng nói cục bộ để tạo và chép lại giọng nói. Toàn bộ quá trình xử lý AI đó có thể diễn ra trên phần cứng của bạn mà không cần nhà cung cấp AI đám mây. Discord vẫn cần kết nối internet và truyền tải các tin nhắn cũng như tệp đa phương tiện bạn trao đổi với bot.</p>

<br />

![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/command-reference/">Các lệnh slash gốc để cấu hình</a></h3>
<p align="center">Mọi thứ đều có thể được quản lý thông qua các lệnh slash gốc của Discord và giao diện người dùng (UI) tương tác. Quản lý hoàn toàn các persona, prompt, tinh chỉnh tham số model, thiết lập máy chủ công cụ MCP, điều chỉnh quyền hạn, cấu hình bộ nhớ, đặt giới hạn tần suất cho thành viên máy chủ và nhiều hơn nữa! Bạn cũng có thể hỏi trực tiếp TomoriBot về những việc bot có thể làm và các lệnh slash của bot. Hiện tại, một Web Dashboard đang được phát triển để giúp việc quản lý thuận tiện hơn nữa.</p>

<br />

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/">Nhiều tính năng hơn nữa, và còn tiếp tục tăng!</a></h3>
<p align="center">Hàng loạt tính năng thú vị và dễ cài đặt, từ những tính năng thực tế như tự động chào mừng thành viên mới của máy chủ và di chuyển xuyên kênh, cho đến những tính năng hài hước như giả mạo người dùng để trêu đùa. Các tính năng mới liên tục được phát triển, vì vậy vui lòng báo cáo qua GitHub issues hoặc Discord chính thức nếu gặp bất kỳ lỗi nào (hoặc để chia sẻ những đề xuất thú vị).</p>

## Tài nguyên hữu ích

- [Danh sách đầy đủ các nhà cung cấp được hỗ trợ](https://docs.tomoribot.app/vi/features/setup-administration/providers-and-models/#các-nhà-cung-cấp-được-hỗ-trợ)
- [Cách chạy các model cục bộ](https://docs.tomoribot.app/vi/self-hosting/local-endpoints/)
- [Bảo mật & mô hình mối đe dọa](https://docs.tomoribot.app/en/wiki/threat-models/)
- [Lộ trình phát triển chính thức của TomoriBot](https://github.com/users/Bredrumb/projects/1/views/1)
- [Macro công cụ để tùy chỉnh prompt](https://docs.tomoribot.app/vi/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## Self-Hosting

Xem [tài liệu self-hosting](https://docs.tomoribot.app/vi/self-hosting/) để biết hướng dẫn cài đặt, Docker Compose và các máy chủ cục bộ tùy chọn.

<!-- AFTER SETUP -->
### Sau khi mời / cài đặt

#### Các lệnh cơ bản

- `/setup` - Thiết lập bot ban đầu cho máy chủ của bạn
- `/config` - Nhiều cách để tùy chỉnh TomoriBot
- `/personal memories` - Quản lý bộ nhớ cá nhân của bạn
- `/memories` - Quản lý bộ nhớ máy chủ, tài liệu và bộ nhớ ngắn hạn
- `/moderation` - Quản lý quyền truy cập của thành viên, danh sách đen người dùng, các hạn chế về kênh, persona và vai trò

Xem đầy đủ **[Danh mục lệnh](https://docs.tomoribot.app/vi/features/command-reference/)** để biết mọi lệnh slash.

#### Tương tác trò chuyện

Chỉ cần đề cập bot trong một máy chủ hoặc sử dụng các từ kích hoạt đã cấu hình để bắt đầu cuộc trò chuyện:
```
@TomoriBot yo wassup
```

Hoặc nhắn tin trực tiếp (DM) cho TomoriBot và nói lời chào!

## Lời cảm ơn

Gửi lời cảm ơn sâu sắc tới mọi người, đặc biệt là những người tuyệt vời sau đây vì những đóng góp mã nguồn và lời khuyên giúp tạo nên TomoriBot của ngày hôm nay!

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Bredrumb" title="Bredrumb: Creator, maintainer, and code contributions">
        <img src="https://avatars.githubusercontent.com/u/65227425?s=128" width="64" height="64" alt="Bredrumb: Creator, maintainer, and code contributions"><br>
        Bredrumb
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/palinalif" title="palinalif: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/31247276?s=128" width="64" height="64" alt="palinalif: Code contributions"><br>
        palinalif
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/baetican" title="baetican: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/280696164?s=128" width="64" height="64" alt="baetican: Code contributions"><br>
        baetican
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/struffl" title="struffl: Software design and technical guidance">
        <img src="https://avatars.githubusercontent.com/u/1026348?s=128" width="64" height="64" alt="struffl: Software design and technical guidance"><br>
        struffl
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Rhapsody-Sky" title="Rhapsody-Sky: Software design and technical guidance">
        <img src="https://avatars.githubusercontent.com/u/8095300?s=128" width="64" height="64" alt="Rhapsody-Sky: Software design and technical guidance"><br>
        Rhapsody-Sky
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/aph31" title="aph31: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/251111747?s=128" width="64" height="64" alt="aph31: Code contributions"><br>
        aph31
      </a>
    </td>
  </tr>
</table>

<!-- CONTACT -->
## Liên hệ & liên kết

**Trang web chính thức**: [https://tomoribot.app](https://tomoribot.app/)

**Email**: bredrumb@gmail.com

**Discord**: [Máy chủ hỗ trợ chính thức](https://discord.gg/bjCfHm9QsB)


## Giấy phép
Dự án này được cấp phép theo [AGPLv3](LICENSE).

<!-- SUPPORT -->
## Ủng hộ dự án

Nếu bạn thấy TomoriBot hữu ích và muốn hỗ trợ sự phát triển liên tục của dự án, hãy cân nhắc để lại một ⭐ trên GitHub hoặc ủng hộ qua Ko-fi!

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ủng hộ trên Ko-fi">
  </a>
</p>

<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript.js]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Bun.sh]: https://img.shields.io/badge/Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white
[Bun-url]: https://bun.sh/
[Discord.js]: https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[PostgreSQL.org]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Google.ai]: https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white
[Google-url]: https://ai.google.dev/
