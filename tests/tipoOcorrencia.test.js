// ============================================================
// TIPO DE OCORRÊNCIA (Etapa H)
// Criação com cada tipo, endereço obrigatório no incêndio urbano,
// compatibilidade com o antigo "zonaUrbana", filtro da listagem e
// a garantia de que o IRS não muda: o tipo só define o valor
// padrão da zona urbana, que já era uma entrada do cálculo.
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');
const cache = require('../services/cacheService');
const { calcularRiscoAvancadoV2 } = require('../services/riscoService');
const ocorrencia = require('../services/ocorrenciaService');
const referencia = require('./fixtures/irs-v2-referencia.json');

const fetchOriginal = global.fetch;
let falso;
let app;
let token;

const PANTANAL = { lat: -16.68, lng: -56.67 };
const ENDERECO_URBANO = { logradouro: 'Terreno baldio próximo à Rua das Flores', bairro: 'Centro', municipio: 'Cuiabá', estado: 'MT' };

const novoAlerta = (campos = {}) => ({
  titulo: 'Ocorrência de teste',
  areaAfetada: 'GRANDE',
  vento: 'ALTO',
  pessoasRisco: false,
  latitude: PANTANAL.lat,
  longitude: PANTANAL.lng,
  ...campos
});
const criar = (campos) => request(app).post('/api/alertas').set({ Authorization: `Bearer ${token}` }).send(novoAlerta(campos));
const listar = (consulta = '') => request(app).get(`/api/alertas${consulta}`).set({ Authorization: `Bearer ${token}` });

