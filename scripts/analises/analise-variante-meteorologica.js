// ============================================================
// VARIANTE METEOROLÓGICA DO IRS — AMOSTRA INDEPENDENTE DE OUTUBRO
// Executa o teste definido em docs/preregistro-variante-meteorologica.md.
// Lê, sem modificar:
//   - data/analises/outubro/amostra.json (preparar-amostra-outubro.js)
//   - data/validacao/amostra.json e amostra.csv (análise secundária, ago–set)
// Modelos: IRS v2, linha de base, IRS-M e IRS-MF (scripts/analises/variantes.js).
// Resultado em data/analises/variante-meteorologica.json e
// docs/variante-meteorologica.md. Os pesos do IRS v2 NÃO são alterados.
//
// Rodar: node scripts/analises/analise-variante-meteorologica.js
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const config = require('../validacao/config');
const M = require('../../services/metricasService');
const E = require('./estatisticas');
const V = require('./variantes');
const { calcularRiscoAvancadoV2 } = require('../../services/riscoService');
const { calcularLinhaBase } = require('../../services/linhaBaseService');

const RAIZ = path.join(__dirname, '..', '..');
const SAIDA_JSON = path.join(RAIZ, 'data', 'analises', 'variante-meteorologica.json');
const SAIDA_MD = path.join(RAIZ, 'docs', 'variante-meteorologica.md');
const REAMOSTRAGENS = 2000; // as mesmas da validação principal
const NIVEIS = M.NIVEIS;
const MODELOS = ['IRS v2', 'Linha de base', 'IRS-M', 'IRS-MF'];
const DIFERENCAS = [['IRS-M', 'IRS v2'], ['IRS-MF', 'IRS v2'], ['IRS-M', 'Linha de base'], ['IRS-MF', 'Linha de base']];

const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const numero = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function lerCsvSimples(arquivo) {
  // amostra.csv da validação: só as colunas numéricas usadas aqui (sem aspas nesses campos)
  const linhas = fs.readFileSync(arquivo, 'utf8').trim().split(/\r?\n/);
  const cab = linhas[0].split(',');
  const col = (nome) => cab.indexOf(nome);
  const [iId, iFrp, iRf] = [col('id'), col('frp'), col('risco_fogo_inpe')];
  const mapa = {};
  for (const l of linhas.slice(1)) {
    const c = l.split(',');
    mapa[c[iId]] = { frp: numero(c[iFrp]), riscoFogo: numero(c[iRf]) };
  }
  return mapa;
}

// ------------------------------------------------------------
// Registros → escores e níveis de cada modelo
// ------------------------------------------------------------
function avaliarRegistros(registros) {
  return registros.map(r => {
    const v2 = calcularRiscoAvancadoV2(r.alerta, r.geodados);
    const lb = calcularLinhaBase(r.alerta, r.geodados);
    const m = V.irsM(v2.irs, r.riscoFogo);
    const mf = V.irsMF(v2.irs, r.riscoFogo, r.frp);
    return {
      id: r.id,
      dia: r.dia0,
      referencia: r.gabarito.nivel,
      contagem: r.gabarito.nFocos10km7dias,
      frp: r.frp,
      riscoFogo: r.riscoFogo,
      escores: { 'IRS v2': v2.irs, 'Linha de base': lb.score, 'IRS-M': m.escore, 'IRS-MF': mf.escore },
      niveis: { 'IRS v2': v2.nivel, 'Linha de base': lb.nivel, 'IRS-M': m.nivel, 'IRS-MF': mf.nivel }
    };
  });
}

const em = (v, idx) => idx.map(i => v[i]);

