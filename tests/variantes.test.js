// Variantes meteorológicas do IRS (somente análise; pré-registro de 29/10/2026)
const V = require('../scripts/analises/variantes');
const { sigmoide, classificar } = require('../services/riscoService');

describe('fatorRiscoFogo', () => {
  test('usa o Risco de Fogo do INPE entre 0 e 1', () => {
    expect(V.fatorRiscoFogo(0)).toBe(0);
    expect(V.fatorRiscoFogo(0.42)).toBe(0.42);
    expect(V.fatorRiscoFogo(1)).toBe(1);
  });

  test('ausente ou negativo (−999 no CSV do INPE) vira 0,5', () => {
    expect(V.fatorRiscoFogo(null)).toBe(0.5);
    expect(V.fatorRiscoFogo(undefined)).toBe(0.5);
    expect(V.fatorRiscoFogo(-999)).toBe(0.5);
    expect(V.fatorRiscoFogo(NaN)).toBe(0.5);
  });

  test('limita a 1', () => {
    expect(V.fatorRiscoFogo(1.3)).toBe(1);
  });
});

describe('fatorFrp', () => {
  test('escala logarítmica com teto em 500 MW', () => {
    expect(V.fatorFrp(500)).toBeCloseTo(1, 10);
    expect(V.fatorFrp(5000)).toBe(1);
    expect(V.fatorFrp(17.9)).toBeCloseTo(Math.log(18.9) / Math.log(501), 10);
  });

  test('ausente, zero ou negativo vira 0', () => {
    expect(V.fatorFrp(null)).toBe(0);
    expect(V.fatorFrp(0)).toBe(0);
    expect(V.fatorFrp(-1)).toBe(0);
  });
});

describe('irsM e irsMF', () => {
  test('pesos do pré-registro somam 1', () => {
    expect(V.PESO_V2_M + V.PESO_RF_M).toBeCloseTo(1, 10);
    expect(V.PESO_V2_MF + V.PESO_RF_MF + V.PESO_FRP_MF).toBeCloseTo(1, 10);
  });

  test('IRS-M = 0,75 × IRS v2 + 0,25 × RF, com a sigmoide e os limites do IRS v2', () => {
    const r = V.irsM(0.4, 0.8);
    expect(r.escore).toBeCloseTo(0.75 * 0.4 + 0.25 * 0.8, 10);
    expect(r.sigmoide).toBeCloseTo(sigmoide(r.escore), 10);
    expect(r.nivel).toBe(classificar(sigmoide(r.escore)));
  });

  test('IRS-MF = 0,65 × IRS v2 + 0,25 × RF + 0,10 × F(FRP)', () => {
    const r = V.irsMF(0.4, 0.8, 100);
    expect(r.escore).toBeCloseTo(0.65 * 0.4 + 0.25 * 0.8 + 0.10 * V.fatorFrp(100), 10);
    expect(r.nivel).toBe(classificar(sigmoide(r.escore)));
  });

  test('Risco de Fogo alto eleva o nível em relação ao IRS v2 com o mesmo escore', () => {
    expect(V.irsM(0.45, 1).escore).toBeGreaterThan(0.45);
    expect(V.irsM(0.45, 0).escore).toBeLessThan(0.45);
  });

  test('RF ausente usa 0,5', () => {
    expect(V.irsM(0.4, null).escore).toBeCloseTo(0.75 * 0.4 + 0.25 * 0.5, 10);
  });
});
