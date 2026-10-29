import type { RagDocument } from "../types";

const veyra = `## Veyra

Veyra keeps the archive and the north quay. Sailors call the town "the reading light" because the archive lamp stays on after the harbor lamps are trimmed. In the local dialect the archive is 灯の蔵, and the ferry landing is 北の波止場.`;

const vetroboy = `## Vetroboy

Vetroboy sits on the north shore, where the wind arrives before the weather does. Its lamp is called «Ветробой» in the old fishing songs, and the keeper's house is known simply as «белый дом». The ferry from Veyra stops there when the ice allows it.`;

const south = `## The southern reach

The southern reach holds three anchorages with no permanent keeper: Mirra's landing, a stone shelf that dries at low water, and a river mouth that moves a little every winter. Charts of the reach are redrawn by the archive every few seasons, and the ferry clerks are told to trust the newest copy.`;

export const lumenGazetteer = {
  key: "lumen-gazetteer",
  documentName: "Lumen Reach gazetteer",
  language: "en",
  scope: "serverwide",
  sourceText: `# Lumen Reach gazetteer

${veyra}

${vetroboy}

${south}`,
  passages: [
    { key: "lumen-gazetteer.veyra", text: veyra },
    { key: "lumen-gazetteer.vetroboy", text: vetroboy },
    { key: "lumen-gazetteer.south", text: south },
  ],
} as const satisfies RagDocument;
