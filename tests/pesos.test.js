// O parâmetro opcional `pesos` de calcularRiscoAvancadoV2 não muda nada quando omitido.
// A referência (fixtures/irs-v2-referencia.json) foi gerada com o código ANTERIOR à
// criação do parâmetro (commit registrado no próprio arquivo).
const { calcularRiscoAvancadoV2, PESOS_AHP_V2 } = require('../services/riscoService');
const referencia = require('./fixtures/irs-v2-referencia.json');

describe('calcularRiscoAvancadoV2: parâmetro opcional de pesos', () => {
  test(`sem o parâmetro, o resultado é idêntico ao do código anterior (${referencia.casos.length} casos, commit ${referencia.commit})`, () => {
    for (const { alerta, geodados, resultado } of referencia.casos) {
      expect(calcularRiscoAvancadoV2(alerta, geodados)).toEqual(resultado);
    }
  });

  test('passar os próprios pesos AHP v2 dá o mesmo resultado que omiti-los', () => {
    for (const { alerta, geodados } of referencia.casos) {
      expect(calcularRiscoAvancadoV2(alerta, geodados, PESOS_AHP_V2)).toEqual(calcularRiscoAvancadoV2(alerta, geodados));
    }
  });

  test('pesos alternativos são de fato usados', () => {
    const { alerta, geodados } = referencia.casos[0];
    const soBioma = Object.fromEntries(Object.keys(PESOS_AHP_V2).map(k => [k, k === 'bioma' ? 1 : 0]));
    const r = calcularRiscoAvancadoV2(alerta, geodados, soBioma);
    expect(r.irs).toBe(r.detalhes.bioma.fator);
    expect(r.detalhes.bioma.peso).toBe(1);
  });

  test('a constante PESOS_AHP_V2 não é alterada por quem passa outros pesos', () => {
    const copia = { ...PESOS_AHP_V2 };
    calcularRiscoAvancadoV2(referencia.casos[0].alerta, null, { ...PESOS_AHP_V2, bioma: 0.5 });
    expect(PESOS_AHP_V2).toEqual(copia);
  });
});
