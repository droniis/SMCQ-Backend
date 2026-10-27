// ============================================================
// ESTATÍSTICAS DAS ANÁLISES COMPLEMENTARES (funções puras)
// Métricas por classe (precisão, recall, F1), kappa de Cohen,
// AUC com empates, correlação de Spearman, bootstrap simples e
// por agrupamento, limiares por quantis e partição estratificada.
// Sem dependências externas e sem acesso à rede.
// ============================================================

const { geradorAleatorio, quantil } = require('../validacao/amostra');

// ------------------------------------------------------------
// Matriz de confusão e métricas por classe
// Convenção (a mesma de services/metricasService.js):
// linha = esperado, coluna = obtido, na ordem de `niveis`.
// ------------------------------------------------------------
function matriz(esperados, obtidos, niveis) {
  if (esperados.length !== obtidos.length) throw new RangeError('listas de tamanhos diferentes');
  const m = niveis.map(() => niveis.map(() => 0));
  esperados.forEach((e, i) => {
    const [l, c] = [niveis.indexOf(e), niveis.indexOf(obtidos[i])];
    if (l < 0 || c < 0) throw new RangeError(`nível desconhecido: ${l < 0 ? e : obtidos[i]}`);
    m[l][c]++;
  });
  return m;
}

// Precisão = acertos / previstos na classe; recall = acertos / reais na classe.
// null quando o denominador é zero. O F1 de uma classe sem previsões (ou sem
// casos reais) vale 0, convenção usual (scikit-learn, zero_division=0).
function metricasPorClasse(esperados, obtidos, niveis) {
  const m = matriz(esperados, obtidos, niveis);
  const porClasse = Object.fromEntries(niveis.map((nivel, i) => {
    const reais = m[i].reduce((a, b) => a + b, 0);
    const previstos = m.reduce((a, linha) => a + linha[i], 0);
    const acertos = m[i][i];
    const precisao = previstos === 0 ? null : acertos / previstos;
    const recall = reais === 0 ? null : acertos / reais;
    const f1 = precisao && recall ? (2 * precisao * recall) / (precisao + recall) : 0;
    return [nivel, { reais, previstos, acertos, precisao, recall, f1 }];
  }));
  const f1Macro = niveis.reduce((a, n) => a + porClasse[n].f1, 0) / niveis.length;
  return { matriz: m, porClasse, f1Macro };
}

// Kappa de Cohen sem ponderação (Cohen, 1960). null quando a concordância
// esperada ao acaso é 1 (todos os casos numa só classe nas duas listas).
function kappaCohen(esperados, obtidos, niveis) {
  const m = matriz(esperados, obtidos, niveis);
  const n = esperados.length;
  const po = niveis.reduce((a, _, i) => a + m[i][i], 0) / n;
  const pe = niveis.reduce((a, _, i) => {
    const linha = m[i].reduce((x, y) => x + y, 0);
    const coluna = m.reduce((x, l) => x + l[i], 0);
    return a + (linha * coluna) / (n * n);
  }, 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

// ------------------------------------------------------------
// AUC (área sob a curva ROC) pela estatística de Mann–Whitney:
// proporção dos pares (positivo, negativo) em que o positivo tem escore maior;
// empates contam meio ponto. null se faltar positivo ou negativo.
// ------------------------------------------------------------
function auc(escores, positivos) {
  const pos = escores.filter((_, i) => positivos[i]);
  const neg = escores.filter((_, i) => !positivos[i]);
  if (pos.length === 0 || neg.length === 0) return null;
  // Pelos postos médios: U = soma dos postos dos positivos − n1(n1+1)/2
  const postos = postosMedios(escores);
  const somaPostosPos = postos.reduce((a, p, i) => a + (positivos[i] ? p : 0), 0);
  const u = somaPostosPos - (pos.length * (pos.length + 1)) / 2;
  return u / (pos.length * neg.length);
}

// Pares (positivo, negativo) com escore exatamente igual
function paresEmpatados(escores, positivos) {
  const negPorValor = new Map();
  escores.forEach((s, i) => { if (!positivos[i]) negPorValor.set(s, (negPorValor.get(s) || 0) + 1); });
  return escores.reduce((a, s, i) => a + (positivos[i] ? negPorValor.get(s) || 0 : 0), 0);
}

// Postos 1..n, com a média dos postos nos empates
function postosMedios(valores) {
  const ordem = valores.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const postos = new Array(valores.length);
  for (let i = 0; i < ordem.length;) {
    let j = i;
    while (j + 1 < ordem.length && ordem[j + 1][0] === ordem[i][0]) j++;
    const medio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) postos[ordem[k][1]] = medio;
    i = j + 1;
  }
  return postos;
}

// Correlação de Spearman = Pearson sobre os postos médios. null se uma das séries é constante.
function spearman(x, y) {
  if (x.length !== y.length) throw new RangeError('listas de tamanhos diferentes');
  const [rx, ry] = [postosMedios(x), postosMedios(y)];
  const media = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const [mx, my] = [media(rx), media(ry)];
  let sxy = 0, sxx = 0, syy = 0;
  rx.forEach((v, i) => {
    sxy += (v - mx) * (ry[i] - my);
    sxx += (v - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  });
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

// ------------------------------------------------------------
// Bootstrap (percentil, 95%)
// Reamostra GRUPOS inteiros com reposição; cada réplica junta os índices
// dos grupos sorteados. Sem `grupos`, cada item é um grupo e o sorteio é
// idêntico ao de scripts/validacao/validar-irs.js (mesma sequência de
// números para a mesma semente). `estatisticas(indices)` devolve
// { chave: valor }; valores null (indefinidos) são descartados.
// ------------------------------------------------------------
function intervaloPercentil(valores) {
  const o = [...valores].sort((a, b) => a - b);
  return { ic95: [o[Math.floor(0.025 * (o.length - 1))], o[Math.ceil(0.975 * (o.length - 1))]], validas: o.length };
}

function indicesPorGrupo(n, grupos) {
  if (!grupos) return Array.from({ length: n }, (_, i) => [i]);
  if (grupos.length !== n) throw new RangeError('grupos deve ter um rótulo por item');
  const mapa = new Map();
  grupos.forEach((g, i) => {
    if (!mapa.has(g)) mapa.set(g, []);
    mapa.get(g).push(i);
  });
  // Ordem fixa dos grupos (rótulo), para não depender da ordem dos itens
  return [...mapa.keys()].sort().map(g => mapa.get(g));
}

function bootstrap({ n, estatisticas, reamostragens, semente, grupos = null }) {
  const aleatorio = geradorAleatorio(semente);
  const blocos = indicesPorGrupo(n, grupos);
  const g = blocos.length;
  const series = {};
  for (let b = 0; b < reamostragens; b++) {
    const indices = [];
    for (let k = 0; k < g; k++) indices.push(...blocos[Math.floor(aleatorio() * g)]);
    for (const [chave, valor] of Object.entries(estatisticas(indices))) {
      if (valor === null || Number.isNaN(valor)) continue;
      if (!series[chave]) series[chave] = [];
      series[chave].push(valor);
    }
  }
  return {
    reamostragens,
    semente,
    grupos: g,
    intervalos: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, intervaloPercentil(v)]))
  };
}

