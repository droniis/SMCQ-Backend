// ============================================================
// VALIDAÇÃO DO IRS — ANÁLISES COMPLEMENTARES (revisão do artigo)
// Lê, sem modificar, os arquivos da validação já publicada:
//   data/validacao/amostra.json, amostra.csv, resultados.json (porFoco)
//   e, só no item C2, os CSV brutos do INPE em data/validacao/bruto/.
// Calcula:
//   A. bootstrap pareado v2 − v1 e v2 − linha de base
//   B. bootstrap por agrupamento (município; dia de detecção)
//   C. sobreposição entrada × referência; C2: referência sem o raio de 1 km
//   D. outros cortes da referência (fixos; binário)
//   E. matriz de confusão e precisão/recall/F1 por classe
//   F. AUC, limiares calibrados por quantis e validação cruzada
// Resultado em data/analises/analises-complementares.json e
// docs/analises-complementares.md.
//
// Os pesos do IRS NÃO são alterados nem recalculados: os níveis e escores
// vêm de resultados.json, exatamente como publicados.
//
// Rodar: node scripts/analises/analises-complementares.js
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../validacao/config');
const A = require('../validacao/amostra');
const M = require('../../services/metricasService');
const { calcularDistancia, sigmoide, classificar } = require('../../services/riscoService');
const E = require('./estatisticas');

const RAIZ = path.join(__dirname, '..', '..');
const PASTA_VALIDACAO = path.join(RAIZ, 'data', 'validacao');
const PASTA_SAIDA = path.join(RAIZ, 'data', 'analises');
const DOC = path.join(RAIZ, 'docs', 'analises-complementares.md');
const PARTES_VALIDACAO_CRUZADA = 5;

const MODELOS = {
  'IRS v2': { nivel: 'nivelIrsV2', escore: 'irsV2' },
  'IRS v1': { nivel: 'nivelIrsV1', escore: 'irsV1' },
  'Linha de base': { nivel: 'nivelLinhaBase', escore: 'linhaBase' }
};
const NOMES = Object.keys(MODELOS);

// ------------------------------------------------------------
// Leitura (somente leitura)
// ------------------------------------------------------------
const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));

