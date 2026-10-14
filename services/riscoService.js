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

// ============================================================
// IRS v2 — CRITÉRIOS AMBIENTAIS
// Acrescenta bioma, tipo de área, fauna e relevância ecológica aos
// cinco critérios do v1. O v1 (calcularRiscoAvancado) continua acima,
// sem alterações, para comparação entre as duas versões no TCC.
// ============================================================

// ------------------------------------------------------------
// 9. Pesos AHP v2 (somam 1,00)
//    Os cinco critérios do v1 cedem peso aos quatro ambientais.
// ------------------------------------------------------------
const PESOS_AHP_V2 = {
  area:       0.10,
  urbano:     0.15,
  vento:      0.06,
  pessoas:    0.14,
  tempo:      0.06,
  bioma:      0.20,
  tipoArea:   0.12,
  fauna:      0.10,
  relevancia: 0.07
};

// ------------------------------------------------------------
// 10. Tabelas de pontuação dos critérios ambientais (0 a 1)
// ------------------------------------------------------------
const PONTOS_BIOMA = {
  AMAZONIA: 1.0,
  PANTANAL: 1.0,
  MATA_ATLANTICA: 0.9,
  CERRADO: 0.7,
  CAATINGA: 0.6,
  PAMPA: 0.5,
  URBANO: 0.3,
  OUTRO: 0.5
};

const PONTOS_TIPO_AREA = {
  TERRA_INDIGENA: 1.0,
  UC_FEDERAL: 1.0,
  UC_ESTADUAL: 0.85,
  APP: 0.8,
  RESERVA_LEGAL: 0.7,
  RURAL: 0.4,
  URBANA: 0.3
};

const PONTOS_FAUNA = {
  CRITICA: 1.0,      // espécies criticamente ameaçadas (IUCN CR)
  AMEACADA: 0.8,     // espécies em perigo (IUCN EN)
  VULNERAVEL: 0.6,   // espécies vulneráveis (IUCN VU)
  SEM_ESPECIES: 0.3,
  URBANA: 0.2
};

// Relevância ecológica: faixas de distância até a UC ou TI mais próxima
const FAIXAS_RELEVANCIA = [
  { fator: 1.0, faixa: '<10 km' },   // dentro ou a menos de 10 km
  { fator: 0.6, faixa: '10-50 km' },
  { fator: 0.3, faixa: '>50 km' }
];

// ------------------------------------------------------------
// 11. Fallback de bioma: 16 centróides de referência
//     Usado quando a base do IBGE não responde. O bioma é o do
//     centróide mais próximo (Haversine); além de 300 km de todos
//     eles, o ponto é classificado como URBANO.
// ------------------------------------------------------------
const CENTROIDES_BIOMA = [
  { bioma: 'AMAZONIA',       lat: -3.4653,  lng: -62.2159 },
  { bioma: 'AMAZONIA',       lat: -3.1190,  lng: -60.0217 },
  { bioma: 'AMAZONIA',       lat: -9.9747,  lng: -67.8098 },
  { bioma: 'PANTANAL',       lat: -16.6869, lng: -56.6744 },
  { bioma: 'PANTANAL',       lat: -19.0078, lng: -57.6531 },
  { bioma: 'MATA_ATLANTICA', lat: -23.5505, lng: -46.6333 },
  { bioma: 'MATA_ATLANTICA', lat: -22.9068, lng: -43.1729 },
  { bioma: 'MATA_ATLANTICA', lat: -25.4284, lng: -49.2733 },
  { bioma: 'CERRADO',        lat: -15.7939, lng: -47.8828 },
  { bioma: 'CERRADO',        lat: -16.6869, lng: -49.2647 },
  { bioma: 'CERRADO',        lat: -19.9167, lng: -43.9345 },
  { bioma: 'CAATINGA',       lat: -8.0476,  lng: -34.8770 },
  { bioma: 'CAATINGA',       lat: -7.1195,  lng: -34.8450 },
  { bioma: 'CAATINGA',       lat: -5.7945,  lng: -35.2110 },
  { bioma: 'PAMPA',          lat: -30.0346, lng: -51.2177 },
  { bioma: 'PAMPA',          lat: -31.7654, lng: -52.3376 }
];
const DISTANCIA_MAXIMA_CENTROIDE_KM = 300;

function identificarBiomaPorCentroides(latitude, longitude) {
  let maisProximo = null;
  let menorDistancia = Infinity;
  for (const centroide of CENTROIDES_BIOMA) {
    const d = calcularDistancia(latitude, longitude, centroide.lat, centroide.lng);
    if (d < menorDistancia) {
      menorDistancia = d;
      maisProximo = centroide;
    }
  }
  const bioma = menorDistancia > DISTANCIA_MAXIMA_CENTROIDE_KM ? 'URBANO' : maisProximo.bioma;
  return { bioma, distanciaKm: menorDistancia, fonte: 'fallback-centroides' };
}

