import type { RagDocument } from "../types";

const allocationSheet = `## Allocation sheet

| berth | vessel | cargo | notes |
|---|---|---|---|
| A-1 | Patient Heron | salt cod | short stay, crew of four |
| A-2 | Glasswing Ferry | mail and passengers | morning departure |`;

const longCargo = [
  "forty crates of salted plums",
  "twelve barrels of lamp oil",
  "nine bundles of hempen rope",
  "six cases of glass chimneys",
  "four crates of brass fittings",
  "three sacks of cork shavings",
  "two boxes of tide tables",
  "one sealed chest of chart paper",
  "eight tins of black paint",
  "five coils of tarred line",
  "seven crates of dried kelp",
  "eleven sacks of ship biscuit",
  "sixteen jars of pickled limes",
  "four bales of sailcloth",
  "three crates of iron nails",
  "two crates of copper wire",
  "one case of survey lenses",
  "nine bars of pig iron",
  "four kegs of resin",
  "six bundles of cedar shingles",
  "two hundred empty glass bottles",
  "five crates of dried figs",
  "three rolls of lead sheeting",
  "six bags of plaster",
  "one crate of lamp wicks",
  "four boxes of soap",
  "eight jars of ink",
  "two bundles of quills",
  "three crates of rope twine",
  "five sacks of charcoal",
].join(", ");

const longNotes = [
  "berthed until the next low tide",
  "the clerk counted every item twice",
  "the manifest had been copied by three hands",
  "none of the counts agreed",
  "the vessel's master signed with a thumbprint",
  "two crates were moved to the bonded shed",
  "the harbor master wants a second copy for the south file",
  "no cargo may leave before the ferry departs",
  "the crew asked for fresh water and a coil of rope",
  "the Lantern Wren carries a spare lens in the stern locker",
  "the customs seal was checked at the gate",
  "the last line of the manifest is written in a different hand",
  "the manifest lists a fourth hand in the margin",
  "the bonded shed key is with the ferry clerk",
  "the crew will return for the empty crates",
].join("; ");

const longRow = `| B-7 | Lantern Wren | ${longCargo} | ${longNotes} |`;

const clerkNotes = `## Clerk's notes

Berths are reassigned at the evening bell. The clerk keeps the allocation sheet under a pane of glass and updates it in pencil, so a late arrival can be squeezed into a berth without rewriting the day's page.`;

export const caldorLedger = {
  key: "caldor-ledger",
  documentName: "Caldor port ledger",
  language: "en",
  scope: "serverwide",
  sourceText: `# Caldor port ledger

${allocationSheet}
${longRow}

${clerkNotes}`,
  passages: [
    { key: "caldor-ledger.allocation-sheet", text: allocationSheet },
    { key: "caldor-ledger.long-row", text: longRow },
    { key: "caldor-ledger.clerk-notes", text: clerkNotes },
  ],
} as const satisfies RagDocument;
