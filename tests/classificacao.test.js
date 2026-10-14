// Testes unitários de services/classificacaoService.js
const classificacao = require('../services/classificacaoService');
const geodadosService = require('../services/geodadosService');
const { calcularRiscoAvancado } = require('../services/riscoService');

// Geodados no formato de obterGeodadosCompletos: ponto dentro de UC federal no Pantanal
const GEO_UC = {
  bioma: 'PANTANAL',
  fonteBioma: 'IBGE WFS',
  unidadeConservacao: { nome: 'PARNA X', categoria: 'Parque', esfera: 'Federal' },
  terraIndigena: null,
  faixaAreaProtegida: '<10 km',
  fauna: { total: 3, nivel: 'CRITICA' },
  fontes: { bioma: 'IBGE WFS', uc: 'ICMBio WFS', ti: 'FUNAI WFS', fauna: 'GBIF API', focos: 'INPE CSV' }
};
const DADOS = { latitude: -16.68, longitude: -56.67, areaAfetada: 'MEDIA', vento: 'MODERADO', pessoasRisco: false };
const NADA_INFORMADO = { bioma: null, tipoArea: null };

beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterAll(() => jest.restoreAllMocks());

describe('lerCamposInformados', () => {
  test('normaliza nomes por extenso e com acento', () => {
    expect(classificacao.lerCamposInformados({ bioma: 'Mata Atlântica', tipoArea: 'uc estadual' }))
      .toEqual({ bioma: 'MATA_ATLANTICA', tipoArea: 'UC_ESTADUAL', erros: [] });
  });

  test('campo vazio ou ausente = não informado', () => {
    expect(classificacao.lerCamposInformados({ bioma: '', tipoArea: undefined })).toEqual({ bioma: null, tipoArea: null, erros: [] });
  });

  test('valor inexistente na tabela → erro (a rota responde 400)', () => {
    const r = classificacao.lerCamposInformados({ bioma: 'Savana', tipoArea: 'QUINTAL' });
    expect(r.bioma).toBeNull();
    expect(r.tipoArea).toBeNull();
    expect(r.erros).toHaveLength(2);
    expect(r.erros[0]).toMatch(/Bioma inválido: Savana/);
  });
});

describe('validarCoordenadas', () => {
  test.each([
    [-16.68, -56.67, true],
    ['-16.68', '-56.67', true],
    [90, 180, true],
    [90.1, 0, false],
    [0, -180.1, false],
    ['', '1', false],
    ['abc', '1', false],
    ['0x10', '1', false],
    [undefined, 1, false],
    [NaN, 1, false]
  ])('(%p, %p) → %p', (lat, lng, esperado) => {
    expect(classificacao.validarCoordenadas(lat, lng)).toBe(esperado);
  });
});

describe('classificarComGeodados', () => {
  test('sem nada informado, vale o detectado (origem "detectado")', () => {
    const r = classificacao.classificarComGeodados(DADOS, NADA_INFORMADO, GEO_UC);
    expect(r).toMatchObject({ bioma: 'PANTANAL', biomaOrigem: 'detectado', tipoArea: 'UC_FEDERAL', tipoAreaOrigem: 'detectado', areaCriticaFauna: 'CRITICA', proximaUC: true, versaoAlgoritmo: 'IRS v2' });
  });

  test('bioma e tipo de área informados prevalecem (origem "informado")', () => {
    const r = classificacao.classificarComGeodados(DADOS, { bioma: 'CAATINGA', tipoArea: 'RESERVA_LEGAL' }, GEO_UC);
    expect(r).toMatchObject({ bioma: 'CAATINGA', biomaOrigem: 'informado', tipoArea: 'RESERVA_LEGAL', tipoAreaOrigem: 'informado' });
    expect(r.detalhes.bioma.fator).toBe(0.6);
    expect(r.detalhes.tipoArea.fator).toBe(0.7);
    // A relevância não muda: o ponto está dentro da UC
    expect(r.detalhes.relevancia.fator).toBe(1);
  });

  test('os geodados originais são gravados sem alteração', () => {
    const copia = JSON.parse(JSON.stringify(GEO_UC));
    const r = classificacao.classificarComGeodados(DADOS, { bioma: 'CAATINGA', tipoArea: 'APP' }, GEO_UC);
    expect(GEO_UC).toEqual(copia);
    expect(r.geodados).toBe(GEO_UC);
  });
});

describe('classificarAlerta', () => {
  test('falha inesperada do geodadosService → cálculo com fallback do IRS, sem erro', async () => {
    const espiao = jest.spyOn(geodadosService, 'obterGeodadosCompletos').mockRejectedValueOnce(new Error('erro inesperado'));
    const r = await classificacao.classificarAlerta(DADOS);
    espiao.mockRestore();
    expect(r.geodados).toBeNull();
    expect(r.versaoAlgoritmo).toBe('IRS v2');
    expect(r.detalhes.bioma.fonte).toBe('fallback-centroides');
    expect(r.bioma).toBe('PANTANAL');
    expect(['BAIXO', 'MODERADO', 'ALTO', 'CRITICO']).toContain(r.risco);
  });

  test('coordenadas em texto são convertidas para número', async () => {
    const espiao = jest.spyOn(geodadosService, 'obterGeodadosCompletos').mockResolvedValueOnce(GEO_UC);
    const r = await classificacao.classificarAlerta({ ...DADOS, latitude: '-16.68', longitude: '-56.67' });
    expect(espiao).toHaveBeenCalledWith(-16.68, -56.67);
    espiao.mockRestore();
    expect(r.tipoArea).toBe('UC_FEDERAL');
  });
});

describe('detalhamentoDoRisco e versão', () => {
  test('alerta sem versaoAlgoritmo é tratado como "IRS v1" e recalculado pelo v1, como antes', () => {
    const antigo = { id: 7, ...DADOS, direcaoVento: 45, dA_dt: 0 };
    expect(classificacao.versaoDoAlerta(antigo)).toBe('IRS v1');
    const r = classificacao.detalhamentoDoRisco(antigo);
    const v1 = calcularRiscoAvancado(antigo);
    expect(r).toEqual({ alertaId: 7, irs: v1.irs, sigmoide: v1.sigmoide, nivel: v1.nivel, detalhes: v1.detalhes, versaoAlgoritmo: 'IRS v1' });
  });

  test('alerta do v2 devolve o cálculo GRAVADO, sem recalcular', () => {
    const gravado = { id: 8, ...classificacao.classificarComGeodados(DADOS, NADA_INFORMADO, GEO_UC) };
    gravado.irs = 0.1234; // se recalculasse, o valor seria outro
    const r = classificacao.detalhamentoDoRisco(gravado);
    expect(r.irs).toBe(0.1234);
    expect(r.versaoAlgoritmo).toBe('IRS v2');
    expect(r.nivel).toBe(gravado.risco);
  });
});
