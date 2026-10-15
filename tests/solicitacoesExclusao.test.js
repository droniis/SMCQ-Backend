// ============================================================
// SOLICITAÇÕES DE EXCLUSÃO (Etapa I3)
// - Rejeição exige resposta ao solicitante
// - Filtro por situação validado
// - Aprovação exclui o alerta (lógica) e ele sai da listagem
// - O operador acompanha os próprios pedidos (listagem e Detalhes)
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');
const cache = require('../services/cacheService');

const fetchOriginal = global.fetch;
let app;
const tokens = {};

const comToken = (perfil) => ({ Authorization: `Bearer ${tokens[perfil]}` });
const criar = () => request(app).post('/api/alertas').set(comToken('operador')).send({
  titulo: 'Queimada de teste', areaAfetada: 'MEDIA', vento: 'BAIXO', pessoasRisco: false, latitude: -16.68, longitude: -56.67
});
const solicitar = (id, motivo = 'registro duplicado') =>
  request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo });
const avaliar = (id, sid, corpo, perfil = 'gestor') =>
  request(app).patch(`/api/alertas/${id}/solicitacoes-exclusao/${sid}`).set(comToken(perfil)).send(corpo);
const listar = (perfil, consulta = '') => request(app).get(`/api/solicitacoes-exclusao${consulta}`).set(comToken(perfil));

// Alerta novo com uma solicitação pendente do operador → { id, sid }
async function comPendente() {
  const { id } = (await criar()).body;
  const { body } = await solicitar(id);
  return { id, sid: body.id };
}

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = jest.fn(criarFetchFalso().fetchFalso);
  app = require('../server');
  for (const [perfil, email, senha] of [
    ['admin', 'admin@smcq.com', 'admin123'],
    ['operador', 'operador@smcq.com', 'operador123'],
    ['gestor', 'gestor@smcq.com', 'gestor123']
  ]) {
    tokens[perfil] = (await request(app).post('/api/login').send({ email, senha })).body.token;
  }
});

beforeEach(() => cache.limpar());

afterAll(() => {
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

// ------------------------------------------------------------
describe('rejeição exige resposta', () => {
  test.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['só espaços', '   '],
    ['não é texto', 42]
  ])('resposta %s → 400 e a solicitação continua pendente', async (_caso, resposta) => {
    const { id, sid } = await comPendente();
    const r = await avaliar(id, sid, { decisao: 'REJEITADA', resposta });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/resposta/i);
    const [s] = (await request(app).get(`/api/alertas/${id}`).set(comToken('gestor'))).body.solicitacoesExclusao;
    expect(s.status).toBe('PENDENTE');
  });

  test('rejeição com resposta → 200, resposta aparada, avaliador e data registrados; o alerta continua ativo', async () => {
    const { id, sid } = await comPendente();
    const r = await avaliar(id, sid, { decisao: 'REJEITADA', resposta: '  ocorrência confirmada pela brigada  ' }, 'admin');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'REJEITADA', resposta: 'ocorrência confirmada pela brigada', resolvidoPor: 1, resolvidoEm: expect.any(String) });
    expect((await request(app).get(`/api/alertas/${id}`).set(comToken('operador'))).status).toBe(200);
  });

  test('aprovação não exige resposta', async () => {
    const { id, sid } = await comPendente();
    const r = await avaliar(id, sid, { decisao: 'APROVADA' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'APROVADA', resposta: '', resolvidoPor: 3 });
  });
});

// ------------------------------------------------------------
describe('aprovação', () => {
  test('o alerta sai da listagem e dos Detalhes (exclusão lógica), com o registro "excluido" pelo avaliador', async () => {
    const { id, sid } = await comPendente();
    expect((await avaliar(id, sid, { decisao: 'APROVADA', resposta: 'ok' })).status).toBe(200);
    const lista = (await request(app).get('/api/alertas').set(comToken('gestor'))).body;
    expect(lista.some(a => a.id === id)).toBe(false);
    expect((await request(app).get(`/api/alertas/${id}`).set(comToken('gestor'))).status).toBe(404);
    // A solicitação continua listada, indicando que o alerta foi excluído
    const s = (await listar('gestor')).body.find(x => x.id === sid);
    expect(s).toMatchObject({ status: 'APROVADA', alertaId: id, alertaExcluido: true, resolvidoPorNome: 'Gestor' });
  });
});

