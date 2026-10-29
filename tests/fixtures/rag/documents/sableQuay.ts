import type { RagDocument } from "../types";

const dispatch = `The dispatch rider reached Sable Quay after the bridge at Low Fen washed out, and the town had already rearranged itself around the absence. Carts that once crossed the bridge waited at the ford, and the ford kept its own hours. The rider left her horse at the smithy and walked the last mile with the satchel under her coat.

Sable Quay is built on two levels. The upper level holds the customs house, the rope walk, and a row of houses whose roofs are pitched against the wind. The lower level is a single street that floods when the moon is full and drains through a grate nobody has cleaned since the quay was widened. Between the two levels runs a stair of forty-one steps, and the forty-first step is always wet.

The harbor master keeps a ledger of arrivals in a cabinet with a broken lock. She says the lock has been broken for so long that replacing it would count as a change in procedure, and changes in procedure require a meeting, and meetings require a clerk, and the clerk left for Veyra. The ledger itself is neat. Each arrival is entered with the vessel's name, the cargo, the number of hands, and a single word for the weather.

On the morning the rider arrived, the word for the weather was grey and the word for the cargo was lenses. Three crates of survey lenses had come down from the north on the Lantern Wren, and nobody could agree who had signed for them. The harbor master pointed to one line in the ledger. The ferry clerk pointed to another line. The rider opened the satchel, took out a folded paper, and read the weight of each crate aloud. The harbor master wrote the weights in the margin and the argument ended, mostly because the ferry clerk had already left for dinner.

The lower street was busy that evening. A rope seller had set up a table outside her door and was selling short lengths of line to children who wanted them for kites. A cook was frying fish in a pan propped on two bricks, and the smell followed the rider all the way to the customs house. At the customs house, a clerk with ink on both cuffs asked whether the rider had come about the lenses. The rider said she had come about the bridge. The clerk said the bridge was not his department.

The bridge, it turned out, was everyone's department and nobody's duty. The north road paid for it, the south road used it, and the quay collected the toll. A meeting had been scheduled for the following morning, and then postponed when the harbor master's chair broke. The rider spent the night on a bench in the customs house, under a blanket that smelled of rope, and wrote three letters before the lamp burned out. The first went to Veyra, the second to the north road office, and the third she burned because it was mostly complaint. By the time the bell rang, she had decided to walk to the ford and count the carts herself, one at a time, until someone agreed to rebuild the bridge or admit that the ford was now the road. She counted eleven carts before noon and wrote the number on the back of the bridge letter, then walked back to the quay to find someone who would read it.`;

const moorings = `## Mooring at the east quay

Boats may tie up along the east quay from the evening bell until the morning tide. The fee is paid at the customs house, and the harbor master hands over a wooden token with the berth number burned into it. Visiting crews are asked to leave the inner berths free for the ferry and to keep their lines clear of the fish crane. In spring tides the lower street floods, so anyone sleeping aboard should move to the outer posts before dark.`;

export const sableQuay = {
  key: "sable-quay",
  documentName: "Sable Quay dispatch",
  language: "en",
  scope: "persona",
  sourceText: `# Sable Quay dispatch

${dispatch}

${moorings}`,
  passages: [
    { key: "sable-quay.dispatch", text: dispatch },
    { key: "sable-quay.moorings", text: moorings },
  ],
} as const satisfies RagDocument;
