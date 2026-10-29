// ============================================================
// AMOSTRA INDEPENDENTE DE OUTUBRO DE 2026 (pré-registro de 29/10/2026)
// Mesmo procedimento de scripts/validacao/preparar-amostra.js, mudando
// só o período: dia 0 de 01/10 a 21/10/2026 (os 7 dias seguintes vão até
// 28/10, último dia publicado pelo INPE na coleta). Reaproveita as funções
// de scripts/validacao/amostra.js sem modificá-las.
// Diferenças em relação à amostra principal (definidas no pré-registro):
//   - focos dos CSVs DIÁRIOS do INPE de 30/09 a 28/10 (o mensal de outubro
//     ainda estava incompleto); 30/09 entra só como dia −1 de 01/10;
//   - cortes da referência FIXOS, os da validação principal
//     (0 | 1–2 | 3–5 | 6+), sem calcular novos tercis.
// Saída em data/analises/outubro/ (brutos em data/analises/outubro/bruto/,
// fora do Git, com URL, data e SHA-256 em fontes.json).
//
// Rodar: node scripts/analises/preparar-amostra-outubro.js
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../validacao/config');
const { requisitarComTentativas, esperar } = require('../validacao/http');
const A = require('../validacao/amostra');
const cacheMemoria = require('../../services/cacheService');
const geodadosService = require('../../services/geodadosService');

const PERIODO = { inicio: '2026-10-01', fim: '2026-10-28' }; // fim − 7 dias = 21/10
const PRIMEIRO_ARQUIVO = '2026-09-30';
const CORTES_FIXOS = { t1: 2, t2: 5 };
const BASE_DIARIO = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/';

const RAIZ = path.join(__dirname, '..', '..');
const PASTA = path.join(RAIZ, 'data', 'analises', 'outubro');
const PASTA_BRUTO = path.join(PASTA, 'bruto');
const PASTA_CACHE = path.join(PASTA, 'cache');
const CACHE_CLIMA = path.join(PASTA_CACHE, 'open-meteo.json');
const CACHE_GEO = path.join(PASTA_CACHE, 'geodados.json');
const LOG_GEO = path.join(PASTA_CACHE, 'geodados.log');
const ARQUIVO_FONTES = path.join(PASTA_BRUTO, 'fontes.json');
const FONTES_GEO = ['bioma', 'uc', 'ti', 'fauna'];
const MAX_TENTATIVAS_GEO = 3;

const lerJson = (arquivo, padrao) => (fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : padrao);
const gravarJson = (arquivo, dados) => fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));

// ------------------------------------------------------------
// Download dos CSVs diários do INPE (com registro de URL, data e SHA-256)
// ------------------------------------------------------------
function diasEntre(inicio, fim) {
  const dias = [];
  for (let d = inicio; d <= fim; d = A.somarDias(d, 1)) dias.push(d);
  return dias;
}

async function baixarBrutos() {
  fs.mkdirSync(PASTA_BRUTO, { recursive: true });
  const fontes = lerJson(ARQUIVO_FONTES, { downloads: [] });
  for (const dia of diasEntre(PRIMEIRO_ARQUIVO, PERIODO.fim)) {
    const nome = `focos_diario_br_${dia.replace(/-/g, '')}.csv`;
    const arquivo = path.join(PASTA_BRUTO, nome);
    if (fs.existsSync(arquivo) && fontes.downloads.some(d => d.arquivo.endsWith(nome))) continue;
    const url = BASE_DIARIO + nome;
    const resposta = await requisitarComTentativas(url, { timeoutMs: 60000 });
    const conteudo = Buffer.from(await resposta.text(), 'utf8');
    fs.writeFileSync(arquivo, conteudo);
    fontes.downloads = fontes.downloads.filter(d => !d.arquivo.endsWith(nome));
    fontes.downloads.push({
      url,
      arquivo: path.relative(RAIZ, arquivo).replace(/\\/g, '/'),
      baixadoEm: new Date().toISOString(),
      bytes: conteudo.length,
      sha256: crypto.createHash('sha256').update(conteudo).digest('hex'),
      ultimaModificacaoServidor: resposta.headers.get('last-modified')
    });
    gravarJson(ARQUIVO_FONTES, fontes);
    console.log(`  ${nome} (${(conteudo.length / 1e6).toFixed(1)} MB)`);
  }
  return fontes.downloads.map(d => path.join(RAIZ, d.arquivo)).sort();
}

