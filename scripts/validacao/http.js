// ============================================================
// REQUISIÇÕES EXTERNAS DA VALIDAÇÃO
// Regras: tempo limite de 10 s e no máximo 3 tentativas.
// Exceção: o Open-Meteo usa 20 s (ver config.js, OPEN_METEO_TIMEOUT_MS).
// Para arquivos grandes (corpo em fluxo), os 10 s valem até a
// resposta chegar e, depois, para cada intervalo sem receber
// dados: quem lê o corpo chama renovarPrazo() a cada pedaço.
// ============================================================

const TIMEOUT_MS = 10000;
const MAX_TENTATIVAS = 3;
const PAUSA_ENTRE_TENTATIVAS_MS = 2000;
const USER_AGENT = 'SMCQ/1.0 (Validacao do IRS; TCC de Engenharia de Software)';

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function tentarUmaVez(url, corpoEmFluxo, timeoutMs) {
  const controlador = new AbortController();
  let temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  const encerrarPrazo = () => clearTimeout(temporizador);
  const renovarPrazo = () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  };
  try {
    const resposta = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controlador.signal });
    if (!resposta.ok) {
      const erro = new Error(`HTTP ${resposta.status} em ${url}`);
      // Erros 4xx (exceto 429) não melhoram com nova tentativa
      erro.definitivo = resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429;
      throw erro;
    }
    if (corpoEmFluxo) {
      renovarPrazo();
      resposta.renovarPrazo = renovarPrazo;
      resposta.encerrarPrazo = encerrarPrazo;
      return resposta;
    }
    // Corpo pequeno: lido aqui mesmo, dentro do mesmo prazo
    const texto = await resposta.text();
    encerrarPrazo();
    return { ok: true, status: resposta.status, headers: resposta.headers, text: async () => texto, json: async () => JSON.parse(texto) };
  } catch (err) {
    encerrarPrazo();
    if (controlador.signal.aborted) throw new Error(`tempo limite de ${timeoutMs} ms em ${url}`);
    if (err.definitivo) throw err;
    throw new Error(`${err.cause?.code || err.message} em ${url}`);
  }
}

async function requisitarComTentativas(url, { corpoEmFluxo = false, timeoutMs = TIMEOUT_MS } = {}) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      return await tentarUmaVez(url, corpoEmFluxo, timeoutMs);
    } catch (err) {
      ultimoErro = err;
      if (err.definitivo) break;
      if (tentativa < MAX_TENTATIVAS) await esperar(PAUSA_ENTRE_TENTATIVAS_MS * tentativa);
    }
  }
  throw new Error(`${ultimoErro.message} (após ${MAX_TENTATIVAS} tentativas)`);
}

module.exports = { requisitarComTentativas, esperar, TIMEOUT_MS, MAX_TENTATIVAS, USER_AGENT };