// ------------------------------------------------------------
describe('permissões e conflitos', () => {
  test('operador não avalia (403), nem aprovando nem rejeitando', async () => {
    const { id, sid } = await comPendente();
    expect((await avaliar(id, sid, { decisao: 'APROVADA' }, 'operador')).status).toBe(403);
    expect((await avaliar(id, sid, { decisao: 'REJEITADA', resposta: 'x' }, 'operador')).status).toBe(403);
  });

  test('solicitação inexistente → 404; já avaliada → 409', async () => {
    const { id, sid } = await comPendente();
    expect((await avaliar(id, 99999, { decisao: 'APROVADA' })).status).toBe(404);
    expect((await avaliar(id, sid, { decisao: 'REJEITADA', resposta: 'manter' })).status).toBe(200);
    expect((await avaliar(id, sid, { decisao: 'REJEITADA', resposta: 'de novo' }, 'admin')).status).toBe(409);
  });

  test('depois de rejeitada, o operador pode pedir de novo', async () => {
    const { id, sid } = await comPendente();
    await avaliar(id, sid, { decisao: 'REJEITADA', resposta: 'manter' });
    expect((await solicitar(id, 'novo motivo')).status).toBe(201);
  });

  test('sem token → 401', async () => {
    expect((await request(app).get('/api/solicitacoes-exclusao')).status).toBe(401);
  });
});

// ------------------------------------------------------------
describe('GET /api/solicitacoes-exclusao', () => {
  test.each(['PENDENTE', 'APROVADA', 'REJEITADA'])('filtro ?status=%s devolve só essa situação', async (situacao) => {
    const a = await comPendente();
    const b = await comPendente();
    await avaliar(a.id, a.sid, { decisao: 'APROVADA' });
    await avaliar(b.id, b.sid, { decisao: 'REJEITADA', resposta: 'manter' });
    const r = await listar('admin', `?status=${situacao}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every(s => s.status === situacao)).toBe(true);
  });

  test('situação inválida → 400', async () => {
    const r = await listar('gestor', '?status=pendente');
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/PENDENTE, APROVADA, REJEITADA/);
  });

  test('mais recentes primeiro, com título do alerta e nome do solicitante', async () => {
    const primeira = await comPendente();
    const segunda = await comPendente();
    const lista = (await listar('gestor', '?status=PENDENTE')).body;
    expect(lista.findIndex(s => s.id === segunda.sid)).toBeLessThan(lista.findIndex(s => s.id === primeira.sid));
    expect(lista.find(s => s.id === primeira.sid)).toMatchObject({ alertaTitulo: 'Queimada de teste', solicitadoPorNome: 'Operador', motivo: 'registro duplicado' });
  });

  test('"Minhas solicitações": o operador vê só as próprias, inclusive as de alertas já excluídos, com situação e resposta', async () => {
    const aprovada = await comPendente();
    const rejeitada = await comPendente();
    await avaliar(aprovada.id, aprovada.sid, { decisao: 'APROVADA', resposta: 'duplicado confirmado' });
    await avaliar(rejeitada.id, rejeitada.sid, { decisao: 'REJEITADA', resposta: 'ocorrência real' });
    const minhas = (await listar('operador')).body;
    expect(minhas.every(s => s.solicitadoPor === 2)).toBe(true);
    expect(minhas.find(s => s.id === aprovada.sid)).toMatchObject({ status: 'APROVADA', alertaExcluido: true, resposta: 'duplicado confirmado' });
    expect(minhas.find(s => s.id === rejeitada.sid)).toMatchObject({ status: 'REJEITADA', alertaExcluido: false, resposta: 'ocorrência real' });
  });
});

// ------------------------------------------------------------
describe('Detalhes do alerta', () => {
  test('o operador vê a situação do próprio pedido, com a resposta e quem avaliou', async () => {
    const { id, sid } = await comPendente();
    await avaliar(id, sid, { decisao: 'REJEITADA', resposta: 'ocorrência real' });
    const { solicitacoesExclusao } = (await request(app).get(`/api/alertas/${id}`).set(comToken('operador'))).body;
    expect(solicitacoesExclusao).toEqual([expect.objectContaining({
      id: sid, solicitadoPor: 2, solicitadoPorNome: 'Operador', status: 'REJEITADA', resposta: 'ocorrência real', resolvidoPorNome: 'Gestor'
    })]);
  });
});
