import type { RagDocument } from "../types";

const opening = `## しおつむぎの由来

しおつむぎとは、月湊灯台のふもとでおこなわれる潮の巡りを祝う行事で使われる縄のことである。潮に濡らした麻糸を三つ編みにして作り、氏子たちは夜明け前に岸へ降りて、できあがった縄を岩の間に張る。糸が切れないように、年長の氏子が風向きを読みながら順番を指示する。`;

const rite = `## つむぎうた

儀式のあいだ、参列者は「つむぎうた」と呼ばれる短い歌を三度うたう。歌詞は海の状態に合わせて少しずつ変わり、最後の一節はその年のいちばん長い潮に合わせて選ばれる。笛は使わず、手拍子だけで拍子をとる。`;

const mio = `## 澪のこと

澪はこの港で生まれた灯守りで、灯りを絶やさないために冬のあいだは灯屋の下の小屋に住んでいる。澪は言葉が少なく、挨拶の代わりに灯りの状態を報告する。澪の作る潮の模様は、参列者が持ち帰る小さな布に縫い取られる。`;

const invitation = `## 案内

潮織りの当日は港の広場に午前五時に集まる。雨の場合は灯屋の広間でおこなう。参加は自由だが、麻糸を持ち寄れる人は持ってきてほしい。`;

export const shioTsumugi = {
  key: "shio-tsumugi",
  documentName: "潮織りの記録",
  language: "ja",
  scope: "serverwide",
  sourceText: `# 潮織りの記録

${opening}

${rite}

${mio}

${invitation}`,
  passages: [
    { key: "shio-tsumugi.opening", text: opening },
    { key: "shio-tsumugi.rite", text: rite },
    { key: "shio-tsumugi.mio", text: mio },
    { key: "shio-tsumugi.invitation", text: invitation },
  ],
} as const satisfies RagDocument;
