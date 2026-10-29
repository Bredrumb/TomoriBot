### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | Português (Brasil) | [Tiếng Việt](README_vi.md)

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

Um sistema de assistente pessoal de IA e RPG personalizável e com hospedagem própria para Discord, com memória, múltiplas personas, chamada de ferramentas, suporte a modelos locais/API *e* vários outros recursos divertidos!

<p align="center">
  <strong><a href="https://docs.tomoribot.app/pt-BR/">Documentação Oficial</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Convidar a TomoriBot</a></strong>
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
# Sobre o Projeto

TomoriBot é um assistente pessoal de IA e sistema de RPG gratuito e de código aberto para Discord, inspirado no SillyTavern e no descontinuado Clyde do Discord. Ele pode ser usado como um assistente prático, companheiro personalizável, parceiro de role-play ou TUDO isso para você e para todos no seu servidor do Discord.

## Demonstração de Recursos


![Screenshots 1](../assets/img/scs/1-agentic.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/capabilities/tools-and-extensions/">Conversação com Agente IA</a></h3>
<p align="center">A TomoriBot possui várias ferramentas que permitem que ela vá além do simples bate-papo, como pesquisar na web, definir tarefas/lembretes recorrentes, utilizar as figurinhas do seu servidor, geração de mídia e memória persistente para lembrar o contexto entre canais e servidores.</p>

<br />


![Screenshots 2](../assets/img/scs/2-multipersona.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/chatting-personality/multiple-personas/">Suporte a Múltiplas Personas</a></h3>
<p align="center">A personalidade, o comportamento e o avatar da TomoriBot no servidor podem ser facilmente alterados, criados e exportados para outras pessoas como Personas (semelhante aos AI Character Cards compartilháveis). Importe e até mesmo transforme seus cards favoritos do SillyTavern através do comando <code>/persona generate</code>. Você pode ter uma quantidade ilimitada de personas diferentes em um único servidor, cada uma com suas próprias memórias e objetivos. Você também pode orquestrá-las para trabalharem juntas no seu servidor (ou apenas brincarem umas com as outras).</p>

<br />

![Screenshots 3](../assets/img/scs/3-commands.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/command-reference/">Comandos Slash Nativos para Configuração e Execução</a></h3>
<p align="center">Configure e personalize a TomoriBot sem sair do Discord. Use comandos slash e menus interativos para criar personas, ajustar prompts e configurações de modelos, conectar servidores MCP, gerenciar memórias e controlar permissões e limites de uso. Execute comandos você mesmo para gerar imagens e mensagens de voz, rolar dados e experimentar outros recursos divertidos.</p>

<br />

![Screenshots 4](../assets/img/scs/4-comfyui.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/self-hosting/local-endpoints/">Configuração Totalmente Local</a></h3>
<p align="center">A TomoriBot pode rodar a si mesma e seu banco de dados criptografado no seu próprio PC, com um LLM local para conversas, ComfyUI para geração de imagem/vídeo (<code>/assets/comfyui-workflows/</code>), mecanismos de busca locais e modelos de fala locais para geração e transcrição de voz (<code>/servers/</code>), tudo sem a necessidade de provedores em nuvem.</p>

<br />

![Screenshots 5](../assets/img/scs/5-features.png)
<h3 align="center"><a href="https://docs.tomoribot.app/pt-BR/features/">Muitos Outros Recursos, e Contando!</a></h3>
<p align="center">Uma série de recursos divertidos que vão desde saudações automáticas práticas para novos membros do servidor e chat de voz, até elementos de role-play como rolagem de dados e ações. Novos recursos estão constantemente em desenvolvimento, então por favor reporte através das issues do GitHub ou no Discord oficial para relatar bugs (ou compartilhar sugestões divertidas).</p>

<!-- GETTING STARTED -->
# Como Começar

Você pode [convidar a TomoriBot pública](https://discord.com/oauth2/authorize?client_id=841644102059556915) para o seu servidor do Discord agora mesmo por conveniência, ou [hospedar sua própria instância](#hospedagem-própria) se preferir controle total sobre sua privacidade e chaves de API. A TomoriBot usa as melhores práticas de segurança e criptografia para manter os dados seguros, mas a hospedagem própria garante que todos os dados permaneçam inteiramente no seu dispositivo:

## Hospedagem Própria

1. **Pré-requisitos:**
   - [Bun](https://bun.sh/) v1.3.2+ (v1.4.0+ recomendado)
   - [PostgreSQL](https://www.postgresql.org/) ou [Docker](https://www.docker.com/) (o assistente de configuração usa uma instalação existente do PostgreSQL ou inicia uma no Docker)`
   - Um [token de bot do Discord](https://discord.com/developers/applications) com `Presence Intent`, `Server Members Intent` e `Message Content Intent` ativados
2. **Execute o assistente de configuração:**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   bun run setup # instala dependências, configura o .env e prepara o PostgreSQL
   bun run dev # inicia o bot e executa as migrações do banco de dados automaticamente
   ```

Para mais detalhes ou se tiver problemas com as etapas acima, consulte a [documentação de hospedagem própria](https://docs.tomoribot.app/pt-BR/self-hosting/) completa.

<!-- AFTER SETUP -->
### Após Convidar / Configuração

Simplesmente mencione o bot em um servidor ou use as palavras-gatilho configuradas para iniciar uma conversa:
```
@TomoriBot e aí, tudo bem
```

Ou mande uma mensagem direta (DM) para a TomoriBot e diga oi!

#### Comandos Básicos

- `/setup` - Configuração inicial do bot para o seu servidor
- `/config` e `/personal config` - Várias maneiras de ajustar a TomoriBot no servidor atual do Discord ou para você
- `/providers` e `/personal providers` - Adicione mais endpoints de modelos ou provedores em nuvem
- `/persona` - Dê a ela uma personalidade ou adicione novos personagens (veja [Múltiplas Personas](https://docs.tomoribot.app/pt-BR/features/chatting-personality/multiple-personas/))
- `/memories` - Ensine fatos a ela através de conversas (veja [Memória](https://docs.tomoribot.app/pt-BR/features/knowledge/memory/))

Consulte a [referência de comandos](https://docs.tomoribot.app/pt-BR/features/command-reference/) completa para todos os comandos slash.


## Agradecimentos

Um enorme agradecimento a todos, *especialmente* às seguintes pessoas queridas por suas contribuições significativas e conselhos que ajudaram muito a aprimorar a TomoriBot!

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

## Licença
Este projeto está licenciado sob [AGPLv3](../LICENSE).

---

Se você achou a TomoriBot útil (e/ou divertida), considere deixar uma ⭐ no repositório ou apoiar o desenvolvimento pelo Ko-fi ou Patreon!

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
