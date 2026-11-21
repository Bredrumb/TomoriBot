import type { RagDocument } from "../types";

const readingRoom = `## The reading room

Mirri Vell catalogs every tide chart that reaches the archive and refuses to file one she has not read twice. She keeps a brass ruler in her sleeve and a list of gaps in the north wall where damp gets in.`;

const shelving = `#### Shelving rules

- Tide charts go in the long cabinet under the window, sorted by the month they describe
  rather than the month they arrive.
  - Charts older than three crossings are folded twice and tied with linen,
    because the paper cracks when it bends a third time.
  - Duplicates stay in the drawer labelled "second copies" until someone asks for the original.
- Ledgers stay on the mezzanine and never travel.
  - The archive ledger records every loan, including loans that were returned before the ink dried.
- Blank paper lives in the map chest, under the spare weights.`;

const lodging = `## Where visitors stay

The Tidewright hostel above the chandlery keeps six narrow rooms for travelers who arrive after the ferry stops. The keeper leaves a lamp in the stairwell and does not ask for payment until morning. Rooms face the inner courtyard, so the harbor bell is muffled but never silent.`;

const ferry = `## The Glasswing Ferry

Departs from the north quay at first light and returns before the evening bell. Tickets are sold at the chandlery window, and the crossing takes a little under two hours when the wind is kind.`;

export const veyraArchive = {
  key: "veyra-archive",
  documentName: "Veyra Archive field notes",
  language: "en",
  scope: "persona",
  sourceText: `# Veyra Archive field notes

${readingRoom}

${shelving}

${lodging}

${ferry}`,
  passages: [
    { key: "veyra-archive.reading-room", text: readingRoom },
    { key: "veyra-archive.shelving", text: shelving },
    { key: "veyra-archive.lodging", text: lodging },
    { key: "veyra-archive.ferry", text: ferry },
  ],
} as const satisfies RagDocument;