// O que o IRS produz para um alerta
const resultadoIrs = ({ irs, sigmoide, risco, detalhes, tipoArea, tipoAreaOrigem, areaCriticaFauna }) =>
  ({ irs, sigmoide, risco, detalhes, tipoArea, tipoAreaOrigem, areaCriticaFauna });

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  falso = criarFetchFalso();
  global.fetch = jest.fn(falso.fetchFalso);
  app = require('../server');
  token = (await request(app).post('/api/login').send({ email: 'operador@smcq.com', senha: 'operador123' })).body.token;
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
describe('ocorrenciaService', () => {
  test('resolverTipoOcorrencia: o tipo prevalece sobre zonaUrbana; sem tipo, vale a regra antiga', () => {
    expect(ocorrencia.resolverTipoOcorrencia({ tipoOcorrencia: 'INCENDIO_URBANO' }))
      .toEqual({ tipoOcorrencia: 'INCENDIO_URBANO', zonaUrbana: true, erro: null });
    expect(ocorrencia.resolverTipoOcorrencia({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', zonaUrbana: true }))
      .toEqual({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', zonaUrbana: false, erro: null });
    expect(ocorrencia.resolverTipoOcorrencia({ tipoOcorrencia: 'INCENDIO_URBANO', zonaUrbana: false }))
      .toEqual({ tipoOcorrencia: 'INCENDIO_URBANO', zonaUrbana: true, erro: null });
    expect(ocorrencia.resolverTipoOcorrencia({ zonaUrbana: true }))
      .toEqual({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', zonaUrbana: true, erro: null });
    expect(ocorrencia.resolverTipoOcorrencia({}))
      .toEqual({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', zonaUrbana: false, erro: null });
    expect(ocorrencia.resolverTipoOcorrencia({ tipoOcorrencia: 'FLORESTAL' }).erro).toMatch(/Tipo de ocorrência inválido/);
  });

  test('lerEndereco: apara os textos e põe a UF em maiúsculas no incêndio urbano', () => {
    const { endereco, erros } = ocorrencia.lerEndereco({ ...ENDERECO_URBANO, estado: ' mt ', numero: ' S/N ' }, 'INCENDIO_URBANO');
    expect(erros).toEqual([]);
    expect(endereco).toEqual({ ...ENDERECO_URBANO, cep: '', numero: 'S/N' });
  });
});

// ------------------------------------------------------------
describe('POST /api/alertas com tipo de ocorrência', () => {
  test('QUEIMADA_VEGETACAO: só coordenadas bastam; endereço vazio', async () => {
    const r = await criar({ tipoOcorrencia: 'QUEIMADA_VEGETACAO' });
    expect(r.status).toBe(201);
    expect(r.body.tipoOcorrencia).toBe('QUEIMADA_VEGETACAO');
    expect(r.body.zonaUrbana).toBe(false);
    expect(r.body.tipoArea).toBe('RURAL');
    expect(r.body).toMatchObject({ cep: '', logradouro: '', numero: '', bairro: '', municipio: '', estado: '' });
  });

  test('INCENDIO_URBANO com rua (ou ponto de referência), bairro, município e UF; sem CEP nem número', async () => {
    const r = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO });
    expect(r.status).toBe(201);
    expect(r.body.tipoOcorrencia).toBe('INCENDIO_URBANO');
    expect(r.body.zonaUrbana).toBe(true);
    // Sem UC/TI no ponto, o tipo de área padrão passa a ser URBANA
    expect(r.body.tipoArea).toBe('URBANA');
    expect(r.body).toMatchObject({ ...ENDERECO_URBANO, cep: '', numero: '' });
  });

  test('INCENDIO_URBANO: CEP de 8 dígitos e número "S/N" são aceitos', async () => {
    const r = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO, cep: '78005-000', numero: 'S/N' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ cep: '78005-000', numero: 'S/N' });
  });

  test('INCENDIO_URBANO: UC detectada no ponto continua prevalecendo sobre o padrão URBANA', async () => {
    falso.cenario.ucDentro = [{ nomeuc: 'PARQUE NACIONAL DE TESTE', categoria_: 'Parque', esferaadm: 'federal', grupouc: 'PI' }];
    const r = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO });
    expect(r.status).toBe(201);
    expect(r.body.tipoArea).toBe('UC_FEDERAL');
  });

  test('INCENDIO_URBANO: tipo de área informado pelo operador prevalece', async () => {
    const r = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO, tipoArea: 'APP' });
    expect(r.body.tipoArea).toBe('APP');
    expect(r.body.tipoAreaOrigem).toBe('informado');
  });

  test('pessoasRisco omitido continua false, mesmo no incêndio urbano', async () => {
    const { pessoasRisco: _omitido, ...semPessoas } = novoAlerta({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO });
    const r = await request(app).post('/api/alertas').set({ Authorization: `Bearer ${token}` }).send(semPessoas);
    expect(r.status).toBe(201);
    expect(r.body.pessoasRisco).toBe(false);
  });
});

// ------------------------------------------------------------
describe('validações do tipo e do endereço (400, nada é gravado)', () => {
  const total = async () => (await listar()).body.length;

  test('tipo de ocorrência inválido → 400', async () => {
    const antes = await total();
    const r = await criar({ tipoOcorrencia: 'FLORESTAL' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Tipo de ocorrência inválido: FLORESTAL/);
    expect(await total()).toBe(antes);
  });

  test('INCENDIO_URBANO sem endereço → 400 listando o que falta', async () => {
    const antes = await total();
    const r = await criar({ tipoOcorrencia: 'INCENDIO_URBANO' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe('Para incêndio em área urbana, informe: rua ou ponto de referência, bairro, município, UF');
    expect(await total()).toBe(antes);
  });

  test.each([
    ['logradouro', /rua ou ponto de referência/],
    ['bairro', /bairro/],
    ['municipio', /município/],
    ['estado', /UF/]
  ])('INCENDIO_URBANO sem %s (ou só com espaços) → 400', async (campo, mensagem) => {
    const r1 = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO, [campo]: undefined });
    const r2 = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO, [campo]: '   ' });
    for (const r of [r1, r2]) {
      expect(r.status).toBe(400);
      expect(r.body.erro).toMatch(mensagem);
    }
  });

  test('INCENDIO_URBANO com UF inexistente ou CEP incompleto → 400', async () => {
    const uf = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO, estado: 'XX' });
    expect(uf.status).toBe(400);
    expect(uf.body.erro).toMatch(/UF inválida: XX/);
    const cep = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO, cep: '7800' });
    expect(cep.status).toBe(400);
    expect(cep.body.erro).toMatch(/CEP inválido/);
  });

  test('QUEIMADA_VEGETACAO não valida o endereço (CEP e UF livres, como antes)', async () => {
    const r = await criar({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', cep: '7800', estado: 'Mato Grosso' });
    expect(r.status).toBe(201);
  });

  test('texto maior que a coluna do banco → 400 (em vez de erro na gravação)', async () => {
    const r = await criar({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', logradouro: 'x'.repeat(201) });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/logradouro aceita no máximo 200/);
  });
});

// ------------------------------------------------------------
describe('compatibilidade com o campo antigo zonaUrbana', () => {
  test('cliente antigo só com zonaUrbana: true → QUEIMADA_VEGETACAO, sem exigir endereço, tipo de área URBANA', async () => {
    const r = await criar({ zonaUrbana: true });
    expect(r.status).toBe(201);
    expect(r.body.tipoOcorrencia).toBe('QUEIMADA_VEGETACAO');
    expect(r.body.zonaUrbana).toBe(true);
    expect(r.body.tipoArea).toBe('URBANA');
  });

  test('sem tipoOcorrencia nem zonaUrbana → QUEIMADA_VEGETACAO e zona rural', async () => {
    const r = await criar();
    expect(r.body.tipoOcorrencia).toBe('QUEIMADA_VEGETACAO');
    expect(r.body.zonaUrbana).toBe(false);
    expect(r.body.tipoArea).toBe('RURAL');
  });

  test('tipoOcorrencia e zonaUrbana juntos → prevalece o tipoOcorrencia', async () => {
    const vegetacao = await criar({ tipoOcorrencia: 'QUEIMADA_VEGETACAO', zonaUrbana: true });
    expect(vegetacao.body.zonaUrbana).toBe(false);
    expect(vegetacao.body.tipoArea).toBe('RURAL');
    const urbano = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', zonaUrbana: false, ...ENDERECO_URBANO });
    expect(urbano.body.zonaUrbana).toBe(true);
    expect(urbano.body.tipoArea).toBe('URBANA');
  });
});

// ------------------------------------------------------------
describe('GET /api/alertas?tipoOcorrencia=', () => {
  test('filtra pelo tipo; sem o parâmetro, lista todos', async () => {
    await criar({ tipoOcorrencia: 'QUEIMADA_VEGETACAO' });
    await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO });
    const todos = (await listar()).body;
    const urbanos = (await listar('?tipoOcorrencia=INCENDIO_URBANO')).body;
    const vegetacao = (await listar('?tipoOcorrencia=QUEIMADA_VEGETACAO')).body;
    expect(urbanos.length).toBeGreaterThan(0);
    expect(vegetacao.length).toBeGreaterThan(0);
    expect(urbanos.every(a => a.tipoOcorrencia === 'INCENDIO_URBANO')).toBe(true);
    expect(vegetacao.every(a => a.tipoOcorrencia === 'QUEIMADA_VEGETACAO')).toBe(true);
    expect(urbanos.length + vegetacao.length).toBe(todos.length);
  });

  test('tipo inválido no filtro → 400', async () => {
    const r = await listar('?tipoOcorrencia=TODOS');
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Tipo de ocorrência inválido: TODOS/);
  });
});