// ------------------------------------------------------------
// Limiares por quantis: escolhe os cortes de modo que a proporção
// prevista de cada nível seja a das `proporcoes` (do menor ao maior).
// Usa o quantil do método 7 (o mesmo do gabarito). Um escore igual a
// um limite fica no nível de baixo, como no gabarito.
// ------------------------------------------------------------
function limiaresPorQuantis(escores, proporcoes) {
  const total = proporcoes.reduce((a, b) => a + b, 0);
  let acumulada = 0;
  return proporcoes.slice(0, -1).map(p => {
    acumulada += p / total;
    return quantil(escores, acumulada);
  });
}

function classificarPorLimiares(escore, limiares, niveis) {
  const i = limiares.findIndex(l => escore <= l);
  return niveis[i === -1 ? niveis.length - 1 : i];
}

// Partição estratificada em k partes: em cada classe, os índices são
// embaralhados (Fisher–Yates, semente fixa) e distribuídos em rodízio.
function particaoEstratificada(rotulos, k, semente) {
  const aleatorio = geradorAleatorio(semente);
  const parte = new Array(rotulos.length);
  let proxima = 0;
  for (const classe of [...new Set(rotulos)].sort()) {
    const idx = rotulos.map((r, i) => (r === classe ? i : -1)).filter(i => i >= 0);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(aleatorio() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    // O rodízio continua de uma classe para a outra, para equilibrar o tamanho das partes
    for (const i of idx) parte[i] = proxima++ % k;
  }
  return parte;
}

// Resumo de uma distribuição: mínimo, quartis (método 7) e máximo
function resumo(valores) {
  return {
    n: valores.length,
    minimo: Math.min(...valores),
    q1: quantil(valores, 0.25),
    mediana: quantil(valores, 0.5),
    q3: quantil(valores, 0.75),
    maximo: Math.max(...valores),
    valoresDistintos: new Set(valores).size
  };
}

// ------------------------------------------------------------
// Curva ROC: pontos (taxa de falsos positivos, taxa de verdadeiros
// positivos), do limiar mais alto ao mais baixo. Escores empatados
// formam um único passo, de modo que a área sob os pontos (regra do
// trapézio) é igual à AUC de auc(). null se faltar positivo ou negativo.
// ------------------------------------------------------------
function curvaRoc(escores, positivos) {
  const nPos = positivos.filter(Boolean).length;
  const nNeg = positivos.length - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  const ordem = escores.map((s, i) => [s, positivos[i]]).sort((a, b) => b[0] - a[0]);
  const pontos = [{ limiar: Infinity, fpr: 0, tpr: 0 }];
  let vp = 0, fp = 0;
  for (let i = 0; i < ordem.length;) {
    const s = ordem[i][0];
    while (i < ordem.length && ordem[i][0] === s) {
      if (ordem[i][1]) vp++; else fp++;
      i++;
    }
    pontos.push({ limiar: s, fpr: fp / nNeg, tpr: vp / nPos });
  }
  return pontos;
}

// Área sob uma lista de pontos ROC pela regra do trapézio
function areaTrapezio(pontos) {
  let area = 0;
  for (let i = 1; i < pontos.length; i++) {
    area += (pontos[i].fpr - pontos[i - 1].fpr) * (pontos[i].tpr + pontos[i - 1].tpr) / 2;
  }
  return area;
}

module.exports = {
  curvaRoc,
  areaTrapezio,
  matriz,
  metricasPorClasse,
  kappaCohen,
  auc,
  paresEmpatados,
  postosMedios,
  spearman,
  intervaloPercentil,
  bootstrap,
  limiaresPorQuantis,
  classificarPorLimiares,
  particaoEstratificada,
  resumo
};
