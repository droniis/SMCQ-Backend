// ============================================================
// TESTES DA API (Jest + Supertest)
// O servidor é importado sem abrir porta. As bases externas são
// simuladas pelo fetch falso (tests/helpers/fetchFalso.js): nenhum
// teste depende de internet.
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');
const cache = require('../services/cacheService');
const geodadosService = require('../services/geodadosService');
const { PESOS_AHP_V2 } = require('../services/riscoService');

const fetchOriginal = global.fetch;
let falso;
let app;
const tokens = {};

const PANTANAL = { lat: -16.68, lng: -56.67 };
const novoAlerta = (campos = {}) => ({
  titulo: 'Queimada de teste',
  areaAfetada: 'GRANDE',
  vento: 'ALTO',
  pessoasRisco: false,
  latitude: PANTANAL.lat,
  longitude: PANTANAL.lng,
  ...campos
});

const comToken = (perfil) => ({ Authorization: `Bearer ${tokens[perfil]}` });
const criar = (campos, perfil = 'operador') => request(app).post('/api/alertas').set(comToken(perfil)).send(novoAlerta(campos));

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {}); // o geodadosService registra cada consulta
  falso = criarFetchFalso();
  global.fetch = jest.fn(falso.fetchFalso);
  app = require('../server');
  for (const [perfil, email, senha] of [
    ['admin', 'admin@smcq.com', 'admin123'],
    ['operador', 'operador@smcq.com', 'operador123'],
    ['gestor', 'gestor@smcq.com', 'gestor123']
  ]) {
    const resposta = await request(app).post('/api/login').send({ email, senha });
    tokens[perfil] = resposta.body.token;
  }
});

beforeEach(() => {
  cache.limpar();
  falso.cenario.falhar = [];
  falso.cenario.ucDentro = [];
});