// ------------------------------------------------------------
// Open-Meteo e geodados: mesma lógica da amostra principal
// ------------------------------------------------------------
function urlClima(foco) {
  const parametros = new URLSearchParams({
    latitude: foco.lat.toFixed(4),
    longitude: foco.lon.toFixed(4),
    start_date: foco.dia,
    end_date: foco.dia,
    daily: 'windspeed_10m_max,winddirection_10m_dominant',
    timezone: 'GMT',
    wind_speed_unit: 'kmh'
  });
  return `${config.OPEN_METEO}?${parametros}`;
}

async function obterClima(foco, cache) {
  const url = urlClima(foco);
  if (cache[url]) return { ...cache[url], fonte: 'Open-Meteo (cache em disco)' };
  const resposta = await requisitarComTentativas(url, { timeoutMs: config.OPEN_METEO_TIMEOUT_MS });
  const dados = await resposta.json();
  const velocidadeKmh = dados.daily?.windspeed_10m_max?.[0];
  const direcaoGraus = dados.daily?.winddirection_10m_dominant?.[0];
  if (!Number.isFinite(velocidadeKmh) || !Number.isFinite(direcaoGraus)) {
    throw new Error(`Open-Meteo sem vento para ${foco.dia} em ${foco.lat},${foco.lon}: ${JSON.stringify(dados).slice(0, 300)}`);
  }
  cache[url] = { velocidadeKmh, direcaoGraus, dia: dados.daily.time[0], consultadoEm: new Date().toISOString(), timeoutMs: config.OPEN_METEO_TIMEOUT_MS, url };
  gravarJson(CACHE_CLIMA, cache);
  await esperar(config.PAUSA_OPEN_METEO_MS);
  return { ...cache[url], fonte: 'Open-Meteo' };
}

const usouFallback = (registro) => FONTES_GEO.some(f => String(registro.resultado.fontes[f]).startsWith('fallback'));

async function consultarGeodados(foco) {
  const logOriginal = console.log;
  const linhas = [];
  console.log = (...args) => linhas.push(args.join(' '));
  try {
    return await geodadosService.obterGeodadosCompletos(foco.lat, foco.lon);
  } finally {
    console.log = logOriginal;
    fs.appendFileSync(LOG_GEO, linhas.map(l => `${new Date().toISOString()} ${foco.id} ${l}`).join('\n') + '\n');
  }
}

async function obterTodosGeodados(amostra, cache) {
  for (let passada = 1; passada <= MAX_TENTATIVAS_GEO; passada++) {
    const pendentes = amostra.filter(f => !cache[f.id] || (usouFallback(cache[f.id]) && cache[f.id].tentativas < MAX_TENTATIVAS_GEO));
    if (pendentes.length === 0) break;
    if (passada > 1) cacheMemoria.limpar();
    console.log(`  geodados: passada ${passada}, ${pendentes.length} ponto(s)`);
    for (const [i, foco] of pendentes.entries()) {
      const resultado = await consultarGeodados(foco);
      cache[foco.id] = { resultado, tentativas: (cache[foco.id]?.tentativas || 0) + 1, consultadoEm: new Date().toISOString() };
      gravarJson(CACHE_GEO, cache);
      if ((i + 1) % 50 === 0) console.log(`    ${i + 1}/${pendentes.length}`);
      await esperar(config.PAUSA_GEODADOS_MS);
    }
  }
}