function lerCsv(arquivo) {
  const linhas = fs.readFileSync(arquivo, 'utf8').trim().split(/\r?\n/);
  const separar = (linha) => {
    const campos = [];
    let campo = '';
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (aspas) {
        if (c === '"' && linha[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false;
        else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === ',') { campos.push(campo); campo = ''; } else campo += c;
    }
    campos.push(campo);
    return campos;
  };
  const cabecalho = separar(linhas[0]);
  return linhas.slice(1).map(l => Object.fromEntries(separar(l).map((v, i) => [cabecalho[i], v])));
}

// O número de reamostragens não está em config.js: é a constante
// REAMOSTRAGENS_BOOTSTRAP de validar-irs.js (lida do texto, sem executar o
// script, que regravaria resultados.json) e deve coincidir com resultados.json.
function reamostragensOriginais(resultados) {
  const fonte = fs.readFileSync(path.join(RAIZ, 'scripts', 'validacao', 'validar-irs.js'), 'utf8');
  const doScript = Number(/const REAMOSTRAGENS_BOOTSTRAP = (\d+);/.exec(fonte)?.[1]);
  const ic = resultados.intervalosConfianca.principal;
  if (doScript !== ic.reamostragens) throw new Error(`reamostragens divergentes: script ${doScript}, resultados.json ${ic.reamostragens}`);
  if (ic.semente !== config.SEMENTE) throw new Error(`semente divergente: config ${config.SEMENTE}, resultados.json ${ic.semente}`);
  return doScript;
}

// ------------------------------------------------------------
// Métricas de um conjunto de índices
// ------------------------------------------------------------
const kappaW = (esp, obt) => M.kappaPonderadoQuadratico(esp, obt);
const em = (v, idx) => idx.map(i => v[i]);

// Acurácia e κ dos três modelos e as diferenças pareadas v2 − v1 e v2 − base
function metricasModelos(esperados, niveis, idx, niveisRef = M.NIVEIS) {
  const esp = em(esperados, idx);
  const r = {};
  for (const nome of NOMES) {
    const obt = em(niveis[nome], idx);
    r[`${nome}|acuracia`] = M.acuracia(esp, obt, niveisRef);
    r[`${nome}|kappa`] = niveisRef.length === 2 ? E.kappaCohen(esp, obt, niveisRef) : kappaW(esp, obt);
  }
  for (const outro of ['IRS v1', 'Linha de base']) {
    for (const m of ['acuracia', 'kappa']) {
      const [a, b] = [r[`IRS v2|${m}`], r[`${outro}|${m}`]];
      r[`IRS v2 − ${outro}|${m}`] = a === null || b === null ? null : a - b;
    }
  }
  return r;
}

const todos = (n) => Array.from({ length: n }, (_, i) => i);

function comIc(esperados, niveis, contexto, opcoes = {}) {
  const { niveisRef = M.NIVEIS, grupos = null } = opcoes;
  const pontual = metricasModelos(esperados, niveis, todos(esperados.length), niveisRef);
  const bs = E.bootstrap({
    n: esperados.length,
    estatisticas: (idx) => metricasModelos(esperados, niveis, idx, niveisRef),
    reamostragens: contexto.reamostragens,
    semente: contexto.semente,
    grupos
  });
  const tabela = Object.fromEntries(Object.keys(pontual).map(k => [k, { valor: pontual[k], ...bs.intervalos[k] }]));
  return { grupos: bs.grupos, metricas: tabela };
}

const contarClasses = (rotulos, classes) => Object.fromEntries(classes.map(c => [c, rotulos.filter(r => r === c).length]));
const largura = (x) => x.ic95[1] - x.ic95[0];

// ------------------------------------------------------------
// A e B. Bootstrap simples (pareado) e por agrupamento
// ------------------------------------------------------------
function itemA(dados, contexto, resultados) {
  const r = comIc(dados.gabarito, dados.niveis, contexto);
  // Conferência com a validação publicada: os IC devem ser idênticos
  const original = resultados.intervalosConfianca.principal;
  for (const chave of Object.keys(original).filter(k => k.includes('|'))) {
    const [a, b] = [original[chave].ic95, r.metricas[chave].ic95];
    if (a[0] !== b[0] || a[1] !== b[1]) {
      throw new Error(`o bootstrap não reproduz a validação publicada em "${chave}": ${a} × ${b}`);
    }
  }
  return { ...r, reproduzOriginal: true };
}

function itemB(dados, contexto, simples) {
  const agrupamentos = {
    municipio: dados.csv.map(l => `${l.municipio}/${l.estado}`),
    dia: dados.csv.map(l => l.dia0)
  };
  return Object.fromEntries(Object.entries(agrupamentos).map(([nome, grupos]) => {
    const r = comIc(dados.gabarito, dados.niveis, contexto, { grupos });
    const tamanhos = Object.values(contarClasses(grupos, [...new Set(grupos)]));
    const razaoLarguras = Object.fromEntries(Object.keys(r.metricas).map(k => [k, largura(r.metricas[k]) / largura(simples.metricas[k])]));
    return [nome, {
      ...r,
      focosPorGrupo: { minimo: Math.min(...tamanhos), mediana: E.resumo(tamanhos).mediana, maximo: Math.max(...tamanhos), gruposComUmFoco: tamanhos.filter(t => t === 1).length },
      razaoLarguraIcSobreSimples: razaoLarguras
    }];
  }));
}

// ------------------------------------------------------------
// C. Sobreposição entre entrada e referência
// ------------------------------------------------------------
function itemC(dados) {
  const n = dados.porFoco.length;
  const entradas = {
    n_focos_1km_dia0: 'focos a ≤ 1 km no dia 0 (inclui o próprio) → área afetada',
    n_outros_focos_1km_dia0: 'outros focos a ≤ 1 km no dia 0 → dA/dt',
    n_focos_1km_dia_menos1: 'focos a ≤ 1 km no dia −1 → dA/dt',
    dA_dt: 'dA/dt = max(0, outros dia 0 − dia −1)'
  };
  const ref = dados.porFoco.map(f => f.gabaritoN);
  const spearman = Object.fromEntries(Object.entries(entradas).map(([campo, descricao]) => {
    const valores = dados.csv.map(l => Number(l[campo]));
    return [campo, { descricao, rho: E.spearman(valores, ref), distribuicao: contarClasses(valores.map(String), [...new Set(valores.map(String))].sort((a, b) => a - b)) }];
  }));
  const spearmanEscores = Object.fromEntries(NOMES.map(nome => [nome, E.spearman(dados.escores[nome], ref)]));

  // Focos da amostra próximos entre si (≤ 10 km e |Δ dias| ≤ 7)
  const dia = dados.csv.map(l => Date.parse(`${l.dia0}T00:00:00Z`) / 86400000);
  const lat = dados.csv.map(l => Number(l.latitude));
  const lon = dados.csv.map(l => Number(l.longitude));
  const pares = [];
  const naReferenciaDeOutro = new Set(); // j cai na janela da referência de i (dias 1 a 7)
  const comOutroNaReferencia = new Set(); // i tem algum j da amostra na sua janela
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dd = dia[j] - dia[i];
      if (Math.abs(dd) > config.DIAS_GABARITO) continue;
      const km = calcularDistancia(lat[i], lon[i], lat[j], lon[j]);
      if (km > config.RAIO_GABARITO_KM) continue;
      pares.push({ i: dados.porFoco[i].id, j: dados.porFoco[j].id, km: Number(km.toFixed(2)), diferencaDias: dd });
      if (dd >= 1) { comOutroNaReferencia.add(i); naReferenciaDeOutro.add(j); }
      if (dd <= -1) { comOutroNaReferencia.add(j); naReferenciaDeOutro.add(i); }
    }
  }
  const envolvidos = new Set(pares.flatMap(p => [p.i, p.j]));
  return {
    disjuncaoTemporal: {
      entrada: 'dias 0 e −1 (scripts/validacao/amostra.js: montarEntradasDia0, l. 186–196, chamada com a visão indice.ate(dia0), que lança erro ao consultar dia posterior, l. 97–105; preparar-amostra.js l. 169)',
      referencia: 'dias 1 a 7 (scripts/validacao/amostra.js: calcularGabarito, l. 228–233, laço d = 1..DIAS_GABARITO)',
      diasEntrada: [-1, 0],
      diasReferencia: Array.from({ length: config.DIAS_GABARITO }, (_, k) => k + 1),
      focosEmComum: 0,
      conclusao: 'Os conjuntos de dias são disjuntos; nenhum foco usado na entrada pode entrar na contagem da referência.'
    },
    spearmanEntradaReferencia: spearman,
    spearmanEscoreReferencia: spearmanEscores,
    proximidadeNaAmostra: {
      criterio: `distância ≤ ${config.RAIO_GABARITO_KM} km e |Δ dias| ≤ ${config.DIAS_GABARITO}`,
      pares: pares.length,
      paresMesmoDia: pares.filter(p => p.diferencaDias === 0).length,
      focosEnvolvidos: envolvidos.size,
      focosComOutroDaAmostraNaReferencia: comOutroNaReferencia.size,
      focosContadosNaReferenciaDeOutro: naReferenciaDeOutro.size,
      lista: pares
    }
  };
}

