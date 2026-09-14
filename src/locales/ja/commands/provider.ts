export default {
  provider: {
    add: {
      provider_choice_descriptions: {
        anthropic: `文章力と指示追従に強いClaudeモデル。`,
        deepseek: `低コストなチャット/推論モデル。`,
        google: `Geminiモデル。機能対応の幅が最も広い構成。`,
        novelai: `無検閲RP/物語向け。テキストとNovelAI画像に対応。`,
        nvidia: `NVIDIAホストのNIM。テキスト、埋め込み、メディア向け。`,
        openrouter: `1つのOpenRouterアカウントで多数のモデル提供元に接続。`,
        vertex: `サービスアカウントで使うGoogle Cloud Vertex AI。`,
        vertexexpress: `Gemini向けVertex AI Express APIキー接続。`,
        zai: `Z.ai一般チャットモデル。非コーディング用途はToS確認推奨。`,
        zaicoding: `コーディング/エージェント用途向けZ.aiモデル。`,
      },
    },
  },
};
