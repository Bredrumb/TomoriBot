export default {
  provider: {
    add: {
      provider_choice_descriptions: {
        anthropic: `Claude 模型，写作和指令遵循能力强。`,
        deepseek: `性价比高，模型限制较少。`,
        google: `Gemini 模型；整体功能覆盖最全。`,
        novelai: `限制较少的角色扮演与故事创作；支持文本和 NovelAI 图像工具。`,
        nvidia: `NVIDIA 托管的 NIM 模型，覆盖文本、嵌入和媒体。`,
        openrouter: `用一个 OpenRouter 账号访问众多模型厂商。`,
        vertex: `用服务账号凭据访问 Google Cloud Vertex AI。`,
        vertexexpress: `用 API 密钥访问 Vertex AI Express 上的 Gemini。`,
        zai: `Z.ai 的通用聊天模型；非编码用途请先看服务条款。`,
        zaicoding: `Z.ai 的编码／智能体模型，面向编码类用途。`,
      },
    },
  },
};
