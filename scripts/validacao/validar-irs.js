// ============================================================
// VALIDAÇÃO DO IRS — ETAPA 3: EXECUÇÃO
// Para cada foco da amostra (data/validacao/amostra.json):
//   - IRS v2 (calcularRiscoAvancadoV2) ......... modelo validado
//   - IRS v1 (calcularRiscoAvancado) ........... o que o POST /api/alertas usa hoje
//   - linha de base (calcularLinhaBase) ........ média simples, sem AHP
// e compara os três com o gabarito:
//   - principal (opção B): 0 → BAIXO; contagens > 0 por tercis
//   - secundária (opção A): quartis, como no plano original do Cap. 6
// Também: reprodutibilidade (RNF18), sensibilidade dos pesos AHP (±10%),
// distribuição do critério urbano e os cenários controlados.
// Resultado em data/validacao/resultados.json.
//
// Os pesos NÃO são ajustados aqui: o IRS é avaliado como está no sistema.
//
// Rodar: node scripts/validacao/validar-irs.js
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { calcularRiscoAvancado, calcularRiscoAvancadoV2, PESOS_AHP_V2 } = require('../../services/riscoService');
const { calcularLinhaBase } = require('../../services/linhaBaseService');
const M = require('../../services/metricasService');
const C = require('./cenarios-controlados');
const { geradorAleatorio } = require('./amostra');
const config = require('./config');

const PASTA = path.join(__dirname, '..', '..', 'data', 'validacao');
const VARIACAO_SENSIBILIDADE = 0.10;
const REAMOSTRAGENS_BOOTSTRAP = 2000;

// ------------------------------------------------------------
// Modelos
// ------------------------------------------------------------
const MODELOS = {
  'IRS v2': (r) => { const x = calcularRiscoAvancadoV2(r.alerta, r.geodados); return { escore: x.irs, nivel: x.nivel, detalhes: x.detalhes }; },
  'IRS v1': (r) => { const x = calcularRiscoAvancado(r.alerta); return { escore: x.irs, nivel: x.nivel }; },
  'Linha de base': (r) => { const x = calcularLinhaBase(r.alerta, r.geodados); return { escore: x.score, nivel: x.nivel, detalhes: x.detalhes }; }
};

function avaliar(esperados, obtidos) {
  return {
    acuracia: M.acuracia(esperados, obtidos),
    kappaPonderadoQuadratico: M.kappaPonderadoQuadratico(esperados, obtidos),
    recallPorNivel: M.recallPorNivel(esperados, obtidos),
    matrizConfusao: M.matrizConfusao(esperados, obtidos),
    distribuicaoObtida: Object.fromEntries(M.NIVEIS.map(n => [n, obtidos.filter(o => o === n).length]))
  };
}

// ------------------------------------------------------------
// Sensibilidade: um peso ×(1 ± 10%), todos renormalizados para somar 1
// ------------------------------------------------------------
function pesosVariados(criterio, fator) {
  const brutos = { ...PESOS_AHP_V2, [criterio]: PESOS_AHP_V2[criterio] * fator };
  const soma = Object.values(brutos).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(brutos).map(([k, v]) => [k, v / soma]));
}

function sensibilidade(amostra, niveisOriginais) {
  return Object.keys(PESOS_AHP_V2).map(criterio => {
    const linha = { criterio, pesoOriginal: PESOS_AHP_V2[criterio] };
    const mudouEmAlgum = new Set();
    for (const [rotulo, fator] of [['mais10', 1 + VARIACAO_SENSIBILIDADE], ['menos10', 1 - VARIACAO_SENSIBILIDADE]]) {
      const pesos = pesosVariados(criterio, fator);
      let mudaram = 0;
      amostra.forEach((r, i) => {
        if (calcularRiscoAvancadoV2(r.alerta, r.geodados, pesos).nivel !== niveisOriginais[i]) {
          mudaram++;
          mudouEmAlgum.add(i);
        }
      });
      linha[rotulo] = { pesoNovo: pesos[criterio], mudaram, percentual: mudaram / amostra.length };
    }
    linha.qualquer = { mudaram: mudouEmAlgum.size, percentual: mudouEmAlgum.size / amostra.length };
    return linha;
  });
}

