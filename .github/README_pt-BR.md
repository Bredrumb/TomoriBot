### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | Português (Brasil) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> Este README é uma visão geral rápida. Para a documentação completa e atualizada (guias de configuração, detalhes de recursos, informações de provedores e mais), visite **[docs.tomoribot.app](https://docs.tomoribot.app/pt-BR/)**.

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Um assistente de IA pessoal e sistema de RPG (role-playing) para Discord com hospedagem própria e personalizável. Possui memória, múltiplas personas, uso de ferramentas, multimodalidade e suporte a APIs/modelos locais.

<p align="center">
  <strong><a href="https://tomoribot.app/">Site Oficial</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Convidar TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Servidor do Discord</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Últimos Lançamentos</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Relatar Bug</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Solicitar Recurso</a>
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
## Sobre o Projeto

TomoriBot é um assistente de IA pessoal e sistema de RPG de código aberto e com hospedagem própria para Discord, inspirado no SillyTavern e no descontinuado Clyde do Discord. Ele pode ser usado como um assistente prático, companheiro personalizável e parceiro de role-play para você em DMs, ou para todos no seu servidor do Discord.

TomoriBot suporta memória de longo prazo, comportamento de múltiplas personas, ferramentas web e MCP, geração de mídia no chat, comandos slash do Discord e múltiplos provedores, incluindo proxies personalizados e hospedagem própria de seus próprios modelos para tudo, desde geração de texto até geração de vídeo.

### Como Começar

