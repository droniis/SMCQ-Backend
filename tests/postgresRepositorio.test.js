// ============================================================
// TESTES DO REPOSITÓRIO POSTGRESQL, SEM POSTGRESQL
// O pool é substituído por um banco falso que guarda o que os
// INSERTs gravam e devolve nos SELECTs, convertendo os tipos como o
// driver "pg" faz (TIMESTAMPTZ → Date, JSONB → objeto). Assim se
// verifica que o alerta remontado das tabelas é IGUAL ao do
// repositório em memória (o contrato da API não muda) e que as
// gravações acontecem em transação.
// ============================================================
const { classificarComGeodados } = require('../services/classificacaoService');

// Banco falso (prefixo "mock" exigido pelo jest.mock)
const mockBanco = { tabelas: {}, consultas: [], parametros: [], falharEm: null, respostas: [] };

jest.mock('../repositorios/postgres/pool', () => {
  const bd = { query: (sql, params) => mockExecutar(sql, params) };
  return {
    obterPool: () => bd,
    // Mesmo protocolo do pool.js real (testado em postgresPool.test.js)
    emTransacao: async (fn) => {
      await bd.query('BEGIN');
      try {
        const r = await fn(bd);
        await bd.query('COMMIT');
        return r;
      } catch (err) {
        await bd.query('ROLLBACK');
        throw err;
      }
    },
    encerrar: async () => {}
  };
});

const JSONB = ['geodados', 'detalhe', 'valor_anterior', 'valor_novo'];
// Converte como o driver: JSONB chega como objeto e TIMESTAMPTZ como Date
function comoPg(linha) {
  const r = { ...linha };
  for (const [k, v] of Object.entries(r)) {
    if (JSONB.includes(k)) r[k] = v === null ? null : JSON.parse(v);
    else if (k.endsWith('_em')) r[k] = v ? new Date(v) : null;
  }
  return r;
}

async function mockExecutar(sql, params = []) {
  const texto = sql.replace(/\s+/g, ' ').trim();
  mockBanco.consultas.push(texto);
  mockBanco.parametros.push(params);
  if (mockBanco.falharEm && texto.includes(mockBanco.falharEm)) {
    throw Object.assign(new Error(`falha simulada em ${mockBanco.falharEm}`), { code: '23514' });
  }
  if (mockBanco.respostas.length && mockBanco.respostas[0].quando.test(texto)) {
    const { resultado, erro } = mockBanco.respostas.shift();
    if (erro) throw erro;
    return resultado;
  }
  const t = mockBanco.tabelas;

  const insert = texto.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/);
  if (insert) {
    const [, tabela, colunas] = insert;
    const linha = Object.fromEntries(colunas.split(',').map((c, i) => [c.trim(), params[i] ?? null]));
    if (tabela === 'alerta') Object.assign(linha, { id: 7, excluido: false, excluido_em: null, excluido_por: null });
    if (tabela === 'classificacao_risco') linha.id = 70;
    (t[tabela] = t[tabela] || []).push(linha);
    return { rows: linha.id ? [{ id: linha.id }] : [], rowCount: 1 };
  }
  if (texto.startsWith('SELECT a.*')) {
    if (!t.alerta) return { rows: [] };
    const { alerta_id: _l, ...local } = t.localizacao[0];
    const { alerta_id: _f, ...fator } = t.fator_risco[0];
    const c = t.classificacao_risco[0];
    return { rows: [comoPg({ ...t.alerta[0], ...local, ...fator, classificacao_id: c.id, versao_algoritmo: c.versao_algoritmo, irs: c.irs, sigmoide: c.sigmoide, nivel: c.nivel })] };
  }
  const leitura = texto.match(/^SELECT \* FROM (\w+)/);
  if (leitura) return { rows: (t[leitura[1]] || []).map(comoPg) };
  return { rows: [], rowCount: 0 };
}

