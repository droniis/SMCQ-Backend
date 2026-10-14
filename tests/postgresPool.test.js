// ============================================================
// TESTES DO POOL POSTGRESQL (transações) E DO REPOSITÓRIO DE
// USUÁRIOS, SEM POSTGRESQL: o driver é substituído por um falso.
// ============================================================

// Pool e client falsos (prefixo "mock" exigido pelo jest.mock)
const mockClient = { consultas: [], falhar: new Set(), query: null, release: jest.fn() };
mockClient.query = jest.fn(async (sql) => {
  mockClient.consultas.push(sql);
  if (mockClient.falhar.has(sql)) throw new Error(`falha em ${sql}`);
  return { rows: [] };
});
const mockPool = { connect: jest.fn(async () => mockClient), on: jest.fn(), end: jest.fn(async () => {}), query: jest.fn() };

jest.mock('../db/conexao', () => ({
  criarPool: jest.fn(() => mockPool),
  explicarErroBanco: (err) => `explicado: ${err.message}`
}));

const conexao = require('../db/conexao');
const pool = require('../repositorios/postgres/pool');

beforeEach(() => {
  mockClient.consultas = [];
  mockClient.falhar = new Set();
  mockClient.release.mockClear();
});

describe('emTransacao', () => {
  test('sucesso: BEGIN → consultas → COMMIT, devolve o resultado e libera a conexão', async () => {
    const r = await pool.emTransacao(async (c) => { await c.query('INSERT 1'); return 'ok'; });
    expect(r).toBe('ok');
    expect(mockClient.consultas).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('erro: ROLLBACK, repassa o erro e libera a conexão', async () => {
    mockClient.falhar.add('INSERT 2');
    await expect(pool.emTransacao(async (c) => { await c.query('INSERT 1'); await c.query('INSERT 2'); }))
      .rejects.toThrow('falha em INSERT 2');
    expect(mockClient.consultas).toEqual(['BEGIN', 'INSERT 1', 'INSERT 2', 'ROLLBACK']);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('se o próprio ROLLBACK falhar (conexão perdida), o erro original é o que chega', async () => {
    mockClient.falhar.add('INSERT 1');
    mockClient.falhar.add('ROLLBACK');
    await expect(pool.emTransacao(async (c) => c.query('INSERT 1'))).rejects.toThrow('falha em INSERT 1');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

describe('obterPool e encerrar', () => {
  test('cria um único pool e registra o tratador de conexão ociosa perdida', () => {
    expect(pool.obterPool()).toBe(pool.obterPool());
    expect(conexao.criarPool).toHaveBeenCalledTimes(1);
    const [evento, tratador] = mockPool.on.mock.calls[0];
    expect(evento).toBe('error');
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
    tratador(new Error('servidor reiniciado'));
    expect(erro).toHaveBeenCalledWith('[banco] conexão ociosa perdida: explicado: servidor reiniciado');
    erro.mockRestore();
  });

  test('encerrar fecha o pool; o próximo uso cria outro', async () => {
    pool.obterPool();
    await pool.encerrar();
    expect(mockPool.end).toHaveBeenCalled();
    pool.obterPool();
    expect(conexao.criarPool).toHaveBeenCalledTimes(2);
  });
});

describe('usuarioRepositorio (PostgreSQL)', () => {
  const usuarios = require('../repositorios/postgres/usuarioRepositorio');

  test('buscarPorEmail devolve o usuário ativo com senhaHash, sem a coluna senha_hash', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1, nome: 'Admin', email: 'admin@smcq.com', senha_hash: '$2a$10$x', perfil: 'ADMINISTRADOR' }] });
    expect(await usuarios.buscarPorEmail('admin@smcq.com')).toEqual({ id: 1, nome: 'Admin', email: 'admin@smcq.com', perfil: 'ADMINISTRADOR', senhaHash: '$2a$10$x' });
    expect(mockPool.query.mock.calls[0][0]).toMatch(/WHERE email = \$1 AND ativo/);
  });

  test('e-mail não cadastrado → null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    expect(await usuarios.buscarPorEmail('x@y.com')).toBeNull();
  });
});
