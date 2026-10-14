// ============================================================
// SERVIÇO DE GEODADOS — INTEGRAÇÃO COM BASES PÚBLICAS
// Enriquece um ponto (latitude, longitude) com dados ambientais:
//   - bioma ......................... IBGE (WFS)
//   - unidade de conservação ........ ICMBio, via INDE (WFS)
//   - terra indígena ................ FUNAI (WFS)
//   - fauna ameaçada ................ GBIF (API REST)
//   - focos de calor recentes ....... INPE, Programa Queimadas (CSV)
//
// Regras comuns a todas as fontes:
//   - tempo limite de 3 s por requisição (AbortController);
//   - cache em memória de 1 h por ponto e fonte;
//   - se a fonte falhar, usa-se um fallback local e o erro vai para o log.
// Nenhuma função daqui rejeita por falha de rede: o sistema continua
// funcionando sem internet, só com dados menos precisos.
// ============================================================

const tls = require('node:tls');
const cache = require('./cacheService');
const { calcularDistancia, identificarBiomaPorCentroides, normalizarChave } = require('./riscoService');

const TIMEOUT_MS = 3000;
const TTL_MS = 60 * 60 * 1000;          // 1 hora
// O fallback fica pouco tempo em cache: evita esperar o tempo limite a cada chamada
// enquanto a fonte está fora do ar, mas volta a tentá-la logo
const TTL_FALLBACK_MS = 5 * 60 * 1000;  // 5 minutos
// Identifica a aplicação para os serviços (a FUNAI recusa requisições sem identificação)
const USER_AGENT = 'SMCQ/1.0 (Sistema de Monitoramento de Queimadas; TCC de Engenharia de Software)';

const IBGE_WFS = 'https://geoservicos.ibge.gov.br/geoserver/ows';
const ICMBIO_WFS = 'https://geoservicos.inde.gov.br/geoserver/ICMBio/ows';
const FUNAI_WFS = 'https://geoserver.funai.gov.br/geoserver/Funai/ows';
const GBIF_API = 'https://api.gbif.org/v1/occurrence/search';
const INPE_CSV = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil';

const BIOMAS_CONHECIDOS = ['AMAZONIA', 'PANTANAL', 'MATA_ATLANTICA', 'CERRADO', 'CAATINGA', 'PAMPA'];
const FAIXAS = ['<10 km', '10-50 km', '>50 km'];

// O servidor da FUNAI não envia o certificado intermediário, e o Node, que não usa os
// certificados do sistema operacional por padrão, recusa a conexão. Somar os certificados
// do sistema aos do Node resolve sem desligar a verificação de TLS.
// Requer Node 22.19+/24.5+; em versões anteriores a FUNAI cai no fallback.
function habilitarCertificadosDoSistema() {
  try {
    if (typeof tls.setDefaultCACertificates !== 'function') return;
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
  } catch {
    // Sem os certificados do sistema, segue só com os do Node
  }
}
habilitarCertificadosDoSistema();

// ------------------------------------------------------------
// 1. Infraestrutura: log, requisição com tempo limite e fallback
// ------------------------------------------------------------

// Log estruturado: [geodados] fonte=X status=sucesso|fallback|cache tempo=Xms
function registrar(fonte, status, tempoMs, detalhe) {
  console.log(`[geodados] fonte=${fonte} status=${status} tempo=${tempoMs}ms${detalhe ? ` detalhe="${detalhe}"` : ''}`);
}

// GET com tempo limite. O limite cobre também a leitura do corpo da resposta.
async function requisitar(url, tipo = 'json') {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controlador.signal });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return tipo === 'texto' ? await resposta.text() : await resposta.json();
  } catch (err) {
    if (controlador.signal.aborted) throw new Error(`tempo limite de ${TIMEOUT_MS} ms`);
    // Em falha de rede, o motivo real (DNS, TLS, conexão recusada) vem em err.cause
    throw new Error(err.cause?.code || err.message);
  } finally {
    clearTimeout(temporizador);
  }
}

