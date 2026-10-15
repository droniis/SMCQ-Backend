// ============================================================
// EDIÇÃO DE OCORRÊNCIA (Etapa I4, RF11, HU04)
// - Campos editáveis, validações e campos bloqueados
// - Recálculo do IRS com os geodados GRAVADOS (sem consulta externa)
// - Histórico campo a campo, inclusive a mudança de nível de risco
// - Simulação sem gravar, para o aviso antes de salvar
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');
const cache = require('../services/cacheService');
const { classificarComGeodados } = require('../services/classificacaoService');

const fetchOriginal = global.fetch;
let app;
const tokens = {};

const comToken = (perfil) => ({ Authorization: `Bearer ${tokens[perfil]}` });
const BASE = { titulo: 'Queimada de teste', descricao: 'Fumaça intensa', areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false, latitude: -16.68, longitude: -56.67 };
const criar = async (campos = {}) => (await request(app).post('/api/alertas').set(comToken('operador')).send({ ...BASE, ...campos })).body;
const editar = (id, corpo, perfil = 'operador') => request(app).patch(`/api/alertas/${id}`).set(comToken(perfil)).send(corpo);
const simular = (id, corpo, perfil = 'operador') => request(app).post(`/api/alertas/${id}/risco/simulacao`).set(comToken(perfil)).send(corpo);
const detalhes = async (id) => (await request(app).get(`/api/alertas/${id}`).set(comToken('operador'))).body;
const ultimos = (alerta, n) => alerta.historico.slice(-n);

