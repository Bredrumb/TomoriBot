---
title: "Puente de Matrix"
sidebar:
  order: 1
---

TomoriBot puede conectar una **sala de Matrix** con un canal de Discord: las personas chatean
desde Matrix, sus mensajes se retransmiten a Discord como mensajes de webhook, y ella responde
de vuelta en la sala de Matrix. Esta página es el lado del usuario del puente. Para los detalles
internos del appservice, consulta la
[arquitectura del puente de Matrix](/en/architecture/integrations/matrix/bridge/).

## Configuración

1. Invita a la cuenta de bot de Matrix configurada a una sala de Matrix **sin cifrar**.
2. Copia el **ID de sala interno** de esa sala.
3. Ejecuta `/matrix link` en el canal de Discord que quieres conectar, y pega el ID de sala.

Después de que el bot acepta la invitación, publica un breve recordatorio en la sala de Matrix,
pero de todos modos debes terminar de vincular desde Discord con `/matrix link`.

### Encontrar el ID de sala

En la mayoría de los clientes de Matrix: **Configuración de sala → Avanzado → ID de sala
interno**. Se ve así: `!abc:matrix.org`.

## Usarlo desde Matrix

- Chatea con normalidad una vez que la sala está vinculada; los mensajes de Matrix se
  retransmiten al canal de Discord.
- Ella responde de vuelta en la sala de Matrix.
- Los únicos comandos de texto de Matrix son `/kill` y `/refresh`.

## Limitaciones actuales

- No hay comandos de barra desde Matrix (más allá de `/kill` y `/refresh`).
- No hay mensajes directos ni recordatorios de enfriamiento basados en mensajes directos.
- Las fotos de perfil de Matrix no son visibles para ella.
- No se pueden fijar mensajes.
- Los emojis personalizados y el Markdown no se renderizan de forma confiable; los embeds se
  retransmiten como texto plano.
- Las memorias personales de usuarios de Matrix recurren a memorias del servidor atribuidas.

## Notas

- Si el bot no se une automáticamente, invita a la cuenta de bot de Matrix manualmente y vuelve
  a ejecutar `/matrix link`.
- **El cifrado de Matrix no se puede desactivar después**: una sala cifrada debe reemplazarse
  por una nueva sala sin cifrar.
- Si alguna limitación no está en la lista de arriba, asume que debería funcionar y reporta
  errores en el servidor de soporte (`/support discord`).

En `/help`, elige **Integraciones** y luego **Matrix**, para ver la misma guía en Discord.
