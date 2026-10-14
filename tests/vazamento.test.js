// Teste de vazamento de dados da validação do IRS.
// As entradas do IRS e da linha de base só podem usar o dia 0 (e o dia −1, para dA/dt).
// Os focos dos dias 1 a 7 servem apenas para o gabarito.
const A = require('../scripts/validacao/amostra');
const { calcularRiscoAvancadoV2 } = require('../services/riscoService');
const { calcularLinhaBase } = require('../services/linhaBaseService');

// Desloca um ponto `km` quilômetros para o norte (1° de latitude ≈ 111,195 km)
const aoNorte = (lat, km) => lat + km / 111.195;

const DIA0 = '2026-08-15';
const FOCO = { id: 'f0', lat: -10, lon: -55, dia: DIA0, bioma: 'Amazônia' };
const CLIMA = { velocidadeKmh: 25, direcaoGraus: 200 };
const GEO = { bioma: 'AMAZONIA', unidadeConservacao: null, terraIndigena: null, faixaAreaProtegida: '>50 km', fauna: { total: 0, nivel: 'SEM_ESPECIES' }, focos: { total: 99 }, fontes: {} };

const foco = (id, dia, km = 0) => ({ id, lat: aoNorte(FOCO.lat, km), lon: FOCO.lon, dia });

// Passado e presente: 2 focos a até 1 km no dia 0 (além do próprio) e 1 no dia −1
const PASSADO = [
  FOCO,
  foco('h1', DIA0, 0.5),
  foco('h2', DIA0, 0.9),
  foco('h3', DIA0, 5),      // mesmo dia, fora do raio de 1 km
  foco('o1', '2026-08-14', 0.3),
  foco('o2', '2026-08-10', 0.1)
];
// Futuro: focos que só podem entrar no gabarito
const FUTURO = [
  foco('d1', '2026-08-16', 0.1),
  foco('d2', '2026-08-16', 0.2),
  foco('d3', '2026-08-18', 3),
  foco('d7', '2026-08-22', 9.9),
  foco('d7b', '2026-08-22', 10.5), // fora do raio de 10 km
  foco('d8', '2026-08-23', 1)      // dia 8: fora da janela
];

function entradasCom(focos) {
  const indice = A.criarIndice(focos);
  return A.montarEntradasDia0(FOCO, indice.ate(DIA0), CLIMA, GEO);
}

describe('vazamento de dados: entradas do dia 0', () => {
  test('acrescentar ou remover focos FUTUROS não muda as entradas, o IRS nem a linha de base', () => {
    const sem = entradasCom(PASSADO);
    // Muitos focos futuros colados ao ponto, em todos os dias seguintes
    const muitosFuturos = Array.from({ length: 70 }, (_, i) => foco(`x${i}`, A.somarDias(DIA0, 1 + (i % 7)), (i % 10) / 20));
    const com = entradasCom([...PASSADO, ...FUTURO, ...muitosFuturos]);

    expect(com).toEqual(sem);
    expect(calcularRiscoAvancadoV2(com.alerta, com.geodados)).toEqual(calcularRiscoAvancadoV2(sem.alerta, sem.geodados));
    expect(calcularLinhaBase(com.alerta, com.geodados)).toEqual(calcularLinhaBase(sem.alerta, sem.geodados));
  });

  test('a visão do dia 0 recusa qualquer consulta a dia posterior', () => {
    const visao = A.criarIndice([...PASSADO, ...FUTURO]).ate(DIA0);
    expect(() => visao.contarNoDia('2026-08-16', FOCO.lat, FOCO.lon, 1)).toThrow(/vazamento de dados/);
    expect(() => visao.contarNoDia(DIA0, FOCO.lat, FOCO.lon, 1)).not.toThrow();
  });

  test('montarEntradasDia0 exige uma visão que termine exatamente no dia 0', () => {
    const indice = A.criarIndice([...PASSADO, ...FUTURO]);
    expect(() => A.montarEntradasDia0(FOCO, indice.ate('2026-08-22'), CLIMA, GEO)).toThrow(/dia 0/);
  });

  test('área afetada: conta o foco e os vizinhos a até 1 km no mesmo dia', () => {
    const { alerta, proxies } = entradasCom(PASSADO);
    expect(proxies.nFocos1kmDia0).toBe(3); // f0, h1, h2 (h3 está a 5 km)
    expect(alerta.areaAfetada).toBe('MEDIA');
  });

  test('dA/dt usa só o PASSADO: (focos a 1 km no dia 0) − (no dia −1), mínimo 0', () => {
    const { alerta, proxies } = entradasCom([...PASSADO, ...FUTURO]);
    expect(proxies.nFocos1kmDiaAnterior).toBe(1); // o1; o2 é do dia −5
    expect(alerta.dA_dt).toBe(3 - 1);

    // Mudar o dia −1 muda dA/dt...
    const maisOntem = entradasCom([...PASSADO, foco('o3', '2026-08-14', 0.2), foco('o4', '2026-08-14', 0.4), foco('o5', '2026-08-14', 0.6)]);
    expect(maisOntem.alerta.dA_dt).toBe(0); // 3 − 4 < 0 → 0
    // ...mudar o dia +1 não
    const maisAmanha = entradasCom([...PASSADO, foco('a1', '2026-08-16', 0.2), foco('a2', '2026-08-16', 0.4)]);
    expect(maisAmanha.alerta.dA_dt).toBe(2);
  });

  test('os focos "recentes" do geodadosService (data da consulta) não chegam ao IRS', () => {
    const { geodados } = entradasCom(PASSADO);
    expect(geodados.focos).toBeUndefined();
    expect(geodados.bioma).toBe('AMAZONIA');
    expect(geodados.fonteBioma).toBe('INPE CSV');
  });

  test('entradas não carregam nenhuma informação do gabarito', () => {
    const { alerta, geodados } = entradasCom([...PASSADO, ...FUTURO]);
    const texto = JSON.stringify({ alerta, geodados });
    expect(texto).not.toMatch(/gabarito/i);
  });
});