function estatisticas(av, mediana) {
  const esperados = av.map(a => a.referencia);
  const propagou = av.map(a => a.contagem > 0);
  const frp = av.map(a => a.frp);
  const temFrp = av.map(a => Number.isFinite(a.frp));
  const niveis = Object.fromEntries(MODELOS.map(m => [m, av.map(a => a.niveis[m])]));
  const escores = Object.fromEntries(MODELOS.map(m => [m, av.map(a => a.escores[m])]));
  return (idx) => {
    const esp = em(esperados, idx);
    const r = {};
    for (const m of MODELOS) {
      const obt = em(niveis[m], idx);
      const mc = E.metricasPorClasse(esp, obt, NIVEIS);
      r[`${m}|kappa`] = M.kappaPonderadoQuadratico(esp, obt);
      r[`${m}|acuracia`] = M.acuracia(esp, obt);
      r[`${m}|f1Macro`] = mc.f1Macro;
      r[`${m}|recallCritico`] = mc.porClasse.CRITICO.recall;
      r[`${m}|precisaoCritico`] = mc.porClasse.CRITICO.precisao;
      r[`${m}|aucPropagacao`] = E.auc(em(escores[m], idx), em(propagou, idx));
      // IRS-MF usa o FRP como entrada: não é avaliado contra o FRP
      if (m !== 'IRS-MF') {
        const idxFrp = idx.filter(i => temFrp[i]);
        r[`${m}|spearmanFrp`] = E.spearman(em(escores[m], idxFrp), em(frp, idxFrp));
        r[`${m}|aucFrpMediana`] = E.auc(em(escores[m], idxFrp), em(frp, idxFrp).map(v => v > mediana));
      }
    }
    for (const [a, b] of DIFERENCAS) {
      r[`${a} − ${b}|kappa`] = r[`${a}|kappa`] - r[`${b}|kappa`];
      r[`${a} − ${b}|aucPropagacao`] = r[`${a}|aucPropagacao`] === null || r[`${b}|aucPropagacao`] === null ? null : r[`${a}|aucPropagacao`] - r[`${b}|aucPropagacao`];
    }
    if (r['IRS-M|aucFrpMediana'] !== undefined) {
      r['IRS-M − IRS v2|aucFrpMediana'] = r['IRS-M|aucFrpMediana'] - r['IRS v2|aucFrpMediana'];
      r['IRS-M − Linha de base|aucFrpMediana'] = r['IRS-M|aucFrpMediana'] - r['Linha de base|aucFrpMediana'];
    }
    return r;
  };
}

function analisar(nome, registros) {
  const av = avaliarRegistros(registros);
  const n = av.length;
  const frpValidos = av.map(a => a.frp).filter(Number.isFinite);
  const mediana = E.resumo(frpValidos).mediana;
  const estat = estatisticas(av, mediana);
  const todos = Array.from({ length: n }, (_, i) => i);
  const pontual = estat(todos);
  const porRegistro = E.bootstrap({ n, estatisticas: estat, reamostragens: REAMOSTRAGENS, semente: config.SEMENTE });
  const porDia = E.bootstrap({ n, estatisticas: estat, reamostragens: REAMOSTRAGENS, semente: config.SEMENTE, grupos: av.map(a => a.dia) });
  const resultado = {};
  for (const [chave, valor] of Object.entries(pontual)) {
    resultado[chave] = { valor, porRegistro: porRegistro.intervalos[chave] ?? null, porDia: porDia.intervalos[chave] ?? null };
  }
  const contarNiveis = (lista) => Object.fromEntries(NIVEIS.map(k => [k, lista.filter(x => x === k).length]));
  return {
    nome,
    n,
    dias: new Set(av.map(a => a.dia)).size,
    referenciaPorNivel: contarNiveis(av.map(a => a.referencia)),
    previstosPorModelo: Object.fromEntries(MODELOS.map(m => [m, contarNiveis(av.map(a => a.niveis[m]))])),
    matrizes: Object.fromEntries(MODELOS.map(m => [m, E.matriz(av.map(a => a.referencia), av.map(a => a.niveis[m]), NIVEIS)])),
    escoresResumo: Object.fromEntries(MODELOS.map(m => [m, E.resumo(av.map(a => a.escores[m]))])),
    riscoFogoAusente: av.filter(a => !(Number.isFinite(a.riscoFogo) && a.riscoFogo >= 0)).length,
    frpMedianaMW: mediana,
    metricas: resultado,
    criterioPrincipal: Object.fromEntries(['IRS-M', 'IRS-MF'].flatMap(m => ['IRS v2', 'Linha de base'].map(b => {
      const d = resultado[`${m} − ${b}|kappa`];
      return [`${m} − ${b}`, { diferencaKappa: d.valor, ic95PorRegistro: d.porRegistro, melhora: d.porRegistro ? d.porRegistro.ic95[0] > 0 : null }];
    })))
  };
}

