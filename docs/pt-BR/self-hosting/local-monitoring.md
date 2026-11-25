---
title: Monitoramento Local com Grafana
sidebar:
  order: 6
aiGenerated: true
---

Monitore sua instância TomoriBot local com painéis Grafana pré-construídos para rastrear o uso de memória, tamanhos de cache, consumo de token e tráfego de comando.

Adicione uma senha do Grafana ao `.env`. O Compose recusa os comandos de monitoramento sem ela, porque a conexão do Grafana com o banco de dados tem acesso total aos seus dados:

```sh
GRAFANA_PASSWORD=choose-a-long-random-password
```

Inicie TomoriBot e Grafana juntos:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Isso inicia o TomoriBot, o PostgreSQL e o Grafana com o painel Visão geral do TomoriBot.

Abra o Grafana em [http://localhost:3000](http://localhost:3000):
- **Nome de usuário**: `admin`
- **Senha**: o valor de `GRAFANA_PASSWORD` no `.env`

O Grafana só aceita conexões do computador que executa o Docker. Para abri-lo de outro computador, encaminhe a porta por SSH com `ssh -L 3000:localhost:3000 <user>@<host>` e depois acesse `http://localhost:3000` no seu próprio computador.

Se você iniciou o Grafana antes de ele exigir uma senha, ele manteve a senha que salvou da primeira vez. Entre com essa senha (`admin` se você nunca definiu uma) e depois altere-a no seu perfil do Grafana.

## O dashboard provisionado

O painel Visão geral do TomoriBot é carregado automaticamente sem configuração manual. Seus painéis exibem memória de processo, contagens de entrada de cache, erros por hora, uso de token por modelo, atividade horária, comandos principais, localidades de usuário, uma nuvem de emoções e predefinições e modelos ativos.

Cada painel consulta tabelas padrão presentes em todas as instalações, permitindo que o mesmo layout de painel funcione localmente e em ambientes de nuvem.

Certos painéis requerem configurações de tempo de execução específicas ou suporte de host:

| Painel | Precisa |
|---|---|
| Memória de processo, entradas de cache | Linhas `metric_samples` gravadas em cada `CACHE_METRICS_INTERVAL_MS`. O coletor é executado somente quando `RUN_ENV=production`, portanto, uma instância de desenvolvimento não exibe dados aqui. |
| Erros por hora por tipo | `ERROR_DB_LOGGING_ENABLED` (habilitado por padrão). Uma linha plana durante um incidente pode indicar que o disjuntor do banco de dados está aberto, em vez de os erros terem cessado. |
| Memória do host e níveis de troca, pressão do host (PSI) e taxa de troca | Um host Linux. Eles são `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` e `/sys/block/zram0`, portanto permanecem vazios no macOS e no Windows. A série zram requer um dispositivo de troca zram configurado; hosts sem zram ainda relatam métricas gerais de memória e pressão. |

## Editando e salvando alterações

Os painéis permanecem editáveis na interface Grafana para depuração ao vivo. Como as reinicializações do contêiner redefinem as edições do painel de volta aos arquivos do disco, exporte o JSON do painel modificado e salve-o em `docker/grafana/dashboards/` para manter suas alterações.

Para adicionar um novo painel, coloque sua definição JSON em `docker/grafana/dashboards/`. Direcione a fonte de dados PostgreSQL com o uid fixo `tomoribot-postgres`: as fontes de dados sem um uid explícito recebem identificadores gerados aleatoriamente, o que faz com que os painéis que usam uids incompatíveis renderizem painéis em branco.
