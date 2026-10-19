// Testes do cache em memória com TTL (services/cacheService.js).
// O relógio é controlado pelos temporizadores falsos do Jest, que também substituem o Date.now.
const cache = require('../services/cacheService');

const LIMITE_ENTRADAS = 500; // o mesmo de cacheService.js

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-19T12:00:00Z') });
  cache.limpar();
});

afterEach(() => {
  cache.limpar();
  jest.useRealTimers();
});

describe('get e set', () => {
  test('devolve o valor guardado e null para chave inexistente', () => {
    cache.set('a', { bioma: 'CERRADO' });
    expect(cache.get('a')).toEqual({ bioma: 'CERRADO' });
    expect(cache.get('inexistente')).toBeNull();
  });

  test('guarda valores falsos (0, false, "") sem confundi-los com ausência', () => {
    cache.set('zero', 0);
    cache.set('falso', false);
    cache.set('vazio', '');
    expect(cache.get('zero')).toBe(0);
    expect(cache.get('falso')).toBe(false);
    expect(cache.get('vazio')).toBe('');
  });

  test('gravar de novo na mesma chave substitui o valor e renova o prazo', () => {
    cache.set('a', 1, 1000);
    jest.advanceTimersByTime(800);
    cache.set('a', 2, 1000);
    jest.advanceTimersByTime(800); // 1600 ms desde a 1ª gravação, 800 ms desde a 2ª
    expect(cache.get('a')).toBe(2);
    expect(cache.tamanho()).toBe(1);
  });
});

describe('prazo de validade (TTL)', () => {
  test('o TTL padrão é de 1 hora', () => {
    expect(cache.TTL_PADRAO_MS).toBe(60 * 60 * 1000);
    cache.set('a', 'valor');
    jest.advanceTimersByTime(cache.TTL_PADRAO_MS);
    expect(cache.get('a')).toBe('valor'); // exatamente no limite ainda vale
    jest.advanceTimersByTime(1);
    expect(cache.get('a')).toBeNull();
  });

  test('respeita um TTL informado na gravação', () => {
    cache.set('curto', 'x', 1000);
    jest.advanceTimersByTime(1001);
    expect(cache.get('curto')).toBeNull();
  });

  test('a entrada vencida sai do mapa quando é lida', () => {
    cache.set('a', 'x', 1000);
    cache.set('b', 'y', 5000);
    jest.advanceTimersByTime(2000);
    expect(cache.tamanho()).toBe(2); // vencida, mas ainda não lida
    expect(cache.get('a')).toBeNull();
    expect(cache.tamanho()).toBe(1);
    expect(cache.get('b')).toBe('y');
  });
});

describe('limpeza das entradas vencidas acima do limite', () => {
  test('abaixo do limite, as entradas vencidas e nunca lidas continuam no mapa', () => {
    for (let i = 0; i < 10; i++) cache.set(`velha-${i}`, i, 1000);
    jest.advanceTimersByTime(2000);
    cache.set('nova', 'n');
    expect(cache.tamanho()).toBe(11);
  });

  test('ao atingir o limite, a gravação seguinte remove só as vencidas', () => {
    // Metade das entradas vence em 1 s; a outra metade vale 1 hora
    for (let i = 0; i < LIMITE_ENTRADAS / 2; i++) cache.set(`velha-${i}`, i, 1000);
    for (let i = 0; i < LIMITE_ENTRADAS / 2; i++) cache.set(`atual-${i}`, i);
    expect(cache.tamanho()).toBe(LIMITE_ENTRADAS);

    jest.advanceTimersByTime(2000);
    cache.set('nova', 'n');

    expect(cache.tamanho()).toBe(LIMITE_ENTRADAS / 2 + 1);
    expect(cache.get('atual-0')).toBe(0);
    expect(cache.get('nova')).toBe('n');
  });

  test('no limite e sem vencidas, nada é removido e o mapa cresce', () => {
    for (let i = 0; i < LIMITE_ENTRADAS; i++) cache.set(`k-${i}`, i);
    cache.set('extra', 'e');
    expect(cache.tamanho()).toBe(LIMITE_ENTRADAS + 1);
    expect(cache.get('k-0')).toBe(0);
  });
});

describe('limpar e tamanho', () => {
  test('limpar esvazia o cache', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.tamanho()).toBe(2);
    cache.limpar();
    expect(cache.tamanho()).toBe(0);
    expect(cache.get('a')).toBeNull();
  });
});
