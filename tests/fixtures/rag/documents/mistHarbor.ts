import type { RagDocument } from "../types";

const pier = `## 霧港

霧港的碼頭在冬天多半浸在霧裡，漁船靠岸時要先敲三下木樁，讓岸上的人知道船到了。港邊的石階被潮水磨得發亮，清晨常有一位老人提著銅壺，替等候的人倒熱水。`;

const lantern = `## 北岸燈樓

北岸燈樓的燈窗朝西，為的是讓從外海回來的船早一點看見光。守燈人棠每天日落前擦一遍燈窗，再把當天的風向記在門後的木板上。棠說，燈樓不怕風大，只怕有人忘了添油。`;

const rules = `## 守燈規矩

鑰匙只有兩把，一把在守燈人手裡，一把掛在港務所的第三個抽屜。換班時要當面點清燈油，並且把上一班的紀錄讀一遍。若遇濃霧，必須每半個時辰敲一次銅鐘，直到霧散為止。`;

export const mistHarbor = {
  key: "mist-harbor",
  documentName: "霧港雜記",
  language: "zh-Hant",
  scope: "serverwide",
  sourceText: `# 霧港雜記

${pier}

${lantern}

${rules}`,
  passages: [
    { key: "mist-harbor.pier", text: pier },
    { key: "mist-harbor.lantern", text: lantern },
    { key: "mist-harbor.rules", text: rules },
  ],
} as const satisfies RagDocument;
