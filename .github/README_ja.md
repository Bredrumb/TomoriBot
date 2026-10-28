### [English](../README.md) | 日本語 | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

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

Discord向けのセルフホスト可能でカスタマイズ自在な個人AIアシスタント/ロールプレイシステム。記憶、複数ペルソナ、ツール呼び出し、API/ローカルモデルサポートに加え、他にも楽しい機能をたくさん備えています！

<p align="center">
  <strong><a href="https://docs.tomoribot.app/ja/">公式ドキュメント</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">TomoriBotを招待</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discordサーバー</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">最新リリース</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">バグ報告</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">機能リクエスト</a>
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
# プロジェクトについて

TomoriBotは、SillyTavernとDiscordの廃止されたClydeにインスパイアされた、無料でオープンソースの個人AIアシスタント兼ロールプレイシステムです。実用的なアシスタント、カスタマイズ可能なコンパニオン、ロールプレイの相手として、あるいはそのすべてとして、あなたやサーバーの全員のために活用できます。

## 機能紹介


![Screenshots 1](../assets/img/scs/1-agentic.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/capabilities/tools-and-extensions/">エージェント型AI駆動の会話</a></h3>
<p align="center">TomoriBotはチャットするだけにとどまらない多彩なツールを備えています。Web検索、繰り返しタスク/リマインダーの設定、サーバーの絵文字/スタンプの活用、メディア生成、そしてチャンネルやサーバーをまたいでコンテキストを記憶できる永続的な記憶機能が使えます。</p>

<br />


![Screenshots 2](../assets/img/scs/2-multipersona.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/chatting-personality/multiple-personas/">マルチペルソナサポート</a></h3>
<p align="center">TomoriBotのサーバー内でのパーソナリティ、行動、アバターは簡単に変更・作成でき、ペルソナとして他のユーザーへエクスポートすることもできます（共有可能なAIキャラクターカードのようなもの）。<code>/persona generate</code>でお気に入りのSillyTavernカードをインポート・変換することも可能です。1つのサーバーに無制限のペルソナを持たせることができ、それぞれが独自の記憶とアジェンダを持ちます。さらに、複数のペルソナを連携させてサーバー内で協働させる（あるいはただじゃれ合わせる）こともできます。</p>

<br />

![Screenshots 3](../assets/img/scs/3-commands.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/command-reference/">設定と実行のためのネイティブスラッシュコマンド</a></h3>
<p align="center">Discordから離れることなくTomoriBotをセットアップ・カスタマイズできます。スラッシュコマンドとインタラクティブメニューを使って、ペルソナの作成、プロンプトやモデル設定の微調整、MCPサーバーの接続、記憶の管理、権限や利用制限の管理が可能です。ご自身でコマンドを実行して画像や音声メッセージの生成、ダイスロール、その他の楽しい機能を試すこともできます。</p>

<br />

![Screenshots 4](../assets/img/scs/4-comfyui.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/self-hosting/local-endpoints/">完全ローカルセットアップ</a></h3>
<p align="center">クラウドプロバイダーを一切必要とせず、TomoriBot本体と暗号化されたデータベースをご自身のPC上で実行できます。会話用のローカルLLM、画像/動画生成用のComfyUI（<code>/assets/comfyui-workflows/</code>）、ローカル検索エンジン、音声生成および文字起こし用のローカル音声モデル（<code>/servers/</code>）に対応しています。</p>

<br />

![Screenshots 5](../assets/img/scs/5-features.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/">さらに多くの機能が続々追加中！</a></h3>
<p align="center">新メンバーへの実用的な自動挨拶やボイスチャットから、ダイスロールやアクションなどのロールプレイ向け機能まで、楽しい機能が盛りだくさんです。新機能は常に開発中ですので、バグ（や楽しい提案）はGitHub Issuesまたは公式Discordでお気軽にお知らせください。</p>

<!-- GETTING STARTED -->
# はじめに

手軽に使いたい場合は[公開版TomoriBotを招待](https://discord.com/oauth2/authorize?client_id=841644102059556915)してご自身のDiscordサーバーに追加できます。プライバシーやAPIキーを完全に管理したい場合は、[ご自身でセルフホスト](#セルフホスト)することも可能です。TomoriBotはデータを安全に保護するためにセキュリティのベストプラクティスと暗号化を採用していますが、セルフホストならすべてのデータが完全にあなたのデバイス上にとどまります：

## セルフホスト

1. **事前準備：**
   - [Bun](https://bun.sh/) v1.3.2以上（v1.4.0以上を推奨）
   - [PostgreSQL](https://www.postgresql.org/) または [Docker](https://www.docker.com/)（セットアップウィザードが既存のPostgreSQLを使用するか、Dockerで起動します）
   - `Presence Intent`、`Server Members Intent`、`Message Content Intent`が有効な[Discord Botトークン](https://discord.com/developers/applications)
2. **セットアップウィザードの実行：**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   bun run setup # 依存関係のインストール、.envの設定、PostgreSQLのセットアップを行います
   bun run dev # Botを起動し、データベースのマイグレーションを自動実行します
   ```

詳細や上記の手順で問題が発生した場合は、[セルフホストの完全なドキュメント](https://docs.tomoribot.app/ja/self-hosting/)を参照してください。

<!-- AFTER SETUP -->
### 招待・セットアップ後

サーバーでボットをメンションするか、設定されたトリガーワードを使用して会話を開始します：
```
@TomoriBot yo wassup
```

または、TomoriBotのDMに入って挨拶してください！

#### 基本コマンド

- `/setup` - サーバーの初期ボットセットアップ
- `/config` および `/personal config` - 現在のDiscordサーバーまたは個人向けにTomoriBotを調整する複数の方法
- `/providers` および `/personal providers` - モデルエンドポイントやクラウドプロバイダーの追加
- `/persona` - 性格を与えたり、新しいキャラクターを追加したりできます（[複数ペルソナ](https://docs.tomoribot.app/ja/features/chatting-personality/multiple-personas/)を参照）
- `/memories` - 会話を通じて事実を教えます（[記憶](https://docs.tomoribot.app/ja/features/knowledge/memory/)を参照）

すべてのスラッシュコマンドについては、[コマンドリファレンス](https://docs.tomoribot.app/ja/features/command-reference/)を参照してください。


## 謝辞

TomoriBotのより良い発展に大きく貢献し、貴重な助言をくださった以下の素晴らしい方々をはじめ、すべての人に心から感謝します！

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

## ライセンス
このプロジェクトは [AGPLv3](../LICENSE) の下でライセンスされています。

---

TomoriBotが役立ったり楽しんでいただけた場合は、リポジトリに ⭐ を付けるか、Ko-fi または Patreon による開発支援をご検討ください！

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
