// ============================================================
// TESTE DO IRS v2 COM GEODADOS MOCKADOS
// Valida calcularRiscoAvancadoV2 sem depender das APIs externas.
// Rodar: node teste-irs-v2-mock.js
// ============================================================
const assert = require('node:assert/strict');
const {
  calcularRiscoAvancado,
  calcularRiscoAvancadoV2,
  identificarBiomaPorCentroides,
  PESOS_AHP_V2
} = require('./services/riscoService');

let falhas = 0;
function teste(nome, fn) {
  try {
    fn();
    console.log(`  ok    ${nome}`);
  } catch (err) {
    falhas++;
    console.log(`  FALHA ${nome}\n        ${err.message}`);
  }
}

const proximo = (a, b) => Math.abs(a - b) < 1e-9;

// Alerta de referência: ponto remoto no Pantanal, sem pessoas em risco
const PANTANAL = { latitude: -16.6869, longitude: -56.6744, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: false };

// Geodados no formato de geodadosService.obterGeodadosCompletos (Etapa B)
const geo = (campos = {}) => ({
  bioma: 'PANTANAL',
  fonteBioma: 'mock',
  unidadeConservacao: null,
  terraIndigena: null,
  fauna: { total: 0, nivel: 'SEM_ESPECIES', especies: [] },
  focos: { total: 0, ultimos7dias: 0 },
  ...campos
});

console.log('\nEstrutura e pesos');
teste('os pesos v2 somam 1,00', () => {
  const soma = Object.values(PESOS_AHP_V2).reduce((a, b) => a + b, 0);
  assert.ok(proximo(soma, 1), `soma = ${soma}`);
});
teste('o detalhamento traz os 9 critérios e as contribuições somam o IRS', () => {
  const { irs, detalhes } = calcularRiscoAvancadoV2(PANTANAL, geo());
  assert.deepEqual(Object.keys(detalhes).sort(), Object.keys(PESOS_AHP_V2).sort());
  const soma = Object.values(detalhes).reduce((a, d) => a + d.contribuicao, 0);
  assert.ok(Math.abs(soma - irs) < 0.001, `soma = ${soma}, irs = ${irs}`);
});
teste('IRS e sigmoide ficam entre 0 e 1 no pior e no melhor caso', () => {
  const pior = calcularRiscoAvancadoV2(
    { latitude: -23.5505, longitude: -46.6333, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true, dA_dt: 5 },
    geo({ bioma: 'AMAZONIA', terraIndigena: { nome: 'TI de teste' }, fauna: { total: 9, nivel: 'CRITICA' } })
  );
  const melhor = calcularRiscoAvancadoV2(
    { latitude: -10, longitude: -50, areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false, zonaUrbana: true },
    geo({ bioma: 'URBANO', fauna: null })
  );
  for (const r of [pior, melhor]) {
    assert.ok(r.irs >= 0 && r.irs <= 1, `irs = ${r.irs}`);
    assert.ok(r.sigmoide >= 0 && r.sigmoide <= 1, `sigmoide = ${r.sigmoide}`);
  }
  assert.equal(pior.nivel, 'CRITICO');
  assert.equal(melhor.nivel, 'BAIXO');
});

