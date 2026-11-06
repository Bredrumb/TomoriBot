---
title: "Transcrição WhisperX"
sidebar:
  order: 1
aiGenerated: true
---

Configure fala para texto local e precisa para TomoriBot usando o servidor [WhisperX](https://github.com/m-bain/whisperX) incluído. WhisperX fornece transcrição de áudio rápida com alinhamento em nível de palavra.

## Configuração

Execute estes comandos na raiz do repositório TomoriBot:

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

Mantenha esse terminal aberto enquanto TomoriBot estiver usando WhisperX. O URL do endpoint padrão é `http://127.0.0.1:8021`. No Windows, use `127.0.0.1` em vez de `localhost`.

## Escolher um modelo

Defina `WHISPERX_MODEL` antes de iniciar o servidor.

| `WHISPERX_MODEL` | Tamanho | Uso |
|---|---|---|
| `large-v3` | 1,55B | Melhor precisão multilíngue; cerca de 0,6 GiB a mais de VRAM que o turbo |
| `large-v3-turbo` | 809M | Multilíngue, decodificador mais rápido; japonês ligeiramente inferior |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | Apenas japonês; mais preciso que o turbo em clipes de teste em japonês, na mesma velocidade |

Em clipes curtos o codificador predomina, então todos os três rodam em velocidade semelhante. Escolha pelo idioma e pela VRAM. `small` e `base` perdem muita precisão em japonês para serem recomendados. Os modelos Whisper ainda podem inventar texto em clipes muito curtos ou quase silenciosos.

## GPU

O servidor usa uma GPU NVIDIA automaticamente quando houver uma disponível. Verifique `http://127.0.0.1:8021/health`: `device` deve exibir `cuda`. No Windows, o reconhecimento de fala precisa das DLLs cuBLAS e cuDNN do CUDA 12 no seu `PATH`. Sem elas, o servidor exibirá `GPU found but unusable` na inicialização e rodará na CPU, o que é muito mais lento: instale-as e reinicie o servidor. Se você definir `WHISPERX_DEVICE=cuda`, o servidor será interrompido na inicialização em vez disso.

## Registrar na TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado`, e use a compatibilidade da API de transcrição:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Depois de salvar a conexão, selecione-a e use o menu suspenso de modelo para adicionar o valor exato de `WHISPERX_MODEL` (`large-v3` por padrão, ou o ID completo do repositório como `kotoba-tech/kotoba-whisper-v2.0-faster`) como um modelo de Transcrição.

Use `/providers` para o registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Usar transcrições

Após o registro, TomoriBot transcreve anexos de áudio em segundo plano e adiciona o texto ao contexto do bate-papo. Use `/config` > Comportamento > Comportamento de Avisos somente se você também quiser que as transcrições sejam postadas de forma visível no bate-papo.
