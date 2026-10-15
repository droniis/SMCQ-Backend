// ============================================================
// ALERTAS EM MEMÓRIA (testes e PERSISTENCIA=memoria)
// Mesmo comportamento do protótipo original: os dados somem ao
// reiniciar. Devolve cópias, para que quem chama não altere o
// estado guardado sem passar pelo repositório.
// ============================================================
const { nomeDoUsuario } = require('./usuarioRepositorio');
const { transicaoPermitida, erroTransicao } = require('../../services/statusService');

const alertas = [];
let alertaIdCounter = 1;
let solicitacaoIdCounter = 1;

const copia = (obj) => (obj ? structuredClone(obj) : null);

function ativo(id) {
  return alertas.find(a => a.id === id && !a.excluido);
}

// Exclusão lógica: o alerta continua guardado para auditoria, mas some das listagens
function marcarExcluido(alerta, usuarioId) {
  const agora = new Date().toISOString();
  alerta.excluido = true;
  alerta.excluidoEm = agora;
  alerta.excluidoPor = usuarioId;
  alerta.atualizadoEm = agora;
  alerta.historico.push({ campo: 'excluido', valorAnterior: false, valorNovo: true, alteradoPor: usuarioId, alteradoEm: agora });
}

// Filtro opcional: { tipoOcorrencia }
async function listarAtivos({ tipoOcorrencia } = {}) {
  return alertas
    .filter(a => !a.excluido && (!tipoOcorrencia || a.tipoOcorrencia === tipoOcorrencia))
    .map(copia);
}

async function buscarAtivo(id) {
  return copia(ativo(id));
}

// dados → alerta completo, sem id (montado pelo server.js)
async function criar(dados) {
  const alerta = { id: alertaIdCounter++, ...structuredClone(dados) };
  alertas.push(alerta);
  return copia(alerta);
}

// → o alerta atualizado; null se não existe; erro TRANSICAO_INVALIDA se a mudança não é permitida
async function atualizarStatus(id, status, usuarioId) {
  const alerta = ativo(id);
  if (!alerta) return null;
  if (!transicaoPermitida(alerta.status, status)) throw erroTransicao(alerta.status, status);
  const agora = new Date().toISOString();
  alerta.historico.push({ campo: 'status', valorAnterior: alerta.status, valorNovo: status, alteradoPor: usuarioId, alteradoEm: agora });
  alerta.status = status;
  alerta.atualizadoEm = agora;
  return copia(alerta);
}

async function adicionarObservacao(id, texto, usuarioId) {
  const alerta = ativo(id);
  if (!alerta) return null;
  const agora = new Date().toISOString();
  if (!alerta.observacoes) alerta.observacoes = [];
  alerta.observacoes.push({ texto, criadoPor: usuarioId, criadoEm: agora });
  alerta.atualizadoEm = agora;
  return copia(alerta);
}

// Exclusão direta: as solicitações pendentes ficam atendidas (APROVADA)
async function excluir(id, usuarioId) {
  const alerta = ativo(id);
  if (!alerta) return null;
  marcarExcluido(alerta, usuarioId);
  alerta.solicitacoesExclusao
    .filter(s => s.status === 'PENDENTE')
    .forEach(s => {
      s.status = 'APROVADA';
      s.resolvidoEm = alerta.excluidoEm;
      s.resolvidoPor = usuarioId;
    });
  return copia(alerta);
}

// → a solicitação criada; null se o alerta não existe; erro SOLICITACAO_PENDENTE se já há uma pendente
async function criarSolicitacao(alertaId, usuarioId, motivo) {
  const alerta = ativo(alertaId);
  if (!alerta) return null;
  if (alerta.solicitacoesExclusao.some(s => s.status === 'PENDENTE')) {
    throw Object.assign(new Error('Já existe uma solicitação de exclusão pendente'), { code: 'SOLICITACAO_PENDENTE' });
  }
  const solicitacao = {
    id: solicitacaoIdCounter++,
    solicitadoPor: usuarioId,
    motivo,
    status: 'PENDENTE',
    criadoEm: new Date().toISOString(),
    resolvidoEm: null,
    resolvidoPor: null,
    resposta: ''
  };
  alerta.solicitacoesExclusao.push(solicitacao);
  return copia(solicitacao);
}

// filtro.solicitadoPor: só as desse usuário (null = todas); filtro.status: PENDENTE | APROVADA | REJEITADA
async function listarSolicitacoes({ solicitadoPor = null, status = null } = {}) {
  return alertas.flatMap(alerta =>
    alerta.solicitacoesExclusao.map(s => ({
      ...copia(s),
      alertaId: alerta.id,
      alertaTitulo: alerta.titulo,
      alertaExcluido: alerta.excluido,
      solicitadoPorNome: nomeDoUsuario(s.solicitadoPor),
      resolvidoPorNome: nomeDoUsuario(s.resolvidoPor)
    }))
  )
    .filter(s => solicitadoPor === null || s.solicitadoPor === solicitadoPor)
    .filter(s => !status || s.status === status)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

// Aprova ou rejeita uma solicitação PENDENTE; aprovada, exclui o alerta.
// → a solicitação avaliada; null se ela não está mais pendente
async function avaliarSolicitacao(alertaId, solicitacaoId, decisao, resposta, usuarioId) {
  const alerta = ativo(alertaId);
  const solicitacao = alerta && alerta.solicitacoesExclusao.find(s => s.id === solicitacaoId);
  if (!solicitacao || solicitacao.status !== 'PENDENTE') return null;
  solicitacao.status = decisao;
  solicitacao.resolvidoEm = new Date().toISOString();
  solicitacao.resolvidoPor = usuarioId;
  solicitacao.resposta = resposta;
  if (decisao === 'APROVADA') marcarExcluido(alerta, usuarioId);
  return copia(solicitacao);
}

module.exports = {
  listarAtivos,
  buscarAtivo,
  criar,
  atualizarStatus,
  adicionarObservacao,
  excluir,
  criarSolicitacao,
  listarSolicitacoes,
  avaliarSolicitacao
};