// O que o IRS dá para um alerta com estas entradas e os geodados que ele gravou
function esperado(alerta, entradas, informados = { bioma: null, tipoArea: null }) {
  return classificarComGeodados({
    latitude: alerta.latitude, longitude: alerta.longitude, zonaUrbana: alerta.zonaUrbana,
    direcaoVento: alerta.direcaoVento, dA_dt: alerta.dA_dt, ...entradas
  }, informados, alerta.geodados);
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
describe('campos que não entram no cálculo', () => {
  test('título e descrição: gravados aparados, um registro por campo, sem recalcular o IRS', async () => {
    const alerta = await criar();
    const r = await editar(alerta.id, { titulo: '  Queimada controlada  ', descricao: ' Equipe no local ' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ titulo: 'Queimada controlada', descricao: 'Equipe no local' });
    expect(ultimos(r.body, 2)).toEqual([
      expect.objectContaining({ campo: 'titulo', valorAnterior: 'Queimada de teste', valorNovo: 'Queimada controlada', alteradoPor: 2, alteradoPorNome: 'Operador' }),
      expect.objectContaining({ campo: 'descricao', valorAnterior: 'Fumaça intensa', valorNovo: 'Equipe no local' })
    ]);
    expect(r.body.atualizadoEm).toBe(r.body.historico.at(-1).alteradoEm);
    // Classificação intocada
    expect(r.body).toMatchObject({ irs: alerta.irs, risco: alerta.risco, detalhes: alerta.detalhes });
  });

  test('descrição null → texto vazio', async () => {
    const alerta = await criar();
    const r = await editar(alerta.id, { descricao: null });
    expect(r.body.descricao).toBe('');
    expect(ultimos(r.body, 1)[0]).toMatchObject({ campo: 'descricao', valorAnterior: 'Fumaça intensa', valorNovo: '' });
  });
});

// ------------------------------------------------------------
describe('recálculo do IRS', () => {
  test.each([
    ['areaAfetada', { areaAfetada: 'GRANDE' }, 'PEQUENA', 'GRANDE'],
    ['vento', { vento: 'ALTO' }, 'BAIXO', 'ALTO'],
    ['pessoasRisco', { pessoasRisco: true }, false, true]
  ])('%s: recalcula com os geodados gravados, sem nenhuma consulta externa', async (campo, corpo, anterior, novo) => {
    const alerta = await criar();
    global.fetch.mockClear();
    const r = await editar(alerta.id, corpo);
    expect(r.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
    const calc = esperado(alerta, { areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false, ...corpo });
    expect(r.body).toMatchObject({ irs: calc.irs, sigmoide: calc.sigmoide, risco: calc.risco, detalhes: calc.detalhes, versaoAlgoritmo: 'IRS v2' });
    expect(r.body.geodados).toEqual(alerta.geodados);
    expect(r.body.historico.find(h => h.campo === campo)).toMatchObject({ valorAnterior: anterior, valorNovo: novo });
    // O detalhamento do risco passa a mostrar o cálculo novo
    const risco = (await request(app).get(`/api/alertas/${alerta.id}/risco`).set(comToken('operador'))).body;
    expect(risco).toMatchObject({ irs: calc.irs, nivel: calc.risco, detalhes: calc.detalhes });
  });

  test('recalcular com as mesmas entradas reproduz exatamente o cálculo da criação', async () => {
    const alerta = await criar();
    const calc = esperado(alerta, { areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false });
    expect({ irs: calc.irs, risco: calc.risco, detalhes: calc.detalhes }).toEqual({ irs: alerta.irs, risco: alerta.risco, detalhes: alerta.detalhes });
  });

  test('mudança de nível de risco entra no histórico, depois dos campos alterados', async () => {
    const alerta = await criar();
    const corpo = { areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true };
    const novoNivel = esperado(alerta, corpo).risco;
    expect(novoNivel).not.toBe(alerta.risco); // pré-condição do cenário
    const r = await editar(alerta.id, corpo, 'gestor');
    expect(r.body.risco).toBe(novoNivel);
    expect(ultimos(r.body, 4).map(h => h.campo)).toEqual(['areaAfetada', 'vento', 'pessoasRisco', 'risco']);
    expect(ultimos(r.body, 1)[0]).toMatchObject({ valorAnterior: alerta.risco, valorNovo: novoNivel, alteradoPor: 3, alteradoPorNome: 'Gestor' });
  });

  test('IRS muda sem mudar o nível → sem registro "risco"', async () => {
    const alerta = await criar();
    const calc = esperado(alerta, { areaAfetada: 'PEQUENA', vento: 'MODERADO', pessoasRisco: false });
    expect(calc.risco).toBe(alerta.risco); // pré-condição do cenário
    const r = await editar(alerta.id, { vento: 'MODERADO' });
    expect(r.body.irs).not.toBe(alerta.irs);
    expect(r.body.historico.some(h => h.campo === 'risco')).toBe(false);
  });

  test('bioma informado prevalece; null volta ao detectado nos geodados gravados', async () => {
    const alerta = await criar();
    expect(alerta).toMatchObject({ bioma: 'PANTANAL', biomaOrigem: 'detectado' });

    const informado = await editar(alerta.id, { bioma: 'Cerrado' });
    expect(informado.status).toBe(200);
    expect(informado.body).toMatchObject({ bioma: 'CERRADO', biomaOrigem: 'informado' });
    expect(informado.body.historico.find(h => h.campo === 'bioma')).toMatchObject({ valorAnterior: 'PANTANAL', valorNovo: 'CERRADO' });
    const calc = esperado(alerta, { areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false }, { bioma: 'CERRADO', tipoArea: null });
    expect(informado.body.detalhes).toEqual(calc.detalhes);

    const devolvido = await editar(alerta.id, { bioma: null });
    expect(devolvido.body).toMatchObject({ bioma: 'PANTANAL', biomaOrigem: 'detectado', irs: alerta.irs, detalhes: alerta.detalhes });
    // Os registros desta edição: o bioma e, se o nível também voltou, o risco
    const desta = devolvido.body.historico.filter(h => h.alteradoEm === devolvido.body.atualizadoEm);
    expect(desta[0]).toMatchObject({ campo: 'bioma', valorAnterior: 'CERRADO', valorNovo: 'PANTANAL' });
    expect(desta.slice(1).every(h => h.campo === 'risco' && h.valorNovo === alerta.risco)).toBe(true);
  });

  test('tipo de área informado ("" volta ao detectado)', async () => {
    const alerta = await criar();
    const r = await editar(alerta.id, { tipoArea: 'APP' });
    expect(r.body).toMatchObject({ tipoArea: 'APP', tipoAreaOrigem: 'informado' });
    expect(r.body.historico.find(h => h.campo === 'tipoArea')).toMatchObject({ valorAnterior: alerta.tipoArea, valorNovo: 'APP' });
    const volta = await editar(alerta.id, { tipoArea: '' });
    expect(volta.body).toMatchObject({ tipoArea: alerta.tipoArea, tipoAreaOrigem: 'detectado' });
  });
});

// ------------------------------------------------------------
describe('sem mudança', () => {
  test('corpo vazio ou com os mesmos valores → 200, sem histórico e sem mudar a data de atualização', async () => {
    const alerta = await criar();
    for (const corpo of [{}, { titulo: 'Queimada de teste', vento: 'BAIXO', pessoasRisco: false }]) {
      const r = await editar(alerta.id, corpo);
      expect(r.status).toBe(200);
      expect(r.body.historico).toHaveLength(1);
      expect(r.body.atualizadoEm).toBe(alerta.atualizadoEm);
    }
  });
});

// ------------------------------------------------------------
describe('regras e validações', () => {
  test('todos os perfis editam', async () => {
    const alerta = await criar();
    for (const [perfil, titulo] of [['admin', 'A'], ['gestor', 'G'], ['operador', 'O']]) {
      expect((await editar(alerta.id, { titulo }, perfil)).status).toBe(200);
    }
  });

  test.each([
    ['latitude', { latitude: -10 }],
    ['longitude', { longitude: -50 }],
    ['endereço', { municipio: 'Cuiabá' }],
    ['tipo de ocorrência', { tipoOcorrencia: 'INCENDIO_URBANO' }],
    ['zona urbana (cliente antigo)', { zonaUrbana: true }],
    ['status (tem rota própria)', { status: 'EM_ANALISE' }],
    ['campo editável junto com um bloqueado', { titulo: 'Novo', latitude: -10 }]
  ])('%s → 422, sem alterar nada', async (_caso, corpo) => {
    const alerta = await criar();
    const r = await editar(alerta.id, corpo);
    expect(r.status).toBe(422);
    expect(r.body.erro).toMatch(/não editáveis/);
    const depois = await detalhes(alerta.id);
    expect(depois.titulo).toBe(alerta.titulo);
    expect(depois.historico).toHaveLength(1);
  });

  test.each([
    ['título vazio', { titulo: '   ' }],
    ['título longo', { titulo: 'x'.repeat(201) }],
    ['título não texto', { titulo: 5 }],
    ['descrição não texto', { descricao: 5 }],
    ['área inválida', { areaAfetada: 'ENORME' }],
    ['vento inválido', { vento: 'FORTE' }],
    ['pessoas em risco não booleano', { pessoasRisco: 'sim' }],
    ['bioma inválido', { bioma: 'MARTE' }],
    ['tipo de área inválido', { tipoArea: 'QUINTAL' }]
  ])('%s → 400, sem alterar nada', async (_caso, corpo) => {
    const alerta = await criar();
    expect((await editar(alerta.id, corpo)).status).toBe(400);
    expect((await detalhes(alerta.id)).historico).toHaveLength(1);
  });

  test('título com 200 caracteres é aceito', async () => {
    const alerta = await criar();
    expect((await editar(alerta.id, { titulo: 'x'.repeat(200) })).status).toBe(200);
  });

  test('alerta RESOLVIDO → 422 (editar e simular); em atendimento ainda pode ser editado', async () => {
    const alerta = await criar();
    for (const status of ['EM_ANALISE', 'EM_ATENDIMENTO']) {
      await request(app).patch(`/api/alertas/${alerta.id}/status`).set(comToken('operador')).send({ status });
    }
    expect((await editar(alerta.id, { titulo: 'Em atendimento' })).status).toBe(200);
    await request(app).patch(`/api/alertas/${alerta.id}/status`).set(comToken('operador')).send({ status: 'RESOLVIDO' });
    const r = await editar(alerta.id, { titulo: 'Depois de resolvido' });
    expect(r.status).toBe(422);
    expect(r.body.erro).toBe('Alerta resolvido não pode ser editado');
    expect((await simular(alerta.id, { vento: 'ALTO' })).status).toBe(422);
    expect((await detalhes(alerta.id)).titulo).toBe('Em atendimento');
  });

  test('alerta excluído ou inexistente → 404', async () => {
    const alerta = await criar();
    await request(app).delete(`/api/alertas/${alerta.id}`).set(comToken('gestor'));
    expect((await editar(alerta.id, { titulo: 'x' })).status).toBe(404);
    expect((await editar(99999, { titulo: 'x' })).status).toBe(404);
    expect((await simular(99999, { vento: 'ALTO' })).status).toBe(404);
  });

  test('sem token → 401', async () => {
    expect((await request(app).patch('/api/alertas/1').send({ titulo: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/alertas/1/risco/simulacao').send({})).status).toBe(401);
  });
});

// ------------------------------------------------------------
describe('POST /api/alertas/:id/risco/simulacao', () => {
  test('informa a mudança de nível sem gravar nada, e coincide com a edição feita em seguida', async () => {
    const alerta = await criar();
    const corpo = { areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true };
    global.fetch.mockClear();
    const s = await simular(alerta.id, corpo);
    expect(s.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(s.body).toMatchObject({ alertaId: alerta.id, recalculado: true, nivelAtual: alerta.risco, irsAtual: alerta.irs, mudaNivel: true });

    const intacto = await detalhes(alerta.id);
    expect(intacto).toMatchObject({ areaAfetada: 'PEQUENA', irs: alerta.irs, risco: alerta.risco, atualizadoEm: alerta.atualizadoEm });
    expect(intacto.historico).toHaveLength(1);

    const r = await editar(alerta.id, corpo);
    expect({ nivel: r.body.risco, irs: r.body.irs }).toEqual({ nivel: s.body.nivelNovo, irs: s.body.irsNovo });
  });

  test('só título → não recalcula; mesma validação da edição', async () => {
    const alerta = await criar();
    expect((await simular(alerta.id, { titulo: 'Outro' })).body).toMatchObject({ recalculado: false, mudaNivel: false, nivelNovo: alerta.risco });
    expect((await simular(alerta.id, { vento: 'FORTE' })).status).toBe(400);
    expect((await simular(alerta.id, { latitude: 1 })).status).toBe(422);
  });
});