describe('gabarito', () => {
  test('conta OUTROS focos a até 10 km nos dias 1 a 7, e nada do dia 0 ou do passado', () => {
    const indice = A.criarIndice([...PASSADO, ...FUTURO]);
    // d1, d2, d3, d7 → 4 (d7b fora do raio; d8 fora da janela; dia 0 e passado ignorados)
    expect(A.calcularGabarito(FOCO, indice)).toBe(4);
  });

  test('é o futuro que muda o gabarito', () => {
    expect(A.calcularGabarito(FOCO, A.criarIndice(PASSADO))).toBe(0);
  });
});

describe('vento: conversão da convenção meteorológica', () => {
  test('direção de onde vem + 180° = direção para onde sopra', () => {
    expect(A.direcaoParaOndeSopra(0)).toBe(180);   // vento norte sopra para o sul
    expect(A.direcaoParaOndeSopra(200)).toBe(20);
    expect(A.direcaoParaOndeSopra(270)).toBe(90);  // vento oeste sopra para o leste
    expect(entradasCom(PASSADO).alerta.direcaoVento).toBe(20);
  });

  test('faixas de Beaufort: < 20 BAIXO · 20 a < 39 MODERADO · ≥ 39 ALTO', () => {
    expect(A.classificarVento(19.9)).toBe('BAIXO');
    expect(A.classificarVento(20)).toBe('MODERADO');
    expect(A.classificarVento(38.9)).toBe('MODERADO');
    expect(A.classificarVento(39)).toBe('ALTO');
  });
});

describe('sorteio e quartis', () => {
  test('mesma semente → mesma amostra, independente da ordem de entrada', () => {
    const itens = Array.from({ length: 100 }, (_, i) => ({ id: `id${String(i).padStart(3, '0')}` }));
    const a = A.sortear(itens, 10, A.geradorAleatorio(42)).map(i => i.id);
    const b = A.sortear([...itens].reverse(), 10, A.geradorAleatorio(42)).map(i => i.id);
    const c = A.sortear(itens, 10, A.geradorAleatorio(43)).map(i => i.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(10);
  });

  test('quartis por interpolação linear (método 7) e faixas', () => {
    // 1..8: h = 7p → Q1 = 2,75 · Q2 = 4,5 · Q3 = 6,25
    expect(A.limitesQuartis([8, 1, 2, 3, 4, 5, 6, 7])).toEqual({ q1: 2.75, q2: 4.5, q3: 6.25 });
    const q = { q1: 2.75, q2: 4.5, q3: 6.25 };
    expect([1, 3, 5, 7].map(n => A.nivelGabarito(n, q))).toEqual(['BAIXO', 'MODERADO', 'ALTO', 'CRITICO']);
  });
});