// C2. Referência alternativa: só o anel de 1 a 10 km (exclui o entorno imediato)
async function itemC2(dados, contexto) {
  const fontes = lerJson(path.join(PASTA_VALIDACAO, 'bruto', 'fontes.json'));
  const arquivos = [];
  for (const d of fontes.downloads) {
    const arquivo = path.join(RAIZ, d.arquivo);
    if (!fs.existsSync(arquivo)) throw new Error(`arquivo bruto ausente: ${d.arquivo}`);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
    if (sha !== d.sha256) throw new Error(`SHA-256 diferente do registrado em fontes.json: ${d.arquivo}`);
    arquivos.push(arquivo);
  }
  const { focos } = await A.lerFocos(arquivos.sort(), config.SATELITE);
  const indice = A.criarIndice(focos);

  const contagens = dados.amostra.map((r, i) => {
    const foco = { id: r.id, dia: r.dia0, lat: r.alerta.latitude, lon: r.alerta.longitude };
    const ate10 = A.calcularGabarito(foco, indice, config.RAIO_GABARITO_KM);
    if (ate10 !== dados.porFoco[i].gabaritoN) {
      throw new Error(`a contagem de 10 km recalculada (${ate10}) não reproduz o gabarito publicado (${dados.porFoco[i].gabaritoN}) no foco ${r.id}`);
    }
    const ate1 = A.calcularGabarito(foco, indice, config.RAIO_AREA_KM);
    return { ate10, ate1, anel: ate10 - ate1 };
  });
  const anel = contagens.map(c => c.anel);
  const tercis = A.limitesTercisPositivos(anel);
  const original = lerJson(path.join(PASTA_VALIDACAO, 'amostra-meta.json')).gabarito.tercisPositivos;
  const versoes = {
    tercisRecalculados: { limites: tercis, niveis: anel.map(x => A.nivelGabaritoTercis(x, tercis)) },
    limitesOriginais: { limites: original, niveis: anel.map(x => A.nivelGabaritoTercis(x, original)) }
  };
  const saida = {
    definicao: `focos a mais de ${config.RAIO_AREA_KM} km e até ${config.RAIO_GABARITO_KM} km nos dias 1 a ${config.DIAS_GABARITO}, satélite ${config.SATELITE}`,
    reproduzContagemPublicada: true,
    focosComAlgumFocoAte1km: contagens.filter(c => c.ate1 > 0).length,
    focosAte1kmNaReferencia: contagens.reduce((a, c) => a + c.ate1, 0),
    focosNaReferenciaPublicada: contagens.reduce((a, c) => a + c.ate10, 0),
    zerosNoAnel: anel.filter(x => x === 0).length
  };
  for (const [nome, v] of Object.entries(versoes)) {
    saida[nome] = {
      limites: v.limites,
      porNivel: contarClasses(v.niveis, M.NIVEIS),
      focosQueMudaramDeNivel: v.niveis.filter((x, i) => x !== dados.gabarito[i]).length,
      ...comIc(v.niveis, dados.niveis, contexto)
    };
  }
  return saida;
}

// ------------------------------------------------------------
// D. Outros cortes da referência
// ------------------------------------------------------------
function cortesFixos(n, limites) {
  // limites = [a, b, c]: 0..a BAIXO, a+1..b MODERADO, b+1..c ALTO, > c CRÍTICO
  return E.classificarPorLimiares(n, limites, M.NIVEIS);
}

function itemD(dados, contexto) {
  const n = dados.porFoco.map(f => f.gabaritoN);
  const cortes = {
    principal: { descricao: '0 | tercis das contagens > 0 (≤ 2 | 3–5 | ≥ 6)', niveis: dados.gabarito },
    secundaria: { descricao: 'quartis (Q1 = Q2 = 0, Q3 = 2)', niveis: dados.porFoco.map(f => f.gabaritoQuartis) },
    D1: { descricao: 'fixos 0 | 1–2 | 3–5 | 6+', niveis: n.map(x => cortesFixos(x, [0, 2, 5])) },
    D1b: { descricao: 'fixos 0 | 1–4 | 5–9 | 10+', niveis: n.map(x => cortesFixos(x, [0, 4, 9])) }
  };
  const quatroNiveis = Object.fromEntries(Object.entries(cortes).map(([k, c]) => [k, {
    descricao: c.descricao,
    porNivel: contarClasses(c.niveis, M.NIVEIS),
    identicoAoPrincipal: c.niveis.every((x, i) => x === dados.gabarito[i]),
    ...comIc(c.niveis, dados.niveis, contexto)
  }]));

  // D2: binário — houve propagação (≥ 1 foco) × não houve; modelo: nível ≠ BAIXO
  const BIN = ['NAO', 'SIM'];
  const ref = n.map(x => (x >= 1 ? 'SIM' : 'NAO'));
  const prev = Object.fromEntries(NOMES.map(nome => [nome, dados.niveis[nome].map(v => (v === 'BAIXO' ? 'NAO' : 'SIM'))]));
  const binario = {
    descricao: 'referência: ≥ 1 foco a ≤ 10 km nos dias 1–7 (SIM) × 0 (NÃO); modelo: SIM se nível ≠ BAIXO',
    porClasse: contarClasses(ref, BIN),
    ...comIc(ref, prev, contexto, { niveisRef: BIN }),
    sensibilidadeEspecificidade: Object.fromEntries(NOMES.map(nome => {
      const m = E.metricasPorClasse(ref, prev[nome], BIN);
      return [nome, { sensibilidade: m.porClasse.SIM.recall, especificidade: m.porClasse.NAO.recall, previstosSim: m.porClasse.SIM.previstos }];
    })),
    referenciaSempreNao: { acuracia: ref.filter(r => r === 'NAO').length / ref.length }
  };
  return { quatroNiveis, binario, binarioReferencia: ref };
}

// ------------------------------------------------------------
// E. Métricas por classe
// ------------------------------------------------------------
function itemE(dados) {
  return Object.fromEntries(NOMES.map(nome => [nome, E.metricasPorClasse(dados.gabarito, dados.niveis[nome], M.NIVEIS)]));
}

