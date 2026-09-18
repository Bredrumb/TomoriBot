---
title: "Guia de Migração Segura"
sidebar:
  order: 6
---

Quando você faz `git pull` de um código novo e reinicia a TomoriBot, o bot executa automaticamente as migrações de esquema do banco de dados na inicialização. Isso é poderoso — significa que você não precisa gerenciar atualizações SQL manualmente — mas também significa que operações destrutivas podem afetar silenciosamente seus dados. Este guia mostra como se proteger antes de fazer um pull.

## Por que isso importa

O executor de migração da TomoriBot (em `src/db/migrationRunner.ts`) executa todas as migrações não aplicadas na ordem de versão. As migrações são **somente para frente**: se algo der errado, o executor não faz a reversão automática. A maioria das migrações são expansões seguras (novas colunas, novas tabelas), mas de acordo com a política de design interna (OD-R-6) do projeto, operações destrutivas, como `DROP COLUMN` ou `DROP TABLE`, são permitidas. Se uma migração destrutiva for executada sem um backup, você perde dados permanentemente. Em caso de dúvida, faça o backup primeiro.

## Lista de verificação pré-pull

Siga estas etapas ANTES de executar `git pull`:

1. **Pare o bot** — desligue o processo da TomoriBot para que nenhuma conexão de banco de dados ativa interfira com o backup.
2. **Faça backup do banco de dados** — use um dos dois métodos abaixo.
3. **Anote o commit atual** — execute `git rev-parse HEAD` e salve a saída, caso seja necessário reverter.
4. **Faça o pull e reinicie** — uma vez que o backup esteja seguro no disco, você estará seguro para fazer o pull e reiniciar.

### Pré-requisito: a extensão `pgvector`

Um backup completo é um `pg_dump` de SQL puro (`backupData.ts` executa `pg_dump --clean --if-exists -f`), portanto ele contém a tabela `document_chunks` com tipo `vector` usada para RAG. **O Postgres de destino deve ter a extensão `pgvector` disponível antes da sua restauração**, caso contrário, o `CREATE EXTENSION IF NOT EXISTS vector` do dump não pode ser executado e a criação da tabela `document_chunks` falhará.

Instale-a uma vez no host (correspondendo à versão principal do seu Postgres), por exemplo, para o Postgres 16:

```bash
sudo apt-get install -y postgresql-16-pgvector
```

Confirme que ela está disponível:

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

Se você restaurar sem ela:

- O `restore-backup` do projeto (e qualquer execução de `psql -f` com `ON_ERROR_STOP=1`) **aborta precocemente** com `extension "vector" is not available` — nenhum dado é carregado. Instale o pgvector e tente novamente.
- Uma execução manual do `psql -f` que **ignora erros** (`ON_ERROR_STOP=0`) é pior: o `COPY public.document_chunks` que falhou dessincroniza o analisador de entrada do psql, que por sua vez analisa de forma incorreta as linhas de dados seguintes do `COPY` como SQL (uma cascata de `syntax error at or near …`). Isso descarta silenciosamente tabelas inteiras (observado: `documents` e `llms`), deixando um banco de dados parcialmente restaurado que parece intacto, mas perdeu linhas. Sempre restaure com `ON_ERROR_STOP=1` para que falhas apareçam imediatamente.

### Opção A: Usar o script de backup do projeto

A TomoriBot inclui dois scripts de backup, cada um visando diferentes dados:

- **`bun run backup`** — Dump completo do esquema do banco de dados + dados (personas, memórias, configurações, tudo)
- **`bun run backup:personas`** — Predefinições de persona e memórias do servidor por persona apenas

Para uma migração segura, use o **backup completo**:

```bash
bun run backup
```

Isso cria um pacote com carimbo de data e hora em `backups/` (ou em seu `TOMORI_BACKUP_DIR` se for substituído no `.env`) contendo o banco de dados PostgreSQL inteiro como um dump SQL puro. Para restaurar mais tarde, execute:

```bash
bun run restore-backup --latest
```

Ou restaure de um pacote específico:

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### Backups automáticos de inicialização local

Em ambientes não produtivos (`RUN_ENV` não definido como `production`), a TomoriBot também verifica se há um backup de dados completo antes da execução da inicialização do banco de dados. Ela cria um pacote automático compatível com `backupData.ts` quando qualquer uma destas condições for verdadeira:

- o último backup de dados completo foi criado por uma versão de bot diferente no `package.json`
- o último backup de dados completo tem pelo menos `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` de idade (padrão: `24`)

