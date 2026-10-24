### [English](../README.md) | 日本語 | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> このREADMEは簡単な概要です。完全で最新のドキュメント（セットアップガイド、機能の解説、プロバイダー情報など）については **[docs.tomoribot.app](https://docs.tomoribot.app/en/)** をご覧ください。

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Discord向けの自ホスト可能でカスタマイズ自在な個人AIアシスタント/ロールプレイシステム。記憶、複数ペルソナ、ツール呼び出し、マルチモーダル、API/ローカルモデルサポートを備えています。

<p align="center">
  <strong><a href="https://tomoribot.app/">公式ウェブサイト</a></strong>
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
## プロジェクトについて

TomoriBotは、SillyTavernとDiscordの廃止されたClydeにインスパイアされた、無料でオープンソースの自ホスト型個人AIアシスタント兼ロールプレイシステムです。DMでは自分専用の、Discordサーバーでは全員のための、実用的なアシスタント、カスタマイズ可能なコンパニオン、ロールプレイの相手として使えます。

TomoriBotは長期記憶、マルチペルソナ動作、WebおよびMCPツール、チャット内でのメディア生成、Discordスラッシュコマンド、そしてカスタムプロキシや自前モデルの自ホストを含む複数のプロバイダーをサポートし、テキスト生成から動画生成まで幅広く対応します。

### はじめに

[公開版TomoriBotを招待](https://discord.com/oauth2/authorize?client_id=841644102059556915)してDiscordサーバーに追加するか、プライバシーとAPIキーを完全にコントロールしたい場合は[自分でホスト](#セルフホスティング)することもできます。TomoriBotはデータを安全に保つためにセキュリティのベストプラクティスと暗号化を用いていますが、セルフホスティングならすべてのデータが完全にあなたのデバイス上にとどまります。

上記いずれかの方法でサーバーに追加した後、`/setup`コマンドを実行して手順を確認してください。その後は、彼女の名前を呼ぶ（または@メンションする）だけで応答が得られます。

## 機能紹介


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/capabilities/tools-and-extensions/">エージェント型AI駆動の会話</a></h3>
<p align="center">TomoriBotはチャットするだけにとどまらない多彩なツールを備えています。Web検索、繰り返しタスク/リマインダーの設定、サーバーの絵文字/スタンプの活用、そしてチャンネルやサーバーをまたいでコンテキストを記憶できるRAGやSTMなどの記憶機能が使えます。</p>

<br />


![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/chatting-personality/multiple-personas/">マルチペルソナサポート</a></h3>
<p align="center">TomoriBotのサーバー内でのパーソナリティ、行動、アバターは簡単に変更・作成でき、ペルソナとして他のユーザーへエクスポートすることもできます（共有可能なAIキャラクターカードのようなもの）。<code>/persona generate</code>でお気に入りのSillyTavernカードをインポート・変換することも可能です。1つのサーバーに無制限のペルソナを持たせることができ、それぞれが独自の記憶とアジェンダを持ちます。さらに、複数のペルソナを連携させてサーバー内で協働させる（あるいはただじゃれ合わせる）こともできます。</p>

<br />

![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/capabilities/media-generation/">完全なマルチモーダル入出力</a></h3>
<p align="center">TomoriBotはDiscordで直接送信された画像・音声・動画を処理し、あなた自身のローカルモデルエンドポイントやAPIキーを使ってそれらを生成して返せます。これらはすべて暗号化され、永続的なデータベースに安全に保存されます。すぐに使えるComfyUIワークフローは<code>assets/comfyui-workflows/</code>に、ローカル音声推論サーバーは<code>servers/</code>にあります！</p>

<br />


![ComfyUIによる完全ローカルセットアップ](../assets/img/docs/intro/05-fully-local-setup.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/self-hosting/local-endpoints/">完全ローカルセットアップ</a></h3>
<p align="center">会話用のローカルLLM、画像生成用のComfyUI、音声生成および文字起こし用のローカル音声モデルを備え、TomoriBotとそのデータベースをご自身のPC上で実行できます。これらすべてのAI処理はクラウドAIプロバイダーを使用せず、お使いのハードウェア上で完結します。Discordへの接続にはインターネット接続が必要で、ボットとのメッセージやメディアのやり取りを仲介します。</p>

<br />

![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/command-reference/">ネイティブな設定用スラッシュコマンド</a></h3>
<p align="center">すべてDiscordのネイティブなスラッシュコマンドとインタラクティブUIで管理できます。ペルソナやプロンプトの完全な管理、モデルパラメータの調整、MCPツールサーバーの設定、権限の調整、記憶の設定、サーバーメンバーのレート制限など、さらに多くのことが可能です。TomoriBotに、彼女ができることやスラッシュコマンドを直接尋ねることもできます。現在、さらに簡単な管理のためにWebダッシュボードを開発中です。</p>

<br />

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/ja/features/">さらに多くの機能が続々追加中！</a></h3>
<p align="center">新しいサーバーメンバーへの自動挨拶やチャンネル間の移動など実用的なものから、ユーザーのなりきりでちょっとしたおふざけをするものまで、簡単に設定できる楽しい機能が揃っています。新機能は常に開発中ですので、バグ（や楽しい提案）はGitHub Issuesまたは公式Discordで報告してください。</p>

## 役立つリソース

- [対応プロバイダーの完全なリスト](https://docs.tomoribot.app/ja/features/setup-administration/providers-and-models/#サポートされているプロバイダー)
- [ローカルモデルの実行方法](https://docs.tomoribot.app/ja/self-hosting/local-endpoints/)
- [セキュリティと脅威モデル](https://docs.tomoribot.app/en/wiki/threat-models/)
- [公式TomoriBotロードマップ](https://github.com/users/Bredrumb/projects/1/views/1)
- [プロンプトカスタマイズ用ツールマクロ](https://docs.tomoribot.app/ja/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## セルフホスティング

セットアップ手順、Docker Compose、オプションのローカルサーバーについては、[セルフホスティングドキュメント](https://docs.tomoribot.app/ja/self-hosting/)を参照してください。

<!-- AFTER SETUP -->
### 招待・セットアップ後

#### 基本コマンド

- `/setup` - サーバーの初期ボットセットアップ
- `/config` - TomoriBotを調整するための複数の方法
- `/personal memories` - 個人の記憶の管理
- `/memories` - サーバーの記憶、ドキュメント、および短期記憶の管理
- `/moderation` - メンバーのアクセス、ユーザーブラックリスト、チャンネル、ペルソナ、およびロールの制限の管理

すべてのスラッシュコマンドについては、**[コマンドリファレンス](https://docs.tomoribot.app/ja/features/command-reference/)**の全文を参照してください。

#### チャットでのやり取り

サーバーでボットをメンションするか、設定されたトリガーワードを使用して会話を開始します：
```
@TomoriBot yo wassup
```

または、TomoriBotのDMに入って挨拶してください！

## 謝辞

TomoriBotを現在の形に形作ってくれたコードの貢献や助言をいただいた以下の素晴らしい方々をはじめ、すべての人に心から感謝します！

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
## 連絡先とリンク

**公式ウェブサイト**: [https://tomoribot.app](https://tomoribot.app/)

**Email**: bredrumb@gmail.com

**Discord**: [公式サポートサーバー](https://discord.gg/bjCfHm9QsB)


## ライセンス
このプロジェクトは[AGPLv3](LICENSE)の下でライセンスされています。

<!-- SUPPORT -->
## プロジェクトのサポート

TomoriBotが役立ったと感じ、今後の開発を支援したい場合は、GitHubで⭐を付けるか、Ko-fiを通じてサポートをご検討ください！

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