afterAll(() => {
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

// ------------------------------------------------------------
describe('POST /api/alertas com o IRS v2', () => {
  test('grava versaoAlgoritmo "IRS v2", os 9 critérios, o nível e os geodados com as fontes', async () => {
    const r = await criar();
    expect(r.status).toBe(201);
    expect(r.body.versaoAlgoritmo).toBe('IRS v2');
    expect(Object.keys(r.body.detalhes).sort()).toEqual(Object.keys(PESOS_AHP_V2).sort());
    expect(['BAIXO', 'MODERADO', 'ALTO', 'CRITICO']).toContain(r.body.risco);
    expect(r.body.irs).toBeGreaterThan(0);
    expect(r.body.pontuacaoRisco).toBe(r.body.irs);
    expect(r.body.sigmoide).toBeGreaterThan(0);
    expect(r.body.bioma).toBe('PANTANAL');
    expect(r.body.biomaOrigem).toBe('detectado');
    expect(r.body.tipoArea).toBe('RURAL');
    expect(r.body.tipoAreaOrigem).toBe('detectado');
    expect(r.body.areaCriticaFauna).toBe('AMEACADA');
    expect(r.body.proximaUC).toBe(false);
    expect(r.body.geodados.fontes).toEqual({ bioma: 'IBGE WFS', uc: 'ICMBio WFS', ti: 'FUNAI WFS', fauna: 'GBIF API', focos: 'INPE CSV' });
    expect(Object.keys(r.body.geodados.obtidoEm).sort()).toEqual(['bioma', 'fauna', 'focos', 'ti', 'uc']);
  });

  test('bioma e tipo de área informados prevalecem sobre os detectados e ficam com origem "informado"', async () => {
    // O ponto está dentro de uma UC federal: o detectado seria UC_FEDERAL
    falso.cenario.ucDentro = [{ nomeuc: 'PARQUE NACIONAL DE TESTE', categoria_: 'Parque', esferaadm: 'federal', grupouc: 'PI' }];
    const r = await criar({ bioma: 'Cerrado', tipoArea: 'APP' });
    expect(r.status).toBe(201);
    expect(r.body.bioma).toBe('CERRADO');
    expect(r.body.biomaOrigem).toBe('informado');
    expect(r.body.tipoArea).toBe('APP');
    expect(r.body.tipoAreaOrigem).toBe('informado');
    expect(r.body.detalhes.bioma.fator).toBe(0.7);
    expect(r.body.detalhes.tipoArea.fator).toBe(0.8);
    // Relevância continua máxima: o ponto está dentro de uma UC
    expect(r.body.detalhes.relevancia.fator).toBe(1);
    // Os geodados gravados continuam os detectados, sem alteração
    expect(r.body.geodados.bioma).toBe('PANTANAL');
    expect(r.body.geodados.unidadeConservacao.nome).toBe('PARQUE NACIONAL DE TESTE');
  });

  test('sem informar, o detectado vale: UC federal detectada → UC_FEDERAL', async () => {
    falso.cenario.ucDentro = [{ nomeuc: 'PARQUE NACIONAL DE TESTE', categoria_: 'Parque', esferaadm: 'federal', grupouc: 'PI' }];
    const r = await criar();
    expect(r.body.tipoArea).toBe('UC_FEDERAL');
    expect(r.body.tipoAreaOrigem).toBe('detectado');
    expect(r.body.proximaUC).toBe(true);
  });

  test('bioma ou tipo de área fora da tabela → 400, e o alerta não é criado', async () => {
    const antes = (await request(app).get('/api/alertas').set(comToken('operador'))).body.length;
    const r1 = await criar({ bioma: 'Savana' });
    const r2 = await criar({ tipoArea: 'QUINTAL' });
    expect(r1.status).toBe(400);
    expect(r1.body.erro).toMatch(/Bioma inválido/);
    expect(r2.status).toBe(400);
    expect(r2.body.erro).toMatch(/Tipo de área inválido/);
    expect((await request(app).get('/api/alertas').set(comToken('operador'))).body.length).toBe(antes);
  });

  test('com TODAS as APIs externas falhando, o alerta é criado com fallback e as fontes registram isso', async () => {
    falso.cenario.falhar = ['IBGE', 'ICMBio', 'FUNAI', 'GBIF', 'INPE'];
    const r = await criar();
    expect(r.status).toBe(201);
    expect(r.body.versaoAlgoritmo).toBe('IRS v2');
    for (const fonte of Object.values(r.body.geodados.fontes)) expect(fonte).toMatch(/^fallback/);
    expect(r.body.geodados.fontes.bioma).toBe('fallback-centroides');
    expect(r.body.bioma).toBe('PANTANAL'); // centróide mais próximo
    expect(r.body.areaCriticaFauna).toBe('SEM_ESPECIES');
  });

  test('falha inesperada do próprio geodadosService → alerta criado com o fallback do IRS', async () => {
    const espiao = jest.spyOn(geodadosService, 'obterGeodadosCompletos').mockRejectedValueOnce(new Error('erro inesperado'));
    const r = await criar();
    espiao.mockRestore();
    expect(r.status).toBe(201);
    expect(r.body.geodados).toBeNull();
    expect(r.body.detalhes.bioma.fonte).toBe('fallback-centroides');

    // Sem geodados gravados, GET /:id/geodados consulta em tempo real
    const g = await request(app).get(`/api/alertas/${r.body.id}/geodados`).set(comToken('operador'));
    expect(g.status).toBe(200);
    expect(g.body.origem).toBe('tempo-real');
    expect(g.body.geodados.fontes.bioma).toBe('IBGE WFS');
  });

  test('POST no mesmo ponto do preview reaproveita o cache: nenhuma consulta externa nova', async () => {
    await request(app).get(`/api/alertas/geodados-preview?lat=${PANTANAL.lat}&lng=${PANTANAL.lng}`).set(comToken('operador'));
    const chamadasAntes = falso.chamadas.length;
    const r = await criar();
    expect(r.status).toBe(201);
    expect(falso.chamadas.length).toBe(chamadasAntes);
  });

  test('validações: campos obrigatórios e coordenadas', async () => {
    expect((await request(app).post('/api/alertas').set(comToken('operador')).send({ titulo: 'x' })).status).toBe(400);
    expect((await criar({ latitude: 95 })).status).toBe(400);
    expect((await criar({ longitude: 'abc' })).status).toBe(400);
  });
});

// ------------------------------------------------------------
describe('GET /api/alertas/geodados-preview', () => {
  test('coordenadas válidas → 200 com os geodados e as fontes', async () => {
    const r = await request(app).get('/api/alertas/geodados-preview?lat=-16.68&lng=-56.67').set(comToken('operador'));
    expect(r.status).toBe(200);
    expect(r.body.bioma).toBe('PANTANAL');
    expect(r.body.fontes.bioma).toBe('IBGE WFS');
    expect(r.body.fauna.nivel).toBe('AMEACADA');
    expect(r.body.focos.total).toBe(7); // a mesma linha do CSV falso em cada um dos 7 dias
  });

  test.each([
    ['lat=abc&lng=-56.67'],
    ['lat=-95&lng=-56.67'],
    ['lat=-16.68&lng=181'],
    ['lat=-16.68'],
    ['lat=&lng=-56.67'],
    ['lat=0x10&lng=-56.67']
  ])('coordenadas inválidas (%s) → 400', async (consulta) => {
    const r = await request(app).get(`/api/alertas/geodados-preview?${consulta}`).set(comToken('operador'));
    expect(r.status).toBe(400);
  });

  test('sem autenticação → 401; token inválido → 401', async () => {
    expect((await request(app).get('/api/alertas/geodados-preview?lat=-16.68&lng=-56.67')).status).toBe(401);
    expect((await request(app).get('/api/alertas/geodados-preview?lat=-16.68&lng=-56.67').set('Authorization', 'Bearer abc')).status).toBe(401);
  });
});

// ------------------------------------------------------------
describe('GET /api/alertas/:id/geodados e /:id/risco', () => {
  test('geodados gravados → origem "salvo", idênticos aos do POST', async () => {
    const criado = (await criar()).body;
    const r = await request(app).get(`/api/alertas/${criado.id}/geodados`).set(comToken('gestor'));
    expect(r.status).toBe(200);
    expect(r.body.origem).toBe('salvo');
    expect(r.body.geodados).toEqual(criado.geodados);
  });

  test('/risco devolve o cálculo gravado do v2', async () => {
    const criado = (await criar()).body;
    const r = await request(app).get(`/api/alertas/${criado.id}/risco`).set(comToken('operador'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ alertaId: criado.id, irs: criado.irs, sigmoide: criado.sigmoide, nivel: criado.risco, detalhes: criado.detalhes, versaoAlgoritmo: 'IRS v2' });
  });

  test('alerta inexistente → 404', async () => {
    expect((await request(app).get('/api/alertas/99999/geodados').set(comToken('operador'))).status).toBe(404);
    expect((await request(app).get('/api/alertas/99999/risco').set(comToken('operador'))).status).toBe(404);
  });
});

// ------------------------------------------------------------
describe('regras de exclusão (inalteradas)', () => {
  test('operador NÃO exclui diretamente (403); pode solicitar a exclusão (201)', async () => {
    const { id } = (await criar()).body;
    const del = await request(app).delete(`/api/alertas/${id}`).set(comToken('operador'));
    expect(del.status).toBe(403);
    const sol = await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'duplicado' });
    expect(sol.status).toBe(201);
    expect(sol.body.status).toBe('PENDENTE');
    // Segunda solicitação pendente → 409; sem motivo → 400
    expect((await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'de novo' })).status).toBe(409);
    expect((await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: ' ' })).status).toBe(400);
  });

  test('gestor exclui diretamente (200) e o alerta some da listagem', async () => {
    const { id } = (await criar()).body;
    const del = await request(app).delete(`/api/alertas/${id}`).set(comToken('gestor'));
    expect(del.status).toBe(200);
    expect(del.body.excluido).toBe(true);
    const lista = (await request(app).get('/api/alertas').set(comToken('operador'))).body;
    expect(lista.some(a => a.id === id)).toBe(false);
    expect((await request(app).delete(`/api/alertas/${id}`).set(comToken('gestor'))).status).toBe(404);
  });

  test('administrador exclui diretamente (200) e a solicitação pendente fica APROVADA', async () => {
    const { id } = (await criar()).body;
    await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'teste' });
    const del = await request(app).delete(`/api/alertas/${id}`).set(comToken('admin'));
    expect(del.status).toBe(200);
    expect(del.body.solicitacoesExclusao[0].status).toBe('APROVADA');
  });

  test('gestor e administrador não solicitam exclusão (400); só eles avaliam solicitações', async () => {
    const { id } = (await criar()).body;
    expect((await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('gestor')).send({ motivo: 'x' })).status).toBe(400);
    expect((await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('admin')).send({ motivo: 'x' })).status).toBe(400);

    const sol = (await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'x' })).body;
    const url = `/api/alertas/${id}/solicitacoes-exclusao/${sol.id}`;
    expect((await request(app).patch(url).set(comToken('operador')).send({ decisao: 'APROVADA' })).status).toBe(403);
    expect((await request(app).patch(url).set(comToken('gestor')).send({ decisao: 'TALVEZ' })).status).toBe(400);
    const ok = await request(app).patch(url).set(comToken('gestor')).send({ decisao: 'REJEITADA', resposta: 'manter' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('REJEITADA');
    expect((await request(app).patch(url).set(comToken('admin')).send({ decisao: 'APROVADA' })).status).toBe(409);
  });

  test('aprovar a solicitação exclui o alerta', async () => {
    const { id } = (await criar()).body;
    const sol = (await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'x' })).body;
    const r = await request(app).patch(`/api/alertas/${id}/solicitacoes-exclusao/${sol.id}`).set(comToken('admin')).send({ decisao: 'APROVADA' });
    expect(r.status).toBe(200);
    expect((await request(app).get(`/api/alertas/${id}/risco`).set(comToken('admin'))).status).toBe(404);
  });
});