Backups automáticos são marcados com `backupType: "automatic"` no `bundle_info.json` e nomeados com o sufixo `_auto`. Os pacotes manuais via `bun run backup` são marcados como `manual`; eles podem satisfazer a verificação do backup mais recente, mas nunca contam para a retenção automática. O portão de inicialização mantém os `TOMORI_AUTO_BACKUP_MAX` pacotes automáticos mais recentes (padrão: `5`) e exclui apenas os pacotes automáticos mais antigos.

Defina `TOMORI_AUTO_BACKUP_ENABLED=false` no `.env` se você precisar iniciar o bot local/desenvolvimento sem este portão de segurança, por exemplo, em uma máquina sem `pg_dump`.

### Opção B: `pg_dump` direto

Se você preferir o controle manual, use o utilitário integrado `pg_dump` do PostgreSQL com as próprias variáveis de ambiente da TomoriBot:

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

Isso salva um dump binário em formato personalizado (mais compacto que texto SQL). As variáveis de ambiente correspondem ao seu `.env`:

- `POSTGRES_HOST` — padrão `localhost`
- `POSTGRES_PORT` — padrão `5432`
- `POSTGRES_USER` — seu usuário do BD
- `POSTGRES_DB` — padrão `tomodb`

Para restaurar:

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

**Nota:** o `pg_restore` pedirá sua senha, a menos que você a defina em um arquivo `.pgpass` (arquivo de credenciais integrado do PostgreSQL).

## Para contribuidores que fazem o deploy via CI: a convenção `(Checkpoint)`

Se você mantém um fork que faz o deploy na AWS ou GCP através dos fluxos de trabalho em `.github/workflows/deploy-tomoribot-{aws,gcp}.yml`, essas pipelines suportam um **snapshot pré-deploy opcional**: quando uma mensagem de commit contém o token literal `(Checkpoint)`, o fluxo de trabalho executa `aws rds create-db-snapshot` (ou o equivalente da GCP Cloud SQL) **antes** que qualquer código seja implantado e antes que o executor de migração toque no banco de dados durante a inicialização.

Use-o quando:

- Você estiver enviando uma migração que descarta uma coluna, descarta uma tabela, altera um tipo de coluna ou perde dados de outra forma (a política de migração destrutiva OD-R-6).
- Você estiver enviando um commit de bundle de versão que combina várias migrações e deseja um único ponto de reversão.
- Você não tiver certeza se uma migração na fila é segura — na dúvida, faça o checkpoint.

Pule isso em implantações de rotina não destrutivas (novas colunas, novos índices, dados adicionais de seed) — o snapshot tem um custo real e o caminho de rotina não precisa dele.

Exemplo de mensagem de commit:

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

O token `(Checkpoint)` pode aparecer em qualquer lugar no assunto ou no corpo — a correspondência faz distinção de maiúsculas e minúsculas contra a mensagem do head commit. O disparo manual do fluxo de trabalho com o input de backup ativado é a mesma alavanca para os casos ad-hoc.

## O que fazer se uma migração falhar no meio

Se o bot travar ou congelar durante a migração:

1. **Pare o bot imediatamente** — não deixe que ele tente as migrações às cegas de novo.

