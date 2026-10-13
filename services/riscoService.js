// ============================================================
// SERVIÇO DE CLASSIFICAÇÃO DE RISCO MULTICRITÉRIO
// Implementa o Índice de Risco Sintético (IRS) do TCC
// ============================================================

// Lista fixa de 10 cidades brasileiras com coordenadas
const CIDADES = [
  { nome: 'São Paulo',       lat: -23.5505, lng: -46.6333 },
  { nome: 'Rio de Janeiro',  lat: -22.9068, lng: -43.1729 },
  { nome: 'Brasília',        lat: -15.7939, lng: -47.8828 },
  { nome: 'Belo Horizonte',  lat: -19.9167, lng: -43.9345 },
  { nome: 'Salvador',        lat: -12.9777, lng: -38.5016 },
  { nome: 'Manaus',          lat: -3.1190,  lng: -60.0217 },
  { nome: 'Porto Alegre',    lat: -30.0346, lng: -51.2177 },
  { nome: 'Curitiba',        lat: -25.4284, lng: -49.2733 },
  { nome: 'Recife',          lat: -8.0476,  lng: -34.8770 },
  { nome: 'Fortaleza',       lat: -3.7319,  lng: -38.5267 }
];

// Pesos AHP (matriz de Saaty) definidos no TCC
const PESOS_AHP = {
  area:    0.16,
  urbano:  0.42,
  vento:   0.09,
  pessoas: 0.26,
  tempo:   0.07
};

