// Testes das funções de scripts/analises/estatisticas.js, com casos calculados à mão.
const E = require('../scripts/analises/estatisticas');
const { geradorAleatorio } = require('../scripts/validacao/amostra');

const NIVEIS = ['B', 'M', 'A', 'C'];

describe('precisão, recall e F1 por classe', () => {
  // esperados: B B M C      obtidos: B M M A
  const r = E.metricasPorClasse(['B', 'B', 'M', 'C'], ['B', 'M', 'M', 'A'], NIVEIS);

  test('valores calculados à mão', () => {
    expect(r.porClasse.B).toEqual({ reais: 2, previstos: 1, acertos: 1, precisao: 1, recall: 0.5, f1: 2 / 3 });
    expect(r.porClasse.M.precisao).toBe(0.5);
    expect(r.porClasse.M.recall).toBe(1);
    expect(r.porClasse.M.f1).toBeCloseTo(2 / 3, 12);
  });

  test('classe sem previsões: precisão null e F1 0; classe ausente do gabarito: recall null', () => {
    expect(r.porClasse.C).toEqual({ reais: 1, previstos: 0, acertos: 0, precisao: null, recall: 0, f1: 0 });
    expect(r.porClasse.A).toEqual({ reais: 0, previstos: 1, acertos: 0, precisao: 0, recall: null, f1: 0 });
  });

  test('F1 macro = média simples dos F1 das classes', () => {
    expect(r.f1Macro).toBeCloseTo((2 / 3 + 2 / 3 + 0 + 0) / 4, 12);
  });

  test('concordância perfeita: tudo 1', () => {
    const p = E.metricasPorClasse(NIVEIS, NIVEIS, NIVEIS);
    expect(p.f1Macro).toBe(1);
  });
});

describe('kappa de Cohen', () => {
  test('perfeito = 1; indefinido com uma só classe', () => {
    expect(E.kappaCohen(['s', 'n', 's'], ['s', 'n', 's'], ['n', 's'])).toBe(1);
    expect(E.kappaCohen(['s', 's'], ['s', 's'], ['n', 's'])).toBeNull();
  });

  test('caso à mão: po = 0,5; pe = 0,5 → κ = 0', () => {
    expect(E.kappaCohen(['s', 's', 'n', 'n'], ['s', 'n', 's', 'n'], ['n', 's'])).toBe(0);
  });
});

describe('AUC', () => {
  test('separação perfeita = 1; invertida = 0', () => {
    expect(E.auc([0.1, 0.2, 0.8, 0.9], [false, false, true, true])).toBe(1);
    expect(E.auc([0.9, 0.8, 0.2, 0.1], [false, false, true, true])).toBe(0);
  });

  test('escores todos iguais = 0,5 (empates valem meio ponto)', () => {
    expect(E.auc([0.5, 0.5, 0.5, 0.5], [true, false, true, false])).toBe(0.5);
    expect(E.paresEmpatados([0.5, 0.5, 0.5, 0.5], [true, false, true, false])).toBe(4);
  });

  test('caso à mão com um empate: pares (p,n) = 4, vitórias 2 + empate 0,5 → 0,625', () => {
    // positivos 0,3 e 0,6; negativos 0,3 e 0,4
    expect(E.auc([0.3, 0.6, 0.3, 0.4], [true, true, false, false])).toBe(0.625);
  });

  test('sem positivos (ou sem negativos) = null', () => {
    expect(E.auc([1, 2], [false, false])).toBeNull();
  });
});