// Alerta como o server.js o monta, com o resultado real do IRS v2 (sem rede: geodados null → fallback)
function dadosDoAlerta() {
  const entrada = { latitude: -16.68, longitude: -56.67, areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true, zonaUrbana: false, direcaoVento: 45, dA_dt: 0 };
  const risco = classificarComGeodados(entrada, { bioma: 'PANTANAL', tipoArea: null }, null);
  const criadoEm = '2026-10-14T12:00:00.123Z';
  // Campos na mesma ordem em que o POST /api/alertas os monta
  return {
    titulo: 'Queimada', descricao: '', tipoOcorrencia: 'QUEIMADA_VEGETACAO', status: 'NOVO', ...risco,
    geodados: { fontes: { bioma: 'IBGE WFS' }, obtidoEm: { bioma: criadoEm }, bioma: 'PANTANAL' },
    direcaoVento: entrada.direcaoVento, dA_dt: entrada.dA_dt, latitude: entrada.latitude, longitude: entrada.longitude,
    estado: 'MT', municipio: 'Poconé', cep: '', logradouro: '', numero: '', bairro: '',
    areaAfetada: entrada.areaAfetada, zonaUrbana: entrada.zonaUrbana, vento: entrada.vento, pessoasRisco: entrada.pessoasRisco,
    criadoPor: 2, criadoEm, atualizadoEm: criadoEm,
    historico: [{ campo: 'status', valorAnterior: null, valorNovo: 'NOVO', alteradoPor: 2, alteradoEm: criadoEm }],
    solicitacoesExclusao: [], excluido: false, excluidoEm: null
  };
}

let pg;
let memoria;

beforeAll(() => {
  pg = require('../repositorios/postgres/alertaRepositorio');
  memoria = require('../repositorios/memoria/alertaRepositorio');
});

beforeEach(() => {
  Object.assign(mockBanco, { tabelas: {}, consultas: [], parametros: [], falharEm: null, respostas: [] });
});

describe('criar: ida e volta pelas tabelas', () => {
  test('o alerta remontado do banco é igual ao do repositório em memória (mesmos campos, na mesma ordem)', async () => {
    const doBanco = await pg.criar(dadosDoAlerta());
    const daMemoria = await memoria.criar(dadosDoAlerta());
    expect(doBanco).toEqual({ ...daMemoria, id: 7 });
    expect(Object.keys(doBanco)).toEqual(Object.keys(daMemoria));
    expect(Object.keys(doBanco.detalhes)).toEqual(Object.keys(daMemoria.detalhes)); // ordem dos 9 critérios
  });

  test('grava cada parte na sua tabela, tudo dentro de uma transação', async () => {
    await pg.criar(dadosDoAlerta());
    const t = mockBanco.tabelas;
    expect(mockBanco.consultas[0]).toBe('BEGIN');
    expect(mockBanco.consultas).toContain('COMMIT');
    expect(t.alerta).toHaveLength(1);
    expect(t.alerta[0]).toMatchObject({ titulo: 'Queimada', tipo_ocorrencia: 'QUEIMADA_VEGETACAO' });
    expect(t.localizacao[0]).toMatchObject({ alerta_id: 7, latitude: -16.68, municipio: 'Poconé' });
    expect(t.fator_risco[0]).toMatchObject({ alerta_id: 7, area_afetada: 'GRANDE', bioma: 'PANTANAL', bioma_origem: 'informado' });
    expect(t.classificacao_risco[0]).toMatchObject({ alerta_id: 7, versao_algoritmo: 'IRS v2' });
    expect(t.contribuicao_criterio).toHaveLength(9);
    expect(t.historico_status).toEqual([expect.objectContaining({ alerta_id: 7, campo: 'status', valor_anterior: null, valor_novo: '"NOVO"' })]);
  });

  test('falha no meio da gravação → ROLLBACK e o erro chega a quem chamou', async () => {
    mockBanco.falharEm = 'INSERT INTO contribuicao_criterio';
    await expect(pg.criar(dadosDoAlerta())).rejects.toMatchObject({ code: '23514' });
    expect(mockBanco.consultas).toContain('ROLLBACK');
    expect(mockBanco.consultas).not.toContain('COMMIT');
  });

  test('INCENDIO_URBANO volta do banco com o tipo gravado', async () => {
    const doBanco = await pg.criar({ ...dadosDoAlerta(), tipoOcorrencia: 'INCENDIO_URBANO', zonaUrbana: true });
    expect(doBanco.tipoOcorrencia).toBe('INCENDIO_URBANO');
    expect(doBanco.zonaUrbana).toBe(true);
  });
});