// ------------------------------------------------------------
// F. AUC e limiares calibrados
// ------------------------------------------------------------
function itemF(dados, contexto, referenciaBinaria) {
  const n = dados.porFoco.length;
  const alvos = {
    propagacao: { descricao: 'D2: ≥ 1 foco (SIM) × 0', positivos: referenciaBinaria.map(r => r === 'SIM') },
    criticoContraResto: { descricao: 'CRÍTICO × demais níveis (regra principal)', positivos: dados.gabarito.map(g => g === 'CRITICO') }
  };
  const aucs = Object.fromEntries(Object.entries(alvos).map(([chave, alvo]) => {
    const estat = (idx) => Object.fromEntries(NOMES.map(nome => [nome, E.auc(em(dados.escores[nome], idx), em(alvo.positivos, idx))]));
    const bs = E.bootstrap({ n, estatisticas: estat, reamostragens: contexto.reamostragens, semente: contexto.semente });
    const pontual = estat(todos(n));
    return [chave, {
      descricao: alvo.descricao,
      positivos: alvo.positivos.filter(Boolean).length,
      negativos: alvo.positivos.filter(p => !p).length,
      porModelo: Object.fromEntries(NOMES.map(nome => [nome, {
        auc: pontual[nome],
        ...bs.intervalos[nome],
        paresPositivoNegativo: alvo.positivos.filter(Boolean).length * alvo.positivos.filter(p => !p).length,
        paresEmpatados: E.paresEmpatados(dados.escores[nome], alvo.positivos)
      }]))
    }];
  }));

  const empates = Object.fromEntries(NOMES.map(nome => {
    const v = dados.escores[nome];
    const freq = contarClasses(v.map(String), [...new Set(v.map(String))]);
    return [nome, {
      valoresDistintos: Object.keys(freq).length,
      focosComEscoreRepetido: Object.values(freq).filter(f => f > 1).reduce((a, b) => a + b, 0),
      maiorRepeticao: Math.max(...Object.values(freq))
    }];
  }));

  // F2: limiares por quantis, proporções iguais às da referência
  const proporcoes = M.NIVEIS.map(nv => dados.gabarito.filter(g => g === nv).length);
  const calibrar = (indicesTreino, indicesAplicar, nome) => {
    const limiares = E.limiaresPorQuantis(em(dados.escores[nome], indicesTreino), proporcoes);
    return { limiares, niveis: indicesAplicar.map(i => E.classificarPorLimiares(dados.escores[nome][i], limiares, M.NIVEIS)) };
  };
  const naAmostra = Object.fromEntries(NOMES.map(nome => {
    const { limiares, niveis } = calibrar(todos(n), todos(n), nome);
    return [nome, {
      limiares,
      previstosPorNivel: contarClasses(niveis, M.NIVEIS),
      acuracia: M.acuracia(dados.gabarito, niveis),
      kappa: kappaW(dados.gabarito, niveis),
      kappaComLimiaresAtuais: kappaW(dados.gabarito, dados.niveis[nome])
    }];
  }));

  // F3: validação cruzada estratificada (limiares nas 4 partes, aplicados na 5ª)
  const partes = E.particaoEstratificada(dados.gabarito, PARTES_VALIDACAO_CRUZADA, contexto.semente);
  const foraDaAmostra = Object.fromEntries(NOMES.map(nome => {
    const previstos = new Array(n);
    const porParte = [];
    for (let k = 0; k < PARTES_VALIDACAO_CRUZADA; k++) {
      const teste = todos(n).filter(i => partes[i] === k);
      const treino = todos(n).filter(i => partes[i] !== k);
      const { limiares, niveis } = calibrar(treino, teste, nome);
      teste.forEach((i, j) => { previstos[i] = niveis[j]; });
      porParte.push({ parte: k + 1, n: teste.length, limiares, kappa: kappaW(em(dados.gabarito, teste), niveis) });
    }
    const kappas = porParte.map(p => p.kappa).filter(k => k !== null);
    const media = kappas.reduce((a, b) => a + b, 0) / kappas.length;
    const dp = Math.sqrt(kappas.reduce((a, k) => a + (k - media) ** 2, 0) / (kappas.length - 1));
    return [nome, { porParte, kappaMedio: media, desvioPadrao: dp, kappaAgregado: kappaW(dados.gabarito, previstos), acuraciaAgregada: M.acuracia(dados.gabarito, previstos) }];
  }));

  // F4: faixas atuais do IRS (sigmoide k = 10, μ = 0,5) e distribuição dos escores
  const corte = (p) => 0.5 + Math.log(p / (1 - p)) / 10;
  const faixasAtuais = [0.25, 0.5, 0.75].map(p => ({ sigmoide: p, irs: corte(p), confere: Math.abs(sigmoide(corte(p)) - p) < 1e-12 }));
  // Logo abaixo e logo acima de cada corte (no corte exato, o arredondamento decide)
  const NIVEIS_ACIMA = ['MODERADO', 'ALTO', 'CRITICO'];
  const NIVEIS_ABAIXO = ['BAIXO', 'MODERADO', 'ALTO'];
  if (faixasAtuais.some((x, i) => classificar(sigmoide(x.irs - 1e-9)) !== NIVEIS_ABAIXO[i] || classificar(sigmoide(x.irs + 1e-9)) !== NIVEIS_ACIMA[i])) {
    throw new Error('as faixas calculadas não conferem com classificar() do riscoService');
  }
  const distribuicao = Object.fromEntries(NOMES.map(nome => [nome, { ...E.resumo(dados.escores[nome]), porNivelAtual: contarClasses(dados.niveis[nome], M.NIVEIS) }]));

  return {
    auc: aucs,
    empates,
    calibracaoNaAmostra: { proporcoesReferencia: Object.fromEntries(M.NIVEIS.map((nv, i) => [nv, proporcoes[i]])), porModelo: naAmostra },
    validacaoCruzada: { partes: PARTES_VALIDACAO_CRUZADA, estratificadaPor: 'nível da referência (regra principal)', semente: contexto.semente, porModelo: foraDaAmostra },
    faixasAtuais,
    distribuicaoEscores: distribuicao
  };
}

