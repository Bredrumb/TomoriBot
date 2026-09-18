---
title: "Estadísticas e información"
sidebar:
  order: 4
---

TomoriBot registra el uso para que puedas ver quién habla con quién, qué personas y modelos se
usan, y qué herramientas se activan; luego lo convierte en una infografía para compartir.

## Paneles de texto

Tres comandos abren un panel interactivo con pestañas (Resumen, Personas, Modelos y costo,
Herramientas y comandos, Expresión, Personas favoritas, Tabla de clasificación):

Las pestañas de texto son paneles públicos duraderos controlados por quien los invocó.
Permanecen disponibles hasta que se elimina el mensaje, y otro usuario no puede operar los
controles.

- `/stats personal`: tu propio uso.
- `/stats persona`: el uso de una persona en este servidor.
- `/stats server`: el uso de todo el servidor.

La mayoría admite una ventana de **período**, y las estadísticas personales pueden limitarse a
este servidor o abarcar todos los servidores.

:::note
Los **conteos de tokens** son el uso reportado por el propio proveedor cuando está disponible
(se usa una estimación basada en caracteres solo para proveedores que no reportan ninguno). El
**costo** valora esos tokens a las tarifas de lista del catálogo de modelos, así que puede
diferir de tu factura real (caché de prompts, descuentos, cuotas de nivel gratuito, etc.).
:::

## Tarjetas de infografía para compartir

`/stats generate` genera una tarjeta de imagen pulida que puedes soltar en el chat:

- **Resumen personal del año**: tu actividad personal, al estilo Spotify Wrapped.
- **Afinidad de persona**: las estadísticas de una persona en este servidor.
- **Tabla de clasificación del servidor**: posiciones a nivel de todo el servidor.

Los usuarios con privacidad total (`/personal config`) no pueden generar tarjetas personales.

Para saber cómo se componen y renderizan las tarjetas, consulta la referencia de arquitectura
del [subsistema de infografía de estadísticas](/en/architecture/subsystems/stats-infographic/).