describe('listarAtivos: filtro por tipo de ocorrência', () => {
  const consultaPrincipal = () => {
    const i = mockBanco.consultas.findIndex(c => c.startsWith('SELECT a.*'));
    return { sql: mockBanco.consultas[i], params: mockBanco.parametros[i] };
  };

  test('com tipoOcorrencia → WHERE a.tipo_ocorrencia = $1, parametrizado', async () => {
    await pg.listarAtivos({ tipoOcorrencia: 'INCENDIO_URBANO' });
    const { sql, params } = consultaPrincipal();
    expect(sql).toContain('WHERE NOT a.excluido AND a.tipo_ocorrencia = $1');
    expect(params).toEqual(['INCENDIO_URBANO']);
  });

  test('sem filtro → só os não excluídos, sem parâmetros', async () => {
    await pg.listarAtivos();
    const { sql, params } = consultaPrincipal();
    expect(sql).toContain('WHERE NOT a.excluido ORDER BY');
    expect(sql).not.toContain('tipo_ocorrencia =');
    expect(params).toEqual([]);
  });
});

describe('alterações em alerta inexistente ou excluído devolvem null (→ 404), sem gravar nada', () => {
  test.each([
    ['atualizarStatus', () => pg.atualizarStatus(1, 'RESOLVIDO', 1)],
    ['adicionarObservacao', () => pg.adicionarObservacao(1, 'x', 1)],
    ['excluir', () => pg.excluir(1, 1)],
    ['avaliarSolicitacao', () => pg.avaliarSolicitacao(1, 1, 'APROVADA', '', 1)]
  ])('%s', async (_nome, operacao) => {
    expect(await operacao()).toBeNull();
    expect(mockBanco.consultas.some(c => /^(INSERT|UPDATE)/.test(c))).toBe(false);
    expect(mockBanco.consultas).toContain('COMMIT');
  });

  test('buscarAtivo e listarAtivos sem alertas', async () => {
    expect(await pg.buscarAtivo(1)).toBeNull();
    expect(await pg.listarAtivos()).toEqual([]);
  });
});

describe('alterações de um alerta existente', () => {
  beforeEach(async () => {
    await pg.criar(dadosDoAlerta());
    mockBanco.consultas = [];
  });

  test('atualizarStatus grava o status e o histórico (valor anterior lido com o alerta travado)', async () => {
    mockBanco.respostas.push({ quando: /FOR UPDATE/, resultado: { rows: [{ status: 'NOVO' }], rowCount: 1 } });
    await pg.atualizarStatus(7, 'EM_ANALISE', 3);
    expect(mockBanco.consultas.some(c => c.startsWith('UPDATE alerta SET status'))).toBe(true);
    expect(mockBanco.tabelas.historico_status[1]).toMatchObject({ campo: 'status', valor_anterior: '"NOVO"', valor_novo: '"EM_ANALISE"', alterado_por: 3 });
  });

  test('excluir: exclusão lógica, histórico "excluido" e aprovação das pendentes na mesma transação', async () => {
    mockBanco.respostas.push({ quando: /FOR UPDATE/, resultado: { rows: [{}], rowCount: 1 } });
    await pg.excluir(7, 1);
    const c = mockBanco.consultas;
    expect(c[0]).toBe('BEGIN');
    expect(c.some(q => q.startsWith('UPDATE alerta SET excluido = TRUE'))).toBe(true);
    expect(c.some(q => q.startsWith("UPDATE solicitacao_exclusao SET status = 'APROVADA'"))).toBe(true);
    expect(mockBanco.tabelas.historico_status[1]).toMatchObject({ campo: 'excluido', valor_anterior: 'false', valor_novo: 'true' });
    expect(c[c.length - 1]).toBe('COMMIT');
  });

  test('adicionarObservacao grava a observação e atualiza a data do alerta', async () => {
    mockBanco.respostas.push({ quando: /FOR UPDATE/, resultado: { rows: [{}], rowCount: 1 } });
    const alerta = await pg.adicionarObservacao(7, 'equipe a caminho', 2);
    expect(alerta.observacoes).toEqual([expect.objectContaining({ texto: 'equipe a caminho', criadoPor: 2 })]);
  });

  test('avaliarSolicitacao aprovada exclui o alerta na mesma transação', async () => {
    const linha = { id: 5, solicitado_por: 2, motivo: 'm', status: 'APROVADA', criado_em: new Date(), resolvido_em: new Date(), resolvido_por: 1, resposta: 'ok' };
    mockBanco.respostas.push(
      { quando: /FOR UPDATE/, resultado: { rows: [{}], rowCount: 1 } },
      { quando: /^UPDATE solicitacao_exclusao/, resultado: { rows: [linha], rowCount: 1 } }
    );
    const s = await pg.avaliarSolicitacao(7, 5, 'APROVADA', 'ok', 1);
    expect(s).toMatchObject({ id: 5, status: 'APROVADA', resolvidoPor: 1, resposta: 'ok' });
    expect(mockBanco.consultas.some(q => q.startsWith('UPDATE alerta SET excluido = TRUE'))).toBe(true);
  });
});