2. **Verifique os logs** — A TomoriBot registra no stdout/stderr por padrão (capturado pelo seu gerenciador de processos ou logs do Docker). Procure uma mensagem de erro indicando o nome da migração que falhou. Exemplo de saída:

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **Decida se deseja restaurar** — se o erro for irrecuperável (por exemplo, a migração tentou descartar uma coluna que não existe), restaure a partir de seu backup:

   ```bash
   # Restauração Opção A
   bun run restore-backup --latest

   # Ou Restauração Opção B
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **Reverta o código** — reverta para o último commit funcionando:

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   Use o hash que você salvou na etapa 3 da lista de verificação pré-pull, ou encontre-o com:

   ```bash
   git log --oneline | head -20
   ```

5. **Relate o bug** — abra uma issue em [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) com:
   - Nome do arquivo de migração com falha (dos logs)
   - Mensagem de erro completa
   - Hash do último commit com sucesso
   - Seu sistema operacional, versão do Bun (`bun --version`) e versão do PostgreSQL

## O que NÃO é auto-recuperável

De acordo com o design do projeto (OD-R-6), **migrações destrutivas não podem ser revertidas** pelo executor de migração. Exemplos:

- `DROP COLUMN name_here` — linhas excluídas são perdidas para sempre; nenhum script SQL pode recuperá-las
- `DROP TABLE old_table` — a tabela inteira é perdida
- Estreitamento de tipo (por exemplo, `VARCHAR(255) → VARCHAR(100)`) — valores maiores que 100 caracteres são truncados

Para essas operações, **a única recuperação é o seu backup**. Sempre faça backup antes do pull se você estiver em uma versão mais antiga e um novo refatoramento tiver sido lançado.

O design de ir apenas para frente do executor de migração é intencional: os arquivos de reversão (`.down.sql`) existem para a segurança do desenvolvedor durante os testes, mas a recuperação na produção depende de backups, e não da reexecução de operações irreversíveis.

## Testando uma branch de funcionalidade, e então voltando para a `main`

Um caso comum: alguém pede que você teste uma branch na sua instalação existente, e você quer saber se fazer o checkout da branch, inicializá-la e depois voltar para a `main` irá prejudicar seu banco de dados.

**Os fatos principais:**

- O Git e o PostgreSQL são mundos separados. `git checkout` apenas troca os arquivos no disco; ele nunca se conecta ou modifica o seu banco de dados. Seu estado de migração aplicada vive na tabela `schema_migrations`, não no git.
- Migrações são executadas **automaticamente na inicialização** (via `initializeDatabase.ts`), de modo que no momento em que você iniciar a branch, suas novas migrações serão aplicadas ao banco de dados para o qual você apontou.
- O executor para frente **nunca faz reversão automática**. Ao voltar para a `main`, ele varre os arquivos no disco, não encontra nada pendente e não faz nada. Migrações que a branch aplicou continuam aplicadas.

**Então, é seguro?** Depende inteiramente do que as migrações da branch fizeram:

- **Apenas aditivo** (novas tabelas / novas colunas) → seguro. Os novos objetos simplesmente ficam sem uso; o código da `main` nunca faz referência a eles, então eles não podem causar resultados incorretos ou falhas. Eles são um peso morto inofensivo.
- **Destrutivo** (`DROP`/`RENAME`/`ALTER` em uma tabela que a `main` ainda usa) → não seguro. A mudança da branch deixa o código da `main` trabalhando contra uma coluna/tabela que agora não existe mais ou foi alterada.

**A abordagem mais segura:** aponte a branch para um banco de dados descartável (um `POSTGRES_DB` separado), assim seus dados reais nunca serão tocados. Você já constrói a conexão a partir das variáveis `POSTGRES_*`, e o `bun run nuke-db` pode resetar um banco de dados de rascunho.

### Revertendo manualmente uma migração de teste

Se você testou uma branch contra o seu banco de dados **real** e deseja desfazer suas migrações em seguida, use o executor de rollback. Ao contrário do executor para frente, ele **nunca roda automaticamente** — o rollback é sempre um ato manual deliberado, já que os arquivos `.down.sql` tipicamente envolvem perda de dados.

```bash
# Apenas visualização (dry run): mostrar o que seria revertido
bun run migrate:down 034          # esta migração + todas as mais recentes aplicadas
bun run migrate:down --last       # apenas a migração mais recentemente aplicada
bun run migrate:down --last=2     # as duas migrações mais recentemente aplicadas

# Executar a reversão (roda os arquivos .down.sql, remove as linhas em schema_migrations)
bun run migrate:down 034 --yes
```

O comando executa os arquivos `.down.sql` selecionados em ordem de versão **decrescente** (para que as dependências de uma migração sejam desfeitas antes dela mesma), então exclui as linhas correspondentes em `schema_migrations`. Com essas linhas fora, o executor para frente reaplicará as migrações na próxima vez que você iniciar uma branch que ainda as ofereça.

> **Execute-o enquanto ainda estiver na branch.** O rollback lê os arquivos `NNN_description.down.sql` do disco. Assim que você fizer `git checkout main`, esses arquivos não estarão mais presentes e a reversão não poderá mais ser executada. Faça o rollback primeiro e depois troque de branch.

> **Ainda causa perda de dados.** Reverter `034` aqui executa o `DROP TABLE short_term_memories` — quaisquer dados criados durante o teste serão perdidos. Isso é o esperado para a limpeza de um teste, mas nunca execute `migrate:down` contra os dados que você deseja manter sem um backup.

## Veja também

- [Documentação do esquema de banco de dados](/en/architecture/subsystems/database-schema/): aprenda sobre a estrutura atual do esquema
- [Documentação do Bun](https://bun.sh) — conheça os fundamentos do runtime do Bun
