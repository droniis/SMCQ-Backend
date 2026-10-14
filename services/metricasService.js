// ============================================================
// MÉTRICAS DE CONCORDÂNCIA PARA A VALIDAÇÃO DO IRS
// Comparam os níveis esperados (gabarito) com os obtidos por um
// modelo. Sem dependências externas.
// Convenção da matriz de confusão: linha = esperado, coluna = obtido,
// na ordem de NIVEIS (do menor para o maior risco).
// ============================================================

const NIVEIS = ['BAIXO', 'MODERADO', 'ALTO', 'CRITICO'];

function validarEntradas(esperados, obtidos, niveis) {
  if (!Array.isArray(esperados) || !Array.isArray(obtidos)) {
    throw new TypeError('esperados e obtidos devem ser listas');
  }
  if (esperados.length !== obtidos.length) {
    throw new RangeError(`listas de tamanhos diferentes (${esperados.length} e ${obtidos.length})`);
  }
  if (esperados.length === 0) throw new RangeError('listas vazias');
  for (const nivel of [...esperados, ...obtidos]) {
    if (!niveis.includes(nivel)) throw new RangeError(`nível desconhecido: ${nivel}`);
  }
}

// → matriz k×k de contagens (k = número de níveis)
function matrizConfusao(esperados, obtidos, niveis = NIVEIS) {
  validarEntradas(esperados, obtidos, niveis);
  const matriz = niveis.map(() => niveis.map(() => 0));
  esperados.forEach((esperado, i) => {
    matriz[niveis.indexOf(esperado)][niveis.indexOf(obtidos[i])]++;
  });
  return matriz;
}

// Proporção de acertos exatos
function acuracia(esperados, obtidos, niveis = NIVEIS) {
  validarEntradas(esperados, obtidos, niveis);
  const acertos = esperados.filter((esperado, i) => esperado === obtidos[i]).length;
  return acertos / esperados.length;
}

// Recall de cada nível: dos casos que eram daquele nível, quantos o modelo acertou.
// null quando o nível não aparece no gabarito (recall indefinido).
function recallPorNivel(esperados, obtidos, niveis = NIVEIS) {
  const matriz = matrizConfusao(esperados, obtidos, niveis);
  return Object.fromEntries(niveis.map((nivel, i) => {
    const totalLinha = matriz[i].reduce((a, b) => a + b, 0);
    return [nivel, totalLinha === 0 ? null : matriz[i][i] / totalLinha];
  }));
}

// Kappa ponderado com pesos quadráticos (Cohen, 1968; kappa original: Cohen, 1960).
//   κw = 1 − Σ wij·Oij / Σ wij·Eij,   wij = (i − j)² / (k − 1)²
// O = contagens observadas; E = contagens esperadas ao acaso (produto das marginais / N).
// Discordâncias distantes (BAIXO × CRÍTICO) pesam 9 vezes mais que as vizinhas.
// null quando a discordância esperada é zero (todos os casos num só nível nas
// duas classificações): nesse caso o kappa é indefinido.
function kappaPonderadoQuadratico(esperados, obtidos, niveis = NIVEIS) {
  const matriz = matrizConfusao(esperados, obtidos, niveis);
  const k = niveis.length;
  const n = esperados.length;
  const linhas = matriz.map(linha => linha.reduce((a, b) => a + b, 0));
  const colunas = niveis.map((_, j) => matriz.reduce((a, linha) => a + linha[j], 0));

  let observado = 0;
  let esperadoAoAcaso = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const peso = (i - j) ** 2 / (k - 1) ** 2;
      observado += peso * matriz[i][j];
      esperadoAoAcaso += peso * (linhas[i] * colunas[j]) / n;
    }
  }
  if (esperadoAoAcaso === 0) return null;
  return 1 - observado / esperadoAoAcaso;
}

module.exports = {
  NIVEIS,
  matrizConfusao,
  acuracia,
  recallPorNivel,
  kappaPonderadoQuadratico
};
