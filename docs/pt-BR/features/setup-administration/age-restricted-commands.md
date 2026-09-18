---
title: "Comandos com Restrição de Idade"
sidebar:
  order: 3
---

A TomoriBot mantém sua categoria de comandos `/nsfw` somente para adultos atrás da restrição de idade integrada do Discord,
oculta até você optar por participar. Esta página explica como acessá-la e onde ela funciona.

## Ativando Comandos com Restrição de Idade

1. No Discord, abra **Configurações do Usuário → Privacidade e Segurança**.
2. Ative **Permitir acesso a comandos com restrição de idade em aplicativos**. Você precisa ter 18 anos ou mais.
3. Comandos com restrição de idade só funcionam em canais marcados como **NSFW** (clique com o botão direito em um canal →
   **Editar Canal → ativar NSFW**; apenas administradores do servidor podem marcar canais como NSFW).

Se um comando é restrito e o canal não está marcado como NSFW, ele simplesmente não aparecerá.

## O Que Está Restrito

- **Configurações de conteúdo NSFW**: `/nsfw jailbreaks` ativa/desativa contornos para filtros de conteúdo
  excessivamente rígidos *do lado do provedor* (a TomoriBot em si não adiciona restrições de segurança próprias). Veja
  [Ajuste de Comportamento](/pt-BR/features/chatting-personality/behavior-tweaking/#saída-sem-censura).

A geração de imagem e vídeo é controlada separadamente pelo provedor configurado e pelas
configurações de capacidade do servidor; elas não são restringidas pela categoria de comandos `/nsfw`.

Conteúdo com restrição de idade é apenas para usuários adultos; use com responsabilidade e siga as
[Diretrizes da Comunidade](https://discord.com/guidelines) do Discord. Em `/help`, escolha **Behavior**, depois **Age-Restricted Commands**, para o mesmo
guia no Discord.
