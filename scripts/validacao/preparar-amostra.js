// ============================================================
// VALIDAÇÃO DO IRS — ETAPA 2.2: PREPARAÇÃO DA AMOSTRA
// 1. Lê os focos brutos do INPE (só o satélite de referência).
// 2. Sorteia ~300 focos estratificados (6 biomas + estrato urbano),
//    com semente fixa, deixando os últimos 7 dias fora do sorteio.
// 3. Monta as entradas do IRS só com dados do dia 0:
//      - lat/lon e bioma ........ CSV do INPE
//      - área afetada ........... focos a até 1 km no mesmo dia (proxy)
//      - dA/dt .................. focos a até 1 km: dia 0 − dia −1 (mín. 0)
//      - pessoas em risco ....... a até 50 km de uma das 10 cidades (proxy)
//      - vento .................. Open-Meteo, dia 0 (cache em disco)
//      - UC, TI, fauna .......... geodadosService (cache em disco)
// 4. Calcula o gabarito (focos a até 10 km nos dias 1 a 7) e as
//    faixas por quartis.
// 5. Salva data/validacao/amostra.csv, amostra.json e amostra-meta.json.
//
// Rodar: node scripts/validacao/preparar-amostra.js
// (depois de scripts/validacao/coletar-dados.js)
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { requisitarComTentativas, esperar } = require('./http');
const A = require('./amostra');
const cacheMemoria = require('../../services/cacheService');
const geodadosService = require('../../services/geodadosService');

const RAIZ = path.join(__dirname, '..', '..');
const PASTA = path.join(RAIZ, 'data', 'validacao');
const PASTA_CACHE = path.join(PASTA, 'cache');
const CACHE_CLIMA = path.join(PASTA_CACHE, 'open-meteo.json');
const CACHE_GEO = path.join(PASTA_CACHE, 'geodados.json');
const LOG_GEO = path.join(PASTA_CACHE, 'geodados.log');
const FONTES_GEO = ['bioma', 'uc', 'ti', 'fauna']; // "focos" fica de fora: não entra no IRS
const MAX_TENTATIVAS_GEO = 3;

const lerJson = (arquivo, padrao) => (fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : padrao);
const gravarJson = (arquivo, dados) => fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));