// ------------------------------------------------------------
// Relatório em Markdown
// ------------------------------------------------------------
const f3 = (v) => (v === null || v === undefined ? '—' : v.toFixed(3).replace('.', ','));
const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const ic = (x, fmt = f3) => (x ? `[${fmt(x.ic95[0])}; ${fmt(x.ic95[1])}]` : '');

function tabelaMetricas(a) {
  const m = a.metricas;
  const linhas = [
    '| Métrica | ' + MODELOS.join(' | ') + ' |',
    '|---|' + MODELOS.map(() => '---').join('|') + '|'
  ];
  const linha = (rotulo, chave, fmt = f3, comIc = true) =>
    linhas.push(`| ${rotulo} | ` + MODELOS.map(mod => {
      const x = m[`${mod}|${chave}`];
      return x ? `${fmt(x.valor)} ${comIc ? ic(x.porRegistro, fmt) : ''}`.trim() : '—';
    }).join(' | ') + ' |');
  linha('Kappa ponderado', 'kappa');
  linha('Acurácia', 'acuracia', pct);
  linha('F1 macro', 'f1Macro', f3, false);
  linha('Recall de Crítico', 'recallCritico', pct, false);
  linha('Precisão de Crítico', 'precisaoCritico', pct, false);
  linha('AUC propagação', 'aucPropagacao');
  linha('Spearman com o FRP', 'spearmanFrp');
  linha(`AUC FRP > mediana (${String(+a.frpMedianaMW.toFixed(2)).replace('.', ',')} MW)`, 'aucFrpMediana');
  return linhas.join('\n');
}

function tabelaDiferencas(a) {
  const linhas = ['| Diferença | Δ kappa [IC por registro] | IC por dia | Δ AUC propagação [IC por registro] |', '|---|---|---|---|'];
  for (const [x, y] of DIFERENCAS) {
    const k = a.metricas[`${x} − ${y}|kappa`];
    const u = a.metricas[`${x} − ${y}|aucPropagacao`];
    linhas.push(`| ${x} − ${y} | ${f3(k.valor)} ${ic(k.porRegistro)} | ${ic(k.porDia)} | ${f3(u.valor)} ${ic(u.porRegistro)} |`);
  }
  return linhas.join('\n');
}

