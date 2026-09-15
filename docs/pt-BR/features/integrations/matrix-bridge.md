---
title: "Bridge Matrix"
sidebar:
  order: 1
---

A TomoriBot pode conectar uma **sala Matrix** a um canal do Discord: as pessoas conversam pelo Matrix, suas
mensagens são retransmitidas para o Discord como mensagens de webhook, e ela responde de volta na sala Matrix.
Esta página é o lado do usuário da bridge. Para os detalhes internos do appservice, veja a
[arquitetura da bridge Matrix](/en/architecture/integrations/matrix/bridge/).

## Configuração

1. Convide a conta de bot Matrix configurada para uma sala Matrix **não criptografada**.
2. Copie o **ID Interno da Sala** dessa sala.
3. Execute `/matrix link` no canal do Discord que você deseja conectar e cole o ID da
   sala.

Depois que o bot aceitar o convite, ele publica um lembrete curto na sala Matrix — mas você
ainda finaliza a conexão a partir do Discord com `/matrix link`.

### Encontrando o ID da Sala

Na maioria dos clientes Matrix: **Configurações da Sala → Avançado → ID Interno da Sala**. Ele se parece com
`!abc:matrix.org`.

## Usando pelo Matrix

- Converse normalmente após a sala estar vinculada; as mensagens do Matrix são retransmitidas para o canal do Discord.
- Ela responde de volta na sala Matrix.
- Os únicos comandos de texto no Matrix são `/kill` e `/refresh`.

## Limitações Atuais

- Sem comandos slash a partir do Matrix (além de `/kill` e `/refresh`).
- Sem DMs ou lembretes de tempo de recarga baseados em DM.
- Fotos de perfil do Matrix não são visíveis para ela.
- Não é possível fixar mensagens.
- Emojis personalizados e Markdown não renderizam de forma confiável; embeds são retransmitidos como texto simples.
- Memórias pessoais para usuários do Matrix recorrem a memórias do servidor atribuídas.

## Observações

- Se o bot não entrar automaticamente, convide a conta de bot Matrix manualmente e execute novamente
  `/matrix link`.
- **A criptografia do Matrix não pode ser desativada depois** — uma sala criptografada precisa ser substituída por uma
  nova sala não criptografada.
- Se uma limitação não está listada acima, presuma que deve funcionar e reporte bugs no servidor de
  suporte (`/support discord`).

No `/help`, escolha **Integrations** e depois **Matrix** para o mesmo guia no Discord.