// ------------------------------------------------------------
describe('o IRS não muda com o tipo de ocorrência', () => {
  test(`mesmas entradas → resultado idêntico à referência anterior à mudança (${referencia.casos.length} casos, commit ${referencia.commit})`, () => {
    for (const { alerta, geodados, resultado } of referencia.casos) {
      // Cliente antigo (só zonaUrbana) e cliente novo (tipo equivalente) chegam à mesma entrada do cálculo
      const antigo = ocorrencia.resolverTipoOcorrencia({ zonaUrbana: alerta.zonaUrbana });
      const tipo = alerta.zonaUrbana ? 'INCENDIO_URBANO' : 'QUEIMADA_VEGETACAO';
      const novo = ocorrencia.resolverTipoOcorrencia({ tipoOcorrencia: tipo });
      expect(calcularRiscoAvancadoV2({ ...alerta, zonaUrbana: antigo.zonaUrbana }, geodados)).toEqual(resultado);
      expect(calcularRiscoAvancadoV2({ ...alerta, zonaUrbana: novo.zonaUrbana }, geodados)).toEqual(resultado);
    }
  });

  test('pela API: zonaUrbana false ≡ QUEIMADA_VEGETACAO e zonaUrbana true ≡ INCENDIO_URBANO', async () => {
    const legadoRural = await criar({ zonaUrbana: false });
    const vegetacao = await criar({ tipoOcorrencia: 'QUEIMADA_VEGETACAO' });
    expect(resultadoIrs(vegetacao.body)).toEqual(resultadoIrs(legadoRural.body));

    const legadoUrbano = await criar({ zonaUrbana: true });
    const urbano = await criar({ tipoOcorrencia: 'INCENDIO_URBANO', ...ENDERECO_URBANO });
    expect(resultadoIrs(urbano.body)).toEqual(resultadoIrs(legadoUrbano.body));
  });
});
