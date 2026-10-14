// ============================================================
// BIBLIOTECA DA AMOSTRA DE VALIDAÇÃO (funções puras)
// Leitura dos focos, sorteio estratificado, montagem das entradas
// do IRS no dia 0 e cálculo do gabarito. Sem acesso à rede: as
// consultas externas ficam em preparar-amostra.js.
//
// Proteção contra vazamento de dados: as entradas do dia 0 são
// montadas a partir de uma VISÃO dos focos limitada ao dia 0
// (indice.ate(dia0)). Qualquer consulta a um dia posterior lança
// erro. Só calcularGabarito acessa os dias 1 a 7.
// ============================================================

const fs = require('node:fs');
const readline = require('node:readline');
const { calcularDistancia, encontrarCidadeMaisProxima, normalizarChave } = require('../../services/riscoService');
const config = require('./config');

// ------------------------------------------------------------
// Datas (AAAA-MM-DD, UTC)
// ------------------------------------------------------------
function somarDias(dia, n) {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Leitura do CSV do INPE
// Colunas: id,lat,lon,data_hora_gmt,satelite,municipio,estado,pais,municipio_id,
//          estado_id,pais_id,numero_dias_sem_chuva,precipitacao,risco_fogo,bioma,frp
// O INPE usa -999 para "sem valor" nos campos meteorológicos.
// ------------------------------------------------------------
const semValor = (v) => (v === undefined || v === '' || Number(v) === -999 ? null : Number(v));

async function lerFocos(caminhos, satelite) {
  const focos = [];
  let malformadas = 0;
  for (const caminho of caminhos) {
    const leitor = readline.createInterface({ input: fs.createReadStream(caminho, 'utf8'), crlfDelay: Infinity });
    let indice = null;
    for await (const linha of leitor) {
      if (!linha.trim()) continue;
      const campos = linha.split(',').map(c => c.trim());
      if (!indice) {
        indice = Object.fromEntries(campos.map((c, i) => [c, i]));
        continue;
      }
      if (campos.length !== Object.keys(indice).length) {
        malformadas++;
        continue;
      }
      if (campos[indice.satelite] !== satelite) continue;
      focos.push({
        id: campos[indice.id],
        lat: Number(campos[indice.lat]),
        lon: Number(campos[indice.lon]),
        dataHora: campos[indice.data_hora_gmt],
        dia: campos[indice.data_hora_gmt].slice(0, 10),
        satelite: campos[indice.satelite],
        municipio: campos[indice.municipio],
        estado: campos[indice.estado],
        bioma: campos[indice.bioma],
        frp: semValor(campos[indice.frp]),
        diasSemChuva: semValor(campos[indice.numero_dias_sem_chuva]),
        precipitacao: semValor(campos[indice.precipitacao]),
        riscoFogo: semValor(campos[indice.risco_fogo])
      });
    }
  }
  return { focos, malformadas };
}

// ------------------------------------------------------------
// Índice de focos por dia, com visão limitada no tempo
// ------------------------------------------------------------
function criarIndice(focos) {
  const porDia = new Map();
  for (const f of focos) {
    if (!porDia.has(f.dia)) porDia.set(f.dia, []);
    porDia.get(f.dia).push(f);
  }

  const contarNoDia = (dia, lat, lon, raioKm, excluirId) => {
    const margem = raioKm / 111 + 0.01; // descarta pela latitude antes do Haversine
    let n = 0;
    for (const f of porDia.get(dia) || []) {
      if (f.id === excluirId || Math.abs(f.lat - lat) > margem) continue;
      if (calcularDistancia(lat, lon, f.lat, f.lon) <= raioKm) n++;
    }
    return n;
  };

  return {
    // Acesso irrestrito: só para o gabarito
    contarNoDia,
    // Visão que enxerga apenas até `limite` (inclusive)
    ate(limite) {
      return {
        limite,
        contarNoDia(dia, lat, lon, raioKm, excluirId) {
          if (dia > limite) throw new Error(`vazamento de dados: consulta ao dia ${dia} com visão limitada a ${limite}`);
          return contarNoDia(dia, lat, lon, raioKm, excluirId);
        }
      };
    }
  };
}

// ------------------------------------------------------------
// Sorteio estratificado com semente fixa
// ------------------------------------------------------------

// Gerador pseudoaleatório mulberry32: mesma semente → mesma sequência
function geradorAleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sorteia `n` itens sem reposição (Fisher–Yates parcial). A lista é antes ordenada
// pelo id, para que o resultado não dependa da ordem de leitura dos arquivos.
function sortear(itens, n, aleatorio) {
  const lista = [...itens].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const k = Math.min(n, lista.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(aleatorio() * (lista.length - i));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista.slice(0, k);
}

const distanciaCidade = (foco) => encontrarCidadeMaisProxima(foco.lat, foco.lon);
const ehUrbano = (foco) => distanciaCidade(foco).distanciaKm <= config.RAIO_PESSOAS_KM;

// Focos que podem ser sorteados: no período, fora dos últimos 7 dias, com bioma.
// Estratos disjuntos: o urbano primeiro; os de bioma ficam com o restante.
function montarEstratos(focos, periodo = config.PERIODO, diasGabarito = config.DIAS_GABARITO) {
  const ultimoDiaSorteavel = somarDias(periodo.fim, -diasGabarito);
  const elegiveis = focos.filter(f => f.dia >= periodo.inicio && f.dia <= ultimoDiaSorteavel && f.bioma);
  const estratos = { [config.ESTRATO_URBANO]: [] };
  for (const bioma of config.BIOMAS) estratos[bioma] = [];
  for (const f of elegiveis) {
    if (ehUrbano(f)) estratos[config.ESTRATO_URBANO].push(f);
    else if (estratos[f.bioma]) estratos[f.bioma].push(f);
  }
  return { estratos, ultimoDiaSorteavel, totalElegiveis: elegiveis.length };
}

function sortearAmostra(estratos, semente = config.SEMENTE, tamanho = config.TAMANHO_POR_ESTRATO) {
  const aleatorio = geradorAleatorio(semente);
  const amostra = [];
  // Ordem fixa dos estratos: o sorteio de um não depende da ordem de inserção no objeto
  for (const nome of Object.keys(estratos).sort()) {
    for (const foco of sortear(estratos[nome], tamanho, aleatorio)) amostra.push({ ...foco, estrato: nome });
  }
  return amostra;
}

// ------------------------------------------------------------
// Proxies do dia 0
// ------------------------------------------------------------
function classificarArea(n) {
  return config.FAIXAS_AREA.find(f => n <= f.ate).area;
}

function classificarVento(kmh) {
  return config.FAIXAS_VENTO.find(f => kmh < f.abaixoDe).vento;
}

// Open-Meteo informa a direção DE ONDE o vento vem (convenção meteorológica).
// O IRS compara a direção PARA ONDE ele sopra com o vetor foco → cidade: soma-se 180°.
function direcaoParaOndeSopra(direcaoDeOndeVem) {
  return (direcaoDeOndeVem + 180) % 360;
}

// Monta as entradas do IRS só com dados do dia 0 (e do dia −1, para dA/dt).
//   foco       → linha do CSV do INPE
//   visao      → indice.ate(foco.dia): não enxerga dias posteriores
//   clima      → { velocidadeKmh, direcaoGraus } do Open-Meteo para o dia 0
//   geodados   → saída de obterGeodadosCompletos (camadas estáticas: UC, TI, fauna)
function montarEntradasDia0(foco, visao, clima, geodados) {
  if (visao.limite !== foco.dia) throw new Error(`a visão deve terminar no dia 0 (${foco.dia}), não em ${visao.limite}`);

  // Área afetada: focos a até 1 km no mesmo dia, incluindo o próprio
  const nDia0 = visao.contarNoDia(foco.dia, foco.lat, foco.lon, config.RAIO_AREA_KM);
  const nDiaAnterior = visao.contarNoDia(somarDias(foco.dia, -1), foco.lat, foco.lon, config.RAIO_AREA_KM);
  const dA_dt = Math.max(0, nDia0 - nDiaAnterior);

  const { cidade, distanciaKm } = distanciaCidade(foco);
  const direcaoVento = direcaoParaOndeSopra(clima.direcaoGraus);

  const alerta = {
    latitude: foco.lat,
    longitude: foco.lon,
    areaAfetada: classificarArea(nDia0),
    vento: classificarVento(clima.velocidadeKmh),
    direcaoVento,
    pessoasRisco: distanciaKm <= config.RAIO_PESSOAS_KM,
    zonaUrbana: false,
    dA_dt,
    bioma: normalizarChave(foco.bioma)
  };

  // Geodados entregues ao IRS: o bioma vem do próprio CSV do INPE, e os focos
  // "recentes" do geodadosService (relativos à data da consulta) são descartados
  const { focos: _focosDaConsulta, ...geoEstatico } = geodados || {};
  const geodadosIrs = { ...geoEstatico, bioma: alerta.bioma, fonteBioma: 'INPE CSV' };

  return {
    alerta,
    geodados: geodadosIrs,
    proxies: { nFocos1kmDia0: nDia0, nFocos1kmDiaAnterior: nDiaAnterior, cidadeProxima: cidade.nome, distanciaCidadeKm: distanciaKm }
  };
}

// ------------------------------------------------------------
// Gabarito: outros focos a até 10 km nos dias 1 a 7 após o dia 0
// ------------------------------------------------------------
function calcularGabarito(foco, indice, raioKm = config.RAIO_GABARITO_KM, dias = config.DIAS_GABARITO) {
  let n = 0;
  for (let d = 1; d <= dias; d++) {
    n += indice.contarNoDia(somarDias(foco.dia, d), foco.lat, foco.lon, raioKm, foco.id);
  }
  return n;
}

// Quantil com interpolação linear entre os pontos (método 7 de Hyndman & Fan,
// o padrão do R e do Excel QUARTIL.INC)
function quantil(valores, p) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const h = (ordenados.length - 1) * p;
  const inferior = Math.floor(h);
  const superior = Math.ceil(h);
  return ordenados[inferior] + (h - inferior) * (ordenados[superior] - ordenados[inferior]);
}

function limitesQuartis(contagens) {
  return { q1: quantil(contagens, 0.25), q2: quantil(contagens, 0.5), q3: quantil(contagens, 0.75) };
}

// ≤ Q1 → BAIXO · (Q1, Q2] → MODERADO · (Q2, Q3] → ALTO · > Q3 → CRÍTICO
function nivelGabarito(n, { q1, q2, q3 }) {
  if (n <= q1) return 'BAIXO';
  if (n <= q2) return 'MODERADO';
  if (n <= q3) return 'ALTO';
  return 'CRITICO';
}

module.exports = {
  somarDias,
  lerFocos,
  criarIndice,
  geradorAleatorio,
  sortear,
  montarEstratos,
  sortearAmostra,
  classificarArea,
  classificarVento,
  direcaoParaOndeSopra,
  montarEntradasDia0,
  calcularGabarito,
  quantil,
  limitesQuartis,
  nivelGabarito
};