function relatorio(principal, secundaria, meta) {
  const crit = principal.criterioPrincipal;
  const conclusao = (chave) => (crit[chave].melhora ? 'atende ao critério (IC inteiramente acima de zero)' : 'não atende ao critério (IC inclui zero ou é negativo)');
  return `# Variante meteorológica do IRS: amostra independente de outubro de 2026

Teste definido em [\`preregistro-variante-meteorologica.md\`](preregistro-variante-meteorologica.md) (29/10/2026), antes da coleta dos dados de outubro. Gerado por \`scripts/analises/analise-variante-meteorologica.js\` em ${new Date().toISOString().slice(0, 10)}. Os pesos do IRS v2 não foram alterados.

- **IRS-M** = 0,75 × IRS v2 + 0,25 × Risco de Fogo do INPE
- **IRS-MF** = 0,65 × IRS v2 + 0,25 × Risco de Fogo + 0,10 × F(FRP), com F = min(1, ln(1 + FRP)/ln(501)); não é avaliado contra o FRP
- Mesma sigmoide e mesmos limites do IRS v2; bootstrap percentil com ${REAMOSTRAGENS} réplicas e semente ${config.SEMENTE}

## 1. Amostra de outubro (principal)

${principal.n} focos, ${principal.dias} dias de detecção (${meta.periodo.inicio} a ${meta.periodo.ultimoDia0Sorteavel}), de ${meta.focosElegiveis} elegíveis do ${meta.satelite}. Referência (0 | 1–2 | 3–5 | 6+ focos a até 10 km nos 7 dias seguintes): ${Object.entries(principal.referenciaPorNivel).map(([k, v]) => `${k} ${v}`).join(' · ')}. Risco de Fogo ausente em ${principal.riscoFogoAusente} focos (usado 0,5). Geodados com valor de reserva em ${meta.geodadosComFallback} focos.

${tabelaMetricas(principal)}

Níveis previstos (Baixo/Moderado/Alto/Crítico): ${MODELOS.map(m => `${m} ${NIVEIS.map(k => principal.previstosPorModelo[m][k]).join('/')}`).join(' · ')}.

### Diferenças pareadas

${tabelaDiferencas(principal)}

### Critério principal (pré-registrado)

- IRS-M − IRS v2: Δκ = ${f3(crit['IRS-M − IRS v2'].diferencaKappa)} ${ic(crit['IRS-M − IRS v2'].ic95PorRegistro)} → ${conclusao('IRS-M − IRS v2')}.
- IRS-MF − IRS v2: Δκ = ${f3(crit['IRS-MF − IRS v2'].diferencaKappa)} ${ic(crit['IRS-MF − IRS v2'].ic95PorRegistro)} → ${conclusao('IRS-MF − IRS v2')}.
- IRS-M − linha de base: Δκ = ${f3(crit['IRS-M − Linha de base'].diferencaKappa)} ${ic(crit['IRS-M − Linha de base'].ic95PorRegistro)} → ${conclusao('IRS-M − Linha de base')}.
- IRS-MF − linha de base: Δκ = ${f3(crit['IRS-MF − Linha de base'].diferencaKappa)} ${ic(crit['IRS-MF − Linha de base'].ic95PorRegistro)} → ${conclusao('IRS-MF − Linha de base')}.

## 2. Amostra de agosto e setembro (secundária, descritiva)

As variáveis das variantes foram escolhidas depois das análises desta amostra; por isso, este resultado não testa a variante, só descreve o seu comportamento nos mesmos ${secundaria.n} focos da validação principal.

${tabelaMetricas(secundaria)}

${tabelaDiferencas(secundaria)}
`;
}

// ------------------------------------------------------------
// Principal
// ------------------------------------------------------------
function main() {
  const pastaOut = path.join(RAIZ, 'data', 'analises', 'outubro');
  const meta = lerJson(path.join(pastaOut, 'amostra-meta.json'));
  const outubro = lerJson(path.join(pastaOut, 'amostra.json')).map(r => ({
    ...r, frp: numero(r.frp), riscoFogo: numero(r.risco_fogo_inpe)
  }));
  const extras = lerCsvSimples(path.join(RAIZ, 'data', 'validacao', 'amostra.csv'));
  const agoSet = lerJson(path.join(RAIZ, 'data', 'validacao', 'amostra.json')).map(r => ({ ...r, ...extras[r.id] }));

  const principal = analisar('outubro de 2026', outubro);
  const secundaria = analisar('agosto e setembro de 2026', agoSet);
  const saida = { preRegistro: 'docs/preregistro-variante-meteorologica.md', geradoEm: new Date().toISOString(), reamostragens: REAMOSTRAGENS, semente: config.SEMENTE, pesos: { PESO_V2_M: V.PESO_V2_M, PESO_RF_M: V.PESO_RF_M, PESO_V2_MF: V.PESO_V2_MF, PESO_RF_MF: V.PESO_RF_MF, PESO_FRP_MF: V.PESO_FRP_MF, FRP_TETO_MW: V.FRP_TETO_MW, RF_AUSENTE: V.RF_AUSENTE }, principal, secundaria };
  fs.writeFileSync(SAIDA_JSON, JSON.stringify(saida, null, 2));
  fs.writeFileSync(SAIDA_MD, relatorio(principal, secundaria, meta));
  console.log(relatorio(principal, secundaria, meta));
}

if (require.main === module) main();

module.exports = { avaliarRegistros, analisar };
