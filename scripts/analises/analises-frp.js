// ============================================================
// VALIDAÇÃO DO IRS — SEGUNDA REFERÊNCIA (FRP) E DADOS PARA FIGURAS
// (2ª revisão do artigo)
// Lê, sem modificar: data/validacao/amostra.csv e resultados.json (porFoco)
// e data/analises/analises-complementares.json (resultados da G1).
// Calcula:
//   A. FRP (potência radiativa do fogo) como segunda referência:
//      Spearman com os escores, AUC para FRP acima da mediana e no
//      quartil superior, diferenças pareadas de AUC; Spearman entre o FRP
//      e a contagem da referência principal
//   B. Risco de Fogo do INPE: comparação descritiva (não é entrada do IRS)
//   C. método do IC da AUC e IC da diferença de kappa na referência binária
//   D. acurácias sem arredondamento e suas diferenças
//   E. dados para figuras (curvas ROC e escores)
// Resultado em data/analises/analises-frp.json, data/analises/figuras-dados.json
// e docs/analises-frp.md. Os pesos do IRS NÃO são alterados.
//
// Rodar: node scripts/analises/analises-frp.js
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const config = require('../validacao/config');
const M = require('../../services/metricasService');
const E = require('./estatisticas');

const RAIZ = path.join(__dirname, '..', '..');
const PASTA_VALIDACAO = path.join(RAIZ, 'data', 'validacao');
const PASTA_SAIDA = path.join(RAIZ, 'data', 'analises');
const DOC = path.join(RAIZ, 'docs', 'analises-frp.md');
const LIMITES_IRS = [0.390, 0.500, 0.610];

const MODELOS = { 'IRS v2': 'irsV2', 'IRS v1': 'irsV1', 'Linha de base': 'linhaBase' };
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

// Número da coluna, ou null se vazio/não numérico
const numero = (texto) => (texto === undefined || texto.trim() === '' || !Number.isFinite(Number(texto)) ? null : Number(texto));

// O mesmo número de réplicas da validação publicada (conferido contra resultados.json)
function reamostragensOriginais(resultados) {
  const fonte = fs.readFileSync(path.join(RAIZ, 'scripts', 'validacao', 'validar-irs.js'), 'utf8');
  const doScript = Number(/const REAMOSTRAGENS_BOOTSTRAP = (\d+);/.exec(fonte)?.[1]);
  const ic = resultados.intervalosConfianca.principal;
  if (doScript !== ic.reamostragens) throw new Error(`reamostragens divergentes: script ${doScript}, resultados.json ${ic.reamostragens}`);
  if (ic.semente !== config.SEMENTE) throw new Error(`semente divergente: config ${config.SEMENTE}, resultados.json ${ic.semente}`);
  return doScript;
}

const em = (v, idx) => idx.map(i => v[i]);
const todos = (n) => Array.from({ length: n }, (_, i) => i);
const comIc = (pontual, intervalo) => ({ valor: pontual, ...intervalo });

// Bootstrap com uma função de estatísticas; devolve { chave: { valor, ic95, validas } }
function estimar(n, estatisticas, contexto, grupos = null) {
  const pontual = estatisticas(todos(n));
  const bs = E.bootstrap({ n, estatisticas, reamostragens: contexto.reamostragens, semente: contexto.semente, grupos });
  return Object.fromEntries(Object.keys(pontual).map(k => [k, comIc(pontual[k], bs.intervalos[k])]));
}