console.log('\nTabelas de pontuação');
teste('bioma: Amazônia 1,0 · Cerrado 0,7 · Pampa 0,5', () => {
  const fator = (bioma) => calcularRiscoAvancadoV2(PANTANAL, geo({ bioma })).detalhes.bioma.fator;
  assert.equal(fator('AMAZONIA'), 1);
  assert.equal(fator('CERRADO'), 0.7);
  assert.equal(fator('PAMPA'), 0.5);
});
teste('bioma por extenso e com acento é reconhecido ("Mata Atlântica")', () => {
  const { detalhes } = calcularRiscoAvancadoV2(PANTANAL, geo({ bioma: 'Mata Atlântica' }));
  assert.equal(detalhes.bioma.valorBruto, 'MATA_ATLANTICA');
  assert.equal(detalhes.bioma.fator, 0.9);
});
teste('tipo de área: TI 1,0 · UC federal 1,0 · UC estadual 0,85 · rural 0,4 · urbana 0,3', () => {
  const tipo = (campos, alerta = PANTANAL) => calcularRiscoAvancadoV2(alerta, geo(campos)).detalhes.tipoArea;
  assert.deepEqual([tipo({ terraIndigena: { nome: 'TI X' } }).valorBruto, tipo({ terraIndigena: { nome: 'TI X' } }).fator], ['TERRA_INDIGENA', 1]);
  assert.equal(tipo({ unidadeConservacao: { nome: 'Parna X', esfera: 'federal' } }).valorBruto, 'UC_FEDERAL');
  assert.equal(tipo({ unidadeConservacao: { nome: 'PE X', esfera: 'estadual' } }).fator, 0.85);
  assert.equal(tipo({}).fator, 0.4);
  assert.equal(tipo({}, { ...PANTANAL, zonaUrbana: true }).fator, 0.3);
});
teste('tipo de área informado no alerta vale quando as bases não acham UC/TI', () => {
  const { detalhes } = calcularRiscoAvancadoV2({ ...PANTANAL, tipoArea: 'APP' }, geo());
  assert.equal(detalhes.tipoArea.valorBruto, 'APP');
  assert.equal(detalhes.tipoArea.fator, 0.8);
  assert.equal(detalhes.tipoArea.fonte, 'informado');
});
teste('fauna: crítica 1,0 · ameaçada 0,8 · vulnerável 0,6 · sem espécies 0,3', () => {
  const fator = (nivel) => calcularRiscoAvancadoV2(PANTANAL, geo({ fauna: { total: 1, nivel } })).detalhes.fauna.fator;
  assert.deepEqual(['CRITICA', 'AMEACADA', 'VULNERAVEL', 'SEM_ESPECIES'].map(fator), [1, 0.8, 0.6, 0.3]);
});
teste('relevância ecológica: dentro 1,0 · 30 km 0,6 · 50 km 0,6 · 80 km 0,3 · sem dado 0,3', () => {
  const fator = (campos) => calcularRiscoAvancadoV2(PANTANAL, geo(campos)).detalhes.relevancia.fator;
  assert.equal(fator({ unidadeConservacao: { nome: 'Parna X' } }), 1);
  assert.equal(fator({ distanciaAreaProtegidaKm: 9.9 }), 1);
  assert.equal(fator({ distanciaAreaProtegidaKm: 30 }), 0.6);
  assert.equal(fator({ distanciaAreaProtegidaKm: 50 }), 0.6);
  assert.equal(fator({ distanciaAreaProtegidaKm: 80 }), 0.3);
  assert.equal(fator({}), 0.3);
});

console.log('\nFallback sem geodados');
teste('sem geodados o cálculo não quebra e o bioma vem dos centróides', () => {
  for (const ausente of [undefined, null, {}]) {
    const { nivel, detalhes } = calcularRiscoAvancadoV2(PANTANAL, ausente);
    assert.ok(['BAIXO', 'MODERADO', 'ALTO', 'CRITICO'].includes(nivel));
    assert.equal(detalhes.bioma.valorBruto, 'PANTANAL');
    assert.equal(detalhes.bioma.fonte, 'fallback-centroides');
    assert.equal(detalhes.tipoArea.valorBruto, 'RURAL');
    assert.equal(detalhes.fauna.valorBruto, 'SEM_ESPECIES');
  }
});
teste('centróides: cada bioma de referência é reconhecido; longe de todos vira URBANO', () => {
  assert.equal(identificarBiomaPorCentroides(-3.4653, -62.2159).bioma, 'AMAZONIA');
  assert.equal(identificarBiomaPorCentroides(-15.7939, -47.8828).bioma, 'CERRADO');
  assert.equal(identificarBiomaPorCentroides(-8.0476, -34.8770).bioma, 'CAATINGA');
  assert.equal(identificarBiomaPorCentroides(-30.0346, -51.2177).bioma, 'PAMPA');
  // Sul do Pará: a mais de 300 km de qualquer centróide
  const remoto = identificarBiomaPorCentroides(-8.0, -52.0);
  assert.ok(remoto.distanciaKm > 300, `distância = ${remoto.distanciaKm}`);
  assert.equal(remoto.bioma, 'URBANO');
});
teste('campos do formulário (bioma, fauna, proximidade de UC) valem sem geodados', () => {
  const { detalhes } = calcularRiscoAvancadoV2({ ...PANTANAL, bioma: 'CERRADO', areaCriticaFauna: true, proximaUC: true });
  assert.equal(detalhes.bioma.valorBruto, 'CERRADO');
  assert.equal(detalhes.bioma.fonte, 'informado');
  assert.equal(detalhes.fauna.valorBruto, 'AMEACADA');
  assert.equal(detalhes.relevancia.fator, 1);
});

