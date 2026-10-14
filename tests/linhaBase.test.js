// Testes da linha de base (services/linhaBaseService.js).
// Os valores esperados foram calculados à mão; a conta está em cada teste.
const {
  calcularLinhaBase,
  classificarEscore,
  alinhamentoLinear,
  normalizarUrbano,
  normalizarTempo,
  LIMIARES
} = require('../services/linhaBaseService');
const { sigmoide, classificar, PESOS_AHP_V2 } = require('../services/riscoService');

const BRASILIA = { nome: 'Brasília', lat: -15.7939, lng: -47.8828 };
// Graus de latitude correspondentes a 1 km no Haversine (R = 6371 km)
const GRAUS_POR_KM = 180 / (6371 * Math.PI);
// Ponto ao sul de Brasília, a `km` quilômetros. Brasília continua a cidade mais próxima.
const aoSulDeBrasilia = (km) => ({ latitude: BRASILIA.lat - km * GRAUS_POR_KM, longitude: BRASILIA.lng });

const geo = (campos = {}) => ({
  bioma: 'CERRADO',
  unidadeConservacao: null,
  terraIndigena: null,
  fauna: { total: 0, nivel: 'SEM_ESPECIES' },
  faixaAreaProtegida: '>50 km',
  ...campos
});

describe('limiares de nível', () => {
  test('são os pontos em que a sigmoide do IRS vale 0,25 / 0,50 / 0,75', () => {
    // x = 0,5 + ln(p / (1 − p)) / 10
    expect(LIMIARES.MODERADO).toBeCloseTo(0.5 - Math.log(3) / 10, 12); // 0,390139
    expect(LIMIARES.ALTO).toBeCloseTo(0.5, 12);
    expect(LIMIARES.CRITICO).toBeCloseTo(0.5 + Math.log(3) / 10, 12);  // 0,609861
  });

  test('classificam igual ao IRS (classificar(sigmoide(x))) em todo o intervalo [0, 1]', () => {
    for (let i = 0; i <= 10000; i++) {
      const x = i / 10000;
      const pertoDeUmLimiar = Object.values(LIMIARES).some(l => Math.abs(x - l) < 1e-9);
      if (pertoDeUmLimiar) continue;
      expect(classificarEscore(x)).toBe(classificar(sigmoide(x)));
    }
  });

  test('cada faixa', () => {
    expect(classificarEscore(0.39)).toBe('BAIXO');
    expect(classificarEscore(0.391)).toBe('MODERADO');
    expect(classificarEscore(0.4999)).toBe('MODERADO');
    expect(classificarEscore(0.5)).toBe('ALTO');
    expect(classificarEscore(0.6098)).toBe('ALTO');
    expect(classificarEscore(0.61)).toBe('CRITICO');
  });
});

describe('normalizações lineares', () => {
  test('urbano: 1 na cidade, 0,5 a 25 km, 0 a partir de 50 km', () => {
    expect(normalizarUrbano(0)).toBe(1);
    expect(normalizarUrbano(25)).toBe(0.5);
    expect(normalizarUrbano(50)).toBe(0);
    expect(normalizarUrbano(120)).toBe(0);
  });

  test('vento: alinhamento linear no ângulo (e não cosseno)', () => {
    // Alerta ao sul da cidade: o vetor alerta → cidade aponta para o Norte (0°)
    const { latitude, longitude } = aoSulDeBrasilia(100);
    const alinhamento = (graus) => alinhamentoLinear(graus, latitude, longitude, BRASILIA);
    expect(alinhamento(0)).toBeCloseTo(1, 10);     // soprando para a cidade
    expect(alinhamento(45)).toBeCloseTo(0.75, 10); // 1 − 45/180 (o IRS daria (1 + cos 45°)/2 ≈ 0,854)
    expect(alinhamento(90)).toBeCloseTo(0.5, 10);
    expect(alinhamento(180)).toBeCloseTo(0, 10);   // soprando para longe
    expect(alinhamento(270)).toBeCloseTo(0.5, 10);
    expect(alinhamento(315)).toBeCloseTo(0.75, 10);
  });

  test('tempo: dA/dt ÷ 2, limitado a 1; sem dado vale 0,3 (mesmo padrão do IRS)', () => {
    expect(normalizarTempo(1)).toBe(0.5);
    expect(normalizarTempo(2)).toBe(1);
    expect(normalizarTempo(5)).toBe(1);
    expect(normalizarTempo(0)).toBe(0.3);
    expect(normalizarTempo(undefined)).toBe(0.3);
  });
});