function contar(itens, chave) {
  return itens.reduce((acc, item) => {
    const k = chave(item);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// Principal
// ------------------------------------------------------------
async function main() {
  fs.mkdirSync(PASTA_CACHE, { recursive: true });
  console.log(`Baixando CSVs diários do INPE (${PRIMEIRO_ARQUIVO} a ${PERIODO.fim})...`);
  const arquivos = await baixarBrutos();

  console.log(`Lendo ${arquivos.length} arquivo(s) (satélite ${config.SATELITE})...`);
  const { focos, malformadas } = await A.lerFocos(arquivos, config.SATELITE);
  const indice = A.criarIndice(focos);
  const ultimoDiaComDados = focos.reduce((m, f) => (f.dia > m ? f.dia : m), '');
  if (ultimoDiaComDados < PERIODO.fim) throw new Error(`os dados vão só até ${ultimoDiaComDados}; o pré-registro exige até ${PERIODO.fim}`);

  const { estratos, ultimoDiaSorteavel, totalElegiveis } = A.montarEstratos(focos, PERIODO);
  const amostra = A.sortearAmostra(estratos);
  console.log(`Sorteio: ${amostra.length} focos de ${totalElegiveis} elegíveis (dia 0 de ${PERIODO.inicio} a ${ultimoDiaSorteavel})`);

  console.log('Vento (Open-Meteo)...');
  const cacheClima = lerJson(CACHE_CLIMA, {});
  const clima = {};
  for (const foco of amostra) clima[foco.id] = await obterClima(foco, cacheClima);

  console.log('Geodados (geodadosService)...');
  const cacheGeo = lerJson(CACHE_GEO, {});
  await obterTodosGeodados(amostra, cacheGeo);

  const registros = amostra.map(foco => {
    const geo = cacheGeo[foco.id];
    const entradas = A.montarEntradasDia0(foco, indice.ate(foco.dia), clima[foco.id], geo.resultado);
    const n = A.calcularGabarito(foco, indice);
    return { foco, entradas, geo, n, nivel: A.nivelGabaritoTercis(n, CORTES_FIXOS) };
  });

  const json = registros.map(r => ({
    id: r.foco.id,
    estrato: r.foco.estrato,
    dia0: r.foco.dia,
    municipio: r.foco.municipio,
    estado: r.foco.estado,
    bioma_inpe: r.foco.bioma,
    latitude: r.foco.lat,
    longitude: r.foco.lon,
    frp: r.foco.frp,
    dias_sem_chuva: r.foco.diasSemChuva,
    precipitacao: r.foco.precipitacao,
    risco_fogo_inpe: r.foco.riscoFogo,
    alerta: r.entradas.alerta,
    geodados: r.entradas.geodados,
    gabarito: { nFocos10km7dias: r.n, nivel: r.nivel }
  }));
  const meta = {
    geradoEm: new Date().toISOString(),
    preRegistro: 'docs/preregistro-variante-meteorologica.md',
    periodo: { ...PERIODO, ultimoDia0Sorteavel: ultimoDiaSorteavel, ultimoDiaComDados },
    satelite: config.SATELITE,
    semente: config.SEMENTE,
    cortesReferencia: CORTES_FIXOS,
    focosLidos: focos.length,
    linhasMalformadas: malformadas,
    focosElegiveis: totalElegiveis,
    elegiveisPorEstrato: Object.fromEntries(Object.entries(estratos).map(([k, v]) => [k, v.length])),
    n: registros.length,
    porEstrato: contar(registros, r => r.foco.estrato),
    porBiomaInpe: contar(registros, r => r.foco.bioma),
    referenciaPorNivel: contar(registros, r => r.nivel),
    riscoFogoAusente: registros.filter(r => !(Number.isFinite(r.foco.riscoFogo) && r.foco.riscoFogo >= 0)).length,
    frpAusente: registros.filter(r => !Number.isFinite(r.foco.frp)).length,
    geodadosComFallback: registros.filter(r => usouFallback(r.geo)).length,
    fontesGeodados: Object.fromEntries(FONTES_GEO.map(f => [f, contar(registros, r => r.geo.resultado.fontes[f])]))
  };
  gravarJson(path.join(PASTA, 'amostra.json'), json);
  gravarJson(path.join(PASTA, 'amostra-meta.json'), meta);

  console.log('\n========== AMOSTRA DE OUTUBRO ==========');
  console.log(`N ${meta.n} de ${meta.focosElegiveis} elegíveis; dados até ${ultimoDiaComDados}`);
  console.log('Por estrato:', meta.porEstrato);
  console.log('Referência:', meta.referenciaPorNivel);
  console.log(`Risco de Fogo ausente: ${meta.riscoFogoAusente}; FRP ausente: ${meta.frpAusente}; geodados com fallback: ${meta.geodadosComFallback}`);
}

main().catch(err => {
  console.error(`\nERRO — a preparação foi interrompida: ${err.message}`);
  process.exit(1);
});