console.log('\nComportamento do modelo');
teste('mais sensibilidade ambiental nunca reduz o IRS', () => {
  const base = calcularRiscoAvancadoV2(PANTANAL, geo()).irs;
  const comFauna = calcularRiscoAvancadoV2(PANTANAL, geo({ fauna: { total: 3, nivel: 'CRITICA' } })).irs;
  const comUc = calcularRiscoAvancadoV2(PANTANAL, geo({ fauna: { total: 3, nivel: 'CRITICA' }, unidadeConservacao: { nome: 'Parna X', esfera: 'federal' } })).irs;
  assert.ok(comFauna > base && comUc > comFauna, `${base} → ${comFauna} → ${comUc}`);
});
teste('ponto remoto no Pantanal deixa de ser BAIXO (era BAIXO no v1)', () => {
  assert.equal(calcularRiscoAvancado(PANTANAL).nivel, 'BAIXO');
  assert.notEqual(calcularRiscoAvancadoV2(PANTANAL, geo()).nivel, 'BAIXO');
});

// ------------------------------------------------------------
// Tabela comparativa v1 × v2 (informativa, sem asserções)
// ------------------------------------------------------------
const cenarios = [
  { nome: 'SP urbano',                alerta: { latitude: -23.5505, longitude: -46.6333, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true, zonaUrbana: true }, geo: geo({ bioma: 'MATA_ATLANTICA' }) },
  { nome: 'Pantanal, só bioma',       alerta: PANTANAL, geo: geo() },
  { nome: 'Pantanal em UC + fauna',   alerta: PANTANAL, geo: geo({ unidadeConservacao: { nome: 'Parna do Pantanal Matogrossense', esfera: 'federal' }, fauna: { total: 3, nivel: 'AMEACADA' } }) },
  { nome: 'Amazônia, só bioma',       alerta: { ...PANTANAL, latitude: -3.4653, longitude: -62.2159 }, geo: geo({ bioma: 'AMAZONIA' }) },
  { nome: 'Amazônia em TI + fauna',   alerta: { ...PANTANAL, latitude: -3.4653, longitude: -62.2159 }, geo: geo({ bioma: 'AMAZONIA', terraIndigena: { nome: 'TI de teste' }, fauna: { total: 5, nivel: 'CRITICA' } }) },
  { nome: 'Cerrado (Brasília)',       alerta: { latitude: -15.7939, longitude: -47.8828, areaAfetada: 'MEDIA', vento: 'MODERADO', pessoasRisco: false }, geo: geo({ bioma: 'CERRADO' }) },
  { nome: 'Caatinga (Recife)',        alerta: { latitude: -8.0476, longitude: -34.8770, areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false }, geo: geo({ bioma: 'CAATINGA' }) },
  { nome: 'Pampa (Porto Alegre)',     alerta: { latitude: -30.0346, longitude: -51.2177, areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false }, geo: geo({ bioma: 'PAMPA' }) }
];

console.log('\nComparativo v1 × v2 (geodados mockados)');
console.table(cenarios.map(({ nome, alerta, geo: g }) => {
  const v1 = calcularRiscoAvancado(alerta);
  const v2 = calcularRiscoAvancadoV2(alerta, g);
  return { cenario: nome, 'IRS v1': v1.irs, 'nível v1': v1.nivel, 'IRS v2': v2.irs, 'sigmoide v2': v2.sigmoide, 'nível v2': v2.nivel };
}));

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