// ------------------------------------------------------------
// 1. Cálculo de distância com fórmula de Haversine
// ------------------------------------------------------------
function calcularDistancia(lat1, lng1, lat2, lng2) {
  const R = 6371; // raio da Terra em km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ------------------------------------------------------------
// 2. Encontrar a cidade mais próxima
// ------------------------------------------------------------
function encontrarCidadeMaisProxima(latAlerta, lngAlerta) {
  let maisProxima = null;
  let menorDistancia = Infinity;
  for (const cidade of CIDADES) {
    const d = calcularDistancia(latAlerta, lngAlerta, cidade.lat, cidade.lng);
    if (d < menorDistancia) {
      menorDistancia = d;
      maisProxima = cidade;
    }
  }
  return { cidade: maisProxima, distanciaKm: menorDistancia };
}

// ------------------------------------------------------------
// 3. Fator exponencial de distância urbana
//    φ_urb = 5 * exp(-0.2 * d), normalizado em [0, 1]
// ------------------------------------------------------------
function fatorDistancia(distanciaKm) {
  const bruto = 5 * Math.exp(-0.2 * distanciaKm);
  // Normalizar: se d=0, bruto=5; dividimos por 5 para ficar em [0,1]
  return Math.min(1, bruto / 5);
}

// ------------------------------------------------------------
// 4. Fator de vento (produto escalar vetorial)
//    φ_vento = intensidade * (1 + cos(θ)) / 2
// ------------------------------------------------------------
function fatorVento(direcaoVentoGraus, latAlerta, lngAlerta, cidade) {
  // Vetor alerta → cidade
  const dx = cidade.lng - lngAlerta;
  const dy = cidade.lat - latAlerta;
  const anguloAlvo = Math.atan2(dy, dx); // em radianos

  // Vetor do vento (direção em graus, 0 = Norte, sentido horário)
  // Converte para radianos, ajustando para o mesmo sistema do atan2
  const anguloVento = ((90 - direcaoVentoGraus) * Math.PI) / 180;

  // Cosseno do ângulo entre os vetores
  const cosTheta = Math.cos(anguloVento - anguloAlvo);

  // Normalizar em [0, 1]: (1 + cos) / 2 → 1 quando alinhados, 0 quando opostos
  return (1 + cosTheta) / 2;
}

// ------------------------------------------------------------
// 5. Fator de propagação temporal (derivada numérica)
//    φ_tempo = ln(1 + dA/dt), normalizado
// ------------------------------------------------------------
function fatorPropagacao(dA_dt) {
  if (!dA_dt || dA_dt <= 0) return 0.3; // valor padrão
  const bruto = Math.log(1 + dA_dt);
  // Normalizar: assumindo dA/dt típico até 2.0 → ln(3) ≈ 1.1
  return Math.min(1, bruto / 1.1);
}

// ------------------------------------------------------------
// 6. Mapeamentos de entrada → fator (0 a 1)
// ------------------------------------------------------------
function mapearArea(area) {
  return { PEQUENA: 0.33, MEDIA: 0.66, GRANDE: 1.0 }[area] || 0.33;
}
function mapearVento(vento) {
  return { BAIXO: 0.33, MODERADO: 0.66, ALTO: 1.0 }[vento] || 0.33;
}
function mapearPessoas(pessoasRisco) {
  return pessoasRisco ? 1.0 : 0.0;
}

// ------------------------------------------------------------
// 7. Sigmoide para classificação final
// ------------------------------------------------------------
function sigmoide(x, k = 10, mu = 0.5) {
  return 1 / (1 + Math.exp(-k * (x - mu)));
}

function classificar(sigmoideValor) {
  if (sigmoideValor < 0.25) return 'BAIXO';
  if (sigmoideValor < 0.5) return 'MODERADO';
  if (sigmoideValor < 0.75) return 'ALTO';
  return 'CRITICO';
}

// ------------------------------------------------------------
// 8. FUNÇÃO PRINCIPAL
// ------------------------------------------------------------
function calcularRiscoAvancado(alerta) {
  const { latitude, longitude, areaAfetada, vento, pessoasRisco } = alerta;

  // 1. Área
  const fArea = mapearArea(areaAfetada);

  // 2. Urbano (distância exponencial)
  const { cidade, distanciaKm } = encontrarCidadeMaisProxima(latitude, longitude);
  const fUrb = fatorDistancia(distanciaKm);

  // 3. Vento (vetorial)
  // Direção do vento: usa campo do alerta ou assume 45° (nordeste) como padrão
  const direcaoVento = alerta.direcaoVento ?? 45;
  const fVentoBase = fatorVento(direcaoVento, latitude, longitude, cidade);
  const fVento = fVentoBase * mapearVento(vento);

  // 4. Pessoas
  const fPessoas = mapearPessoas(pessoasRisco);

  // 5. Tempo (derivada)
  const dA_dt = alerta.dA_dt ?? 0;
  const fTempo = fatorPropagacao(dA_dt);

  // 6. IRS (Índice de Risco Sintético)
  const contribuicoes = {
    area:    PESOS_AHP.area    * fArea,
    urbano:  PESOS_AHP.urbano  * fUrb,
    vento:   PESOS_AHP.vento   * fVento,
    pessoas: PESOS_AHP.pessoas * fPessoas,
    tempo:   PESOS_AHP.tempo   * fTempo
  };
  const irs = Object.values(contribuicoes).reduce((a, b) => a + b, 0);

  // 7. Sigmoide
  const sigmoideValor = sigmoide(irs);
  const nivel = classificar(sigmoideValor);

  return {
    irs: parseFloat(irs.toFixed(4)),
    sigmoide: parseFloat(sigmoideValor.toFixed(4)),
    nivel,
    detalhes: {
      area:    { valorBruto: areaAfetada, fator: fArea, peso: PESOS_AHP.area, contribuicao: parseFloat(contribuicoes.area.toFixed(4)) },
      urbano:  { cidadeProxima: cidade.nome, distanciaKm: parseFloat(distanciaKm.toFixed(2)), fator: parseFloat(fUrb.toFixed(4)), peso: PESOS_AHP.urbano, contribuicao: parseFloat(contribuicoes.urbano.toFixed(4)) },
      vento:   { direcaoGraus: direcaoVento, intensidade: vento, fator: parseFloat(fVento.toFixed(4)), peso: PESOS_AHP.vento, contribuicao: parseFloat(contribuicoes.vento.toFixed(4)) },
      pessoas: { valorBruto: pessoasRisco, fator: fPessoas, peso: PESOS_AHP.pessoas, contribuicao: parseFloat(contribuicoes.pessoas.toFixed(4)) },
      tempo:   { dA_dt, fator: parseFloat(fTempo.toFixed(4)), peso: PESOS_AHP.tempo, contribuicao: parseFloat(contribuicoes.tempo.toFixed(4)) }
    }
  };
}

module.exports = { calcularRiscoAvancado, calcularDistancia, encontrarCidadeMaisProxima };
