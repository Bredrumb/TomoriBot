import type { RagDocument } from "../types";

const farola = `## La farola de Peñalta

La farola de Peñalta se levanta sobre una roca que el agua cubre en marea alta. Cada tarde, la torre gira su lente y el haz de luz cruza la costa hasta la punta de Sargal. Los pescadores dicen que la farola tiene más años que el muelle y que su escalera nunca se ha mojado.`;

const keeper = `## La torre del norte

La torre del norte funciona con aceite de oliva y una mecha ancha. La encargada sube dos veces por noche, una al anochecer y otra antes de que cambie la marea. Si el viento sopla del sur, la lente se empaña y hay que limpiarla con un paño de lino.`;

const mercado = `## El mercado de la sal

Las cajas llegan antes que el sol y se colocan en filas sobre el muelle. Los compradores prueban el pescado con la punta del cuchillo y pagan al final de la mañana. Una campana pequeña marca el cierre, y entonces las cajas vacías se apilan junto al agua.`;

export const costaBrasa = {
  key: "costa-brasa",
  documentName: "Costa Brasa",
  language: "es",
  scope: "persona",
  sourceText: `# Costa Brasa

${farola}

${keeper}

${mercado}`,
  passages: [
    { key: "costa-brasa.farola", text: farola },
    { key: "costa-brasa.keeper", text: keeper },
    { key: "costa-brasa.mercado", text: mercado },
  ],
} as const satisfies RagDocument;
