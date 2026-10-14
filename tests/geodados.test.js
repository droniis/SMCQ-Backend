// Testes de services/geodadosService.js com as bases externas simuladas (sem internet):
// data real de obtenção (obtidoEm), fallback por fonte e aquecimento do cache do INPE.
const { criarFetchFalso } = require('./helpers/fetchFalso');
const cache = require('../services/cacheService');
const geodados = require('../services/geodadosService');

const fetchOriginal = global.fetch;
let falso;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  falso = criarFetchFalso();
  global.fetch = jest.fn(falso.fetchFalso);
});

beforeEach(() => {
  cache.limpar();
  falso.cenario.falhar = [];
  falso.chamadas.length = 0;
});

afterAll(() => {
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('obtidoEm: data real de obtenção de cada fonte', () => {
  test('dado reaproveitado do cache mantém a data da consulta original; timestamp é o da montagem', async () => {
    const primeiro = await geodados.obterGeodadosCompletos(-16.68, -56.67);
    await esperar(15);
    const segundo = await geodados.obterGeodadosCompletos(-16.68, -56.67);
    expect(segundo.obtidoEm).toEqual(primeiro.obtidoEm);
    expect(segundo.timestamp > primeiro.timestamp).toBe(true);
    for (const data of Object.values(primeiro.obtidoEm)) expect(Number.isNaN(Date.parse(data))).toBe(false);
  });

  test('focos: obtidoEm é a data do download do CSV mais antigo usado', async () => {
    const r = await geodados.obterGeodadosCompletos(-16.68, -56.67);
    expect(r.obtidoEm.focos).toBe(r.focos.arquivosBaixadosEm.maisAntigo);
  });
});

describe('fallback por fonte', () => {
  test('cada fonte que falha cai no próprio fallback; as demais seguem normais', async () => {
    falso.cenario.falhar = ['GBIF', 'FUNAI'];
    const r = await geodados.obterGeodadosCompletos(-16.68, -56.67);
    expect(r.fontes).toEqual({ bioma: 'IBGE WFS', uc: 'ICMBio WFS', ti: 'fallback-lista-tis', fauna: 'fallback-sem-dados', focos: 'INPE CSV' });
    expect(r.fauna.nivel).toBe('SEM_ESPECIES');
  });

  test('coordenadas inválidas rejeitam com RangeError (erro de quem chama, não de rede)', async () => {
    await expect(geodados.obterGeodadosCompletos('abc', 10)).rejects.toThrow(RangeError);
  });
});

describe('aquecimento do cache do INPE', () => {
  const chamadasInpe = () => falso.chamadas.filter(c => c.fonte === 'INPE').length;

  test('renovarFocosInpe baixa os 7 dias; depois disso, consultas não baixam mais nada', async () => {
    const r = await geodados.renovarFocosInpe();
    expect(r).toEqual({ carregados: 7, falhas: [] });
    expect(chamadasInpe()).toBe(7);
    const focos = await geodados.buscarFocosProximos(-16.68, -56.67, 50);
    expect(focos.diasConsultados).toBe(7);
    expect(chamadasInpe()).toBe(7);
  });

  test('INPE fora do ar: a renovação não lança erro, só registra a falha', async () => {
    falso.cenario.falhar = ['INPE'];
    const r = await geodados.renovarFocosInpe();
    expect(r.carregados).toBe(0);
    expect(r.falhas).toHaveLength(7);
  });

  test('uma renovação que falha não apaga os arquivos bons que já estavam em cache', async () => {
    await geodados.renovarFocosInpe();
    falso.cenario.falhar = ['INPE'];
    await geodados.renovarFocosInpe();
    const focos = await geodados.buscarFocosProximos(-16.68, -56.67, 50);
    expect(focos.diasConsultados).toBe(7);
  });

  test('falha de download fica guardada por alguns minutos: requisições seguintes não repetem a tentativa', async () => {
    falso.cenario.falhar = ['INPE'];
    await geodados.buscarFocosProximos(-16.68, -56.67, 50);
    const depoisDaPrimeira = chamadasInpe();
    await geodados.buscarFocosProximos(-10, -50, 50); // outro ponto: não usa o cache do ponto anterior
    expect(chamadasInpe()).toBe(depoisDaPrimeira);
  });

  test('downloads simultâneos do mesmo dia são feitos uma vez só', async () => {
    await Promise.all([geodados.renovarFocosInpe(), geodados.buscarFocosProximos(-16.68, -56.67, 50)]);
    expect(chamadasInpe()).toBe(7);
  });

  test('aquecerFocosInpe não bloqueia, não lança erro e devolve uma função que para as renovações', async () => {
    falso.cenario.falhar = ['INPE'];
    const parar = geodados.aquecerFocosInpe(60000);
    expect(typeof parar).toBe('function');
    await esperar(20); // a primeira carga roda em segundo plano
    parar();
    expect(chamadasInpe()).toBe(7);
  });
});
