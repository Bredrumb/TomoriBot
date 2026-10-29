---
title: "Configuração do OAuth do PluralBuddy"
description: "Autorize seu TomoriBot autohospedado a verificar mensagens de instâncias aprovadas do PluralBuddy."
sidebar:
  order: 8
---

Um TomoriBot autohospedado precisa de um aplicativo autorizado do PluralBuddy para o serviço oficial e para cada instância personalizada aprovada.

Se você usa o [bot público implantado](https://discord.com/oauth2/authorize?client_id=841644102059556915),
não precisa concluir esta configuração do lado do host. Selecione o PluralBuddy com
`/personal message-proxy service:pluralbuddy`; consulte
[Suporte a proxy de mensagens](/features/integrations/message-proxy-support/#pluralbuddy).

## Antes de começar

- Execute a versão atual do TomoriBot conectada a um banco de dados PostgreSQL migrado.
- Use um computador com um navegador e acesso a esse banco de dados e à chave de criptografia do TomoriBot. O
  auxiliar de autorização escuta no endereço de loopback desse computador. Se o banco de dados for remoto,
  providencie acesso temporário e restrito a partir deste computador.
- Escolha uma porta local não utilizada e registre uma URL de retorno de chamada (callback URL) exata no portal de desenvolvedores, por
  exemplo `http://127.0.0.1:<porta>/oauth/callback`. Anote essa URL; você a usará em todas as
  etapas abaixo.

## Autorizar a instância oficial

1. Entre no [portal de desenvolvedores do PluralBuddy](https://pluralbuddy.app/developers/applications)
   e crie um aplicativo OAuth. Use um aplicativo separado para testes. Selecione `profile` e
   `offline_access`. Registre seu callback exatamente como escolhido acima. Mantenha o client ID e o secret
   em sigilo.
2. A partir do repositório do TomoriBot, execute o auxiliar com o ID da instância oficial e o mesmo callback:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. Digite o client ID e o secret nas solicitações do terminal. Abra a URL de autorização exibida no
   navegador desse computador, faça login no PluralBuddy e aprove a tela de consentimento. O auxiliar
   é encerrado após um callback ou três minutos e armazena a conexão no PostgreSQL.
4. Inicie o TomoriBot com o mesmo banco de dados e chave de criptografia. Selecione
   `/personal message-proxy service:pluralbuddy` em uma conta do Discord que use o PluralBuddy e, em seguida,
   envie um repost de webhook para verificar se o TomoriBot reconhece o alter.

O auxiliar lê as configurações do banco de dados e as chaves de criptografia do `.env` ou de um pacote JSON `SECRET_FILE`. Mantenha o pacote fora do repositório e faça backup da chave de criptografia. Insira o segredo do cliente (client secret) no terminal em vez de armazená-lo no `.env` ou passá-lo como argumento. Se o PluralBuddy revogar a conexão, repita a autorização com o mesmo ID de instância.

## Adicionar uma instância aprovada

Use uma origem pública HTTPS sem caminho, query ou fragmento. A instância deve executar tanto um bot proxy quanto a sua API correspondente.

1. Em um computador com acesso ao banco de dados de implantação, registre uma instância desativada:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   Para o PluralKit, use `pluralkit` como o serviço. O ID de usuário do bot evita esperas de consulta desnecessárias em servidores onde esse bot não está presente.
2. Para o PluralBuddy, registre um aplicativo OAuth separado nessa instância com o mesmo padrão
   de callback em loopback acima. Autorize-o usando o ID da instância retornado pelo registro:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   Repita a autorização para substituir credenciais ou se recuperar de um refresh token revogado. O PluralKit não exige essa etapa.
3. A partir de uma mensagem escrita pelo bot proxy correspondente, anote o ID de repost do Discord e o ID
   da conta remetente. Verifique se a API da instância resolve esse repost e, em seguida, ative-a:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   Para um novo fork, teste o bot, a troca e renovação de OAuth e a consulta no TomoriBot em uma implantação descartável antes de disponibilizá-lo para os usuários.
4. Os usuários selecionam a instância ativada com `/personal message-proxy service:pluralbuddy instance:<nome>`.
   Deixar `instance` vazio escolhe a instância oficial. Desativar uma instância interrompe novas consultas
   sem alterar os perfis armazenados.

Se o bot proxy personalizado for substituído, atualize o ID de usuário do bot no Discord antes de disponibilizar a instância novamente:

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

Desative ou remova uma instância personalizada com:

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

A remoção exclui a conexão OAuth e impede permanentemente que a origem seja registrada novamente. Use `disable` se pretender retomar a instância no futuro. Identidades e memórias existentes continuam disponíveis, e as alterações entram em vigor sem a necessidade de reiniciar.

Consulte [Suporte a proxy de mensagens](/features/integrations/message-proxy-support/#pluralbuddy) para a configuração do usuário e a [arquitetura de proxy de mensagens](/architecture/integrations/message-proxy/) para o armazenamento de tokens e comportamento de atualização.