// ------------------------------------------------------------
// Bootstrap (percentil, 95%): reamostra os focos com reposição, com a
// mesma semente do sorteio, e recalcula acurácia e kappa de cada modelo
// e a diferença pareada IRS v2 − linha de base.
// ------------------------------------------------------------
function bootstrap(esperados, niveisPorModelo, reamostragens = REAMOSTRAGENS_BOOTSTRAP, semente = config.SEMENTE) {
  const aleatorio = geradorAleatorio(semente);
  const n = esperados.length;
  const series = {};
  const guardar = (chave, valor) => {
    if (valor === null) return; // kappa indefinido nesta reamostragem
    if (!series[chave]) series[chave] = [];
    series[chave].push(valor);
  };
  for (let b = 0; b < reamostragens; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(aleatorio() * n));
    const esp = idx.map(i => esperados[i]);
    const valores = {};
    for (const [nome, niveis] of Object.entries(niveisPorModelo)) {
      const obt = idx.map(i => niveis[i]);
      valores[nome] = { acuracia: M.acuracia(esp, obt), kappa: M.kappaPonderadoQuadratico(esp, obt) };
      guardar(`${nome}|acuracia`, valores[nome].acuracia);
      guardar(`${nome}|kappa`, valores[nome].kappa);
    }
    const [irs, base] = [valores['IRS v2'], valores['Linha de base']];
    guardar('IRS v2 − Linha de base|acuracia', irs.acuracia - base.acuracia);
    if (irs.kappa !== null && base.kappa !== null) guardar('IRS v2 − Linha de base|kappa', irs.kappa - base.kappa);
  }
  const intervalo = (v) => {
    const o = [...v].sort((a, b) => a - b);
    return { ic95: [o[Math.floor(0.025 * (o.length - 1))], o[Math.ceil(0.975 * (o.length - 1))]], validas: o.length };
  };
  return { reamostragens, semente, ...Object.fromEntries(Object.entries(series).map(([k, v]) => [k, intervalo(v)])) };
}