// ------------------------------------------------------------
// A. FRP como segunda referência
// ------------------------------------------------------------
function itemA(dados, contexto) {
  const { frp, escores, dias, contagemReferencia } = dados;
  const n = frp.length;
  const resumoFrp = E.resumo(frp);

  // A1. Spearman FRP × escores (por registro e por dia)
  const rho = (idx) => Object.fromEntries(NOMES.map(nome => [nome, E.spearman(em(escores[nome], idx), em(frp, idx))]));
  const spearman = {
    porRegistro: estimar(n, rho, contexto),
    porDia: estimar(n, rho, contexto, dias)
  };

  // A2. AUC para FRP acima da mediana e no quartil superior, com diferenças pareadas
  const alvos = {
    acimaDaMediana: { descricao: `FRP acima da mediana (> ${String(resumoFrp.mediana).replace(".", ",")} MW)`, positivos: frp.map(v => v > resumoFrp.mediana) },
    quartilSuperior: { descricao: `FRP no quartil superior (> ${String(resumoFrp.q3).replace(".", ",")} MW)`, positivos: frp.map(v => v > resumoFrp.q3) }
  };
  const auc = Object.fromEntries(Object.entries(alvos).map(([chave, alvo]) => {
    const estat = (idx) => {
      const pos = em(alvo.positivos, idx);
      const r = Object.fromEntries(NOMES.map(nome => [nome, E.auc(em(escores[nome], idx), pos)]));
      r['IRS v2 − Linha de base'] = r['IRS v2'] === null || r['Linha de base'] === null ? null : r['IRS v2'] - r['Linha de base'];
      r['IRS v2 − IRS v1'] = r['IRS v2'] === null || r['IRS v1'] === null ? null : r['IRS v2'] - r['IRS v1'];
      return r;
    };
    const positivos = alvo.positivos.filter(Boolean).length;
    return [chave, {
      descricao: alvo.descricao,
      positivos,
      negativos: n - positivos,
      porRegistro: estimar(n, estat, contexto),
      porDia: estimar(n, estat, contexto, dias),
      paresEmpatados: Object.fromEntries(NOMES.map(nome => [nome, E.paresEmpatados(escores[nome], alvo.positivos)]))
    }];
  }));

  // A3. Concordância entre as duas referências
  const entreReferencias = estimar(n, (idx) => ({ rho: E.spearman(em(frp, idx), em(contagemReferencia, idx)) }), contexto).rho;
  const aucFrpParaPropagacao = estimar(n, (idx) => ({ auc: E.auc(em(frp, idx), em(contagemReferencia.map(c => c > 0), idx)) }), contexto).auc;

  return { focosComFrp: n, resumoFrp, spearman, auc, entreReferencias: { spearmanFrpContagem: entreReferencias, aucFrpParaPropagacao } };
}

// ------------------------------------------------------------
// B. Risco de Fogo do INPE (comparação descritiva)
// ------------------------------------------------------------
function itemB(dados, contexto) {
  const validos = dados.riscoFogo.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
  const risco = em(dados.riscoFogo, validos);
  const alvos = {
    propagacao: { descricao: 'Propagação (≥ 1 detecção a ≤ 10 km nos 7 dias seguintes)', positivos: em(dados.contagemReferencia.map(c => c > 0), validos) },
    frpAcimaDaMediana: { descricao: 'FRP acima da mediana', positivos: em(dados.frp.map(v => v > E.resumo(dados.frp).mediana), validos) }
  };
  const auc = Object.fromEntries(Object.entries(alvos).map(([chave, alvo]) => {
    const estat = (idx) => ({ 'Risco de Fogo': E.auc(em(risco, idx), em(alvo.positivos, idx)), 'IRS v2 (mesmos focos)': E.auc(em(em(dados.escores['IRS v2'], validos), idx), em(alvo.positivos, idx)) });
    return [chave, { descricao: alvo.descricao, positivos: alvo.positivos.filter(Boolean).length, negativos: alvo.positivos.length - alvo.positivos.filter(Boolean).length, ...estimar(validos.length, estat, contexto) }];
  }));
  return { focosComRiscoValido: validos.length, focosSemRisco: dados.riscoFogo.length - validos.length, resumoRisco: E.resumo(risco), spearmanComIrsV2: E.spearman(risco, em(dados.escores['IRS v2'], validos)), auc };
}

