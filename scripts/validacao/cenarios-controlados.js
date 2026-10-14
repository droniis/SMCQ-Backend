// ============================================================
// CENÁRIOS CONTROLADOS DO IRS v2 (geodados simulados)
// Fonte única dos cenários usados por teste-irs-v2-mock.js e pela
// validação (validar-irs.js).
//
// `nivelEsperado` só existe onde o nível foi afirmado no teste
// antes da validação (asserções de teste-irs-v2-mock.js):
//   - pior caso    → CRITICO
//   - melhor caso  → BAIXO
//   - Pantanal, só bioma → ALTO ou CRITICO. O teste afirma apenas
//     assert.notEqual(nivel, 'BAIXO'); na validação adota-se a formulação
//     do autor, "ALTO ou CRITICO", fixada na Etapa 2, antes do cálculo
//     do IRS sobre os cenários. O teste do mock continua com "≠ BAIXO".
// Nos demais cenários não há nível esperado documentado (null).
// ============================================================

// Alerta de referência: ponto remoto no Pantanal, sem pessoas em risco
const PANTANAL = { latitude: -16.6869, longitude: -56.6744, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: false };

// Geodados no formato de geodadosService.obterGeodadosCompletos
const geo = (campos = {}) => ({
  bioma: 'PANTANAL',
  fonteBioma: 'mock',
  unidadeConservacao: null,
  terraIndigena: null,
  fauna: { total: 0, nivel: 'SEM_ESPECIES', especies: [] },
  focos: { total: 0, ultimos7dias: 0 },
  ...campos
});

// Casos extremos: todos os critérios no máximo / no mínimo
const PIOR_CASO = {
  nome: 'Pior caso (todos os critérios no máximo)',
  alerta: { latitude: -23.5505, longitude: -46.6333, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true, dA_dt: 5 },
  geo: geo({ bioma: 'AMAZONIA', terraIndigena: { nome: 'TI de teste' }, fauna: { total: 9, nivel: 'CRITICA' } }),
  nivelEsperado: 'CRITICO'
};
const MELHOR_CASO = {
  nome: 'Melhor caso (todos os critérios no mínimo)',
  alerta: { latitude: -10, longitude: -50, areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false, zonaUrbana: true },
  geo: geo({ bioma: 'URBANO', fauna: null }),
  nivelEsperado: 'BAIXO'
};

// Os 8 cenários da tabela comparativa v1 × v2
const CENARIOS = [
  { nome: 'SP urbano',              alerta: { latitude: -23.5505, longitude: -46.6333, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true, zonaUrbana: true }, geo: geo({ bioma: 'MATA_ATLANTICA' }), nivelEsperado: null },
  { nome: 'Pantanal, só bioma',     alerta: PANTANAL, geo: geo(), nivelEsperado: 'ALTO_OU_CRITICO' },
  { nome: 'Pantanal em UC + fauna', alerta: PANTANAL, geo: geo({ unidadeConservacao: { nome: 'Parna do Pantanal Matogrossense', esfera: 'federal' }, fauna: { total: 3, nivel: 'AMEACADA' } }), nivelEsperado: null },
  { nome: 'Amazônia, só bioma',     alerta: { ...PANTANAL, latitude: -3.4653, longitude: -62.2159 }, geo: geo({ bioma: 'AMAZONIA' }), nivelEsperado: null },
  { nome: 'Amazônia em TI + fauna', alerta: { ...PANTANAL, latitude: -3.4653, longitude: -62.2159 }, geo: geo({ bioma: 'AMAZONIA', terraIndigena: { nome: 'TI de teste' }, fauna: { total: 5, nivel: 'CRITICA' } }), nivelEsperado: null },
  { nome: 'Cerrado (Brasília)',     alerta: { latitude: -15.7939, longitude: -47.8828, areaAfetada: 'MEDIA', vento: 'MODERADO', pessoasRisco: false }, geo: geo({ bioma: 'CERRADO' }), nivelEsperado: null },
  { nome: 'Caatinga (Recife)',      alerta: { latitude: -8.0476, longitude: -34.8770, areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false }, geo: geo({ bioma: 'CAATINGA' }), nivelEsperado: null },
  { nome: 'Pampa (Porto Alegre)',   alerta: { latitude: -30.0346, longitude: -51.2177, areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false }, geo: geo({ bioma: 'PAMPA' }), nivelEsperado: null }
];

// Confere um nível obtido com o esperado. null = sem nível esperado documentado.
function acertou(nivelEsperado, nivelObtido) {
  if (nivelEsperado === null) return null;
  if (nivelEsperado === 'ALTO_OU_CRITICO') return nivelObtido === 'ALTO' || nivelObtido === 'CRITICO';
  return nivelObtido === nivelEsperado;
}

const rotuloEsperado = (nivelEsperado) => (nivelEsperado === null ? '—' : nivelEsperado === 'ALTO_OU_CRITICO' ? 'ALTO ou CRÍTICO' : nivelEsperado);

module.exports = { PANTANAL, geo, PIOR_CASO, MELHOR_CASO, CENARIOS, acertou, rotuloEsperado };