describe('solicitações de exclusão', () => {
  test('índice único violado (pedidos simultâneos) → erro SOLICITACAO_PENDENTE (→ 409)', async () => {
    const violacao = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_solic_pendente' });
    mockBanco.respostas.push({ quando: /^INSERT INTO solicitacao_exclusao/, erro: violacao });
    await expect(pg.criarSolicitacao(7, 2, 'motivo')).rejects.toMatchObject({ code: 'SOLICITACAO_PENDENTE' });
  });

  test('outro erro do banco é repassado sem alteração', async () => {
    const outro = Object.assign(new Error('fora do ar'), { code: 'ECONNREFUSED' });
    mockBanco.respostas.push({ quando: /^INSERT INTO solicitacao_exclusao/, erro: outro });
    await expect(pg.criarSolicitacao(7, 2, 'motivo')).rejects.toBe(outro);
  });

  test('criarSolicitacao em alerta inexistente → null', async () => {
    mockBanco.respostas.push({ quando: /^INSERT INTO solicitacao_exclusao/, resultado: { rows: [], rowCount: 0 } });
    expect(await pg.criarSolicitacao(99, 2, 'motivo')).toBeNull();
  });

  test('listarSolicitacoes devolve o formato da API, com datas ISO e nomes', async () => {
    const criado = new Date('2026-10-14T10:00:00.000Z');
    mockBanco.respostas.push({
      quando: /FROM solicitacao_exclusao s/,
      resultado: { rows: [{ id: 1, alerta_id: 7, solicitado_por: 2, motivo: 'm', status: 'PENDENTE', criado_em: criado, resolvido_em: null, resolvido_por: null, resposta: '', alerta_titulo: 'Queimada', alerta_excluido: false, solicitado_por_nome: 'Operador', resolvido_por_nome: null }] }
    });
    expect(await pg.listarSolicitacoes({ solicitadoPor: 2, status: 'PENDENTE' })).toEqual([{
      id: 1, solicitadoPor: 2, motivo: 'm', status: 'PENDENTE', criadoEm: '2026-10-14T10:00:00.000Z', resolvidoEm: null,
      resolvidoPor: null, resposta: '', alertaId: 7, alertaTitulo: 'Queimada', alertaExcluido: false,
      solicitadoPorNome: 'Operador', resolvidoPorNome: null
    }]);
  });
});

describe('repositorios/index.js com PERSISTENCIA=postgres', () => {
  let repos;
  const ambiente = { ...process.env };

  beforeAll(() => {
    process.env.PERSISTENCIA = 'postgres';
    process.env.DB_PASSWORD = 'senha-ficticia';
    jest.isolateModules(() => { repos = require('../repositorios'); });
  });
  afterAll(() => { process.env = ambiente; });
  afterEach(() => jest.restoreAllMocks());

  test('usa os repositórios PostgreSQL', () => {
    expect(repos.tipo).toBe('postgres');
    expect(typeof repos.alertas.criar).toBe('function');
  });

  test('verificarConexao: banco sem usuários → avisa para rodar db:seed', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockBanco.respostas.push({ quando: /FROM usuario/, resultado: { rows: [{ total: 0 }] } });
    expect(await repos.verificarConexao()).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PostgreSQL conectado'));
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('npm run db:seed'));
  });

  test('verificarConexao: banco fora do ar → explica no log e não derruba o servidor', async () => {
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockBanco.respostas.push({ quando: /FROM usuario/, erro: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
    expect(await repos.verificarConexao()).toBe(false);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('PostgreSQL inacessível'));
  });
});
