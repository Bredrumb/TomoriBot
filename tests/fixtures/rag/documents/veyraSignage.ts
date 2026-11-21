import type { RagDocument } from "../types";

const harbor = `## Harbor gate sign

The gate carries the same notice in seven languages. The English line reads "Tie up beyond the second post. The inner berths belong to the ferry." The Japanese line reads 「二本目の杭より先に係留してください。内側の船着き場は連絡船のものです。」 The Chinese line reads 「请系泊在第二根木桩之外。内侧泊位属于渡船。」 The Russian line reads «Швартуйтесь дальше второго столба. Внутренние места принадлежат парому.» The Portuguese line reads "Amarre depois do segundo poste. As vagas internas são do barco de passagem." The Spanish line reads "Amarre después del segundo poste. Los amarres interiores son del transbordador." The Vietnamese line reads "Hãy buộc thuyền qua cọc thứ hai. Các chỗ neo bên trong dành cho phà."`;

const archive = `## Archive door sign

The archive door carries a shorter notice: "Quiet after the second bell. Coats stay in the entry. The reading room closes when the lamps are trimmed." The Japanese copy below it reads 「二度目の鐘のあとは静かに。」 and the Russian copy reads «После второго звонка соблюдайте тишину.»`;

export const veyraSignage = {
  key: "veyra-signage",
  documentName: "Veyra harbor signage",
  language: "en",
  scope: "serverwide",
  sourceText: `# Veyra harbor signage

${harbor}

${archive}`,
  passages: [
    { key: "veyra-signage.harbor", text: harbor },
    { key: "veyra-signage.archive", text: archive },
  ],
} as const satisfies RagDocument;
