---
title: "Memoria a corto plazo"
sidebar:
  order: 5
aiGenerated: false
---

TomoriBot lee los mensajes recientes en el canal activo. La memoria a corto plazo (STM) amplía esto manteniendo
un contexto de trabajo temporal:

- **Contexto del canal:** Refuerza el tema o la situación en curso en el canal actual.
- **Contexto entre canales:** Recuerda conversaciones recientes de otros canales, y entre servidores cuando el
  recuerdo entre servidores está habilitado.

Ella solo recuerda las conversaciones en las que participó. Solo actualiza el resumen de un canal cuando responde,
y en ningún otro momento, por lo que un canal concurrido donde nadie habla con ella no deja ninguna memoria. La
memoria a corto plazo de cada canal caduca después de 24 horas de forma predeterminada. Si optas por no participar
en `/personal config`, tus mensajes quedan excluidos de la memoria a corto plazo.

La memoria a corto plazo reciente y la memoria que contiene contenido de otros canales se ubican justo arriba de los
cuatro turnos de diálogo más recientes. La memoria más antigua de este canal permanece arriba de la conversación en
el ajuste predeterminado. Una profundidad menor configurada puede mantener el contenido más cerca del mensaje más
reciente. Consulta [Dentro del prompt](/features/knowledge/inside-the-prompt/) para ver el diseño completo.

## Ejemplo entre canales

- **Canales públicos:** Hablas sobre una recomendación de álbum con TomoriBot en `#music`. Unos minutos más tarde en
  `#general`, le preguntas qué álbum sugirió. Debido a que respondió en `#music`, recuerda ese contexto en `#general`.
- **Canales privados:** Si esa conversación ocurrió en un canal privado, ella no la recordará en `#general`. Los
  resúmenes de canales privados permanecen aislados a menos que un administrador habilite la Omisión de privacidad de STM
  en `/config` > `Permisos`.

## Administrar la memoria a corto plazo
<!-- anchor: managing-short-term-memory -->

Puedes ver o corregir el resumen del canal actual en `/config` > `Persona` > `Memorias`. Los administradores del
servidor pueden ajustar los parámetros o deshabilitar la memoria a corto plazo en `/config` > `Comportamiento` >
`Memoria avanzada`, y revisar o borrar los resúmenes de canales activos en `/memories` > `Corto plazo`.
`/refresh` borra la memoria del canal actual.
