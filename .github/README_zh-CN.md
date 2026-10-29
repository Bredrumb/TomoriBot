### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | 简体中文 | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

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

一套可自部署、可自由定制的 Discord 个人 AI 助理与角色扮演系统，具备记忆、多个人格、工具调用、API 与本地模型支持，*以及*众多其他有趣功能！

<p align="center">
  <strong><a href="https://docs.tomoribot.app/zh-CN/">官方文档</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">邀请 TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord 服务器</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">最新版本</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">报告 Bug</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">请求新功能</a>
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
# 关于这个项目

TomoriBot 是一套免费开源的 Discord 个人 AI 助理与角色扮演系统，灵感来自 SillyTavern 与 Discord 已经停运的 Clyde。她既可以当作实用的助理、可定制的伙伴、角色扮演的对象，也可以兼具以上所有角色，为你以及你的 Discord 服务器中的所有人提供服务。

## 功能展示


![Screenshots 1](../assets/img/scs/1-agentic.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/capabilities/tools-and-extensions/">Agentic AI 驱动的对话</a></h3>
<p align="center">TomoriBot 拥有大量工具，让她远不止于聊天：支持网络搜索、设置定时任务与提醒、使用服务器的表情与贴纸、媒体生成，以及能在跨频道与跨服务器间记住上下文的持久化记忆。</p>

<br />


![Screenshots 2](../assets/img/scs/2-multipersona.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/chatting-personality/multiple-personas/">多人格支持</a></h3>
<p align="center">TomoriBot 在服务器中的性格、行为与头像都可以轻松修改、创建，并能作为人格（类似可分享的 AI 角色卡）导出给他人。通过 <code>/persona generate</code> 即可导入甚至转换你喜爱的 SillyTavern 角色卡。你可以在单个服务器中拥有无限数量的不同人格，每个人格都拥有独立的记忆与目标。你还可以安排它们协同工作，在服务器中共同执行任务（或者只是互相嬉闹）。</p>

<br />

![Screenshots 3](../assets/img/scs/3-commands.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/command-reference/">原生斜杠指令配置与执行</a></h3>
<p align="center">无需离开 Discord 即可设置并定制 TomoriBot。使用斜杠指令与交互式菜单创建人格、微调提示词与模型参数、连接 MCP 服务器、管理记忆，以及掌控权限与用量限制。你也可以自己运行指令来生成图像与语音消息、掷骰子，并体验更多有趣功能。</p>

<br />

![Screenshots 4](../assets/img/scs/4-comfyui.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/self-hosting/local-endpoints/">完全本地化部署</a></h3>
<p align="center">TomoriBot 可以完全在你的电脑上运行本体及其加密数据库，无需任何云端提供方：支持用于对话的本地 LLM、用于图像/视频生成的 ComfyUI（<code>/assets/comfyui-workflows/</code>）、本地搜索引擎，以及用于语音合成与转写的本地语音模型（<code>/servers/</code>）。</p>

<br />

![Screenshots 5](../assets/img/scs/5-features.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/">更多丰富功能，持续更新中！</a></h3>
<p align="center">包含众多有趣功能：从实用的新成员自动欢迎与语音聊天，到掷骰子和互动动作等角色扮演玩法。新功能持续开发中，遇到任何 Bug（或有任何有趣的建议），欢迎通过 GitHub issues 或官方 Discord 提交反馈。</p>

<!-- GETTING STARTED -->
# 快速上手

你可以[邀请公开版 TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915)立即加入你的 Discord 服务器，如果希望完全掌控自己的隐私和 API 密钥，也可以[自部署你自己的实例](#自部署)。TomoriBot 采用最佳安全实践与加密来保护数据，而自部署能确保所有数据完全留在你的设备上：

## 自部署

1. **前置要求：**
   - [Bun](https://bun.sh/) v1.3.2+（推荐 v1.4.0+）
   - [PostgreSQL](https://www.postgresql.org/) 或 [Docker](https://www.docker.com/)（安装向导会使用已有的 PostgreSQL 或在 Docker 中启动）
   - 已启用 `Presence Intent`、`Server Members Intent` 和 `Message Content Intent` 的 [Discord Bot Token](https://discord.com/developers/applications)
2. **运行安装向导：**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   bun run setup # 安装依赖、配置 .env 并设置 PostgreSQL
   bun run dev # 启动机器人并自动执行数据库迁移
   ```

有关更多详情或在上述步骤中遇到问题，请参见完整的[自部署文档](https://docs.tomoribot.app/zh-CN/self-hosting/)。

<!-- AFTER SETUP -->
### 邀请与设置完成后

只需在服务器中 @ 提及机器人，或使用配置好的触发词即可开始对话：
```
@TomoriBot yo wassup
```

或者直接私信 TomoriBot 打个招呼！

#### 基础指令

- `/setup` - 针对你的服务器进行初始 Bot 设置
- `/config` 与 `/personal config` - 在当前 Discord 服务器或为你个人调整 TomoriBot 的多种方式
- `/providers` 与 `/personal providers` - 添加更多模型端点或云端提供方
- `/persona` - 为她赋予性格或添加新角色（参见[多个人格](https://docs.tomoribot.app/zh-CN/features/chatting-personality/multiple-personas/)）
- `/memories` - 跨对话教导她记住事实（参见[记忆](https://docs.tomoribot.app/zh-CN/features/knowledge/memory/)）

查看完整的[指令参考](https://docs.tomoribot.app/zh-CN/features/command-reference/)以了解所有斜杠指令。


## 致谢

衷心感谢所有人，*特别*感谢以下杰出贡献者为完善 TomoriBot 所付出的重大贡献与宝贵建议！

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

## 许可证
本项目采用 [AGPLv3](../LICENSE) 许可协议。

---

如果你觉得 TomoriBot 实用（或有趣），欢迎在 GitHub 上点个 ⭐，或者通过 Ko-fi 或 Patreon 支持后续开发！

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