Você pode [convidar a TomoriBot pública](https://discord.com/oauth2/authorize?client_id=841644102059556915) para o seu servidor do Discord, ou [hospedar sua própria instância](#hospedagem-própria) se preferir controle total sobre sua privacidade e chaves de API. A TomoriBot usa as melhores práticas de segurança e criptografia para manter os dados seguros, mas a hospedagem própria garante que todos os dados permaneçam inteiramente no seu dispositivo.

Após adicioná-la ao seu servidor por qualquer um dos métodos acima, execute o comando `/setup` para obter instruções. Em seguida, você pode simplesmente dizer o nome dela (ou mencioná-la com @) para obter uma resposta.

## Demonstração de Recursos


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/capabilities/tools-and-extensions/">Conversação com Agente IA</a></h3>
<p align="center">A TomoriBot possui VÁRIAS ferramentas que permitem que ela vá além do simples bate-papo, como pesquisar na web, definir tarefas/lembretes recorrentes, utilizar as figurinhas do seu servidor, e opções de memória como RAG e memória de curto prazo que permitem que ela lembre do contexto entre canais e servidores.</p>

<br />


![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/chatting-personality/multiple-personas/">Suporte a Múltiplas Personas</a></h3>
<p align="center">A personalidade, o comportamento e o avatar da TomoriBot no servidor podem ser facilmente alterados, criados e exportados para outras pessoas como Personas (semelhante aos AI Character Cards compartilháveis). Importe e até mesmo transforme seus cards favoritos do SillyTavern através do comando <code>/persona generate</code>. Você pode ter uma quantidade ilimitada de personas diferentes em um único servidor, cada uma com suas próprias memórias e objetivos. Você também pode orquestrá-las para trabalharem juntas no seu servidor (ou apenas brincarem umas com as outras).</p>

<br />

![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/capabilities/media-generation/">Entrada/Saída Multimodal Completa</a></h3>
<p align="center">A TomoriBot pode processar imagens, áudio e vídeo enviados diretamente no Discord e gerá-los em resposta usando seus próprios endpoints de modelo local ou chaves de API, tudo criptografado de forma segura dentro de um banco de dados persistente. Fluxos de trabalho do ComfyUI prontos para uso podem ser encontrados em <code>assets/comfyui-workflows/</code> e servidores locais de inferência de áudio em <code>servers/</code>!</p>

<br />


![Configuração totalmente local com ComfyUI](../assets/img/docs/intro/05-fully-local-setup.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/self-hosting/local-endpoints/">Configuração Totalmente Local</a></h3>
<p align="center">Você pode rodar a TomoriBot e seu banco de dados no seu próprio PC, com um LLM local para conversas, ComfyUI para geração de imagens e modelos de fala locais para geração e transcrição de voz. Todo esse processamento de IA pode acontecer no seu hardware, sem provedores de IA em nuvem. O Discord ainda precisa de uma conexão com a internet e transporta as mensagens e mídias que você troca com o bot.</p>

<br />

![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/command-reference/">Comandos Slash Nativos para Configuração</a></h3>
<p align="center">Tudo pode ser gerenciado através de comandos slash nativos do Discord e UI interativa. Gerencie completamente personas, predefinições, ajuste parâmetros de modelos, configure servidores de ferramentas MCP, ajuste permissões, configure memórias, defina limites de taxa para membros do servidor e muito mais! Você também pode perguntar diretamente à TomoriBot sobre o que ela pode fazer e quais são os seus comandos slash. Atualmente, um Web Dashboard está em desenvolvimento para facilitar ainda mais o gerenciamento.</p>

<br />

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/">Muitos Outros Recursos, e Contando!</a></h3>
<p align="center">Uma série de recursos divertidos que são fáceis de configurar, variando de saudações automáticas práticas para novos membros do servidor e movimento entre canais, a recursos engraçados como imitações de usuários para algumas trollagens. Novos recursos estão constantemente em desenvolvimento, então por favor reporte através das issues do GitHub ou no Discord oficial para relatar bugs (ou compartilhar sugestões divertidas).</p>

## Recursos Úteis

- [Lista Completa de Provedores Suportados](https://docs.tomoribot.app/pt-BR/features/setup-administration/providers-and-models/#provedores-suportados)
- [Como Rodar Modelos Locais](https://docs.tomoribot.app/pt-BR/self-hosting/local-endpoints/)
- [Segurança & Modelos de Ameaça](https://docs.tomoribot.app/en/wiki/threat-models/)
- [Roteiro (Roadmap) Oficial da TomoriBot](https://github.com/users/Bredrumb/projects/1/views/1)
- [Macros de Ferramenta para Personalização de Prompt](https://docs.tomoribot.app/pt-BR/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## Hospedagem Própria

Consulte a [documentação de hospedagem própria](https://docs.tomoribot.app/pt-BR/self-hosting/) para instruções de instalação, Docker Compose e servidores locais opcionais.

<!-- AFTER SETUP -->
### Após Convidar / Configuração

#### Comandos Básicos

- `/setup` - Configuração inicial do bot para o seu servidor
- `/config` - Várias maneiras de ajustar a TomoriBot
- `/personal memories` - Gerencie suas memórias pessoais
- `/memories` - Gerencie memórias do servidor, documentos e memória de curto prazo
- `/moderation` - Gerencie o acesso dos membros, a lista de bloqueio de usuários, e as restrições de canais, personas e cargos

Consulte a **[Referência de Comandos](https://docs.tomoribot.app/pt-BR/features/command-reference/)** completa para todos os comandos slash.

#### Interação no Chat

Simplesmente mencione o bot em um servidor ou use as palavras-gatilho configuradas para iniciar uma conversa:
```
@TomoriBot e aí, tudo bem
```

Ou mande uma mensagem direta (DM) para a TomoriBot e diga oi!

## Agradecimentos

Muito obrigado a todos, especialmente às seguintes pessoas maravilhosas pelas suas contribuições de código e conselhos que moldaram a TomoriBot para o que ela é hoje!

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
## Contato & Links

**Site Oficial**: [https://tomoribot.app](https://tomoribot.app/)

**Email**: bredrumb@gmail.com

**Discord**: [Servidor Oficial de Suporte](https://discord.gg/bjCfHm9QsB)


## Licença
Este projeto é licenciado sob a [AGPLv3](LICENSE).

<!-- SUPPORT -->
## Apoie o Projeto

Se você achar a TomoriBot útil e quiser apoiar o seu desenvolvimento contínuo, considere deixar uma ⭐ no GitHub ou apoiar via Ko-fi!

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