// ------------------------------------------------------------
describe('regressão: rotas existentes', () => {
  test('login: credenciais corretas → token; e-mail desconhecido ou senha errada → 401', async () => {
    const ok = await request(app).post('/api/login').send({ email: 'gestor@smcq.com', senha: 'gestor123' });
    expect(ok.status).toBe(200);
    expect(ok.body.usuario).toEqual({ id: 3, nome: 'Gestor', email: 'gestor@smcq.com', perfil: 'GESTOR', senhaProvisoria: false });
    expect((await request(app).post('/api/login').send({ email: 'x@smcq.com', senha: 'a' })).status).toBe(401);
    expect((await request(app).post('/api/login').send({ email: 'gestor@smcq.com', senha: 'errada' })).status).toBe(401);
  });

  test('rotas protegidas sem token → 401', async () => {
    expect((await request(app).get('/api/alertas')).status).toBe(401);
    expect((await request(app).post('/api/alertas').send(novoAlerta())).status).toBe(401);
  });

  test('GET /api/alertas lista os alertas com versaoAlgoritmo', async () => {
    await criar();
    const r = await request(app).get('/api/alertas').set(comToken('operador'));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    for (const a of r.body) expect(a.versaoAlgoritmo).toBe('IRS v2');
  });

  test('a criação gera o 1º registro do histórico (status Novo, sem valor anterior, pelo criador)', async () => {
    const r = await criar({}, 'operador');
    expect(r.status).toBe(201);
    expect(r.body.historico).toEqual([
      { campo: 'status', valorAnterior: null, valorNovo: 'NOVO', alteradoPor: 2, alteradoEm: r.body.criadoEm }
    ]);
    expect(r.body.atualizadoEm).toBe(r.body.criadoEm);
    // O registro é persistido, não só devolvido na resposta
    const lido = (await request(app).get('/api/alertas').set(comToken('gestor'))).body.find(a => a.id === r.body.id);
    expect(lido.historico).toEqual(r.body.historico);
  });

  test('exclusão acrescenta o registro "excluido" depois do da criação', async () => {
    const { id } = (await criar()).body;
    const del = await request(app).delete(`/api/alertas/${id}`).set(comToken('admin'));
    expect(del.body.historico.map(h => h.campo)).toEqual(['status', 'excluido']);
    expect(del.body.historico[1]).toMatchObject({ valorAnterior: false, valorNovo: true, alteradoPor: 1 });
  });

  test('PATCH status: válido → 200 com histórico; inválido → 400; inexistente → 404', async () => {
    const { id } = (await criar()).body;
    const r = await request(app).patch(`/api/alertas/${id}/status`).set(comToken('operador')).send({ status: 'EM_ANALISE' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('EM_ANALISE');
    // historico[0] é o registro da criação; a mudança de status vem em seguida
    expect(r.body.historico).toHaveLength(2);
    expect(r.body.historico[1]).toMatchObject({ campo: 'status', valorAnterior: 'NOVO', valorNovo: 'EM_ANALISE' });
    expect((await request(app).patch(`/api/alertas/${id}/status`).set(comToken('operador')).send({ status: 'XYZ' })).status).toBe(400);
    expect((await request(app).patch('/api/alertas/99999/status').set(comToken('operador')).send({ status: 'NOVO' })).status).toBe(404);
  });

  test('POST observações → 200', async () => {
    const { id } = (await criar()).body;
    const r = await request(app).post(`/api/alertas/${id}/observacoes`).set(comToken('operador')).send({ observacao: 'equipe a caminho' });
    expect(r.status).toBe(200);
    expect(r.body.observacoes[0].texto).toBe('equipe a caminho');
    expect((await request(app).post('/api/alertas/99999/observacoes').set(comToken('operador')).send({ observacao: 'x' })).status).toBe(404);
  });

  test('GET /api/solicitacoes-exclusao: operador vê só as próprias; gestor vê todas; filtro por status', async () => {
    const { id } = (await criar()).body;
    await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken('operador')).send({ motivo: 'listagem' });
    const doOperador = (await request(app).get('/api/solicitacoes-exclusao').set(comToken('operador'))).body;
    expect(doOperador.length).toBeGreaterThan(0);
    expect(doOperador.every(s => s.solicitadoPor === 2)).toBe(true);
    const pendentes = (await request(app).get('/api/solicitacoes-exclusao?status=PENDENTE').set(comToken('gestor'))).body;
    expect(pendentes.every(s => s.status === 'PENDENTE')).toBe(true);
    expect(pendentes.some(s => s.alertaId === id && s.solicitadoPorNome === 'Operador')).toBe(true);
  });
});