// ------------------------------------------------------------
// 12. Resolução dos critérios ambientais
//     Cada função escolhe o valor do critério pela melhor fonte
//     disponível: geodados (bases públicas) → campo informado no
//     alerta → valor padrão. Devolve também a origem, para o
//     detalhamento do cálculo.
// ------------------------------------------------------------

// "Mata Atlântica" → "MATA_ATLANTICA": as bases externas devolvem nomes por extenso
function normalizarChave(valor) {
  if (typeof valor !== 'string') return '';
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function arredondar(valor) {
  return parseFloat(valor.toFixed(4));
}

function resolverBioma(alerta, geodados) {
  const doGeodados = normalizarChave(geodados?.bioma);
  if (doGeodados in PONTOS_BIOMA) {
    return { bioma: doGeodados, fonte: geodados.fonteBioma || 'geodados' };
  }
  const informado = normalizarChave(alerta.bioma);
  if (informado in PONTOS_BIOMA) {
    return { bioma: informado, fonte: 'informado' };
  }
  const { bioma, fonte } = identificarBiomaPorCentroides(alerta.latitude, alerta.longitude);
  return { bioma, fonte };
}

function resolverTipoArea(alerta, geodados) {
  // Uma área protegida identificada nas bases públicas prevalece sobre o que foi informado
  if (geodados?.terraIndigena) {
    return { tipoArea: 'TERRA_INDIGENA', fonte: 'geodados', nome: geodados.terraIndigena.nome };
  }
  if (geodados?.unidadeConservacao) {
    const esfera = normalizarChave(geodados.unidadeConservacao.esfera);
    // Não há pontuação própria para UC municipal: usa a de UC estadual
    const tipoArea = esfera === 'ESTADUAL' || esfera === 'MUNICIPAL' ? 'UC_ESTADUAL' : 'UC_FEDERAL';
    return { tipoArea, fonte: 'geodados', nome: geodados.unidadeConservacao.nome };
  }
  const informado = normalizarChave(alerta.tipoArea);
  if (informado in PONTOS_TIPO_AREA) {
    return { tipoArea: informado, fonte: 'informado' };
  }
  return { tipoArea: alerta.zonaUrbana ? 'URBANA' : 'RURAL', fonte: 'padrao' };
}

function resolverFauna(alerta, geodados, tipoArea) {
  const doGeodados = normalizarChave(geodados?.fauna?.nivel);
  if (doGeodados in PONTOS_FAUNA) {
    return { nivel: doGeodados, fonte: 'geodados', totalEspecies: geodados.fauna.total ?? 0 };
  }
  // No alerta o campo pode ser o nível já calculado ou a marcação do formulário (booleano)
  const informado = normalizarChave(alerta.areaCriticaFauna);
  if (informado in PONTOS_FAUNA) {
    return { nivel: informado, fonte: 'informado' };
  }
  if (alerta.areaCriticaFauna === true) {
    return { nivel: 'AMEACADA', fonte: 'informado' };
  }
  return { nivel: tipoArea === 'URBANA' ? 'URBANA' : 'SEM_ESPECIES', fonte: 'padrao' };
}

function resolverRelevancia(alerta, geodados) {
  let distanciaKm = null;
  let fonte = 'padrao';
  if (geodados?.unidadeConservacao || geodados?.terraIndigena) {
    distanciaKm = 0; // o ponto está dentro de uma UC ou TI
    fonte = 'geodados';
  } else if (Number.isFinite(geodados?.distanciaAreaProtegidaKm)) {
    distanciaKm = geodados.distanciaAreaProtegidaKm;
    fonte = 'geodados';
  } else if (FAIXAS_RELEVANCIA.some(f => f.faixa === geodados?.faixaAreaProtegida)) {
    // As bases públicas informam a faixa de distância, não a distância exata
    const encontrada = FAIXAS_RELEVANCIA.find(f => f.faixa === geodados.faixaAreaProtegida);
    return { distanciaKm: null, fator: encontrada.fator, faixa: encontrada.faixa, fonte: 'geodados' };
  } else if (alerta.proximaUC) {
    distanciaKm = 0; // proximidade declarada no registro, sem distância medida
    fonte = 'informado';
  }
  // Sem informação de distância, assume a faixa mais distante.
  // Limites: abaixo de 10 km → primeira faixa; de 10 a 50 km (inclusive) → segunda.
  const d = distanciaKm ?? Infinity;
  const { fator, faixa } = d < 10 ? FAIXAS_RELEVANCIA[0] : d <= 50 ? FAIXAS_RELEVANCIA[1] : FAIXAS_RELEVANCIA[2];
  return { distanciaKm: fonte === 'geodados' ? distanciaKm : null, fator, faixa, fonte };
}

// ------------------------------------------------------------
// 13. FUNÇÃO PRINCIPAL v2
//     IRS = Σ (peso v2 × fator), com os nove critérios.
//     `geodados` é o resultado de geodadosService.obterGeodadosCompletos;
//     sem ele (ou com campos ausentes), cada critério ambiental cai para
//     o campo informado no alerta e, por fim, para o valor padrão — o
//     bioma, para a lista de centróides.
// ------------------------------------------------------------
function calcularRiscoAvancadoV2(alerta, geodados = null) {
  const { latitude, longitude, areaAfetada, vento, pessoasRisco } = alerta;
  const pesos = PESOS_AHP_V2;

  // 1 a 5. Critérios herdados do v1 (mesmos fatores, pesos novos)
  const fArea = mapearArea(areaAfetada);
  const { cidade, distanciaKm } = encontrarCidadeMaisProxima(latitude, longitude);
  const fUrb = fatorDistancia(distanciaKm);
  const direcaoVento = alerta.direcaoVento ?? 45;
  const fVento = fatorVento(direcaoVento, latitude, longitude, cidade) * mapearVento(vento);
  const fPessoas = mapearPessoas(pessoasRisco);
  const dA_dt = alerta.dA_dt ?? 0;
  const fTempo = fatorPropagacao(dA_dt);

  // 6 a 9. Critérios ambientais
  const bioma = resolverBioma(alerta, geodados);
  const fBioma = PONTOS_BIOMA[bioma.bioma];
  const tipoArea = resolverTipoArea(alerta, geodados);
  const fTipoArea = PONTOS_TIPO_AREA[tipoArea.tipoArea];
  const fauna = resolverFauna(alerta, geodados, tipoArea.tipoArea);
  const fFauna = PONTOS_FAUNA[fauna.nivel];
  const relevancia = resolverRelevancia(alerta, geodados);
  const fRelevancia = relevancia.fator;

  const fatores = {
    area: fArea, urbano: fUrb, vento: fVento, pessoas: fPessoas, tempo: fTempo,
    bioma: fBioma, tipoArea: fTipoArea, fauna: fFauna, relevancia: fRelevancia
  };
  const contribuicoes = {};
  for (const criterio of Object.keys(pesos)) {
    contribuicoes[criterio] = pesos[criterio] * fatores[criterio];
  }
  const irs = Object.values(contribuicoes).reduce((a, b) => a + b, 0);

  const sigmoideValor = sigmoide(irs);
  const nivel = classificar(sigmoideValor);

  // Campos comuns a todos os critérios no detalhamento
  const base = (criterio) => ({
    fator: arredondar(fatores[criterio]),
    peso: pesos[criterio],
    contribuicao: arredondar(contribuicoes[criterio])
  });

  return {
    irs: arredondar(irs),
    sigmoide: arredondar(sigmoideValor),
    nivel,
    detalhes: {
      area:       { valorBruto: areaAfetada, ...base('area') },
      urbano:     { cidadeProxima: cidade.nome, distanciaKm: parseFloat(distanciaKm.toFixed(2)), ...base('urbano') },
      vento:      { direcaoGraus: direcaoVento, intensidade: vento, ...base('vento') },
      pessoas:    { valorBruto: pessoasRisco, ...base('pessoas') },
      tempo:      { dA_dt, ...base('tempo') },
      bioma:      { valorBruto: bioma.bioma, fonte: bioma.fonte, ...base('bioma') },
      tipoArea:   { valorBruto: tipoArea.tipoArea, nome: tipoArea.nome ?? null, fonte: tipoArea.fonte, ...base('tipoArea') },
      fauna:      { valorBruto: fauna.nivel, totalEspecies: fauna.totalEspecies ?? null, fonte: fauna.fonte, ...base('fauna') },
      relevancia: { faixa: relevancia.faixa, distanciaKm: relevancia.distanciaKm, fonte: relevancia.fonte, ...base('relevancia') }
    }
  };
}

module.exports = {
  calcularRiscoAvancado,
  calcularRiscoAvancadoV2,
  calcularDistancia,
  encontrarCidadeMaisProxima,
  identificarBiomaPorCentroides,
  normalizarChave,
  PESOS_AHP,
  PESOS_AHP_V2,
  PONTOS_BIOMA,
  PONTOS_TIPO_AREA,
  PONTOS_FAUNA
};
