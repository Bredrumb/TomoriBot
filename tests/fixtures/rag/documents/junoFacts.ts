import type { RagDocument } from "../types";

const compass = "Juno keeps a brass compass in her coat pocket and checks it whenever the weather turns.";
const chandlery =
  "The chandlery on the north quay still smells of brine after the salt shipment spilled across the steps.";
const crane = "Bau repaired the west crane with a coil spring borrowed from the mill and returned it the next morning.";
const bow = "Pell paints the ferry's name on the bow every spring and refuses to charge for the second coat.";
const oil = "The north light burns lamp oil from the Ashglass store, and the keeper orders it by the barrel.";
const ledger = "Pell keeps the ferry ledger under the ticket window and marks unpaid fares with a small cross.";
const letters =
  "Juno sends Pell a letter whenever a ship from the southern reach arrives, even if the letter is only three lines long.";

// A history import stores one extracted fact per chunk, so these passages are self-contained sentences instead of sections.
const facts = [compass, chandlery, crane, bow, oil, ledger, letters];

export const junoFacts = {
  key: "juno-facts",
  documentName: "North light channel notes",
  language: "en",
  scope: "persona",
  sourceText: facts.join("\n\n"),
  passages: [
    { key: "juno-facts.compass", text: compass },
    { key: "juno-facts.chandlery", text: chandlery },
    { key: "juno-facts.crane", text: crane },
    { key: "juno-facts.bow", text: bow },
    { key: "juno-facts.oil", text: oil },
    { key: "juno-facts.ledger", text: ledger },
    { key: "juno-facts.letters", text: letters },
  ],
} as const satisfies RagDocument;
