---
title: Monitoramento Local com Grafana
sidebar:
  order: 7
---

Você pode monitorar sua instância local do TomoriBot com dashboards do Grafana usando um perfil fornecido do Docker Compose.

Para iniciar o TomoriBot e o Grafana juntos em sua máquina:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Isso irá:
- Iniciar o TomoriBot com PostgreSQL (na porta 15432 para o BD)
- Iniciar o Grafana na porta 3000 com uma fonte de dados PostgreSQL autoconfigurada
- Provisionar o dashboard **TomoriBot Overview**
- Conectar ambos os serviços na mesma rede Docker

Acesse o Grafana em [http://localhost:3000](http://localhost:3000):
- **Usuário**: `admin`
- **Senha**: Definida via `GRAFANA_PASSWORD` em `.env` (o padrão é `admin` se não for definida)

## O dashboard provisionado

O **TomoriBot Overview** aparece automaticamente e não precisa de configuração. Seus painéis cobrem a memória do processo, contagens de entradas em cache, erros por hora, uso de tokens por modelo, atividade por hora, principais comandos, localidades dos usuários, uma nuvem de emoções, e quais predefinições e modelos estão em uso.

Cada painel lê apenas tabelas que existem em qualquer instalação, de modo que o mesmo dashboard funciona tanto em hospedagem própria quanto em uma implantação na nuvem.

Alguns painéis permanecem vazios até que sua fonte seja ativada:

| Painel | Necessita |
|---|---|
| Process Memory, Cache Entries | Linhas `metric_samples`, gravadas a cada `CACHE_METRICS_INTERVAL_MS`. O coletor só roda quando `RUN_ENV=production`, então uma instância de desenvolvimento não mostra nada aqui. |
| Errors per Hour by Type | `ERROR_DB_LOGGING_ENABLED` (ativado por padrão). Uma linha plana durante um incidente suspeito também pode significar que o *circuit breaker* do repositório está aberto, e não que os erros pararam. |
| Host Memory and Swap Tiers, Host Pressure (PSI) and Swap-In Rate | Um host Linux. Estes leem `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` e `/sys/block/zram0`, então permanecem vazios no macOS e Windows. A série zram também precisa de um dispositivo de swap zram; um host sem um ainda reporta a memória e o PSI. |

## Editando e salvando alterações

Os dashboards permanecem editáveis na interface do usuário (UI), o que é importante durante um incidente. As edições existem apenas no contêiner e são substituídas pelo arquivo em disco no próximo reinício, então exporte o JSON de um dashboard e faça o *commit* dele em `docker/grafana/dashboards/` para manter uma alteração.

Adicionar seu próprio dashboard significa colocar um arquivo JSON nesse mesmo diretório. Faça referência à fonte de dados pelo seu `uid` fixo `tomoribot-postgres`: o Grafana atribui um `uid` aleatório quando uma fonte de dados não declara nenhum, e um dashboard apontando para um `uid` aleatório renderiza painéis vazios em vez de um erro.
