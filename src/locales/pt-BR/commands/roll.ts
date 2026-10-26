export default {
  roll: {
    description: "Role dados para jogos de mesa e RPG.",
    dice_description: "Dados para rolar, como 3d4 ou 1d20+5 (padrão: 1d20).",
    mode_description: "Role normalmente ou fique com o maior ou menor de dois d20.",
    reason_description: "Um rótulo curto para a rolagem, como Teste de furtividade.",
    visibility_description: "Quem pode ver o resultado, incluindo se o bot o recebe no contexto do chat.",
    normal_option: "Normal",
    advantage_option: "Vantagem",
    disadvantage_option: "Desvantagem",
    public_option: "Público",
    hidden_option: "Oculto",
    shared_option: "Público + Bot",
    title: "🎲 Rolagem de dados",
    rolled: "**{actor}** rolou `{dice}`:",
    rolled_with_reason: "**{actor}** rolou `{dice}` por *{reason}*:",
    advantage_line: "Vantagem: {rolls}{modifier}",
    disadvantage_line: "Desvantagem: {rolls}{modifier}",
    calculation_line: "Cálculo: {calculation}",
    footer_public: "Público • Não compartilhado com o bot",
    footer_hidden: "Oculto • Apenas você pode ver isso",
    footer_shared: "Público • Compartilhado com o bot",
    invalid_title: "Rolagem de dados inválida",
    invalid_input:
      "Insira uma expressão de dados de até 64 caracteres, um modo válido e um motivo de até 100 caracteres. Exemplo: `1d20+5`.",
    invalid_notation:
      "Use apenas um grupo de dados com um modificador opcional, como `d20`, `3d4`, `2d6+3` ou `1d20-2`.",
    invalid_limits:
      "Role de 1 a 100 dados com 2 a 1.000 lados cada e um modificador entre -10.000 e +10.000. Exemplo: `2d6+3`.",
    invalid_mode: "Vantagem e desvantagem exigem `1d20` com um modificador opcional, como `1d20+5`.",
    invalid_visibility: "Escolha Público, Oculto ou Público + Bot.",
  },
};
