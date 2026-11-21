export default {
  provider: {
    add: {
      provider_choice_descriptions: {
        anthropic: `Claude 模型，寫作與遵循指令的能力出色。`,
        deepseek: `成本效益高，且審查相對寬鬆的模型。`,
        google: `Gemini 模型；整體功能支援最完整。`,
        novelai: `無審查的角色扮演與故事創作；提供文字與 NovelAI 圖片工具。`,
        nvidia: `由 NVIDIA 代管的 NIM 模型，涵蓋文字、嵌入與媒體。`,
        openrouter: `用一個 OpenRouter 帳號就能取用多家供應商的模型。`,
        vertex: `使用服務帳戶憑證的 Google Cloud Vertex AI。`,
        vertexexpress: `用 API 金鑰透過 Vertex AI Express 使用 Gemini。`,
        zai: `Z.ai 的通用聊天模型；非程式開發用途請先確認服務條款。`,
        zaicoding: `Z.ai 的程式開發與代理模型，適合以寫程式為主的用途。`,
      },
    },
  },
};