describe('Spearman', () => {
  test('monotônica = 1; invertida = −1; constante = null', () => {
    expect(E.spearman([1, 2, 3, 4], [10, 20, 30, 1000])).toBeCloseTo(1, 12);
    expect(E.spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    expect(E.spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  test('postos médios nos empates', () => {
    expect(E.postosMedios([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe('bootstrap por agrupamento', () => {
  const valores = [1, 2, 3, 4, 5, 6, 7, 8];
  const grupos = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd'];
  const media = (idx) => ({ media: idx.reduce((s, i) => s + valores[i], 0) / idx.length });

  test('reprodutível com a mesma semente', () => {
    const r1 = E.bootstrap({ n: 8, estatisticas: media, reamostragens: 200, semente: 42, grupos });
    const r2 = E.bootstrap({ n: 8, estatisticas: media, reamostragens: 200, semente: 42, grupos });
    expect(r1).toEqual(r2);
    expect(r1.grupos).toBe(4);
  });

  test('semente diferente muda o resultado', () => {
    const r1 = E.bootstrap({ n: 8, estatisticas: media, reamostragens: 200, semente: 42, grupos });
    const r2 = E.bootstrap({ n: 8, estatisticas: media, reamostragens: 200, semente: 43, grupos });
    expect(r1.intervalos.media).not.toEqual(r2.intervalos.media);
  });

  test('não depende da ordem dos itens (grupos ordenados pelo rótulo)', () => {
    const ordem = [7, 6, 5, 4, 3, 2, 1, 0];
    const v2 = ordem.map(i => valores[i]);
    const g2 = ordem.map(i => grupos[i]);
    const media2 = (idx) => ({ media: idx.reduce((s, i) => s + v2[i], 0) / idx.length });
    // Dentro do grupo a ordem muda, mas a média de cada réplica não
    const r1 = E.bootstrap({ n: 8, estatisticas: media, reamostragens: 100, semente: 7, grupos });
    const r2 = E.bootstrap({ n: 8, estatisticas: media2, reamostragens: 100, semente: 7, grupos: g2 });
    expect(r2.intervalos).toEqual(r1.intervalos);
  });

  test('cada réplica sorteia grupos inteiros', () => {
    const vistos = [];
    E.bootstrap({ n: 8, estatisticas: (idx) => { vistos.push(idx); return {}; }, reamostragens: 50, semente: 1, grupos });
    for (const idx of vistos) {
      expect(idx).toHaveLength(8);
      for (let k = 0; k < idx.length; k += 2) expect(grupos[idx[k]]).toBe(grupos[idx[k + 1]]);
    }
  });

  test('sem grupos: mesmo sorteio do bootstrap de validar-irs.js', () => {
    const aleatorio = geradorAleatorio(20261025);
    const esperado = Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => Math.floor(aleatorio() * 8)));
    const vistos = [];
    E.bootstrap({ n: 8, estatisticas: (idx) => { vistos.push(idx); return {}; }, reamostragens: 3, semente: 20261025 });
    expect(vistos).toEqual(esperado);
  });

  test('intervalo percentil e descarte de valores null', () => {
    const r = E.bootstrap({ n: 2, estatisticas: () => ({ x: null }), reamostragens: 10, semente: 1 });
    expect(r.intervalos.x).toBeUndefined();
    const valoresIc = Array.from({ length: 101 }, (_, i) => i);
    expect(E.intervaloPercentil(valoresIc).ic95).toEqual([2, 98]);
  });
});

describe('limiares por quantis e partição estratificada', () => {
  test('proporções 2/1/1 em 8 escores', () => {
    const escores = [1, 2, 3, 4, 5, 6, 7, 8];
    const limiares = E.limiaresPorQuantis(escores, [4, 2, 2]);
    expect(limiares).toEqual([4.5, 6.25]);
    const niveis = escores.map(s => E.classificarPorLimiares(s, limiares, ['B', 'M', 'A']));
    expect(niveis).toEqual(['B', 'B', 'B', 'B', 'M', 'M', 'A', 'A']);
  });

  test('empate com o limite fica no nível de baixo', () => {
    expect(E.classificarPorLimiares(2, [2, 5], ['B', 'M', 'A'])).toBe('B');
    expect(E.classificarPorLimiares(5.01, [2, 5], ['B', 'M', 'A'])).toBe('A');
  });

  test('partição estratificada: classes repartidas e reprodutível', () => {
    const rotulos = [...Array(10).fill('x'), ...Array(5).fill('y')];
    const p = E.particaoEstratificada(rotulos, 5, 3);
    expect(p).toEqual(E.particaoEstratificada(rotulos, 5, 3));
    for (let k = 0; k < 5; k++) {
      expect(rotulos.filter((r, i) => r === 'x' && p[i] === k)).toHaveLength(2);
      expect(rotulos.filter((r, i) => r === 'y' && p[i] === k)).toHaveLength(1);
    }
  });

  test('resumo: mínimo, quartis e máximo', () => {
    expect(E.resumo([1, 2, 3, 4, 5])).toEqual({ n: 5, minimo: 1, q1: 2, mediana: 3, q3: 4, maximo: 5, valoresDistintos: 5 });
  });
});

describe('curva ROC', () => {
  test('separação perfeita: sobe até TPR = 1 antes de qualquer falso positivo', () => {
    const pontos = E.curvaRoc([0.9, 0.8, 0.2, 0.1], [true, true, false, false]);
    expect(pontos.map(p => [p.fpr, p.tpr])).toEqual([[0, 0], [0, 0.5], [0, 1], [0.5, 1], [1, 1]]);
    expect(E.areaTrapezio(pontos)).toBe(1);
  });

  test('empates formam um único passo e a área coincide com a AUC de Mann–Whitney', () => {
    const escores = [0.5, 0.5, 0.7, 0.3, 0.5, 0.9, 0.1];
    const positivos = [true, false, true, false, true, false, false];
    const pontos = E.curvaRoc(escores, positivos);
    expect(pontos).toHaveLength(1 + new Set(escores).size);
    expect(E.areaTrapezio(pontos)).toBeCloseTo(E.auc(escores, positivos), 12);
  });

  test('sem positivos ou sem negativos: null', () => {
    expect(E.curvaRoc([1, 2], [true, true])).toBeNull();
  });
});