describe('calcularLinhaBase', () => {
  test('todos os critérios no máximo → escore 1, CRÍTICO', () => {
    // Na cidade (urbano 1), vento ALTO soprando para o leste com o alvo a leste (atan2(0, 0) = 0)
    const r = calcularLinhaBase(
      { latitude: BRASILIA.lat, longitude: BRASILIA.lng, areaAfetada: 'GRANDE', vento: 'ALTO', direcaoVento: 90, pessoasRisco: true, dA_dt: 2 },
      geo({ bioma: 'AMAZONIA', terraIndigena: { nome: 'TI de teste' }, fauna: { total: 1, nivel: 'CRITICA' } })
    );
    expect(Object.values(r.detalhes.criterios).every(v => v === 1)).toBe(true);
    expect(r.score).toBe(1);
    expect(r.nivel).toBe('CRITICO');
  });

  test('caso A: ponto rural a 111 km de Brasília → 0,2772, BAIXO', () => {
    // área PEQUENA 0,33 · urbano 0 · vento (0,33 + 0) / 2 = 0,165 · pessoas 0 · tempo 0,3
    // bioma CERRADO 0,7 · tipo RURAL 0,4 · fauna SEM_ESPECIES 0,3 · relevância >50 km 0,3
    // soma 2,495 ÷ 9 = 0,277222
    const r = calcularLinhaBase(
      { ...aoSulDeBrasilia(111.19), areaAfetada: 'PEQUENA', vento: 'BAIXO', direcaoVento: 180, pessoasRisco: false },
      geo()
    );
    expect(r.detalhes.criterios).toEqual({
      area: 0.33, urbano: 0, vento: 0.165, pessoas: 0, tempo: 0.3,
      bioma: 0.7, tipoArea: 0.4, fauna: 0.3, relevancia: 0.3
    });
    expect(r.score).toBeCloseTo(2.495 / 9, 4);
    expect(r.nivel).toBe('BAIXO');
  });

  test('caso B: perto do limiar ALTO → 0,4933, MODERADO', () => {
    // área MEDIA 0,66 · urbano (25 km) 0,5 · vento (0,66 + 0,5) / 2 = 0,58 · pessoas 0 · tempo 0,3
    // bioma CAATINGA 0,6 · tipo RURAL 0,4 · fauna AMEACADA 0,8 · relevância 10-50 km 0,6
    // soma 4,44 ÷ 9 = 0,493333 (< 0,5)
    const r = calcularLinhaBase(
      { ...aoSulDeBrasilia(25), areaAfetada: 'MEDIA', vento: 'MODERADO', direcaoVento: 90, pessoasRisco: false, dA_dt: 0 },
      geo({ bioma: 'CAATINGA', fauna: { total: 2, nivel: 'AMEACADA' }, faixaAreaProtegida: '10-50 km' })
    );
    expect(r.detalhes.criterios.urbano).toBeCloseTo(0.5, 4);
    expect(r.detalhes.criterios.vento).toBeCloseTo(0.58, 4);
    expect(r.score).toBeCloseTo(4.44 / 9, 4);
    expect(r.nivel).toBe('MODERADO');
  });

  test('caso C: dentro de UC estadual a 25 km da cidade → 0,7944, CRÍTICO', () => {
    // área GRANDE 1 · urbano 0,5 · vento (1 + 1) / 2 = 1 · pessoas 1 · tempo 1 ÷ 2 = 0,5
    // bioma CERRADO 0,7 · tipo UC_ESTADUAL 0,85 · fauna VULNERAVEL 0,6 · relevância (dentro) 1
    // soma 7,15 ÷ 9 = 0,794444
    const r = calcularLinhaBase(
      { ...aoSulDeBrasilia(25), areaAfetada: 'GRANDE', vento: 'ALTO', direcaoVento: 0, pessoasRisco: true, dA_dt: 1 },
      geo({ unidadeConservacao: { nome: 'PE de teste', esfera: 'Estadual' }, fauna: { total: 1, nivel: 'VULNERAVEL' } })
    );
    expect(r.score).toBeCloseTo(7.15 / 9, 4);
    expect(r.nivel).toBe('CRITICO');
  });

  test('média sem pesos: o mesmo acréscimo em qualquer critério muda o escore em acréscimo ÷ 9', () => {
    // Tolerância de 3 casas: o score sai arredondado em 4, e a diferença de dois arredondados pode errar na 4ª
    const alerta = { ...aoSulDeBrasilia(111.19), areaAfetada: 'PEQUENA', vento: 'BAIXO', direcaoVento: 180, pessoasRisco: false };
    const base = calcularLinhaBase(alerta, geo()).score;
    // pessoas: 0 → 1 (+1); fauna: 0,3 → 1 (+0,7); bioma: 0,7 → 1 (+0,3)
    expect(calcularLinhaBase({ ...alerta, pessoasRisco: true }, geo()).score - base).toBeCloseTo(1 / 9, 3);
    expect(calcularLinhaBase(alerta, geo({ fauna: { nivel: 'CRITICA' } })).score - base).toBeCloseTo(0.7 / 9, 3);
    expect(calcularLinhaBase(alerta, geo({ bioma: 'AMAZONIA' })).score - base).toBeCloseTo(0.3 / 9, 3);
  });

  test('usa os mesmos nove critérios do IRS v2', () => {
    const r = calcularLinhaBase({ ...aoSulDeBrasilia(10), areaAfetada: 'MEDIA', vento: 'BAIXO', pessoasRisco: false }, geo());
    expect(Object.keys(r.detalhes.criterios).sort()).toEqual(Object.keys(PESOS_AHP_V2).sort());
  });

  test('sem geodados não quebra e cai nos mesmos fallbacks do IRS', () => {
    for (const ausente of [undefined, null, {}]) {
      const r = calcularLinhaBase({ latitude: -16.6869, longitude: -56.6744, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: false }, ausente);
      expect(r.detalhes.fontes.bioma).toBe('fallback-centroides');
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test('mesma entrada → mesma saída', () => {
    const alerta = { ...aoSulDeBrasilia(30), areaAfetada: 'MEDIA', vento: 'ALTO', direcaoVento: 123, pessoasRisco: true, dA_dt: 0.7 };
    expect(calcularLinhaBase(alerta, geo())).toEqual(calcularLinhaBase(alerta, geo()));
  });
});