// ------------------------------------------------------------
// Open-Meteo: vento do dia 0, com cache em disco
// ------------------------------------------------------------
function urlClima(foco) {
  const parametros = new URLSearchParams({
    latitude: foco.lat.toFixed(4),
    longitude: foco.lon.toFixed(4),
    start_date: foco.dia,
    end_date: foco.dia,
    daily: 'windspeed_10m_max,winddirection_10m_dominant',
    timezone: 'GMT', // o dia 0 é o dia UTC do CSV do INPE
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

// ------------------------------------------------------------
// Geodados: geodadosService com cache em disco e até 3 tentativas
// O log do serviço vai para data/validacao/cache/geodados.log.
// ------------------------------------------------------------
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
    // A partir da 2ª passada, esvazia o cache em memória do serviço: senão ele
    // devolveria o mesmo fallback guardado (TTL de 5 min) sem consultar a fonte de novo
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

// ------------------------------------------------------------
// CSV de saída
// ------------------------------------------------------------
function paraCsv(linhas) {
  const colunas = Object.keys(linhas[0]);
  const escapar = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [colunas.join(','), ...linhas.map(l => colunas.map(c => escapar(l[c])).join(','))].join('\n') + '\n';
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
  const fontes = lerJson(path.join(PASTA, 'bruto', 'fontes.json'), null);
  if (!fontes) throw new Error('data/validacao/bruto/fontes.json não encontrado: rode antes scripts/validacao/coletar-dados.js');
  const arquivos = fontes.downloads.map(d => path.join(RAIZ, d.arquivo)).sort();

  console.log(`Lendo ${arquivos.length} arquivo(s) do INPE (satélite ${config.SATELITE})...`);
  const { focos, malformadas } = await A.lerFocos(arquivos, config.SATELITE);
  console.log(`  ${focos.length} focos do ${config.SATELITE}; ${malformadas} linha(s) malformada(s) ignorada(s)`);
  const indice = A.criarIndice(focos);

  const { estratos, ultimoDiaSorteavel, totalElegiveis } = A.montarEstratos(focos);
  const amostra = A.sortearAmostra(estratos);
  console.log(`Sorteio: ${amostra.length} focos de ${totalElegiveis} elegíveis (dia 0 de ${config.PERIODO.inicio} a ${ultimoDiaSorteavel})`);

  console.log('Vento (Open-Meteo)...');
  const cacheClima = lerJson(CACHE_CLIMA, {});
  const clima = {};
  for (const [i, foco] of amostra.entries()) {
    try {
      clima[foco.id] = await obterClima(foco, cacheClima);
    } catch (err) {
      const faltam = amostra.filter(f => !cacheClima[urlClima(f)]).length;
      throw new Error(`${err.message}
  Open-Meteo: ${amostra.length - faltam} de ${amostra.length} pontos em cache; faltam ${faltam} (parou no ponto ${i + 1})`);
    }
  }

  console.log('Geodados (geodadosService)...');
  const cacheGeo = lerJson(CACHE_GEO, {});
  await obterTodosGeodados(amostra, cacheGeo);

  // Entradas do dia 0 e gabarito
  const registros = amostra.map(foco => {
    const geo = cacheGeo[foco.id];
    const entradas = A.montarEntradasDia0(foco, indice.ate(foco.dia), clima[foco.id], geo.resultado);
    return { foco, entradas, clima: clima[foco.id], geo, gabaritoN: A.calcularGabarito(foco, indice) };
  });
  const quartis = A.limitesQuartis(registros.map(r => r.gabaritoN));
  for (const r of registros) r.gabaritoNivel = A.nivelGabarito(r.gabaritoN, quartis);

  // amostra.json: entradas exatas do IRS, lidas pela Etapa 3
  const json = registros.map(r => ({
    id: r.foco.id,
    estrato: r.foco.estrato,
    dia0: r.foco.dia,
    alerta: r.entradas.alerta,
    geodados: r.entradas.geodados,
    gabarito: { nFocos10km7dias: r.gabaritoN, nivel: r.gabaritoNivel }
  }));

  // amostra.csv: uma linha por foco, legível em planilha
  const csv = registros.map(({ foco, entradas: { alerta, geodados, proxies }, clima: c, geo, gabaritoN, gabaritoNivel }) => ({
    id: foco.id,
    estrato: foco.estrato,
    dia0: foco.dia,
    data_hora_gmt: foco.dataHora,
    satelite: foco.satelite,
    latitude: foco.lat,
    longitude: foco.lon,
    municipio: foco.municipio,
    estado: foco.estado,
    bioma_inpe: foco.bioma,
    frp: foco.frp,
    dias_sem_chuva: foco.diasSemChuva,
    precipitacao: foco.precipitacao,
    risco_fogo_inpe: foco.riscoFogo,
    n_focos_1km_dia0: proxies.nFocos1kmDia0,
    n_focos_1km_dia_menos1: proxies.nFocos1kmDiaAnterior,
    area_afetada: alerta.areaAfetada,
    dA_dt: alerta.dA_dt,
    cidade_proxima: proxies.cidadeProxima,
    distancia_cidade_km: proxies.distanciaCidadeKm.toFixed(2),
    pessoas_risco: alerta.pessoasRisco,
    zona_urbana: alerta.zonaUrbana,
    vento_kmh: c.velocidadeKmh,
    vento_dir_de_onde_vem: c.direcaoGraus,
    vento_dir_para_onde_sopra: alerta.direcaoVento,
    vento_classe: alerta.vento,
    bioma_irs: alerta.bioma,
    bioma_ibge: geo.resultado.bioma,
    uc_nome: geodados.unidadeConservacao?.nome ?? '',
    uc_esfera: geodados.unidadeConservacao?.esfera ?? '',
    ti_nome: geodados.terraIndigena?.nome ?? '',
    faixa_area_protegida: geodados.faixaAreaProtegida,
    fauna_nivel: geodados.fauna?.nivel,
    fauna_total_especies: geodados.fauna?.total,
    fonte_vento: c.fonte.replace(' (cache em disco)', ''),
    fonte_bioma_irs: 'INPE CSV',
    fonte_bioma_ibge: geo.resultado.fontes.bioma,
    fonte_uc: geo.resultado.fontes.uc,
    fonte_ti: geo.resultado.fontes.ti,
    fonte_fauna: geo.resultado.fontes.fauna,
    geodados_tentativas: geo.tentativas,
    geodados_consultado_em: geo.consultadoEm,
    gabarito_n_focos_10km_7d: gabaritoN,
    gabarito_nivel: gabaritoNivel
  }));

  const contagens = registros.map(r => r.gabaritoN);
  const meta = {
    geradoEm: new Date().toISOString(),
    parametros: config,
    satelite: config.SATELITE,
    focosLidos: focos.length,
    linhasMalformadas: malformadas,
    focosElegiveis: totalElegiveis,
    elegiveisPorEstrato: Object.fromEntries(Object.entries(estratos).map(([k, v]) => [k, v.length])),
    periodo: { inicio: config.PERIODO.inicio, fim: config.PERIODO.fim, ultimoDia0Sorteavel: ultimoDiaSorteavel },
    n: registros.length,
    porEstrato: contar(registros, r => r.foco.estrato),
    porBiomaInpe: contar(registros, r => r.foco.bioma),
    concordanciaBiomaInpeIbge: registros.filter(r => r.entradas.alerta.bioma === r.geo.resultado.bioma).length,
    gabarito: {
      quartis,
      minimo: Math.min(...contagens),
      maximo: Math.max(...contagens),
      zeros: contagens.filter(n => n === 0).length,
      porNivel: contar(registros, r => r.gabaritoNivel)
    },
    proxies: {
      areaAfetada: contar(registros, r => r.entradas.alerta.areaAfetada),
      vento: contar(registros, r => r.entradas.alerta.vento),
      pessoasRisco: contar(registros, r => String(r.entradas.alerta.pessoasRisco)),
      dA_dtPositivo: registros.filter(r => r.entradas.alerta.dA_dt > 0).length
    },
    openMeteo: {
      // Entradas antigas do cache, sem o campo, foram obtidas com o limite original de 10 s
      pontosPorTimeoutMs: contar(registros, r => String(r.clima.timeoutMs ?? 10000)),
      timeoutAtualMs: config.OPEN_METEO_TIMEOUT_MS,
      pausaEntreRequisicoesMs: config.PAUSA_OPEN_METEO_MS
    },
    fontes: {
      vento: contar(registros, r => r.clima.fonte.replace(' (cache em disco)', '')),
      ...Object.fromEntries(FONTES_GEO.map(f => [f === 'bioma' ? 'biomaIbge' : f, contar(registros, r => r.geo.resultado.fontes[f])]))
    },
    geodadosComFallback: registros.filter(r => usouFallback(r.geo)).length
  };

  fs.writeFileSync(path.join(PASTA, 'amostra.csv'), paraCsv(csv));
  gravarJson(path.join(PASTA, 'amostra.json'), json);
  gravarJson(path.join(PASTA, 'amostra-meta.json'), meta);

  console.log('\n================ RESUMO DA AMOSTRA ================');
  console.log(`N final: ${meta.n}   satélite: ${meta.satelite}`);
  console.log(`Período: ${meta.periodo.inicio} a ${meta.periodo.fim} (dia 0 sorteado até ${meta.periodo.ultimoDia0Sorteavel})`);
  console.log('Por estrato (sorteados / elegíveis):');
  for (const [k, v] of Object.entries(meta.porEstrato)) console.log(`  ${k.padEnd(42)} ${String(v).padStart(3)} / ${meta.elegiveisPorEstrato[k]}`);
  console.log('Por bioma (CSV do INPE, incluindo o estrato urbano):', meta.porBiomaInpe);
  console.log(`Bioma INPE = bioma IBGE em ${meta.concordanciaBiomaInpeIbge}/${meta.n}`);
  console.log('Gabarito (focos a ≤ 10 km nos 7 dias seguintes):');
  console.log(`  mín ${meta.gabarito.minimo} · Q1 ${quartis.q1} · Q2 ${quartis.q2} · Q3 ${quartis.q3} · máx ${meta.gabarito.maximo} · zeros ${meta.gabarito.zeros}`);
  console.log('  por nível:', meta.gabarito.porNivel);
  console.log('Proxies:', meta.proxies);
  console.log('Fontes:', JSON.stringify(meta.fontes, null, 2));
  console.log(`Focos com algum fallback de geodados: ${meta.geodadosComFallback}`);
}

main().catch(err => {
  console.error(`\nERRO — a preparação foi interrompida: ${err.message}`);
  process.exit(1);
});