// ------------------------------------------------------------
// Estatísticas simples
// ------------------------------------------------------------
function mediana(valores) {
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

function distribuicao(valores, limiarBaixo = 0.05) {
  return {
    minimo: Math.min(...valores),
    mediana: mediana(valores),
    maximo: Math.max(...valores),
    percentualAbaixoDe005: valores.filter(v => v < limiarBaixo).length / valores.length
  };
}

const hash = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

// ------------------------------------------------------------
// Saída na tela
// ------------------------------------------------------------
const pct = (x) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(1)}%`);
const num = (x, casas = 3) => (x === null || x === undefined ? '—' : x.toFixed(casas));
const SIGLAS = { BAIXO: 'B', MODERADO: 'M', ALTO: 'A', CRITICO: 'C' };

function imprimirMatriz(titulo, matriz) {
  console.log(`  ${titulo} (linha = gabarito, coluna = obtido)`);
  console.log(`         ${M.NIVEIS.map(n => SIGLAS[n].padStart(5)).join('')}   total`);
  matriz.forEach((linha, i) => {
    console.log(`    ${SIGLAS[M.NIVEIS[i]].padEnd(5)}${linha.map(v => String(v).padStart(5)).join('')}   ${String(linha.reduce((a, b) => a + b, 0)).padStart(5)}`);
  });
}

function imprimirComparacao(titulo, porModelo) {
  console.log(`\n=== ${titulo} ===`);
  const nomes = Object.keys(porModelo);
  console.log(`  ${'Métrica'.padEnd(26)}${nomes.map(n => n.padStart(15)).join('')}`);
  const linha = (rotulo, f) => console.log(`  ${rotulo.padEnd(26)}${nomes.map(n => f(porModelo[n]).padStart(15)).join('')}`);
  linha('Acurácia', m => pct(m.acuracia));
  linha('Kappa ponderado quadrát.', m => num(m.kappaPonderadoQuadratico));
  for (const nivel of M.NIVEIS) linha(`Recall ${nivel}${nivel === 'CRITICO' ? ' ◄' : ''}`, m => pct(m.recallPorNivel[nivel]));
  linha('Previstos B/M/A/C', m => M.NIVEIS.map(n => m.distribuicaoObtida[n]).join('/'));
}

// ------------------------------------------------------------
// Principal
// ------------------------------------------------------------
function main() {
  const amostra = JSON.parse(fs.readFileSync(path.join(PASTA, 'amostra.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(PASTA, 'amostra-meta.json'), 'utf8'));
  const gabaritos = {
    principal: amostra.map(r => r.gabarito.nivel),
    secundaria: amostra.map(r => r.gabarito.nivelQuartis)
  };

  // 3.1 Cálculo dos três modelos
  const saidas = Object.fromEntries(Object.entries(MODELOS).map(([nome, f]) => [nome, amostra.map(f)]));
  const niveis = Object.fromEntries(Object.entries(saidas).map(([nome, s]) => [nome, s.map(x => x.nivel)]));

  // 3.2 Métricas. "Sempre BAIXO" é só referência: a classe majoritária do gabarito.
  const referenciaTrivial = amostra.map(() => 'BAIXO');
  const metricas = {};
  for (const [qual, esperados] of Object.entries(gabaritos)) {
    metricas[qual] = Object.fromEntries(Object.entries(niveis).map(([nome, obtidos]) => [nome, avaliar(esperados, obtidos)]));
    metricas[qual]['Ref.: sempre BAIXO'] = avaliar(esperados, referenciaTrivial);
  }

  // Intervalos de confiança (só os três modelos; a referência trivial fica de fora)
  const ic = {
    principal: bootstrap(gabaritos.principal, niveis),
    secundaria: bootstrap(gabaritos.secundaria, niveis)
  };

  // Acurácia e kappa por estrato (gabarito principal)
  const estratos = [...new Set(amostra.map(r => r.estrato))].sort();
  const porEstrato = estratos.map(estrato => {
    const idx = amostra.map((r, i) => (r.estrato === estrato ? i : -1)).filter(i => i >= 0);
    const esperados = idx.map(i => gabaritos.principal[i]);
    const linha = { estrato, n: idx.length, gabarito: Object.fromEntries(M.NIVEIS.map(n => [n, esperados.filter(e => e === n).length])) };
    for (const nome of Object.keys(niveis)) {
      const obtidos = idx.map(i => niveis[nome][i]);
      linha[nome] = { acuracia: M.acuracia(esperados, obtidos), kappa: M.kappaPonderadoQuadratico(esperados, obtidos) };
    }
    return linha;
  });

  // 3.3 Reprodutibilidade (RNF18): duas execuções completas do IRS v2 sobre a amostra
  const execucao1 = amostra.map(r => calcularRiscoAvancadoV2(r.alerta, r.geodados));
  const execucao2 = amostra.map(r => calcularRiscoAvancadoV2(r.alerta, r.geodados));
  const identicos = execucao1.filter((x, i) => JSON.stringify(x) === JSON.stringify(execucao2[i])).length;
  const reprodutibilidade = {
    execucoes: 2,
    n: amostra.length,
    identicos,
    percentual: identicos / amostra.length,
    sha256Execucao1: hash(execucao1),
    sha256Execucao2: hash(execucao2)
  };

  // 3.4 Sensibilidade dos pesos AHP
  const tabelaSensibilidade = sensibilidade(amostra, niveis['IRS v2']);

  // Critério urbano (pedido do autor: evidenciar que fica perto de 0)
  const urbano = {
    irsV2FatorExponencial: distribuicao(saidas['IRS v2'].map(s => s.detalhes.urbano.fator)),
    linhaBaseLinear: distribuicao(saidas['Linha de base'].map(s => s.detalhes.criterios.urbano)),
    distanciaKm: distribuicao(saidas['IRS v2'].map(s => s.detalhes.urbano.distanciaKm))
  };

  // Escores (faixa efetivamente atingida na amostra)
  const escores = Object.fromEntries(Object.entries(saidas).map(([nome, s]) => [nome, distribuicao(s.map(x => x.escore))]));

  // 3.5 Cenários controlados: os 8 da tabela + os 2 casos extremos
  const cenarios = [C.PIOR_CASO, C.MELHOR_CASO, ...C.CENARIOS].map(c => {
    const v2 = calcularRiscoAvancadoV2(c.alerta, c.geo);
    const v1 = calcularRiscoAvancado(c.alerta);
    const lb = calcularLinhaBase(c.alerta, c.geo);
    return {
      cenario: c.nome,
      nivelEsperado: C.rotuloEsperado(c.nivelEsperado),
      irs: v2.irs,
      nivelIrs: v2.nivel,
      escoreLinhaBase: lb.score,
      nivelLinhaBase: lb.nivel,
      nivelIrsV1: v1.nivel,
      irsAcertou: C.acertou(c.nivelEsperado, v2.nivel),
      linhaBaseAcertou: C.acertou(c.nivelEsperado, lb.nivel)
    };
  });

  const resultados = {
    geradoEm: new Date().toISOString(),
    amostra: { n: amostra.length, periodo: meta.periodo, satelite: meta.satelite, gabarito: meta.gabarito },
    versaoIrs: 'calcularRiscoAvancadoV2 (pesos PESOS_AHP_V2), services/riscoService.js',
    metricas,
    intervalosConfianca: ic,
    porEstrato,
    escores,
    urbano,
    reprodutibilidade,
    sensibilidade: { variacao: VARIACAO_SENSIBILIDADE, renormalizacao: 'todos os pesos divididos pela nova soma', tabela: tabelaSensibilidade },
    cenarios,
    porFoco: amostra.map((r, i) => ({
      id: r.id,
      estrato: r.estrato,
      gabaritoN: r.gabarito.nFocos10km7dias,
      gabarito: r.gabarito.nivel,
      gabaritoQuartis: r.gabarito.nivelQuartis,
      irsV2: saidas['IRS v2'][i].escore,
      nivelIrsV2: niveis['IRS v2'][i],
      irsV1: saidas['IRS v1'][i].escore,
      nivelIrsV1: niveis['IRS v1'][i],
      linhaBase: saidas['Linha de base'][i].escore,
      nivelLinhaBase: niveis['Linha de base'][i]
    }))
  };
  fs.writeFileSync(path.join(PASTA, 'resultados.json'), JSON.stringify(resultados, null, 2));

  // ---------------- Tela ----------------
  console.log(`Amostra: ${amostra.length} focos (${meta.satelite}), ${meta.periodo.inicio} a ${meta.periodo.fim}`);
  console.log(`IRS validado: ${resultados.versaoIrs}`);
  imprimirComparacao(`GABARITO PRINCIPAL (B: 0 → BAIXO; tercis das contagens > 0) — gabarito B/M/A/C = ${M.NIVEIS.map(n => gabaritos.principal.filter(g => g === n).length).join('/')}`, metricas.principal);
  console.log();
  for (const nome of Object.keys(niveis)) imprimirMatriz(nome, metricas.principal[nome].matrizConfusao);
  imprimirComparacao(`GABARITO SECUNDÁRIO (A: quartis) — gabarito B/M/A/C = ${M.NIVEIS.map(n => gabaritos.secundaria.filter(g => g === n).length).join('/')}`, metricas.secundaria);
  console.log();
  imprimirMatriz('IRS v2 × gabarito A', metricas.secundaria['IRS v2'].matrizConfusao);

  for (const [qual, r] of Object.entries(ic)) {
    console.log(`\n=== IC 95% POR BOOTSTRAP (${r.reamostragens} reamostragens, semente ${r.semente}) — gabarito ${qual} ===`);
    for (const chave of Object.keys(r).filter(k => k.includes('|'))) {
      const [modelo, metrica] = chave.split('|');
      console.log(`  ${modelo.padEnd(24)} ${metrica.padEnd(9)} [${num(r[chave].ic95[0])}, ${num(r[chave].ic95[1])}]`);
    }
  }

  console.log('\n=== POR ESTRATO (gabarito principal): acurácia / kappa ===');
  for (const e of porEstrato) {
    console.log(`  ${e.estrato.slice(0, 22).padEnd(23)} n=${String(e.n).padStart(2)}  gab ${M.NIVEIS.map(n => e.gabarito[n]).join('/').padEnd(11)}` +
      Object.keys(niveis).map(nome => `  ${nome}: ${pct(e[nome].acuracia).padStart(6)} / ${num(e[nome].kappa, 2).padStart(5)}`).join(''));
  }

  console.log('\n=== ESCORES NA AMOSTRA (mín / mediana / máx) ===');
  for (const [nome, d] of Object.entries(escores)) console.log(`  ${nome.padEnd(14)} ${num(d.minimo)} / ${num(d.mediana)} / ${num(d.maximo)}`);

  console.log('\n=== CRITÉRIO URBANO (valor normalizado) ===');
  const u = urbano.irsV2FatorExponencial;
  console.log(`  IRS v2 (exp(−0,2·d)):  mín ${num(u.minimo, 4)} · mediana ${num(u.mediana, 6)} · máx ${num(u.maximo, 4)} · < 0,05 em ${pct(u.percentualAbaixoDe005)}`);
  const l = urbano.linhaBaseLinear;
  console.log(`  Linha de base (1−d/50): mín ${num(l.minimo, 4)} · mediana ${num(l.mediana, 4)} · máx ${num(l.maximo, 4)} · < 0,05 em ${pct(l.percentualAbaixoDe005)}`);
  console.log(`  Distância à cidade mais próxima: mín ${num(urbano.distanciaKm.minimo, 1)} km · mediana ${num(urbano.distanciaKm.mediana, 1)} km · máx ${num(urbano.distanciaKm.maximo, 1)} km`);

  console.log('\n=== REPRODUTIBILIDADE (RNF18) ===');
  console.log(`  ${identicos}/${amostra.length} resultados idênticos (${pct(reprodutibilidade.percentual)}); SHA-256 iguais: ${reprodutibilidade.sha256Execucao1 === reprodutibilidade.sha256Execucao2}`);

  console.log('\n=== SENSIBILIDADE (peso ±10%, renormalizado): focos que mudaram de nível ===');
  console.log(`  ${'Critério'.padEnd(12)}${'peso'.padStart(6)}${'+10%'.padStart(10)}${'−10%'.padStart(10)}${'qualquer'.padStart(10)}`);
  for (const s of tabelaSensibilidade) {
    console.log(`  ${s.criterio.padEnd(12)}${s.pesoOriginal.toFixed(2).padStart(6)}${pct(s.mais10.percentual).padStart(10)}${pct(s.menos10.percentual).padStart(10)}${pct(s.qualquer.percentual).padStart(10)}`);
  }

  console.log('\n=== CENÁRIOS CONTROLADOS ===');
  console.log(`  ${'Cenário'.padEnd(44)}${'Esperado'.padEnd(27)}${'IRS'.padStart(7)}  ${'Nível IRS'.padEnd(10)}${'Linha base'.padEnd(11)}${'v1'.padEnd(10)}IRS acertou?`);
  for (const c of cenarios) {
    const ok = c.irsAcertou === null ? '—' : c.irsAcertou ? 'sim' : 'não';
    console.log(`  ${c.cenario.padEnd(44)}${c.nivelEsperado.padEnd(27)}${c.irs.toFixed(4).padStart(7)}  ${c.nivelIrs.padEnd(10)}${c.nivelLinhaBase.padEnd(11)}${c.nivelIrsV1.padEnd(10)}${ok}`);
  }
  console.log(`\nResultados salvos em ${path.relative(path.join(__dirname, '..', '..'), path.join(PASTA, 'resultados.json'))}`);
}

main();
