// ============================================================
// STATUS DO ALERTA E TRANSIÇÕES PERMITIDAS (UC05 FA01)
//   NOVO           → EM_ANALISE
//   EM_ANALISE     → EM_ATENDIMENTO ou NOVO
//   EM_ATENDIMENTO → RESOLVIDO ou EM_ANALISE
//   RESOLVIDO      → (final)
// Qualquer outra mudança, inclusive para o mesmo status, é recusada.
// Os repositórios conferem a transição com o alerta já travado, para
// que dois pedidos simultâneos não escapem da regra.
// ============================================================

const STATUS_VALIDOS = ['NOVO', 'EM_ANALISE', 'EM_ATENDIMENTO', 'RESOLVIDO'];

const TRANSICOES = {
  NOVO: ['EM_ANALISE'],
  EM_ANALISE: ['EM_ATENDIMENTO', 'NOVO'],
  EM_ATENDIMENTO: ['RESOLVIDO', 'EM_ANALISE'],
  RESOLVIDO: []
};

function statusValido(status) {
  return STATUS_VALIDOS.includes(status);
}

function transicaoPermitida(de, para) {
  return (TRANSICOES[de] || []).includes(para);
}

// Erro lançado pelos repositórios; o server.js o converte em 422
function erroTransicao(de, para) {
  return Object.assign(new Error(`Transição de status não permitida: ${de} → ${para}`), { code: 'TRANSICAO_INVALIDA' });
}

module.exports = { STATUS_VALIDOS, TRANSICOES, statusValido, transicaoPermitida, erroTransicao };
