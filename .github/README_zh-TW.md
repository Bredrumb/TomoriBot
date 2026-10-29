### [English](../README.md) | [日本語](README_ja.md) | 繁體中文 | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

一套可自架、可高度自訂的 Discord 個人 AI 助理與角色扮演系統，具備記憶、多個人格、工具呼叫、API 與本機模型支援，*以及*眾多其他有趣功能！

<p align="center">
  <strong><a href="https://docs.tomoribot.app/zh-TW/">官方文件</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">邀請 TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord 伺服器</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">最新版本</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">回報 Bug</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">請求新功能</a>
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
# 關於專案

TomoriBot 是一套免費且開源的 Discord 個人 AI 助理與角色扮演系統，靈感來自 SillyTavern 與 Discord 已停止服務的 Clyde。你可以把它當成實用的助理、可客製的夥伴、角色扮演對象，或是兼具以上所有角色，為你以及你的 Discord 伺服器中的所有人提供服務。

## 功能展示


![Screenshots 1](../assets/img/scs/1-agentic.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/capabilities/tools-and-extensions/">AI 代理驅動的對話</a></h3>
<p align="center">TomoriBot 內建非常多工具，讓她不只是聊天：支援搜尋網頁、設定重複任務與提醒、使用伺服器的表情符號與貼圖、媒體生成，並透過持久化記憶記住跨頻道、跨伺服器的脈絡。</p>

<br />


![Screenshots 2](../assets/img/scs/2-multipersona.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/chatting-personality/multiple-personas/">多個人格支援</a></h3>
<p align="center">TomoriBot 在伺服器裡的人格、行為與頭像都能輕鬆修改、建立，也能匯出成「人格」分享給其他人（類似可分享的 AI 角色卡）。你可以透過 <code>/persona generate</code> 匯入甚至轉換自己喜歡的 SillyTavern 角色卡。單一伺服器能擁有無限多個不同人格，每個都有自己的記憶與目標。你也可以安排它們互相合作，在伺服器裡一起做事（或只是互相打鬧）。</p>

<br />

![Screenshots 3](../assets/img/scs/3-commands.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/command-reference/">原生設定斜線指令與執行</a></h3>
<p align="center">無需離開 Discord 即可設定並自訂 TomoriBot。使用斜線指令與互動選單建立人格、微調提示詞與模型設定、連接 MCP 伺服器、管理記憶，並掌控權限與用量限制。你也可以自己執行指令來生成圖片與語音訊息、擲骰子，並體驗更多有趣功能。</p>

<br />

![Screenshots 4](../assets/img/scs/4-comfyui.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/">完全本機設定</a></h3>
<p align="center">你可以在自己的電腦上執行 TomoriBot 及其加密資料庫，完全不需要任何雲端供應商：搭配用於對話的本機 LLM、用於圖片/影片生成的 ComfyUI（<code>/assets/comfyui-workflows/</code>）、本機搜尋引擎，以及用於語音生成與轉錄的本機語音模型（<code>/servers/</code>）。</p>

<br />

![Screenshots 5](../assets/img/scs/5-features.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/">還有更多豐富功能，持續增加中！</a></h3>
<p align="center">包含眾多有趣功能：從實用的新成員自動問候與語音通話，到擲骰子與互動動作等角色扮演玩法。新功能持續開發中，若遇到任何錯誤（或想分享有趣的建議），歡迎透過 GitHub issues 或官方 Discord 回報。</p>

<!-- GETTING STARTED -->
# 開始使用

你可以[邀請公開版 TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915) 加入你的 Discord 伺服器，如果希望完全掌控自己的隱私與 API 金鑰，也可以[自架自己的執行個體](#自架)。TomoriBot 採用最佳安全實務與加密來保護資料，不過自架能確保所有資料都完全留在你的裝置上：

## 自架

1. **事前準備：**
   - [Bun](https://bun.sh/) v1.3.2+（建議 v1.4.0+）
   - [PostgreSQL](https://www.postgresql.org/) 或 [Docker](https://www.docker.com/)（安裝精靈會使用既有的 PostgreSQL 或在 Docker 中啟動）
   - 已啟用 `Presence Intent`、`Server Members Intent` 與 `Message Content Intent` 的 [Discord Bot Token](https://discord.com/developers/applications)
2. **執行安裝精靈：**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   bun run setup # 安裝依賴套件、設定 .env 並配置 PostgreSQL
   bun run dev # 啟動 bot 並自動執行資料庫遷移
   ```

有關更多詳細資訊或在上述步驟中遇到問題，請參閱完整的[自架文件](https://docs.tomoribot.app/zh-TW/self-hosting/)。

<!-- AFTER SETUP -->
### 邀請或設定完成後

只要在伺服器裡提及 bot，或使用設定好的觸發詞，就能開始對話：
```
@TomoriBot yo wassup
```

或者直接私訊 TomoriBot 打個招呼！

#### 基本指令

- `/setup` - 伺服器的 bot 初始設定
- `/config` 與 `/personal config` - 在目前 Discord 伺服器或個人調整 TomoriBot 的多種方式
- `/providers` 與 `/personal providers` - 新增更多模型端點或雲端供應商
- `/persona` - 為她賦予性格或新增角色（請參閱[多個人格](https://docs.tomoribot.app/zh-TW/features/chatting-personality/multiple-personas/)）
- `/memories` - 跨對話教導她記住事實（請參閱[記憶](https://docs.tomoribot.app/zh-TW/features/knowledge/memory/)）

所有斜線指令請參閱完整的[指令參考](https://docs.tomoribot.app/zh-TW/features/command-reference/)。


## 謝辭

衷心感謝所有人，*特別*感謝以下各位好友的重大貢獻與寶貴建議，大力協助 TomoriBot 變得更好！

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

## 授權條款
本專案採用 [AGPLv3](../LICENSE) 授權。

---

如果你覺得 TomoriBot 很有用（或很有趣），歡迎在 GitHub 上給個 ⭐，或透過 Ko-fi 或 Patreon 贊助後續開發！

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
  </a>
  &nbsp;
  <a href="https://www.patreon.com/cw/tomoribot">
    <img src="https://img.shields.io/badge/Support_on_Patreon-FF424D?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon">
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
