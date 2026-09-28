export default {
  kill: {
    description: `Pare imediatamente a stream atual e limpe as respostas na fila neste canal.`,
    success_title: `Stream Interrompida`,
    success_description: `Interrompeu a stream de resposta ativa (se houver) e limpou as respostas na fila neste canal.`,
    nothing_to_stop_title: `Nada para Parar`,
    nothing_to_stop_description: `Não há stream de resposta ativa ou resposta na fila para limpar neste canal.`,
    media_generation_billing_footer: `Havia uma geração de mídia em andamento. O provedor ainda pode cobrar por ela, mesmo que não tenha sido publicada.`,
  },
};
