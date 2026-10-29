// ============================================================
// VARIANTES METEOROLÓGICAS DO IRS (somente análise)
// Definidas em docs/preregistro-variante-meteorologica.md (29/10/2026),
// antes da coleta da amostra de outubro. Não são usadas pelo sistema:
// o IRS v2 de services/riscoService.js continua o mesmo.
// ============================================================

const { sigmoide, classificar } = require('../../services/riscoService');

const PESO_V2_M = 0.75;
const PESO_RF_M = 0.25;
const PESO_V2_MF = 0.65;
const PESO_RF_MF = 0.25;
const PESO_FRP_MF = 0.10;
const FRP_TETO_MW = 500;
const RF_AUSENTE = 0.5;

// Risco de Fogo do INPE (0 a 1); ausente ou negativo → 0,5
function fatorRiscoFogo(rf) {
  return Number.isFinite(rf) && rf >= 0 ? Math.min(1, rf) : RF_AUSENTE;
}

// FRP em MW → [0, 1] em escala logarítmica, com teto em 500 MW
function fatorFrp(frp) {
  if (!Number.isFinite(frp) || frp <= 0) return 0;
  return Math.min(1, Math.log(1 + frp) / Math.log(1 + FRP_TETO_MW));
}

function resultado(escore) {
  const s = sigmoide(escore);
  return { escore, sigmoide: s, nivel: classificar(s) };
}

// IRS-M = 0,75 × IRS v2 + 0,25 × RF
function irsM(escoreV2, rf) {
  return resultado(PESO_V2_M * escoreV2 + PESO_RF_M * fatorRiscoFogo(rf));
}

// IRS-MF = 0,65 × IRS v2 + 0,25 × RF + 0,10 × F(FRP)
function irsMF(escoreV2, rf, frp) {
  return resultado(PESO_V2_MF * escoreV2 + PESO_RF_MF * fatorRiscoFogo(rf) + PESO_FRP_MF * fatorFrp(frp));
}

module.exports = {
  fatorRiscoFogo,
  fatorFrp,
  irsM,
  irsMF,
  PESO_V2_M,
  PESO_RF_M,
  PESO_V2_MF,
  PESO_RF_MF,
  PESO_FRP_MF,
  FRP_TETO_MW,
  RF_AUSENTE
};