// Consulta de feições em um GeoServer. Devolve só os atributos (sem geometria).
// WFS 1.0.0 porque nele a ordem das coordenadas é sempre longitude, latitude;
// na 2.0.0 ela depende do sistema de referência da camada.
async function consultarWfs(base, camada, filtro, campos) {
  const parametros = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: camada,
    outputFormat: 'application/json',
    maxFeatures: '5',
    propertyName: campos.join(','),
    CQL_FILTER: filtro
  });
  const dados = await requisitar(`${base}?${parametros}`);
  if (!Array.isArray(dados.features)) throw new Error('resposta sem lista de feições');
  return dados.features.map(f => f.properties);
}

// Executa `buscar` com cache; se falhar, registra e devolve `fallback()`.
// Resultado: { dados, fonte }, em que `fonte` diz de onde o dado veio.
async function comFallback({ rotulo, chave, fonte, fonteFallback, buscar, fallback }) {
  const emCache = cache.get(chave);
  if (emCache) {
    registrar(rotulo, 'cache', 0, emCache.fonte === fonte ? undefined : emCache.fonte);
    return emCache;
  }
  const inicio = Date.now();
  let resultado;
  try {
    resultado = { dados: await buscar(), fonte };
    cache.set(chave, resultado, TTL_MS);
    registrar(rotulo, 'sucesso', Date.now() - inicio);
  } catch (err) {
    resultado = { dados: fallback(), fonte: fonteFallback };
    cache.set(chave, resultado, TTL_FALLBACK_MS);
    registrar(rotulo, 'fallback', Date.now() - inicio, err.message);
  }
  return resultado;
}

// Converte e valida as coordenadas. Coordenada inválida é erro de quem chama, não de rede.
function validarCoordenadas(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  const validas = lat !== null && lat !== '' && lng !== null && lng !== ''
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  if (!validas) throw new RangeError('Coordenadas inválidas');
  return { latitude, longitude };
}

