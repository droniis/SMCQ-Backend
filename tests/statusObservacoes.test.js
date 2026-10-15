// ============================================================
// TRANSIÇÕES DE STATUS, OBSERVAÇÕES E DETALHES DO ALERTA (Etapa I2)
// - Só as transições do UC05 FA01; as demais → 422 sem alterar nada
// - GET /api/alertas/:id com o nome de cada autor
// - Observação com texto obrigatório e tamanho máximo
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');
const cache = require('../services/cacheService');
const { STATUS_VALIDOS, TRANSICOES, transicaoPermitida } = require('../services/statusService');

const fetchOriginal = global.fetch;
let app;
const tokens = {};

const comToken = (perfil) => ({ Authorization: `Bearer ${tokens[perfil]}` });
const criar = (perfil = 'operador') => request(app).post('/api/alertas').set(comToken(perfil)).send({
  titulo: 'Queimada de teste', areaAfetada: 'MEDIA', vento: 'BAIXO', pessoasRisco: false, latitude: -16.68, longitude: -56.67
});
const mudarStatus = (id, status, perfil = 'operador') =>
  request(app).patch(`/api/alertas/${id}/status`).set(comToken(perfil)).send({ status });
const detalhes = (id, perfil = 'operador') => request(app).get(`/api/alertas/${id}`).set(comToken(perfil));

// Caminho válido do NOVO até cada status
const CAMINHO = {
  NOVO: [],
  EM_ANALISE: ['EM_ANALISE'],
  EM_ATENDIMENTO: ['EM_ANALISE', 'EM_ATENDIMENTO'],
  RESOLVIDO: ['EM_ANALISE', 'EM_ATENDIMENTO', 'RESOLVIDO']
};

async function alertaNoStatus(status) {
  const { id } = (await criar()).body;
  for (const passo of CAMINHO[status]) {
    expect((await mudarStatus(id, passo)).status).toBe(200);
  }
  return id;
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
describe('regras de transição (statusService)', () => {
  test('a tabela é exatamente a do UC05 FA01', () => {
    expect(TRANSICOES).toEqual({
      NOVO: ['EM_ANALISE'],
      EM_ANALISE: ['EM_ATENDIMENTO', 'NOVO'],
      EM_ATENDIMENTO: ['RESOLVIDO', 'EM_ANALISE'],
      RESOLVIDO: []
    });
  });

  test('nenhum status transita para ele mesmo; RESOLVIDO é final', () => {
    for (const s of STATUS_VALIDOS) expect(transicaoPermitida(s, s)).toBe(false);
    for (const s of STATUS_VALIDOS) expect(transicaoPermitida('RESOLVIDO', s)).toBe(false);
  });
});

// As 16 combinações de/para pela API
const COMBINACOES = STATUS_VALIDOS.flatMap(de => STATUS_VALIDOS.map(para => [de, para, transicaoPermitida(de, para)]));

describe('PATCH /api/alertas/:id/status: as 16 combinações', () => {
  test.each(COMBINACOES)('%s → %s (permitida: %s)', async (de, para, permitida) => {
    const id = await alertaNoStatus(de);
    const antes = (await detalhes(id)).body;
    const r = await mudarStatus(id, para);
    if (permitida) {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe(para);
      expect(r.body.historico).toHaveLength(antes.historico.length + 1);
      expect(r.body.historico.at(-1)).toMatchObject({ campo: 'status', valorAnterior: de, valorNovo: para, alteradoPor: 2, alteradoPorNome: 'Operador' });
    } else {
      expect(r.status).toBe(422);
      expect(r.body).toEqual({ erro: 'Transição de status não permitida' });
      // Nada mudou: nem o status, nem o histórico, nem a data de atualização
      const depois = (await detalhes(id)).body;
      expect(depois.status).toBe(de);
      expect(depois.historico).toEqual(antes.historico);
      expect(depois.atualizadoEm).toBe(antes.atualizadoEm);
    }
  });

  test('a regra vale para todos os perfis', async () => {
    for (const perfil of ['admin', 'gestor', 'operador']) {
      const id = await alertaNoStatus('NOVO');
      expect((await mudarStatus(id, 'RESOLVIDO', perfil)).status).toBe(422);
      expect((await mudarStatus(id, 'EM_ANALISE', perfil)).status).toBe(200);
    }
  });

  test('ordem das verificações: inexistente → 404; status desconhecido → 400; transição proibida → 422', async () => {
    const id = await alertaNoStatus('RESOLVIDO');
    expect((await mudarStatus(99999, 'XYZ')).status).toBe(404);
    expect((await mudarStatus(id, 'XYZ')).status).toBe(400);
    expect((await mudarStatus(id, 'NOVO')).status).toBe(422);
  });

  test('sem token → 401', async () => {
    expect((await request(app).patch('/api/alertas/1/status').send({ status: 'EM_ANALISE' })).status).toBe(401);
  });
});

// ------------------------------------------------------------
describe('GET /api/alertas/:id', () => {
  test('devolve o alerta com os nomes dos autores e o registro da criação', async () => {
    const { id } = (await criar('gestor')).body;
    await mudarStatus(id, 'EM_ANALISE', 'admin');
    await request(app).post(`/api/alertas/${id}/observacoes`).set(comToken('operador')).send({ observacao: 'equipe a caminho' });
    await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'duplicado' });

    const r = await detalhes(id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id, criadoPor: 3, criadoPorNome: 'Gestor', versaoAlgoritmo: 'IRS v2' });
    expect(r.body.historico).toEqual([
      expect.objectContaining({ campo: 'status', valorAnterior: null, valorNovo: 'NOVO', alteradoPor: 3, alteradoPorNome: 'Gestor' }),
      expect.objectContaining({ campo: 'status', valorAnterior: 'NOVO', valorNovo: 'EM_ANALISE', alteradoPor: 1, alteradoPorNome: 'Admin' })
    ]);
    expect(r.body.observacoes).toEqual([expect.objectContaining({ texto: 'equipe a caminho', criadoPor: 2, criadoPorNome: 'Operador' })]);
    expect(r.body.solicitacoesExclusao).toEqual([
      expect.objectContaining({ motivo: 'duplicado', status: 'PENDENTE', solicitadoPorNome: 'Operador', resolvidoPorNome: null })
    ]);
  });

  test('inexistente ou excluído → 404', async () => {
    const { id } = (await criar()).body;
    await request(app).delete(`/api/alertas/${id}`).set(comToken('gestor'));
    expect((await detalhes(id)).status).toBe(404);
    expect((await detalhes(99999)).status).toBe(404);
  });

  test('a rota de prévia dos geodados continua respondendo (não é confundida com /:id)', async () => {
    const r = await request(app).get('/api/alertas/geodados-preview?lat=x&lng=y').set(comToken('operador'));
    expect(r.status).toBe(400);
  });
});