// ------------------------------------------------------------
// C e D. Método do IC e valores sem arredondamento
// ------------------------------------------------------------
function itemC(g1) {
  const d2 = g1.D.binario;
  return {
    metodoIcAuc: `bootstrap percentil 95%, ${g1.parametros.reamostragens} réplicas, semente ${g1.parametros.semente}, reamostrando registros com reposição (o mesmo usado na G1, item F1)`,
    kappaBinarioV2MenosBase: d2.metricas['IRS v2 − Linha de base|kappa']
  };
}

function itemD(dados) {
  const n = dados.gabarito.length;
  const acuracia = Object.fromEntries(NOMES.map(nome => [nome, M.acuracia(dados.gabarito, dados.niveis[nome], M.NIVEIS) * 100]));
  return {
    n,
    acuraciaPercentual: acuracia,
    acertos: Object.fromEntries(NOMES.map(nome => [nome, Math.round(acuracia[nome] * n / 100)])),
    diferencas: {
      'IRS v2 − Linha de base': acuracia['IRS v2'] - acuracia['Linha de base'],
      'IRS v2 − IRS v1': acuracia['IRS v2'] - acuracia['IRS v1']
    }
  };
}

// ------------------------------------------------------------
// E. Dados para figuras
// ------------------------------------------------------------
function itemE(dados) {
  const reduzir = (pontos) => pontos.map(p => ({ limiar: Number.isFinite(p.limiar) ? p.limiar : null, fpr: Number(p.fpr.toFixed(6)), tpr: Number(p.tpr.toFixed(6)) }));
  const alvos = {
    propagacao: dados.contagemReferencia.map(c => c > 0),
    frpAcimaDaMediana: dados.frp.map(v => v > E.resumo(dados.frp).mediana)
  };
  const roc = Object.fromEntries(Object.entries(alvos).map(([chave, positivos]) => [chave, Object.fromEntries(NOMES.map(nome => {
    const pontos = E.curvaRoc(dados.escores[nome], positivos);
    return [nome, { auc: E.auc(dados.escores[nome], positivos), areaTrapezio: E.areaTrapezio(pontos), pontos: reduzir(pontos) }];
  }))]));
  return {
    roc,
    escores: { 'IRS v2': dados.escores['IRS v2'], 'Linha de base': dados.escores['Linha de base'] },
    limitesIrs: LIMITES_IRS
  };
}

// ------------------------------------------------------------
// Relatório em Markdown
// ------------------------------------------------------------
const f = (x, casas = 3) => (x === null || x === undefined ? '—' : x.toFixed(casas).replace('.', ','));
const ic = (x, casas = 3) => (x && x.ic95 ? `[${f(x.ic95[0], casas)}; ${f(x.ic95[1], casas)}]` : '');
const vi = (x, casas = 3) => `${f(x.valor, casas)} ${ic(x, casas)}`;
const linha = (c) => `| ${c.join(' | ')} |`;
const cab = (c) => [linha(c), linha(c.map(() => '---'))].join('\n');

