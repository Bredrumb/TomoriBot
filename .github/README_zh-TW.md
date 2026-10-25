### [English](../README.md) | [日本語](README_ja.md) | 繁體中文 | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> 這份 README 只是快速概覽。完整且最新的文件（設定指南、功能導覽、供應商資訊等）請見 **[docs.tomoribot.app](https://docs.tomoribot.app/zh-TW/)**。

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

可在自己的伺服器上自架、自由客製的 Discord 個人 AI 助理與角色扮演系統，具備記憶、多個人格、工具呼叫、多模態，並支援 API 與本機模型。

<p align="center">
  <strong><a href="https://tomoribot.app/">官方網站</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">邀請 TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord 伺服器</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">最新版本</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">回報錯誤</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">建議功能</a>
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
## 關於專案

TomoriBot 是一套免費且開源的 Discord 自架個人 AI 助理與角色扮演系統，靈感來自 SillyTavern 與 Discord 已停止服務的 Clyde。你可以把它當成實用的助理、可客製的夥伴或角色扮演對象，在私訊裡自己用，也能讓整個 Discord 伺服器一起用。

TomoriBot 支援長期記憶、多個人格運作、網頁與 MCP 工具、聊天室內的媒體生成、Discord 斜線指令，以及多種供應商，包含自訂代理與自架自己的模型，從文字生成到影片生成都涵蓋在內。

### 開始使用

你可以[邀請公開版 TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915) 加入你的 Discord 伺服器，如果希望完全掌控自己的隱私與 API 金鑰，也可以[自架自己的執行個體](#自架)。TomoriBot 採用最佳安全實務與加密來保護資料，不過自架能確保所有資料都完全留在你的裝置上。

用上述任一方式把她加入伺服器後，執行 `/setup` 指令取得說明。之後只要喊她的名字（或 @ 提及她）就能得到回應。

## 功能展示


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/capabilities/tools-and-extensions/">AI 代理驅動的對話</a></h3>
<p align="center">TomoriBot 內建非常多工具，讓她不只是聊天，還能搜尋網頁、設定重複任務與提醒、使用伺服器的表情符號與貼圖，並透過 RAG、STM 等記憶功能記住跨頻道、跨伺服器的脈絡。</p>

<br />


![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/chatting-personality/multiple-personas/">多個人格支援</a></h3>
<p align="center">TomoriBot 在伺服器裡的人格、行為與頭像都能輕鬆修改、建立，也能匯出成「人格」分享給其他人（類似可分享的 AI 角色卡）。你可以透過 <code>/persona generate</code> 匯入甚至轉換自己喜歡的 SillyTavern 角色卡。單一伺服器能擁有無限多個不同人格，每個都有自己的記憶與目標。你也可以安排它們互相合作，在伺服器裡一起做事（或只是互相打鬧）。</p>

<br />

![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/capabilities/media-generation/">完整的多模態輸入輸出</a></h3>
<p align="center">TomoriBot 能處理直接傳進 Discord 的圖片、音訊與影片，並用你自己的本機模型端點或 API 金鑰生成這些內容，全部都會加密存放在持久化資料庫中。現成可用的 ComfyUI 工作流程放在 <code>assets/comfyui-workflows/</code>，本機音訊推論伺服器則在 <code>servers/</code>！</p>

<br />


![搭配 ComfyUI 的完全本機設定](../assets/img/docs/intro/05-fully-local-setup.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/">完全本機設定</a></h3>
<p align="center">你可以在自己的電腦上執行 TomoriBot 及其資料庫，搭配用於對話的本機 LLM、用於圖片生成的 ComfyUI，以及用於語音生成與文字轉錄的本機語音模型。所有這些 AI 運算都能在你自己的硬體上進行，無需使用雲端 AI 供應商。Discord 仍需要網際網路連線，並負責傳輸你與 bot 之間交流的訊息與媒體。</p>

<br />

![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/command-reference/">原生設定斜線指令</a></h3>
<p align="center">所有設定都能透過 Discord 原生的斜線指令與互動介面完成。完整管理人格與提示詞、調整模型參數、設定 MCP 工具伺服器、調整權限、設定記憶、設定伺服器成員的速率限制，還有更多！你也可以直接問 TomoriBot 她會做什麼、有哪些斜線指令。目前正在開發網頁儀表板，讓管理更方便。</p>

<br />

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/">還有更多功能，持續增加中！</a></h3>
<p align="center">還有一堆容易設定的有趣功能，從實用的新成員自動問候、跨頻道移動，到使用者模仿這種純粹來亂的都有。新功能持續開發中，如果有任何錯誤（或想分享有趣的建議），請透過 GitHub issues 或官方 Discord 回報。</p>

## 實用資源

- [支援的供應商完整清單](https://docs.tomoribot.app/zh-TW/features/setup-administration/providers-and-models/#支援的供應商)
- [如何執行本機模型](https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/)
- [安全性與威脅模型](https://docs.tomoribot.app/en/wiki/threat-models/)
- [官方 TomoriBot 開發藍圖](https://github.com/users/Bredrumb/projects/1/views/1)
- [自訂提示詞用的工具巨集](https://docs.tomoribot.app/zh-TW/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## 自架

安裝步驟、Docker Compose 與選用的本機伺服器，請參閱[自架文件](https://docs.tomoribot.app/zh-TW/self-hosting/)。

<!-- AFTER SETUP -->
### 邀請或設定完成後

#### 基本指令

- `/setup` - 伺服器的 bot 初始設定
- `/config` - 多種調整 TomoriBot 的方式
- `/personal memories` - 管理你的個人記憶
- `/memories` - 管理伺服器記憶、文件與短期記憶
- `/moderation` - 管理成員存取、使用者黑名單，以及頻道、人格與身分組限制

所有斜線指令請見完整的**[指令參考](https://docs.tomoribot.app/zh-TW/features/command-reference/)**。

#### 聊天互動

只要在伺服器裡提及 bot，或使用設定好的觸發詞，就能開始對話：
```
@TomoriBot yo wassup
```

或者直接私訊 TomoriBot 跟她打招呼！

## 致謝

衷心感謝所有人，特別是以下這些優秀的朋友，他們提供的程式碼貢獻與建議塑造了 TomoriBot 的今日樣貌！

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
## 聯絡與連結

**官方網站**：[https://tomoribot.app](https://tomoribot.app/)

**電子郵件**：bredrumb@gmail.com

**Discord**：[官方支援伺服器](https://discord.gg/bjCfHm9QsB)


## 授權條款
本專案採用 [AGPLv3](LICENSE) 授權。

<!-- SUPPORT -->
## 支持專案

如果你覺得 TomoriBot 有幫助，也想支持她持續開發，歡迎在 GitHub 留下一顆 ⭐，或透過 Ko-fi 贊助！

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
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
