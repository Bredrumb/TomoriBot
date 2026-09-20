---
title: "Voz: TTS & STT"
sidebar:
  order: 3
---

A TomoriBot pode **falar** (texto-para-fala) e **ouvir** (fala-para-texto):

- **TTS** permite que ela responda com mensagens de voz nativas do Discord.
- **STT** converte anexos de áudio dos usuários em texto que ela pode usar como contexto de conversa.

Ambos funcionam pelo mesmo sistema de endpoints. O caminho mais rápido é o **ElevenLabs** (nuvem,
documentado na íntegra abaixo). Se você preferir executar a voz em seu próprio hardware, use um motor local
e siga os guias de hospedagem própria.

## Texto-para-Fala {#text-to-speech}

### ElevenLabs (nuvem, mais fácil)

1. Obtenha uma chave de API em [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Execute `/providers`, escolha **Add New Provider**, selecione **ElevenLabs** e cole a chave. Esse fluxo:
   - registra o endpoint de **fala** do ElevenLabs (e o endpoint de **transcrição** também),
   - seleciona-os como ativos,
   - pode atribuir uma voz a uma persona na hora.
3. Atribua vozes a personas adicionais em Persona > Voice no `/config`. Explore vozes na
   [Biblioteca de Vozes do ElevenLabs](https://elevenlabs.io/app/voice-library), onde você também pode
   clonar a sua própria.

Selecione ElevenLabs em `/providers` e escolha **Edit Endpoint** sempre que precisar atualizar a chave.

Observações:

- No **plano gratuito, apenas vozes pré-fabricadas funcionam**. Explore a
  [lista de vozes pré-fabricadas](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Caracteres são contados quando ela gera e lê mensagens de voz; o nível gratuito tem
  limites mensais; verifique seu painel do ElevenLabs.
- Respostas de voz são controladas por `voice_message_enabled` e exigem que a persona ativa tenha uma
  voz atribuída.
- Persona > Voice no `/config` requer Gerenciar Servidor em uma guilda e permanece disponível para o dono em um workspace baseado em DM.

No `/help`, escolha **Features** e depois **Speech** para o mesmo passo a passo no Discord.

### Motores locais de clonagem de voz (hospedagem própria)

Em uma instância de hospedagem própria, você pode executar um servidor local de clonagem de voz. O fluxo geral é:
iniciar o servidor wrapper, registrar sua conexão e modelo com `/providers`, selecioná-lo com
`/providers`, enviar uma amostra com `/config` em Models > TTS Parameters & Voices, e então atribuí-lo em
Persona > Voice no `/config`. Qualquer formato de áudio é aceito (convertido automaticamente para WAV mono); clipes de 10-20
segundos sem música de fundo funcionam melhor.

Cada motor tem seu próprio guia de configuração:

- [Chatterbox-Turbo/Nano](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/): clonagem de voz rápida, apenas em inglês, com tags de evento suportadas como `[laugh]`.
- [Qwen3-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/qwen3tts/): multilíngue (10 idiomas), além de um
  modo VoiceDesign em linguagem natural.
- [MOSS-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/moss/): endpoint automático experimental para clonagem multilíngue ou design de voz em inglês/chinês.
- [IrodoriTTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/irodoritts/): especializado em japonês, lê emojis
  como pistas de emoção.

Veja a [tabela comparativa de Texto-para-Fala](/pt-BR/self-hosting/local-endpoints/text-to-speech/) para a lista completa e orientações de hardware.

## Fala-para-Texto {#speech-to-text}

Endpoints de transcrição convertem anexos de áudio dos usuários em texto para contexto de conversa
em segundo plano. Se as transcrições são **exibidas visivelmente** no chat é controlado separadamente por
`/config` > Engine > Notices.

### ElevenLabs (nuvem)

Já coberto acima: adicionar o ElevenLabs a partir de `/providers` registra o endpoint de transcrição junto com o de
fala. Use `/providers` para escolher entre endpoints de transcrição.

### Motores locais (hospedagem própria)

- [WhisperX](/pt-BR/self-hosting/local-endpoints/speech-to-text/whisperx/): o caminho local recomendado; ~100
  idiomas, acelerado por GPU, múltiplos tamanhos de modelo.
- [KoboldCPP](/pt-BR/self-hosting/local-endpoints/speech-to-text/koboldcpp/): funciona se sua build expõe um
  endpoint de transcrição compatível com OpenAI.
- [whisper.cpp](/pt-BR/self-hosting/local-endpoints/speech-to-text/whispercpp/).

Veja o hub de [Fala-para-Texto](/pt-BR/self-hosting/local-endpoints/speech-to-text/) para a lista completa. Para o
resumo no Discord, execute `/help`, depois escolha **Features** e **Transcription**.
