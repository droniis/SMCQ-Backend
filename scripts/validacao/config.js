// ============================================================
// PARÂMETROS DA VALIDAÇÃO DO IRS
// Tudo o que define a amostra fica aqui, num lugar só, para que
// o experimento possa ser reproduzido e citado no TCC.
// Os valores foram fixados ANTES de calcular o IRS sobre a amostra.
// ============================================================

module.exports = {
  // Temporada de fogo analisada (datas em UTC, como no CSV do INPE)
  PERIODO: { inicio: '2026-08-01', fim: '2026-09-30' },

  // Só o satélite de referência do INPE (séries históricas). Os demais satélites
  // repetem a detecção do mesmo incêndio várias vezes ao dia (o GOES-19 a cada 10 min),
  // o que distorceria as contagens de área e do gabarito.
  SATELITE: 'AQUA_M-T',

  // Sorteio estratificado
  SEMENTE: 20261025,
  TAMANHO_POR_ESTRATO: 43, // 7 estratos × 43 ≈ 300; estrato com menos focos entra inteiro
  BIOMAS: ['Amazônia', 'Cerrado', 'Pantanal', 'Mata Atlântica', 'Caatinga', 'Pampa'],
  ESTRATO_URBANO: 'Urbano (≤ 50 km de uma das 10 cidades)',

  // Gabarito: outros focos num raio de 10 km nos 7 dias seguintes ao dia 0
  RAIO_GABARITO_KM: 10,
  DIAS_GABARITO: 7,

  // Proxy de área afetada: focos num raio de 1 km no mesmo dia (o próprio foco incluído).
  // Com o pixel de ~1 km do MODIS, isso conta o foco e os pixels vizinhos ativos.
  RAIO_AREA_KM: 1,
  FAIXAS_AREA: [
    { ate: 1, area: 'PEQUENA' },       // foco isolado
    { ate: 3, area: 'MEDIA' },         // 2 ou 3 focos
    { ate: Infinity, area: 'GRANDE' }  // 4 ou mais
  ],

  // Proxy de pessoas em risco: a até 50 km de uma das 10 cidades do riscoService
  // (mesmo raio usado para fauna e focos no geodadosService)
  RAIO_PESSOAS_KM: 50,

  // Vento (Open-Meteo, km/h) pela escala de Beaufort:
  // BAIXO < 20 (força ≤ 3) · MODERADO 20 a < 39 (forças 4–5) · ALTO ≥ 39 (força ≥ 6)
  FAIXAS_VENTO: [
    { abaixoDe: 20, vento: 'BAIXO' },
    { abaixoDe: 39, vento: 'MODERADO' },
    { abaixoDe: Infinity, vento: 'ALTO' }
  ],

  OPEN_METEO: 'https://archive-api.open-meteo.com/v1/archive',
  // Em 14/10/2026 a API histórica respondia em 10 a 15 s e a primeira execução parou
  // por tempo limite (10 s × 3 tentativas) após 160 de 294 pontos. A pedido do autor,
  // o Open-Meteo passou a usar 20 s e pausa de 2 s entre requisições. Cada ponto
  // registra o tempo limite com que foi obtido (cache/open-meteo.json).
  OPEN_METEO_TIMEOUT_MS: 20000,
  PAUSA_OPEN_METEO_MS: 2000,
  PAUSA_GEODADOS_MS: 200
};