// Chave de cache do ponto, com 4 casas decimais (cerca de 11 m)
function chaveDoPonto(prefixo, latitude, longitude) {
  return `${prefixo}:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function faixaPorDistancia(distanciaKm) {
  if (distanciaKm < 10) return FAIXAS[0];
  if (distanciaKm <= 50) return FAIXAS[1];
  return FAIXAS[2];
}

// ------------------------------------------------------------
// 2. Bioma — IBGE
//    Camada CREN:lm_bioma_250 (Biomas do Brasil, 1:250 000).
//    Fallback: centróide mais próximo (lista em riscoService).
// ------------------------------------------------------------
function consultarBioma(latitude, longitude) {
  return comFallback({
    rotulo: 'IBGE',
    chave: chaveDoPonto('bioma', latitude, longitude),
    fonte: 'IBGE WFS',
    fonteFallback: 'fallback-centroides',
    buscar: async () => {
      const feicoes = await consultarWfs(IBGE_WFS, 'CREN:lm_bioma_250', `INTERSECTS(geom,POINT(${longitude} ${latitude}))`, ['bioma']);
      const bioma = normalizarChave(feicoes[0]?.bioma);
      // Ponto fora de todos os biomas (no mar ou fora do Brasil)
      return BIOMAS_CONHECIDOS.includes(bioma) ? bioma : 'OUTRO';
    },
    fallback: () => identificarBiomaPorCentroides(latitude, longitude).bioma
  });
}

// ------------------------------------------------------------
// 3. Áreas protegidas — ICMBio (UCs federais) e FUNAI (TIs)
//    Três consultas por base: o ponto está dentro de uma área?
//    Há alguma a até 10 km? E a até 50 km? As duas últimas dão a
//    faixa de distância usada no critério de relevância ecológica.
//    Fallback: listas fixas com o retângulo envolvente (bbox) de
//    cada área, extraídos das próprias bases em outubro de 2026.
//    O retângulo é maior que a área real: no fallback o resultado
//    é aproximado e vem marcado com `aproximado: true`.
// ------------------------------------------------------------

// bbox: [oeste, sul, leste, norte]
const UCS_FALLBACK = [
  { nome: 'PARQUE NACIONAL DO PANTANAL MATO-GROSSENSE', categoria: 'Parque Nacional', bbox: [-57.693, -17.864, -57.155, -17.431] },
  { nome: 'PARQUE NACIONAL DO IGUAÇU', categoria: 'Parque Nacional', bbox: [-54.487, -25.694, -53.623, -25.052] },
  { nome: 'PARQUE NACIONAL DA CHAPADA DOS VEADEIROS', categoria: 'Parque Nacional', bbox: [-47.907, -14.216, -46.974, -13.618] },
  { nome: 'PARQUE NACIONAL DAS EMAS', categoria: 'Parque Nacional', bbox: [-53.119, -18.349, -52.737, -17.864] },
  { nome: 'PARQUE NACIONAL DO JAÚ', categoria: 'Parque Nacional', bbox: [-63.989, -2.971, -61.357, -1.549] },
  { nome: 'PARQUE NACIONAL DA TIJUCA', categoria: 'Parque Nacional', bbox: [-43.343, -23.005, -43.194, -22.903] },
  { nome: 'PARQUE NACIONAL DE BRASÍLIA', categoria: 'Parque Nacional', bbox: [-48.164, -15.783, -47.861, -15.483] },
  { nome: 'PARQUE NACIONAL DA SERRA DA CANASTRA', categoria: 'Parque Nacional', bbox: [-47.0, -20.665, -46.204, -20.076] },
  { nome: 'PARQUE NACIONAL DA SERRA DA CAPIVARA', categoria: 'Parque Nacional', bbox: [-42.762, -8.835, -42.321, -8.5] },
  { nome: 'PARQUE NACIONAL DA CHAPADA DOS GUIMARÃES', categoria: 'Parque Nacional', bbox: [-55.98, -15.481, -55.786, -15.209] },
  { nome: 'PARQUE NACIONAL DA AMAZÔNIA', categoria: 'Parque Nacional', bbox: [-57.475, -4.949, -55.993, -3.65] },
  { nome: 'PARQUE NACIONAL MONTANHAS DO TUMUCUMAQUE', categoria: 'Parque Nacional', bbox: [-54.793, 0.684, -51.572, 3.509] },
  { nome: 'PARQUE NACIONAL DA SERRA DOS ÓRGÃOS', categoria: 'Parque Nacional', bbox: [-43.181, -22.585, -42.981, -22.392] },
  { nome: 'PARQUE NACIONAL DO ARAGUAIA', categoria: 'Parque Nacional', bbox: [-50.485, -11.167, -49.937, -9.842] },
  { nome: 'PARQUE NACIONAL DE APARADOS DA SERRA', categoria: 'Parque Nacional', bbox: [-50.175, -29.257, -50.014, -29.103] },
  { nome: 'FLORESTA NACIONAL DO TAPAJÓS', categoria: 'Floresta Nacional', bbox: [-55.41, -4.112, -54.802, -2.75] },
  { nome: 'PARQUE NACIONAL DO PICO DA NEBLINA', categoria: 'Parque Nacional', bbox: [-66.905, -0.394, -65.026, 1.033] },
  { nome: 'RESERVA BIOLÓGICA DO GURUPI', categoria: 'Reserva Biológica', bbox: [-46.963, -4.131, -46.459, -3.161] },
  { nome: 'PARQUE NACIONAL GRANDE SERTÃO VEREDAS', categoria: 'Parque Nacional', bbox: [-46.081, -15.425, -45.601, -14.743] },
  { nome: 'PARQUE NACIONAL DA SERRA DA BODOQUENA', categoria: 'Parque Nacional', bbox: [-56.862, -21.513, -56.609, -20.57] }
].map(uc => ({ ...uc, esfera: 'Federal' }));

const TIS_FALLBACK = [
  { nome: 'Yanomami', etnia: 'Yanomámi', area_ha: 9664975, bbox: [-66.477, -0.323, -61.333, 4.292] },
  { nome: 'Parque do Xingu', etnia: 'Wauja, Trumái, Yawalapití, Mehináku, Aweti, Yudjá, Kisêdjê, Ikpeng, Matipú, Kuikuro, Nahukuá, Tapayuna, Kaiabi, Kamayrurá, Kalapalo', area_ha: 2642004, bbox: [-54.011, -13.002, -52.539, -10.6] },
  { nome: 'Raposa Serra do Sol', etnia: 'Taulipáng, Makuxí, Ingarikó, Wapixana', area_ha: 1747465, bbox: [-61.134, 3.374, -59.516, 5.27] },
  { nome: 'Vale do Javari', etnia: 'Kulina Páno, Matsés e Matís', area_ha: 8544482, bbox: [-73.725, -7.202, -69.396, -4.348] },
  { nome: 'Kayapó', etnia: 'Kayapó', area_ha: 3284005, bbox: [-53.13, -8.693, -50.833, -6.879] },
  { nome: 'Alto Rio Negro', etnia: 'Arapáso, Karapanã, Barasána, Baré, Wanana', area_ha: 7999381, bbox: [-70.065, -1.086, -67.018, 2.235] },
  { nome: 'Munduruku', etnia: 'Mundurukú', area_ha: 2381796, bbox: [-58.475, -8.67, -56.667, -6.13] },
  { nome: 'Kadiwéu', etnia: 'Terena, Kadiwéu', area_ha: 538536, bbox: [-57.848, -21.053, -56.848, -20.182] },
  { nome: 'Arariboia', etnia: 'Guajá', area_ha: 413288, bbox: [-46.801, -5.389, -46.01, -4.782] },
  { nome: 'Uru-Eu-Wau-Wau', etnia: 'Uru-Eu-Wau-Wau', area_ha: 1867118, bbox: [-64.466, -11.838, -62.536, -10.394] }
];

// Distância do ponto ao retângulo (0 se estiver dentro)
function distanciaAteCaixa(latitude, longitude, [oeste, sul, leste, norte]) {
  const latProxima = Math.min(Math.max(latitude, sul), norte);
  const lngProxima = Math.min(Math.max(longitude, oeste), leste);
  return calcularDistancia(latitude, longitude, latProxima, lngProxima);
}

function areaProtegidaPelaLista(lista, latitude, longitude) {
  let maisProxima = null;
  let menorDistancia = Infinity;
  for (const item of lista) {
    const d = distanciaAteCaixa(latitude, longitude, item.bbox);
    if (d < menorDistancia) {
      menorDistancia = d;
      maisProxima = item;
    }
  }
  const { bbox, ...atributos } = maisProxima;
  return {
    area: menorDistancia === 0 ? { ...atributos, aproximado: true } : null,
    faixa: faixaPorDistancia(menorDistancia),
    nomeProximo: menorDistancia <= 50 ? maisProxima.nome : null
  };
}

// Configuração de cada base de áreas protegidas
const BASE_UC = {
  rotulo: 'ICMBio',
  prefixo: 'uc',
  fonte: 'ICMBio WFS',
  fonteFallback: 'fallback-lista-ucs',
  url: ICMBIO_WFS,
  camada: 'ICMBio:limiteucsfederais_a',
  campos: ['nomeuc', 'categoria_', 'esferaadm', 'grupouc'],
  campoNome: 'nomeuc',
  lista: UCS_FALLBACK,
  // Em sobreposição (ex.: parque dentro de uma APA), fica a de proteção integral
  converter: (feicoes) => {
    const uc = feicoes.find(f => f.grupouc === 'PI') || feicoes[0];
    return { nome: uc.nomeuc, categoria: uc.categoria_ || '', esfera: uc.esferaadm || 'Federal' };
  }
};

const BASE_TI = {
  rotulo: 'FUNAI',
  prefixo: 'ti',
  fonte: 'FUNAI WFS',
  fonteFallback: 'fallback-lista-tis',
  url: FUNAI_WFS,
  camada: 'Funai:tis_poligonais',
  campos: ['terrai_nome', 'etnia_nome', 'superficie_perimetro_ha', 'fase_ti'],
  campoNome: 'terrai_nome',
  lista: TIS_FALLBACK,
  converter: ([ti]) => ({
    nome: ti.terrai_nome,
    etnia: (ti.etnia_nome || '').trim(),
    area_ha: Math.round(ti.superficie_perimetro_ha || 0),
    fase: ti.fase_ti || ''
  })
};

// Resultado: { dados: { area, faixa, nomeProximo }, fonte }
function consultarAreaProtegida(base, latitude, longitude) {
  const ponto = `POINT(${longitude} ${latitude})`;
  const consultar = (filtro, campos) => consultarWfs(base.url, base.camada, filtro, campos);
  return comFallback({
    rotulo: base.rotulo,
    chave: chaveDoPonto(base.prefixo, latitude, longitude),
    fonte: base.fonte,
    fonteFallback: base.fonteFallback,
    buscar: async () => {
      const [dentro, ate10, ate50] = await Promise.all([
        consultar(`INTERSECTS(the_geom,${ponto})`, base.campos),
        consultar(`DWITHIN(the_geom,${ponto},10000,meters)`, [base.campoNome]),
        consultar(`DWITHIN(the_geom,${ponto},50000,meters)`, [base.campoNome])
      ]);
      const proxima = dentro[0] || ate10[0] || ate50[0];
      return {
        area: dentro.length > 0 ? base.converter(dentro) : null,
        faixa: dentro.length > 0 || ate10.length > 0 ? FAIXAS[0] : ate50.length > 0 ? FAIXAS[1] : FAIXAS[2],
        nomeProximo: proxima ? proxima[base.campoNome] : null
      };
    },
    fallback: () => areaProtegidaPelaLista(base.lista, latitude, longitude)
  });
}

// ------------------------------------------------------------
// 4. Fauna ameaçada — GBIF
//    Espécies animais com registro de ocorrência a até 50 km do
//    ponto, por categoria da Lista Vermelha da IUCN (CR, EN, VU).
//    Uma consulta por categoria, agregada por espécie (facet).
//    Fallback: nenhuma espécie (SEM_ESPECIES).
// ------------------------------------------------------------
const RAIO_FAUNA_KM = 50;
const CATEGORIAS_IUCN = [
  { status: 'CR', nivel: 'CRITICA' },    // criticamente em perigo
  { status: 'EN', nivel: 'AMEACADA' },   // em perigo
  { status: 'VU', nivel: 'VULNERAVEL' }  // vulnerável
];
const REINO_ANIMALIA = '1'; // sem este filtro o GBIF devolve também plantas
const LIMITE_ESPECIES_POR_CATEGORIA = 100;
const LIMITE_ESPECIES_NA_RESPOSTA = 20;

const FAUNA_FALLBACK = { total: 0, nivel: 'SEM_ESPECIES', especies: [], porCategoria: { CR: 0, EN: 0, VU: 0 } };

function consultarFauna(latitude, longitude) {
  return comFallback({
    rotulo: 'GBIF',
    chave: chaveDoPonto('fauna', latitude, longitude),
    fonte: 'GBIF API',
    fonteFallback: 'fallback-sem-dados',
    buscar: async () => {
      const respostas = await Promise.all(CATEGORIAS_IUCN.map(({ status }) => {
        const parametros = new URLSearchParams({
          geoDistance: `${latitude},${longitude},${RAIO_FAUNA_KM}km`,
          kingdomKey: REINO_ANIMALIA,
          iucnRedListCategory: status,
          limit: '0',
          facet: 'scientificName',
          facetLimit: String(LIMITE_ESPECIES_POR_CATEGORIA)
        });
        return requisitar(`${GBIF_API}?${parametros}`);
      }));

      const porCategoria = {};
      const especies = [];
      respostas.forEach((resposta, i) => {
        const { status } = CATEGORIAS_IUCN[i];
        const contagens = resposta.facets?.[0]?.counts || [];
        porCategoria[status] = contagens.length;
        contagens.forEach(({ name, count }) => especies.push({ nome: name, status, ocorrencias: count }));
      });
      // O nível é o da categoria mais grave com ao menos uma espécie
      const maisGrave = CATEGORIAS_IUCN.find(({ status }) => porCategoria[status] > 0);
      return {
        total: especies.length,
        nivel: maisGrave ? maisGrave.nivel : 'SEM_ESPECIES',
        // Já vêm ordenadas por gravidade (CR, EN, VU) e, em cada categoria, por número de registros
        especies: especies.slice(0, LIMITE_ESPECIES_NA_RESPOSTA),
        porCategoria
      };
    },
    fallback: () => ({ ...FAUNA_FALLBACK })
  });
}

// ------------------------------------------------------------
// 5. Focos de calor — INPE, Programa Queimadas
//    Um CSV por dia com todos os focos do Brasil (cerca de 4 MB).
//    Baixa os últimos 7 dias e filtra por distância (Haversine).
//    Cada arquivo fica em cache, então pontos diferentes reutilizam
//    o mesmo download. O total soma as detecções de todos os
//    satélites: o mesmo incêndio costuma aparecer mais de uma vez.
//    `totalSateliteReferencia` conta só o satélite de referência
//    do INPE, usado nas séries históricas.
//    Fallback: nenhum foco.
// ------------------------------------------------------------
const DIAS_FOCOS = 7;
const SATELITE_REFERENCIA = 'AQUA_M-T';
const LIMITE_FOCOS_NA_RESPOSTA = 20;

// Datas (UTC) dos últimos `dias` dias, no formato YYYYMMDD, de hoje para trás
function ultimosDias(dias) {
  const hoje = new Date();
  return Array.from({ length: dias }, (_, i) => {
    const dia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - i));
    return dia.toISOString().slice(0, 10).replace(/-/g, '');
  });
}

// Baixa e interpreta o CSV de um dia. Guarda as coordenadas em vetores numéricos
// e as linhas originais, lidas por inteiro só para os focos dentro do raio.
async function carregarFocosDoDia(dia) {
  const chave = `inpe:${dia}`;
  const emCache = cache.get(chave);
  if (emCache) return emCache;

  const texto = await requisitar(`${INPE_CSV}/focos_diario_br_${dia}.csv`, 'texto');
  const [cabecalho, ...linhas] = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const colunas = cabecalho.split(',');
  const indice = Object.fromEntries(['lat', 'lon', 'data_hora_gmt', 'satelite', 'municipio', 'estado'].map(c => [c, colunas.indexOf(c)]));
  if (indice.lat < 0 || indice.lon < 0) throw new Error('CSV do INPE em formato inesperado');

  const lats = new Float64Array(linhas.length);
  const lons = new Float64Array(linhas.length);
  linhas.forEach((linha, i) => {
    const campos = linha.split(',');
    lats[i] = Number(campos[indice.lat]);
    lons[i] = Number(campos[indice.lon]);
  });
  const focosDoDia = { linhas, lats, lons, indice };
  cache.set(chave, focosDoDia, TTL_MS);
  return focosDoDia;
}

function focosNoRaio({ linhas, lats, lons, indice }, latitude, longitude, raioKm) {
  const margemGraus = raioKm / 111; // 1 grau de latitude ≈ 111 km: descarta a maioria antes do Haversine
  const encontrados = [];
  for (let i = 0; i < linhas.length; i++) {
    if (Math.abs(lats[i] - latitude) > margemGraus) continue;
    const distanciaKm = calcularDistancia(latitude, longitude, lats[i], lons[i]);
    if (distanciaKm > raioKm) continue;
    const campos = linhas[i].split(',');
    encontrados.push({
      latitude: lats[i],
      longitude: lons[i],
      dataHora: campos[indice.data_hora_gmt] || '',
      satelite: campos[indice.satelite] || '',
      municipio: campos[indice.municipio] || '',
      estado: campos[indice.estado] || '',
      distanciaKm: parseFloat(distanciaKm.toFixed(2))
    });
  }
  return encontrados;
}

function consultarFocos(latitude, longitude, raioKm) {
  return comFallback({
    rotulo: 'INPE',
    chave: `${chaveDoPonto('focos', latitude, longitude)},${raioKm}`,
    fonte: 'INPE CSV',
    fonteFallback: 'fallback-sem-dados',
    buscar: async () => {
      const dias = ultimosDias(DIAS_FOCOS);
      const arquivos = await Promise.allSettled(dias.map(carregarFocosDoDia));
      const disponiveis = arquivos.filter(a => a.status === 'fulfilled');
      // Um dia sem arquivo é tolerado; sem nenhum, a fonte é considerada fora do ar
      if (disponiveis.length === 0) throw new Error(arquivos[0].reason.message);

      const focos = disponiveis.flatMap(a => focosNoRaio(a.value, latitude, longitude, raioKm));
      focos.sort((a, b) => a.distanciaKm - b.distanciaKm);
      return {
        total: focos.length,
        ultimos7dias: focos.length,
        totalSateliteReferencia: focos.filter(f => f.satelite === SATELITE_REFERENCIA).length,
        raioKm,
        diasConsultados: disponiveis.length,
        // Os mais próximos do ponto
        focos: focos.slice(0, LIMITE_FOCOS_NA_RESPOSTA)
      };
    },
    fallback: () => ({ total: 0, ultimos7dias: 0, totalSateliteReferencia: 0, raioKm, diasConsultados: 0, focos: [] })
  });
}

// ------------------------------------------------------------
// 6. Funções públicas
// ------------------------------------------------------------

// → { bioma, fonte }
async function identificarBioma(lat, lng) {
  const { latitude, longitude } = validarCoordenadas(lat, lng);
  const { dados, fonte } = await consultarBioma(latitude, longitude);
  return { bioma: dados, fonte };
}

// → { nome, categoria, esfera } ou null
async function verificarUnidadeConservacao(lat, lng) {
  const { latitude, longitude } = validarCoordenadas(lat, lng);
  return (await consultarAreaProtegida(BASE_UC, latitude, longitude)).dados.area;
}

// → { nome, etnia, area_ha, fase } ou null
async function verificarTerraIndigena(lat, lng) {
  const { latitude, longitude } = validarCoordenadas(lat, lng);
  return (await consultarAreaProtegida(BASE_TI, latitude, longitude)).dados.area;
}

// → { total, nivel, especies: [{ nome, status, ocorrencias }], porCategoria }
async function verificarFaunaAmeacada(lat, lng) {
  const { latitude, longitude } = validarCoordenadas(lat, lng);
  return (await consultarFauna(latitude, longitude)).dados;
}

// → { total, ultimos7dias, totalSateliteReferencia, raioKm, diasConsultados, focos: [...] }
async function buscarFocosProximos(lat, lng, raioKm = 50) {
  const { latitude, longitude } = validarCoordenadas(lat, lng);
  return (await consultarFocos(latitude, longitude, raioKm)).dados;
}

// Consulta todas as bases em paralelo e devolve um objeto único.
// Só rejeita com coordenadas inválidas (RangeError); falha de rede vira fallback.
async function obterGeodadosCompletos(lat, lng) {
  const { latitude, longitude } = validarCoordenadas(lat, lng);
  const inicio = Date.now();

  const [bioma, uc, ti, fauna, focos] = await Promise.allSettled([
    consultarBioma(latitude, longitude),
    consultarAreaProtegida(BASE_UC, latitude, longitude),
    consultarAreaProtegida(BASE_TI, latitude, longitude),
    consultarFauna(latitude, longitude),
    consultarFocos(latitude, longitude, 50)
  ]);

  // As consultas já tratam as próprias falhas; isto cobre um erro inesperado em uma delas
  const valor = (resultado, reserva) => (resultado.status === 'fulfilled' ? resultado.value : { dados: reserva, fonte: 'fallback-erro-interno' });
  const semArea = { area: null, faixa: FAIXAS[2], nomeProximo: null };
  const rBioma = valor(bioma, identificarBiomaPorCentroides(latitude, longitude).bioma);
  const rUc = valor(uc, semArea);
  const rTi = valor(ti, semArea);
  const rFauna = valor(fauna, { ...FAUNA_FALLBACK });
  const rFocos = valor(focos, { total: 0, ultimos7dias: 0, focos: [] });

  // Área protegida mais próxima entre UC e TI (em empate, a TI)
  const maisProxima = FAIXAS.indexOf(rTi.dados.faixa) <= FAIXAS.indexOf(rUc.dados.faixa)
    ? { ...rTi.dados, tipo: 'TI' }
    : { ...rUc.dados, tipo: 'UC' };

  const geodados = {
    latitude,
    longitude,
    bioma: rBioma.dados,
    fonteBioma: rBioma.fonte,
    unidadeConservacao: rUc.dados.area,
    terraIndigena: rTi.dados.area,
    faixaAreaProtegida: maisProxima.faixa,
    areaProtegidaProxima: maisProxima.nomeProximo ? { nome: maisProxima.nomeProximo, tipo: maisProxima.tipo } : null,
    fauna: rFauna.dados,
    focos: rFocos.dados,
    fontes: { bioma: rBioma.fonte, uc: rUc.fonte, ti: rTi.fonte, fauna: rFauna.fonte, focos: rFocos.fonte },
    timestamp: new Date().toISOString()
  };
  registrar('TODAS', 'concluido', Date.now() - inicio, Object.values(geodados.fontes).join(' | '));
  return geodados;
}

module.exports = {
  identificarBioma,
  verificarUnidadeConservacao,
  verificarTerraIndigena,
  verificarFaunaAmeacada,
  buscarFocosProximos,
  obterGeodadosCompletos,
  TIMEOUT_MS
};