function relatorio(r) {
  const { A, B, C, D } = r;
  const s = [];
  s.push('# Segunda referência (FRP) e dados para figuras');
  s.push('');
  s.push(`- **Data de execução:** ${r.geradoEm.slice(0, 10)}`);
  s.push(`- **Semente:** ${r.parametros.semente} · **Reamostragens:** ${r.parametros.reamostragens} (as mesmas da validação); IC 95% pelo método percentil`);
  s.push('- **Pesos do IRS:** não alterados. Escores de `data/validacao/resultados.json` (`porFoco`); FRP e Risco de Fogo de `data/validacao/amostra.csv` (somente leitura).');
  s.push('- **Gerado por:** `node scripts/analises/analises-frp.js` → `data/analises/analises-frp.json` e `data/analises/figuras-dados.json`');
  s.push('');
  s.push('## A. FRP como segunda referência');
  s.push('');
  s.push(`A potência radiativa do fogo (FRP, em MW) vem do próprio registro do INPE e existe para os ${A.focosComFrp} focos. Distribuição: mínimo ${f(A.resumoFrp.minimo, 1)}, Q1 ${f(A.resumoFrp.q1, 1)}, mediana ${f(A.resumoFrp.mediana, 1)}, Q3 ${f(A.resumoFrp.q3, 1)}, máximo ${f(A.resumoFrp.maximo, 1)} MW.`);
  s.push('');
  s.push('### A1. Correlação de Spearman entre o escore e o FRP');
  s.push('');
  s.push(cab(['Modelo', 'ρ [IC 95%] por registro', 'IC 95% por dia']));
  for (const nome of NOMES) s.push(linha([nome, vi(A.spearman.porRegistro[nome]), ic(A.spearman.porDia[nome])]));
  s.push('');
  s.push('### A2. AUC para FRP elevado');
  s.push('');
  for (const x of Object.values(A.auc)) {
    s.push(`**${x.descricao}** — ${x.positivos} positivos / ${x.negativos} negativos`);
    s.push('');
    s.push(cab(['Medida', 'Valor [IC 95%] por registro', 'IC 95% por dia']));
    for (const k of Object.keys(x.porRegistro)) s.push(linha([k.includes('−') ? `Δ AUC ${k}` : `AUC ${k}`, vi(x.porRegistro[k]), ic(x.porDia[k])]));
    s.push('');
  }
  s.push('### A3. Concordância entre as duas referências');
  s.push('');
  s.push(`ρ de Spearman entre o FRP e a contagem da referência principal (10 km, 7 dias): ${vi(A.entreReferencias.spearmanFrpContagem)}. AUC do FRP para a referência binária de propagação: ${vi(A.entreReferencias.aucFrpParaPropagacao)}.`);
  s.push('');
  const a2 = A.auc.acimaDaMediana.porRegistro;
  s.push(`**Interpretação:** com o FRP como referência, o IRS v2 tem ρ = ${f(A.spearman.porRegistro['IRS v2'].valor)} e AUC = ${f(a2['IRS v2'].valor)} ${ic(a2['IRS v2'])} para FRP acima da mediana; a diferença para a linha de base é ${vi(a2['IRS v2 − Linha de base'])}${a2['IRS v2 − Linha de base'].ic95[0] <= 0 && a2['IRS v2 − Linha de base'].ic95[1] >= 0 ? ', com IC que inclui zero' : ''}.`);
  s.push('');
  s.push('## B. Risco de Fogo do INPE (comparação descritiva)');
  s.push('');
  s.push(`O Risco de Fogo calculado pelo INPE acompanha o registro de cada foco; não é entrada do IRS. Focos com valor válido: ${B.focosComRiscoValido} (sem valor: ${B.focosSemRisco}). ρ de Spearman com o IRS v2: ${f(B.spearmanComIrsV2)}.`);
  s.push('');
  s.push(cab(['Alvo', 'Positivos/negativos', 'AUC Risco de Fogo [IC 95%]', 'AUC IRS v2, mesmos focos [IC 95%]']));
  for (const x of Object.values(B.auc)) s.push(linha([x.descricao, `${x.positivos}/${x.negativos}`, vi(x['Risco de Fogo']), vi(x['IRS v2 (mesmos focos)'])]));
  s.push('');
  s.push('**Interpretação:** comparação apenas descritiva, para situar o IRS diante de um índice meteorológico consolidado; não houve ajuste do IRS.');
  s.push('');
  s.push('## C. Método do IC da AUC e diferença de kappa na referência binária');
  s.push('');
  s.push(`- IC da AUC (G1, item F1, e esta análise): ${C.metodoIcAuc}.`);
  s.push(`- Diferença de kappa de Cohen IRS v2 − linha de base na referência binária (G1, item D2): ${vi(C.kappaBinarioV2MenosBase)} — o IC inclui zero: as duas não são distinguíveis.`);
  s.push('');
  s.push('## D. Acurácias sem arredondamento');
  s.push('');
  s.push(cab(['Modelo', 'Acertos', 'Acurácia']));
  for (const nome of NOMES) s.push(linha([nome, `${D.acertos[nome]}/${D.n}`, `${f(D.acuraciaPercentual[nome], 2)}%`]));
  s.push('');
  s.push(`Diferenças: IRS v2 − linha de base = ${f(D.diferencas['IRS v2 − Linha de base'], 2)} p.p. (arredondada: ${f(D.diferencas['IRS v2 − Linha de base'], 1)}); IRS v2 − IRS v1 = ${f(D.diferencas['IRS v2 − IRS v1'], 2)} p.p. A diferença é calculada sobre os valores não arredondados; subtrair as acurácias já arredondadas (35,0% − 29,3%) dá 5,7.`);
  s.push('');
  s.push('## E. Dados para figuras');
  s.push('');
  s.push('`data/analises/figuras-dados.json` traz os pontos das curvas ROC (IRS v2, IRS v1 e linha de base) para a referência de propagação e para FRP acima da mediana, a área de cada curva pela regra do trapézio (igual à AUC de Mann–Whitney) e os 294 escores do IRS v2 e da linha de base, com os limites atuais 0,390 / 0,500 / 0,610.');
  s.push('');
  return s.join('\n');
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------
function main() {
  const resultados = lerJson(path.join(PASTA_VALIDACAO, 'resultados.json'));
  const csv = lerCsv(path.join(PASTA_VALIDACAO, 'amostra.csv'));
  const g1 = lerJson(path.join(PASTA_SAIDA, 'analises-complementares.json'));
  const porFoco = resultados.porFoco;
  if (!(csv.length === porFoco.length && porFoco.every((x, i) => x.id === csv[i].id && x.gabaritoN === Number(csv[i].gabarito_n_focos_10km_7d)))) {
    throw new Error('amostra.csv e resultados.json não estão alinhados');
  }
  const frp = csv.map(l => numero(l.frp));
  if (frp.some(v => v === null)) throw new Error('há focos sem FRP: a análise A pressupõe FRP em todos');

  const contexto = { reamostragens: reamostragensOriginais(resultados), semente: config.SEMENTE };
  const dados = {
    gabarito: porFoco.map(x => x.gabarito),
    niveis: { 'IRS v2': porFoco.map(x => x.nivelIrsV2), 'IRS v1': porFoco.map(x => x.nivelIrsV1), 'Linha de base': porFoco.map(x => x.nivelLinhaBase) },
    escores: Object.fromEntries(NOMES.map(n => [n, porFoco.map(x => x[MODELOS[n]])])),
    contagemReferencia: porFoco.map(x => x.gabaritoN),
    dias: csv.map(l => l.dia0),
    frp,
    riscoFogo: csv.map(l => numero(l.risco_fogo_inpe))
  };

  console.log(`Amostra: ${porFoco.length} focos · semente ${contexto.semente} · ${contexto.reamostragens} reamostragens`);
  const resultado = {
    geradoEm: new Date().toISOString(),
    parametros: { n: porFoco.length, semente: contexto.semente, reamostragens: contexto.reamostragens, metodoIc: 'percentil 95%' },
    A: itemA(dados, contexto),
    B: itemB(dados, contexto),
    C: itemC(g1),
    D: itemD(dados)
  };
  const figuras = { geradoEm: resultado.geradoEm, ...itemE(dados) };

  fs.mkdirSync(PASTA_SAIDA, { recursive: true });
  fs.writeFileSync(path.join(PASTA_SAIDA, 'analises-frp.json'), JSON.stringify(resultado, null, 2) + '\n');
  fs.writeFileSync(path.join(PASTA_SAIDA, 'figuras-dados.json'), JSON.stringify(figuras, null, 2) + '\n');
  fs.writeFileSync(DOC, relatorio(resultado));
  console.log('Gravados: data/analises/analises-frp.json, data/analises/figuras-dados.json, docs/analises-frp.md');
}

if (require.main === module) main();

module.exports = { itemD };
