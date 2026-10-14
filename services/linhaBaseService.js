// ============================================================
// LINHA DE BASE PARA A VALIDAÇÃO DO IRS (Cap. 6 do TCC)
// Modelo deliberadamente simples, usado só para comparação:
//   - os mesmos nove critérios do IRS v2, com as mesmas entradas;
//   - cada critério normalizado em [0, 1] de forma linear;
//   - média aritmética simples (sem os pesos AHP);
//   - nível pelos mesmos limiares do IRS.
// Ficam de fora tudo o que é próprio do IRS: os pesos AHP, o
// decaimento exponencial da distância urbana, o produto escalar
// do vento, o logaritmo da taxa de crescimento e a sigmoide.
// As tabelas de pontuação das entradas categóricas (área, intensidade
// do vento, bioma, tipo de área, fauna, faixa de relevância) são as
// mesmas do IRS: são a escala do próprio critério, não uma função
// de transformação, e não há outra forma linear de pontuar uma
// categoria nominal como o bioma.
// Não é usada por nenhuma rota da API.
// ============================================================

const {
  encontrarCidadeMaisProxima,
  mapearArea,
  mapearVento,
  mapearPessoas,
  resolverBioma,
  resolverTipoArea,
  resolverFauna,
  resolverRelevancia,
  PONTOS_BIOMA,
  PONTOS_TIPO_AREA,
  PONTOS_FAUNA,
  SIGMOIDE_K,
  SIGMOIDE_MU
} = require('./riscoService');

// Distância urbana a partir da qual o critério vale 0. Mesmo raio de 50 km
// usado pelo sistema para fauna, focos e relevância ecológica.
const DISTANCIA_URBANA_MAXIMA_KM = 50;

// Taxa de crescimento da área que satura o critério tempo. Mesmo teto que o
// IRS assume para dA/dt (riscoService, fatorPropagacao).
const DA_DT_MAXIMO = 2.0;

// Valor do critério tempo sem taxa de crescimento informada (ou ≤ 0).
// É o mesmo valor padrão do IRS, para que a ausência do dado não
// favoreça nenhum dos dois modelos.
const TEMPO_PADRAO = 0.3;

// O IRS classifica pela sigmoide: BAIXO < 0,25 ≤ MODERADO < 0,50 ≤ ALTO < 0,75 ≤ CRÍTICO.
// Como a sigmoide é estritamente crescente, isso equivale a cortar o próprio
// escore nos pontos x em que sigmoide(x) = p, isto é, x = mu + ln(p / (1 − p)) / k.
// A linha de base usa esses cortes direto no escore, sem passar pela sigmoide.
const limiarDoEscore = (p) => SIGMOIDE_MU + Math.log(p / (1 - p)) / SIGMOIDE_K;
const LIMIARES = {
  MODERADO: limiarDoEscore(0.25), // ≈ 0,3901
  ALTO: limiarDoEscore(0.5),      //   0,5000
  CRITICO: limiarDoEscore(0.75)   // ≈ 0,6099
};

function classificarEscore(escore) {
  if (escore < LIMIARES.MODERADO) return 'BAIXO';
  if (escore < LIMIARES.ALTO) return 'MODERADO';
  if (escore < LIMIARES.CRITICO) return 'ALTO';
  return 'CRITICO';
}

const limitar = (x) => Math.min(1, Math.max(0, x));
const arredondar = (x) => parseFloat(x.toFixed(4));

// Proximidade urbana: 1 na cidade, cai em linha reta até 0 a 50 km
function normalizarUrbano(distanciaKm) {
  return limitar(1 - distanciaKm / DISTANCIA_URBANA_MAXIMA_KM);
}

// Alinhamento do vento com a direção alerta → cidade, linear no ângulo:
// 1 com o vento soprando direto para a cidade, 0 soprando no sentido oposto.
// Mesma convenção de ângulos do IRS (0° = Norte, sentido horário).
function alinhamentoLinear(direcaoVentoGraus, latitude, longitude, cidade) {
  const anguloAlvo = Math.atan2(cidade.lat - latitude, cidade.lng - longitude);
  const anguloVento = ((90 - direcaoVentoGraus) * Math.PI) / 180;
  // Menor ângulo entre os dois vetores, em [0, π]
  let diferenca = Math.abs(anguloVento - anguloAlvo) % (2 * Math.PI);
  if (diferenca > Math.PI) diferenca = 2 * Math.PI - diferenca;
  return 1 - diferenca / Math.PI;
}

// Taxa de crescimento da área, linear até o teto
function normalizarTempo(dA_dt) {
  if (!dA_dt || dA_dt <= 0) return TEMPO_PADRAO;
  return limitar(dA_dt / DA_DT_MAXIMO);
}

// ------------------------------------------------------------
// FUNÇÃO PRINCIPAL
// Mesma assinatura e mesmas entradas de calcularRiscoAvancadoV2.
// → { score, nivel, detalhes }
// ------------------------------------------------------------
function calcularLinhaBase(alerta, geodados = null) {
  const { latitude, longitude, areaAfetada, vento, pessoasRisco } = alerta;

  const { cidade, distanciaKm } = encontrarCidadeMaisProxima(latitude, longitude);
  const direcaoVento = alerta.direcaoVento ?? 45;
  const intensidade = mapearVento(vento);
  const alinhamento = alinhamentoLinear(direcaoVento, latitude, longitude, cidade);

  // Critérios ambientais: mesma resolução de fontes do IRS (geodados → alerta → padrão)
  const bioma = resolverBioma(alerta, geodados);
  const tipoArea = resolverTipoArea(alerta, geodados);
  const fauna = resolverFauna(alerta, geodados, tipoArea.tipoArea);
  const relevancia = resolverRelevancia(alerta, geodados);

  const criterios = {
    area: mapearArea(areaAfetada),
    urbano: normalizarUrbano(distanciaKm),
    // Média simples (e não produto) da intensidade com o alinhamento
    vento: (intensidade + alinhamento) / 2,
    pessoas: mapearPessoas(pessoasRisco),
    tempo: normalizarTempo(alerta.dA_dt ?? 0),
    bioma: PONTOS_BIOMA[bioma.bioma],
    tipoArea: PONTOS_TIPO_AREA[tipoArea.tipoArea],
    fauna: PONTOS_FAUNA[fauna.nivel],
    relevancia: relevancia.fator
  };

  const valores = Object.values(criterios);
  const score = valores.reduce((a, b) => a + b, 0) / valores.length;

  return {
    score: arredondar(score),
    nivel: classificarEscore(score),
    detalhes: {
      criterios: Object.fromEntries(Object.entries(criterios).map(([nome, valor]) => [nome, arredondar(valor)])),
      urbano: { cidadeProxima: cidade.nome, distanciaKm: parseFloat(distanciaKm.toFixed(2)) },
      vento: { direcaoGraus: direcaoVento, intensidade: arredondar(intensidade), alinhamento: arredondar(alinhamento) },
      fontes: { bioma: bioma.fonte, tipoArea: tipoArea.fonte, fauna: fauna.fonte, relevancia: relevancia.fonte }
    }
  };
}

module.exports = {
  calcularLinhaBase,
  classificarEscore,
  normalizarUrbano,
  alinhamentoLinear,
  normalizarTempo,
  LIMIARES,
  DISTANCIA_URBANA_MAXIMA_KM,
  DA_DT_MAXIMO,
  TEMPO_PADRAO
};
