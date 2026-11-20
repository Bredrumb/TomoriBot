import type { RagDocument } from "../types";

const harbor = `## Vịnh Trăng

Vịnh Trăng là một vịnh nhỏ ở phía nam quần đảo, nơi nước biển đổi màu theo từng con nước. Người dân trong vịnh sống bằng nghề đánh cá và làm muối. Mỗi sáng, khi thủy triều rút, họ lại ra bãi đá để nhặt những mảnh lưới cũ mắc lại.`;

const boat = `## Sóng Bạc

Sóng Bạc là chiếc thuyền gỗ lớn nhất trong vịnh, được đóng từ gỗ của một cây thông già. Mỗi lần ra khơi, người cầm lái thắp một ngọn đèn dầu nhỏ và treo nó ở đầu mũi thuyền. Khi thuyền về, người ta rửa sạch muối bám trên mạn thuyền trước khi cất lưới.`;

const keeper = `## Người giữ đèn

Người giữ đèn ở đây sống trong căn nhà nhỏ cạnh ngọn hải đăng. Mỗi tối, người ấy leo lên đỉnh tháp, lau kính và thêm dầu vào đèn. Người giữ đèn nói rằng ngọn đèn không được phép tắt, kể cả khi trời yên gió.`;

const market = `## Chợ nổi

Chợ nổi họp trên mặt nước từ lúc trời còn tối. Thuyền nhỏ chở rau, cá khô và muối, người mua trả tiền bằng những đồng xu cũ. Ai đến muộn vẫn có thể mua được cá, nhưng phải chèo ra xa hơn một chút.`;

export const songBac = {
  key: "song-bac",
  documentName: "Chuyện ở Vịnh Trăng",
  language: "vi",
  scope: "serverwide",
  sourceText: `# Chuyện ở Vịnh Trăng

${harbor}

${boat}

${keeper}

${market}`,
  passages: [
    { key: "song-bac.harbor", text: harbor },
    { key: "song-bac.boat", text: boat },
    { key: "song-bac.keeper", text: keeper },
    { key: "song-bac.market", text: market },
  ],
} as const satisfies RagDocument;
