import type { RagDocument } from "../types";

const chapel = `## A maré da Conceição

Na capela da Conceição, a maré é medida por uma corda com nós. A guardiã da capela sobe ao campanário antes do amanhecer e conta os nós em voz alta, para que o sacristão anote o número no livro. Quando a corda fica molhada até o quinto nó, as famílias recolhem as redes e voltam para casa.`;

const boats = `## Barcos e redes

Os barcos do porto saem antes do sol e voltam com a maré. As redes ficam estendidas no muro da capela até secarem, e quem passa deve desviar para não pisar no fio. Ao domingo, a guardiã troca a corda dos nós por uma fita nova e guarda a antiga numa caixa de madeira.`;

const notes = `## Notas da guardiã

A corda dos nós foi trocada três vezes desde que a capela recebeu o sino. A guardiã guarda as pontas antigas num baú, junto com as listas de nomes das procissões. Ninguém sabe quem doou o primeiro sino, mas a inscrição na base diz apenas "para quem volta do mar".`;

export const conceicaoTide = {
  key: "conceicao-tide",
  documentName: "Crônica da capela",
  language: "pt",
  scope: "serverwide",
  sourceText: `# Crônica da capela

${chapel}

${boats}

${notes}`,
  passages: [
    { key: "conceicao-tide.chapel", text: chapel },
    { key: "conceicao-tide.boats", text: boats },
    { key: "conceicao-tide.notes", text: notes },
  ],
} as const satisfies RagDocument;