// ------------------------------------------------------------
// Markdown
// ------------------------------------------------------------
const f = (x, casas = 3) => (x === null || x === undefined ? '—' : x.toFixed(casas).replace('.', ',').replace(/^-/, '−'));
const p = (x) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(1).replace('.', ',')}%`);
const ic = (m, casas = 3) => (m?.ic95 ? `[${f(m.ic95[0], casas)}; ${f(m.ic95[1], casas)}]` : '—');
const comIcTexto = (m, casas = 3) => `${f(m.valor, casas)} ${ic(m, casas)}`;
const acIc = (m) => `${p(m.valor)} [${p(m.ic95[0])}; ${p(m.ic95[1])}]`;
const pp = (m) => `${f(100 * m.valor, 1)} p.p. [${f(100 * m.ic95[0], 1)}; ${f(100 * m.ic95[1], 1)}]`;
const SIGLA = { BAIXO: 'Baixo', MODERADO: 'Moderado', ALTO: 'Alto', CRITICO: 'Crítico' };
// Uma barra vertical dentro da célula quebraria a tabela do Markdown
const linhaTabela = (celulas) => `| ${celulas.map(c => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
const cabecalho = (celulas) => [linhaTabela(celulas), linhaTabela(celulas.map(() => '---'))].join('\n');

function tabelaKappas(metricas) {
  return [
    cabecalho(['Modelo', 'κ ponderado quadrático [IC 95%]', 'Acurácia [IC 95%]']),
    ...NOMES.map(nome => linhaTabela([nome, comIcTexto(metricas[`${nome}|kappa`]), acIc(metricas[`${nome}|acuracia`])]))
  ].join('\n');
}

function gerarMarkdown(r) {
  const s = [];
  const A_ = r.A.metricas;
  s.push('# Análises complementares da validação do IRS');
  s.push('');
  s.push(`- **Data de execução:** ${r.geradoEm.slice(0, 10)}`);
  s.push(`- **Semente:** ${r.parametros.semente} (\`config.SEMENTE\`, a mesma do sorteio e do bootstrap da validação)`);
  s.push(`- **Reamostragens do bootstrap:** ${r.parametros.reamostragens} (as mesmas de \`scripts/validacao/validar-irs.js\`); IC 95% pelo método percentil`);
  s.push('- **Pesos do IRS:** não foram alterados nem recalculados. Níveis e escores vêm de `data/validacao/resultados.json` (`porFoco`), como publicados.');
  s.push(`- **Dados:** \`data/validacao/amostra.json\`, \`amostra.csv\` e \`resultados.json\` (somente leitura); no item C2, também os CSV brutos do INPE em \`data/validacao/bruto/\` (SHA-256 conferidos com \`fontes.json\`). N = ${r.parametros.n} focos.`);
  s.push('- **Gerado por:** `node scripts/analises/analises-complementares.js` → `data/analises/analises-complementares.json`');
  s.push('');
  s.push('Salvo indicação contrária, a referência é a regra principal (0 → Baixo; tercis das contagens > 0), com 182/52/24/36 focos em Baixo/Moderado/Alto/Crítico.');
  s.push('');

  // A
  s.push('## A. Bootstrap pareado');
  s.push('');
  s.push('Em cada uma das réplicas, os mesmos focos sorteados são usados para os três modelos; as diferenças são calculadas réplica a réplica.');
  s.push('');
  s.push(tabelaKappas(A_));
  s.push('');
  s.push(cabecalho(['Diferença', 'Δκ [IC 95%]', 'Δ acurácia [IC 95%]']));
  for (const outro of ['IRS v1', 'Linha de base']) {
    s.push(linhaTabela([`IRS v2 − ${outro}`, comIcTexto(A_[`IRS v2 − ${outro}|kappa`]), pp(A_[`IRS v2 − ${outro}|acuracia`])]));
  }
  s.push('');
  s.push('Os intervalos de cada modelo e da diferença v2 − linha de base são idênticos aos de `resultados.json` (conferido pelo script).');
  s.push('');
  const dv1 = A_['IRS v2 − IRS v1|kappa'];
  const dbase = A_['IRS v2 − Linha de base|kappa'];
  s.push(`**Interpretação:** o IC da diferença de κ entre v2 e v1 ${dv1.ic95[0] > 0 ? 'fica inteiramente acima de zero' : 'inclui o zero'}, e o da diferença v2 − linha de base ${dbase.ic95[0] > 0 || dbase.ic95[1] < 0 ? 'não inclui o zero' : 'inclui o zero'}; em acurácia, a v1 supera a v2 porque classifica quase todos os focos como Baixo, a classe majoritária.`);
  s.push('');

  // B
  s.push('## B. Bootstrap por agrupamento');
  s.push('');
  s.push('Reamostram-se grupos inteiros com reposição (cada réplica sorteia tantos grupos quantos existem), o que preserva a dependência entre focos do mesmo município ou do mesmo dia.');
  s.push('');
  s.push(cabecalho(['Reamostragem', 'Grupos', 'κ v2', 'κ v1', 'κ base', 'Δκ v2 − v1', 'Δκ v2 − base']));
  const linhaB = (rotulo, x) => linhaTabela([rotulo, String(x.grupos), ...['IRS v2|kappa', 'IRS v1|kappa', 'Linha de base|kappa', 'IRS v2 − IRS v1|kappa', 'IRS v2 − Linha de base|kappa'].map(k => comIcTexto(x.metricas[k]))]);
  s.push(linhaB('Simples (focos)', r.A));
  s.push(linhaB('B1 · município', r.B.municipio));
  s.push(linhaB('B2 · dia de detecção', r.B.dia));
  s.push('');
  s.push('Razão entre a largura do IC por agrupamento e a do bootstrap simples:');
  s.push('');
  s.push(cabecalho(['Agrupamento', 'Focos por grupo (mín./mediana/máx.)', 'κ v2', 'κ v1', 'κ base', 'Δκ v2 − v1', 'Δκ v2 − base']));
  for (const [rotulo, chave] of [['B1 · município', 'municipio'], ['B2 · dia', 'dia']]) {
    const x = r.B[chave];
    s.push(linhaTabela([rotulo, `${x.focosPorGrupo.minimo}/${f(x.focosPorGrupo.mediana, 0)}/${x.focosPorGrupo.maximo}`,
      ...['IRS v2|kappa', 'IRS v1|kappa', 'Linha de base|kappa', 'IRS v2 − IRS v1|kappa', 'IRS v2 − Linha de base|kappa'].map(k => f(x.razaoLarguraIcSobreSimples[k], 2))]));
  }
  s.push('');
  const larg = (x) => x.metricas['IRS v2|kappa'];
  const incluiZero = (m) => m.ic95[0] <= 0 && m.ic95[1] >= 0;
  const zeros = (x) => ['IRS v2|kappa', 'IRS v2 − IRS v1|kappa'].filter(k => incluiZero(x.metricas[k])).map(k => (k.includes('−') ? 'Δκ v2 − v1' : 'κ v2'));
  const textoZeros = (x) => (zeros(x).length ? `inclui o zero em ${zeros(x).join(' e ')}` : 'não inclui o zero em κ v2 nem em Δκ v2 − v1');
  s.push(`**Interpretação:** os valores pontuais não mudam; a largura do IC do κ da v2 passa de ${f(largura(larg(r.A)))} (focos) para ${f(largura(larg(r.B.municipio)))} (município) e ${f(largura(larg(r.B.dia)))} (dia). Por município, o IC ${textoZeros(r.B.municipio)}; por dia, ${textoZeros(r.B.dia)}. A diferença v2 − linha de base inclui o zero nas três formas de reamostragem.`);
  s.push('');

  // C
  const C = r.C;
  s.push('## C. Sobreposição entre entrada e referência');
  s.push('');
  s.push('### C1. Disjunção temporal');
  s.push('');
  s.push(`- **Entrada:** ${C.disjuncaoTemporal.entrada}.`);
  s.push(`- **Referência:** ${C.disjuncaoTemporal.referencia}.`);
  s.push('');
  s.push('Os conjuntos de dias {−1, 0} e {1, …, 7} são disjuntos. Como cada foco do INPE tem uma única data, **nenhum foco usado na entrada pode entrar na contagem da referência**: a sobreposição foco a foco é 0 por construção, para todos os 294 focos.');
  s.push('');
  s.push('Correlação de Spearman entre as contagens da entrada e a contagem da referência:');
  s.push('');
  s.push(cabecalho(['Contagem da entrada', 'Distribuição na amostra', 'ρ de Spearman']));
  for (const [campo, x] of Object.entries(C.spearmanEntradaReferencia)) {
    s.push(linhaTabela([`\`${campo}\` (${x.descricao})`, Object.entries(x.distribuicao).map(([k, v]) => `${k}: ${v}`).join(' · '), f(x.rho)]));
  }
  s.push('');
  s.push('As duas primeiras linhas têm o mesmo ρ porque `n_outros_focos_1km_dia0` = `n_focos_1km_dia0` − 1 em todos os focos.');
  s.push('');
  s.push(`Para comparação, ρ entre o escore contínuo e a contagem da referência: IRS v2 ${f(C.spearmanEscoreReferencia['IRS v2'])}, IRS v1 ${f(C.spearmanEscoreReferencia['IRS v1'])}, linha de base ${f(C.spearmanEscoreReferencia['Linha de base'])}.`);
  s.push('');
  const pr = C.proximidadeNaAmostra;
  s.push(`Focos da amostra próximos entre si (${pr.criterio}): **${pr.pares} pares**, envolvendo ${pr.focosEnvolvidos} focos (${pr.paresMesmoDia} pares no mesmo dia). Em ${pr.focosComOutroDaAmostraNaReferencia} focos, outro foco da amostra cai na janela da referência (dias 1 a 7, ≤ 10 km); ${pr.focosContadosNaReferenciaDeOutro} focos da amostra são contados na referência de outro foco da amostra.`);
  s.push('');
  const rhos = Object.values(C.spearmanEntradaReferencia).map(x => Math.abs(x.rho));
  s.push(`**Interpretação:** não há reuso de focos entre entrada e referência, e as correlações entre as contagens de entrada e a da referência são baixas (|ρ| ≤ ${f(Math.max(...rhos))}). Por outro lado, ${pr.focosEnvolvidos} dos ${r.parametros.n} focos (${p(pr.focosEnvolvidos / r.parametros.n)}) estão a ≤ 10 km e ≤ 7 dias de outro foco da amostra e podem pertencer ao mesmo incêndio; essa dependência é a que o bootstrap por agrupamento (item B) procura levar em conta.`);
  s.push('');
  s.push('### C2. Sensibilidade: referência sem o entorno imediato (anel de 1 a 10 km)');
  s.push('');
  const c2 = r.C2;
  s.push(`Referência alternativa: ${c2.definicao}. A contagem de 10 km recalculada a partir dos CSV brutos reproduz a publicada nos 294 focos. ${c2.focosComAlgumFocoAte1km} focos tinham algum foco a ≤ 1 km nos dias 1 a 7 (${c2.focosAte1kmNaReferencia} de ${c2.focosNaReferenciaPublicada} focos da referência publicada); sem eles, ${c2.zerosNoAnel} focos ficam com contagem 0.`);
  s.push('');
  const [tr, lo] = [c2.tercisRecalculados, c2.limitesOriginais];
  const mesmosLimites = tr.limites.t1 === lo.limites.t1 && tr.limites.t2 === lo.limites.t2;
  const pub = r.D.quatroNiveis.principal;
  s.push(cabecalho(['Referência', 'Limites (T1; T2)', 'Baixo/Moderado/Alto/Crítico', 'Focos que mudaram de nível', 'κ v2', 'κ v1', 'κ base']));
  s.push(linhaTabela(['Publicada (≤ 10 km)', `${f(r.parametros.tercisPublicados.t1, 0)}; ${f(r.parametros.tercisPublicados.t2, 0)}`, M.NIVEIS.map(n => pub.porNivel[n]).join('/'), '—', ...NOMES.map(n => comIcTexto(A_[`${n}|kappa`]))]));
  const linhasC2 = mesmosLimites
    ? [['Anel 1–10 km (tercis recalculados = limites publicados)', tr]]
    : [['Anel 1–10 km, tercis recalculados', tr], ['Anel 1–10 km, limites publicados', lo]];
  for (const [rotulo, x] of linhasC2) {
    s.push(linhaTabela([rotulo, `${f(x.limites.t1, 2)}; ${f(x.limites.t2, 2)}`, M.NIVEIS.map(n => x.porNivel[n]).join('/'), String(x.focosQueMudaramDeNivel), ...NOMES.map(n => comIcTexto(x.metricas[`${n}|kappa`]))]));
  }
  s.push('');
  if (mesmosLimites) s.push('Os tercis das contagens positivas do anel são os mesmos da referência publicada (T1 = 2, T2 = 5), de modo que as duas variantes (tercis recalculados e limites publicados) coincidem.');
  s.push('');
  const dk = (n) => tr.metricas[`${n}|kappa`].valor - A_[`${n}|kappa`].valor;
  s.push(`**Interpretação:** sem os focos a até 1 km, ${tr.focosQueMudaramDeNivel} focos mudam de nível e os κ variam ${NOMES.map(n => `${f(dk(n))} (${n})`).join(', ')}; as variações são pequenas diante da largura dos IC.`);
  s.push('');

  // D
  s.push('## D. Outros cortes da referência');
  s.push('');
  s.push(cabecalho(['Corte', 'Baixo/Moderado/Alto/Crítico', 'κ v2', 'κ v1', 'κ base']));
  for (const [chave, x] of Object.entries(r.D.quatroNiveis)) {
    s.push(linhaTabela([`${chave}: ${x.descricao}${x.identicoAoPrincipal && chave !== 'principal' ? ' (idêntico ao principal)' : ''}`, M.NIVEIS.map(n => x.porNivel[n]).join('/'), ...NOMES.map(n => comIcTexto(x.metricas[`${n}|kappa`]))]));
  }
  s.push('');
  s.push('Os cortes fixos D1 (0 | 1–2 | 3–5 | 6+) coincidem exatamente com a regra principal, porque os tercis das contagens positivas são T1 = 2 e T2 = 5; por isso foi incluído o corte D1b, mais largo.');
  s.push('');
  const b = r.D.binario;
  s.push(`### D2. Referência binária (${b.porClasse.SIM} com propagação × ${b.porClasse.NAO} sem)`);
  s.push('');
  s.push(`Modelo: “houve propagação” quando o nível previsto não é Baixo. Referência trivial “nunca há propagação”: acurácia ${p(b.referenciaSempreNao.acuracia)}, κ = 0.`);
  s.push('');
  s.push(cabecalho(['Modelo', 'Previstos SIM', 'Acurácia [IC 95%]', 'κ de Cohen [IC 95%]', 'Sensibilidade', 'Especificidade']));
  for (const nome of NOMES) {
    const se = b.sensibilidadeEspecificidade[nome];
    s.push(linhaTabela([nome, String(se.previstosSim), acIc(b.metricas[`${nome}|acuracia`]), comIcTexto(b.metricas[`${nome}|kappa`]), p(se.sensibilidade), p(se.especificidade)]));
  }
  s.push(linhaTabela(['Δ IRS v2 − IRS v1', '', pp(b.metricas['IRS v2 − IRS v1|acuracia']), comIcTexto(b.metricas['IRS v2 − IRS v1|kappa']), '', '']));
  s.push(linhaTabela(['Δ IRS v2 − linha de base', '', pp(b.metricas['IRS v2 − Linha de base|acuracia']), comIcTexto(b.metricas['IRS v2 − Linha de base|kappa']), '', '']));
  s.push('');
  const kq = r.D.quatroNiveis;
  s.push(`**Interpretação:** nos quatro cortes de quatro níveis, o κ da v2 varia de ${f(Math.min(...Object.values(kq).map(x => x.metricas['IRS v2|kappa'].valor)))} a ${f(Math.max(...Object.values(kq).map(x => x.metricas['IRS v2|kappa'].valor)))}, fica próximo do κ da linha de base e acima do da v1; no corte mais largo (D1b) os IC da v2 e da linha de base incluem o zero. Na referência binária, a v2 tem κ = ${f(b.metricas['IRS v2|kappa'].valor)}, com sensibilidade ${p(b.sensibilidadeEspecificidade['IRS v2'].sensibilidade)} e especificidade ${p(b.sensibilidadeEspecificidade['IRS v2'].especificidade)}, e a diferença para a linha de base inclui o zero.`);
  s.push('');

  // E
  s.push('## E. Métricas por classe (regra principal)');
  s.push('');
  for (const nome of NOMES) {
    const x = r.E[nome];
    s.push(`### ${nome}`);
    s.push('');
    s.push(cabecalho(['Referência ↓ / previsto →', ...M.NIVEIS.map(n => SIGLA[n]), 'Total']));
    x.matriz.forEach((linha, i) => s.push(linhaTabela([`**${SIGLA[M.NIVEIS[i]]}**`, ...linha.map(String), String(linha.reduce((a, c) => a + c, 0))])));
    s.push(linhaTabela(['**Total previsto**', ...M.NIVEIS.map((_, j) => String(x.matriz.reduce((a, l) => a + l[j], 0))), String(r.parametros.n)]));
    s.push('');
    s.push(cabecalho(['Classe', 'Precisão', 'Recall', 'F1']));
    for (const n of M.NIVEIS) s.push(linhaTabela([SIGLA[n], p(x.porClasse[n].precisao), p(x.porClasse[n].recall), f(x.porClasse[n].f1)]));
    s.push(linhaTabela(['**F1 macro**', '', '', `**${f(x.f1Macro)}**`]));
    s.push('');
  }
  s.push('Precisão “—”: o modelo não previu nenhum foco naquela classe; nesse caso o F1 da classe é 0.');
  s.push('');
  s.push(`**Interpretação:** F1 macro de ${NOMES.map(n => `${f(r.E[n].f1Macro)} (${n})`).join(', ')}; o desempenho por classe é heterogêneo e deve ser lido junto com a matriz de confusão.`);
  s.push('');

  // F
  const F = r.F;
  s.push('## F. Escores contínuos e limiares calibrados');
  s.push('');
  s.push('### F1. AUC (curva ROC)');
  s.push('');
  s.push(`Empates contam meio ponto (estatística de Mann–Whitney). Os escores de \`porFoco\` têm até 4 casas decimais: ${NOMES.map(n => `${n} ${F.empates[n].valoresDistintos} valores distintos (${F.empates[n].focosComEscoreRepetido} focos com escore repetido)`).join('; ')}.`);
  s.push('');
  s.push(cabecalho(['Alvo', 'Positivos/negativos', ...NOMES.map(n => `AUC ${n} [IC 95%]`)]));
  for (const x of Object.values(F.auc)) {
    s.push(linhaTabela([x.descricao, `${x.positivos}/${x.negativos}`, ...NOMES.map(n => `${f(x.porModelo[n].auc)} ${ic(x.porModelo[n])}`)]));
  }
  s.push('');
  s.push(`Pares positivo–negativo empatados: ${Object.values(F.auc).map(x => `${x.descricao.split(':')[0]}: ${NOMES.map(n => `${n} ${x.porModelo[n].paresEmpatados}/${x.porModelo[n].paresPositivoNegativo}`).join(', ')}`).join('; ')}.`);
  s.push('');
  s.push('### F2. Limiares calibrados por quantis (na própria amostra)');
  s.push('');
  s.push(`Limiares escolhidos para que a proporção prevista de cada nível seja a da referência (${M.NIVEIS.map(n => F.calibracaoNaAmostra.proporcoesReferencia[n]).join('/')}). Escores iguais ao limite ficam no nível de baixo, o que, com empates, desvia um pouco as contagens previstas das da referência.`);
  s.push('');
  s.push(cabecalho(['Modelo', 'Limiares (B|M, M|A, A|C)', 'Previstos B/M/A/C', 'Acurácia', 'κ calibrado', 'κ com limiares atuais']));
  for (const nome of NOMES) {
    const x = F.calibracaoNaAmostra.porModelo[nome];
    s.push(linhaTabela([nome, x.limiares.map(l => f(l, 4)).join('; '), M.NIVEIS.map(n => x.previstosPorNivel[n]).join('/'), p(x.acuracia), f(x.kappa), f(x.kappaComLimiaresAtuais)]));
  }
  s.push('');
  s.push('### F3. Validação cruzada estratificada (5 partes)');
  s.push('');
  s.push(`Limiares estimados em 4 partes e aplicados na 5ª; partição estratificada pelo nível da referência, semente ${F.validacaoCruzada.semente}. “κ agregado” é calculado sobre as 294 previsões fora da amostra juntas.`);
  s.push('');
  s.push(cabecalho(['Modelo', 'κ por parte', 'κ médio (DP)', 'κ agregado', 'Acurácia agregada', 'κ calibrado na amostra (F2)']));
  for (const nome of NOMES) {
    const x = F.validacaoCruzada.porModelo[nome];
    s.push(linhaTabela([nome, x.porParte.map(q => f(q.kappa)).join('; '), `${f(x.kappaMedio)} (${f(x.desvioPadrao)})`, f(x.kappaAgregado), p(x.acuraciaAgregada), f(F.calibracaoNaAmostra.porModelo[nome].kappa)]));
  }
  s.push('');
  s.push('### F4. Faixas atuais e distribuição dos escores');
  s.push('');
  s.push(`Faixas atuais do IRS (sigmoide com k = 10 e μ = 0,5): ${F.faixasAtuais.map(x => `sigmoide ${f(x.sigmoide, 2)} → IRS ≈ ${f(x.irs)}`).join('; ')}. Ou seja: Baixo < ${f(F.faixasAtuais[0].irs)} ≤ Moderado < ${f(F.faixasAtuais[1].irs)} ≤ Alto < ${f(F.faixasAtuais[2].irs)} ≤ Crítico. A linha de base usa os mesmos cortes diretamente no escore.`);
  s.push('');
  s.push(cabecalho(['Modelo', 'Mínimo', 'Q1', 'Mediana', 'Q3', 'Máximo', 'Níveis atuais B/M/A/C']));
  for (const nome of NOMES) {
    const x = F.distribuicaoEscores[nome];
    s.push(linhaTabela([nome, f(x.minimo, 4), f(x.q1, 4), f(x.mediana, 4), f(x.q3, 4), f(x.maximo, 4), M.NIVEIS.map(n => x.porNivelAtual[n]).join('/')]));
  }
  s.push('');
  const vc = F.validacaoCruzada.porModelo['IRS v2'];
  const av2 = F.auc.propagacao.porModelo['IRS v2'];
  const cal = F.calibracaoNaAmostra.porModelo['IRS v2'];
  s.push(`**Interpretação:** a AUC da v2 para propagação é ${f(av2.auc)} ${ic(av2)}, ${av2.ic95[0] > 0.5 ? 'acima de 0,5 mas' : 'com IC que inclui 0,5 e'} distante de uma separação forte; para o nível Crítico, o IC ${F.auc.criticoContraResto.porModelo['IRS v2'].ic95[0] > 0.5 ? 'fica acima de 0,5' : 'inclui 0,5'}. Ajustar os limiares para reproduzir as proporções da referência ${cal.kappa < cal.kappaComLimiaresAtuais ? 'não aumenta' : 'aumenta'} o κ da v2 (${f(cal.kappaComLimiaresAtuais)} com os limiares atuais; ${f(cal.kappa)} calibrado na amostra; ${f(vc.kappaMedio)} em média fora da amostra), embora aumente a acurácia, por prever mais focos como Baixo.`);
  s.push('');
  return s.join('\n');
}

// ------------------------------------------------------------
// Principal
// ------------------------------------------------------------
async function main() {
  const amostra = lerJson(path.join(PASTA_VALIDACAO, 'amostra.json'));
  const resultados = lerJson(path.join(PASTA_VALIDACAO, 'resultados.json'));
  const csv = lerCsv(path.join(PASTA_VALIDACAO, 'amostra.csv'));
  const porFoco = resultados.porFoco;
  if (!(amostra.length === porFoco.length && csv.length === porFoco.length &&
    porFoco.every((x, i) => x.id === amostra[i].id && x.id === csv[i].id && x.gabaritoN === Number(csv[i].gabarito_n_focos_10km_7d)))) {
    throw new Error('amostra.json, amostra.csv e resultados.json não estão alinhados (ids, ordem ou contagens)');
  }

  const contexto = { reamostragens: reamostragensOriginais(resultados), semente: config.SEMENTE };
  const dados = {
    amostra,
    csv,
    porFoco,
    gabarito: porFoco.map(x => x.gabarito),
    niveis: Object.fromEntries(NOMES.map(n => [n, porFoco.map(x => x[MODELOS[n].nivel])])),
    escores: Object.fromEntries(NOMES.map(n => [n, porFoco.map(x => x[MODELOS[n].escore])]))
  };

  console.log(`Amostra: ${porFoco.length} focos · semente ${contexto.semente} · ${contexto.reamostragens} reamostragens`);
  console.log('A. bootstrap pareado...');
  const a = itemA(dados, contexto, resultados);
  console.log('B. bootstrap por agrupamento...');
  const b = itemB(dados, contexto, a);
  console.log('C. sobreposição entrada × referência...');
  const c = itemC(dados);
  console.log('C2. referência no anel de 1 a 10 km (lendo os CSV brutos)...');
  const c2 = await itemC2(dados, contexto);
  console.log('D. outros cortes...');
  const { binarioReferencia, ...d } = itemD(dados, contexto);
  console.log('E. métricas por classe...');
  const e = itemE(dados);
  console.log('F. AUC e limiares calibrados...');
  const fF = itemF(dados, contexto, binarioReferencia);

  const resultado = {
    geradoEm: new Date().toISOString(),
    parametros: {
      n: porFoco.length,
      semente: contexto.semente,
      reamostragens: contexto.reamostragens,
      intervalo: 'percentil 95% (mesma fórmula de validar-irs.js)',
      tercisPublicados: lerJson(path.join(PASTA_VALIDACAO, 'amostra-meta.json')).gabarito.tercisPositivos,
      pesosAlterados: false,
      fontes: ['data/validacao/amostra.json', 'data/validacao/amostra.csv', 'data/validacao/resultados.json (porFoco)', 'data/validacao/bruto/*.csv (só C2)']
    },
    A: a,
    B: b,
    C: c,
    C2: c2,
    D: d,
    E: e,
    F: fF
  };
  fs.mkdirSync(PASTA_SAIDA, { recursive: true });
  fs.writeFileSync(path.join(PASTA_SAIDA, 'analises-complementares.json'), JSON.stringify(resultado, null, 2));
  fs.writeFileSync(DOC, gerarMarkdown(resultado) + '\n');
  console.log(`\nSalvo em ${path.relative(RAIZ, path.join(PASTA_SAIDA, 'analises-complementares.json'))} e ${path.relative(RAIZ, DOC)}`);
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