// ------------------------------------------------------------
describe('POST /api/alertas/:id/observacoes', () => {
  const observar = (id, observacao) => request(app).post(`/api/alertas/${id}/observacoes`).set(comToken('operador')).send({ observacao });

  test('grava o texto aparado, com autor, nome e data', async () => {
    const { id } = (await criar()).body;
    const r = await observar(id, '  equipe no local  ');
    expect(r.status).toBe(200);
    expect(r.body.observacoes).toEqual([
      { texto: 'equipe no local', criadoPor: 2, criadoPorNome: 'Operador', criadoEm: expect.any(String) }
    ]);
    expect(r.body.atualizadoEm).toBe(r.body.observacoes[0].criadoEm);
  });

  test.each([
    ['vazia', ''],
    ['só espaços', '   '],
    ['ausente', undefined],
    ['não é texto', 123]
  ])('observação %s → 400', async (_caso, valor) => {
    const { id } = (await criar()).body;
    const r = await observar(id, valor);
    expect(r.status).toBe(400);
    expect((await detalhes(id)).body.observacoes).toBeUndefined();
  });

  test('até 2.000 caracteres; acima disso → 400', async () => {
    const { id } = (await criar()).body;
    expect((await observar(id, 'a'.repeat(2000))).status).toBe(200);
    expect((await observar(id, 'a'.repeat(2001))).status).toBe(400);
  });

  test('alerta inexistente → 404', async () => {
    expect((await observar(99999, 'x')).status).toBe(404);
  });

  test('observação em alerta RESOLVIDO continua permitida (registro posterior ao atendimento)', async () => {
    const id = await alertaNoStatus('RESOLVIDO');
    expect((await observar(id, 'área vistoriada')).status).toBe(200);
  });
});
