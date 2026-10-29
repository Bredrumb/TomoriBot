import type { RagDocument } from "../types";

const harbor = `## 望潮港

望潮港位于群岛东侧，港口最窄处只容两条渔船并排通过。退潮时，滩涂上会露出一排旧石桩，据说是早年间灯塔的基座。守灯人每天傍晚沿海岸走一圈，把漂上岸的海草清理干净。`;

const keeper = `## 守灯人岚

岚是港口的守灯人，十九岁那年从外祖母手里接过灯塔的钥匙。岚习惯把每天的潮位写在旧账本的空白处，再折成小船放进抽屉。港里的人说，岚记得每一艘夜航船回港的时辰。`;

const ledger = `## 账本的规矩

旧账本只记潮位和灯油，不记人名。每页右下角要写上当天的风向，写错的行不撕掉，只在旁边画一条细线。灯油不够时，账本会被带到仓库，由守灯人当面点数，再在最后一页记下差额。`;

export const lanternLedger = {
  key: "lantern-ledger",
  documentName: "望潮港灯塔账本",
  language: "zh-Hans",
  scope: "persona",
  sourceText: `# 望潮港灯塔账本

${harbor}

${keeper}

${ledger}`,
  passages: [
    { key: "lantern-ledger.harbor", text: harbor },
    { key: "lantern-ledger.keeper", text: keeper },
    { key: "lantern-ledger.ledger", text: ledger },
  ],
} as const satisfies RagDocument;
