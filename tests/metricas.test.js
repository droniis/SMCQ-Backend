// Testes das métricas (services/metricasService.js), com casos calculados à mão.
const {
  matrizConfusao,
  acuracia,
  recallPorNivel,
  kappaPonderadoQuadratico
} = require('../services/metricasService');

const B = 'BAIXO';
const M = 'MODERADO';
const A = 'ALTO';
const C = 'CRITICO';

describe('concordância perfeita', () => {
  const niveis = [B, M, A, C, C, A, M, B];

  test('acurácia 1, kappa 1, recall 1 em todos os níveis', () => {
    expect(acuracia(niveis, niveis)).toBe(1);
    expect(kappaPonderadoQuadratico(niveis, niveis)).toBe(1);
    expect(recallPorNivel(niveis, niveis)).toEqual({ BAIXO: 1, MODERADO: 1, ALTO: 1, CRITICO: 1 });
  });

  test('matriz só com a diagonal', () => {
    expect(matrizConfusao(niveis, niveis)).toEqual([
      [2, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 2]
    ]);
  });
});

describe('caso misto calculado à mão', () => {
  // esperados: B B M C      obtidos: B M M A
  const esperados = [B, B, M, C];
  const obtidos = [B, M, M, A];

  test('matriz de confusão (linha = esperado, coluna = obtido)', () => {
    expect(matrizConfusao(esperados, obtidos)).toEqual([
      [1, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 1, 0]
    ]);
  });

  test('acurácia 2/4', () => {
    expect(acuracia(esperados, obtidos)).toBe(0.5);
  });

  test('recall: B 1/2, M 1/1, A indefinido (null), C 0/1', () => {
    expect(recallPorNivel(esperados, obtidos)).toEqual({ BAIXO: 0.5, MODERADO: 1, ALTO: null, CRITICO: 0 });
  });

  test('kappa ponderado quadrático = 0,75', () => {
    // Pesos wij = (i − j)² / 9. Discordâncias observadas: B→M e C→A, ambas vizinhas:
    //   Σ w·O = 1/9 + 1/9 = 2/9
    // Marginais: linhas (esperado) B 2, M 1, A 0, C 1; colunas (obtido) B 1, M 2, A 1, C 0.
    // E = linha × coluna / 4, só nas células com peso > 0:
    //   B×M 1·(1/9) + B×A 0,5·(4/9) + M×B 0,25·(1/9) + M×A 0,25·(1/9)
    //   + C×B 0,25·(9/9) + C×M 0,5·(4/9) + C×A 0,25·(1/9)
    //   = (1 + 2 + 0,25 + 0,25 + 2,25 + 2 + 0,25) / 9 = 8/9
    // κw = 1 − (2/9) / (8/9) = 0,75
    expect(kappaPonderadoQuadratico(esperados, obtidos)).toBeCloseTo(0.75, 12);
  });
});

describe('kappa ponderado: propriedades', () => {
  test('inversão total da escala → −1', () => {
    // Observado: 2·(9/9) + 2·(1/9) = 20/9. Marginais todas 1, E = 1/4 em cada célula:
    // Σ w = (6·1 + 4·4 + 2·9) / 9 = 40/9 → Σ w·E = 10/9. κw = 1 − (20/9)/(10/9) = −1
    expect(kappaPonderadoQuadratico([B, M, A, C], [C, A, M, B])).toBeCloseTo(-1, 12);
  });

  test('erro distante pesa mais que erro vizinho', () => {
    const esperados = [B, M, A, C, B, M, A, C];
    const vizinho = [B, M, A, C, B, M, A, A];   // um CRÍTICO previsto como ALTO
    const distante = [B, M, A, C, B, M, A, B];  // um CRÍTICO previsto como BAIXO
    expect(acuracia(esperados, vizinho)).toBe(acuracia(esperados, distante));
    expect(kappaPonderadoQuadratico(esperados, vizinho)).toBeGreaterThan(kappaPonderadoQuadratico(esperados, distante));
  });

  test('indefinido (null) quando tudo cai num único nível', () => {
    expect(kappaPonderadoQuadratico([A, A, A], [A, A, A])).toBeNull();
  });
});

describe('validação das entradas', () => {
  test('listas de tamanhos diferentes', () => {
    expect(() => acuracia([B, M], [B])).toThrow(RangeError);
  });
  test('nível desconhecido', () => {
    expect(() => matrizConfusao([B], ['MEDIO'])).toThrow(/nível desconhecido/);
  });
  test('listas vazias', () => {
    expect(() => kappaPonderadoQuadratico([], [])).toThrow(RangeError);
  });
});
