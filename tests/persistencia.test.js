// ============================================================
// TESTES DA CAMADA DE PERSISTÊNCIA
// Escolha da implementação, cópias defensivas do repositório em
// memória e respostas da API quando o banco falha (503 / 400 / 500).
// Não dependem do PostgreSQL: as falhas do banco são simuladas.
// ============================================================
const request = require('supertest');
const { ehErroDeConexao } = require('../db/conexao');

let app;
let repositorios;
let token;

const erroComCodigo = (code, message = `erro ${code}`) => Object.assign(new Error(message), { code });

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  app = require('../server');
  repositorios = require('../repositorios');
  const r = await request(app).post('/api/login').send({ email: 'admin@smcq.com', senha: 'admin123' });
  token = r.body.token;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => jest.restoreAllMocks());

describe('escolha da persistência', () => {
  test('os testes usam a implementação em memória', () => {
    expect(repositorios.tipo).toBe('memoria');
  });

  test('PERSISTENCIA inválida impede a inicialização com mensagem clara', () => {
    const anterior = process.env.PERSISTENCIA;
    process.env.PERSISTENCIA = 'mysql';
    try {
      jest.isolateModules(() => {
        expect(() => require('../repositorios')).toThrow('PERSISTENCIA inválida: "mysql". Use postgres ou memoria.');
      });
    } finally {
      process.env.PERSISTENCIA = anterior;
    }
  });

  test('PERSISTENCIA=postgres sem DB_PASSWORD impede a inicialização', () => {
    const anterior = { ...process.env };
    process.env.PERSISTENCIA = 'postgres';
    delete process.env.DB_PASSWORD;
    try {
      jest.isolateModules(() => {
        jest.doMock('dotenv', () => ({ config: () => ({}) })); // ignora um .env local com a senha
        expect(() => require('../repositorios')).toThrow('DB_PASSWORD não definida');
      });
    } finally {
      process.env = anterior;
    }
  });
});

describe('repositório em memória', () => {
  const dados = (campos = {}) => ({
    titulo: 'teste', descricao: '', status: 'NOVO', latitude: -16, longitude: -56, criadoPor: 1,
    criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
    historico: [], solicitacoesExclusao: [], excluido: false, excluidoEm: null, ...campos
  });

  test('devolve cópias: alterar o objeto devolvido não altera o que está guardado', async () => {
    const criado = await repositorios.alertas.criar(dados());
    criado.status = 'RESOLVIDO';
    criado.historico.push({ campo: 'falso' });
    const guardado = await repositorios.alertas.buscarAtivo(criado.id);
    expect(guardado.status).toBe('NOVO');
    expect(guardado.historico).toEqual([]);
  });

  test('não aceita duas solicitações pendentes para o mesmo alerta', async () => {
    const { id } = await repositorios.alertas.criar(dados());
    await repositorios.alertas.criarSolicitacao(id, 2, 'primeira');
    await expect(repositorios.alertas.criarSolicitacao(id, 2, 'segunda')).rejects.toMatchObject({ code: 'SOLICITACAO_PENDENTE' });
  });

  test('atualizarStatus recusa transição proibida sem alterar o alerta', async () => {
    const { id } = await repositorios.alertas.criar(dados());
    await expect(repositorios.alertas.atualizarStatus(id, 'RESOLVIDO', 1)).rejects.toMatchObject({ code: 'TRANSICAO_INVALIDA' });
    await expect(repositorios.alertas.atualizarStatus(id, 'NOVO', 1)).rejects.toMatchObject({ code: 'TRANSICAO_INVALIDA' });
    const guardado = await repositorios.alertas.buscarAtivo(id);
    expect(guardado.status).toBe('NOVO');
    expect(guardado.historico).toEqual([]);
    expect((await repositorios.alertas.atualizarStatus(id, 'EM_ANALISE', 1)).status).toBe('EM_ANALISE');
  });

  test('nomesPorIds resolve os nomes dos usuários padrão', async () => {
    expect(await repositorios.usuarios.nomesPorIds([1, 3, 3, null])).toEqual({ 1: 'Admin', 3: 'Gestor' });
  });

  test('operações em alerta inexistente ou excluído devolvem null', async () => {
    const { id } = await repositorios.alertas.criar(dados());
    await repositorios.alertas.excluir(id, 1);
    expect(await repositorios.alertas.buscarAtivo(id)).toBeNull();
    expect(await repositorios.alertas.atualizarStatus(id, 'RESOLVIDO', 1)).toBeNull();
    expect(await repositorios.alertas.adicionarObservacao(id, 'x', 1)).toBeNull();
    expect(await repositorios.alertas.excluir(id, 1)).toBeNull();
    expect(await repositorios.alertas.criarSolicitacao(id, 2, 'x')).toBeNull();
    expect(await repositorios.alertas.avaliarSolicitacao(id, 1, 'APROVADA', '', 1)).toBeNull();
  });
});

describe('API com falha no banco', () => {
  const comToken = () => ({ Authorization: `Bearer ${token}` });

  test.each(['ECONNREFUSED', '57P01', '08006', '28P01', '42P01'])('erro de conexão %s → 503 com mensagem clara e motivo no log', async (code) => {
    jest.spyOn(repositorios.alertas, 'listarAtivos').mockRejectedValue(erroComCodigo(code));
    const r = await request(app).get('/api/alertas').set(comToken());
    expect(r.status).toBe(503);
    expect(r.body.erro).toBe('Banco de dados indisponível no momento. Tente novamente em instantes.');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[banco] GET /api/alertas'));
  });

  test('login com o banco fora do ar → 503 (não 401)', async () => {
    jest.spyOn(repositorios.usuarios, 'buscarPorEmail').mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    const r = await request(app).post('/api/login').send({ email: 'admin@smcq.com', senha: 'admin123' });
    expect(r.status).toBe(503);
  });

  test('dado recusado pelo banco (classe 22/23) → 400', async () => {
    jest.spyOn(repositorios.alertas, 'buscarAtivo').mockRejectedValue(erroComCodigo('22001', 'value too long for type character varying(200)'));
    const r = await request(app).get('/api/alertas/1/risco').set(comToken());
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/^Dados inválidos para gravação/);
  });

  test('erro inesperado → 500 em JSON, sem expor detalhes', async () => {
    jest.spyOn(repositorios.alertas, 'listarSolicitacoes').mockRejectedValue(new Error('falha interna qualquer'));
    const r = await request(app).get('/api/solicitacoes-exclusao').set(comToken());
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ erro: 'Erro interno do servidor' });
  });

  test('JSON malformado continua com o tratamento padrão do Express (400)', async () => {
    const r = await request(app).post('/api/login').set('Content-Type', 'application/json').send('{"email":');
    expect(r.status).toBe(400);
  });
});

// Outra requisição altera o alerta entre a verificação da rota e a gravação no repositório
describe('API com alteração concorrente', () => {
  const comToken = (t = token) => ({ Authorization: `Bearer ${t}` });
  const criarAlerta = async () => (await repositorios.alertas.criar({
    titulo: 'concorrência', status: 'NOVO', latitude: -16, longitude: -56, criadoPor: 1, criadoEm: new Date().toISOString(),
    historico: [], solicitacoesExclusao: [], excluido: false, excluidoEm: null
  })).id;
  const tokenOperador = async () => (await request(app).post('/api/login').send({ email: 'operador@smcq.com', senha: 'operador123' })).body.token;

  test('alerta excluído durante a mudança de status → 404', async () => {
    const id = await criarAlerta();
    jest.spyOn(repositorios.alertas, 'atualizarStatus').mockResolvedValue(null);
    expect((await request(app).patch(`/api/alertas/${id}/status`).set(comToken()).send({ status: 'RESOLVIDO' })).status).toBe(404);
  });

  test('alerta excluído durante a solicitação de exclusão → 404', async () => {
    const id = await criarAlerta();
    jest.spyOn(repositorios.alertas, 'criarSolicitacao').mockResolvedValue(null);
    const r = await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken(await tokenOperador())).send({ motivo: 'x' });
    expect(r.status).toBe(404);
  });

  test('banco fora do ar ao criar a solicitação → 503 (o erro não vira 409)', async () => {
    const id = await criarAlerta();
    jest.spyOn(repositorios.alertas, 'criarSolicitacao').mockRejectedValue(erroComCodigo('ECONNREFUSED'));
    const r = await request(app).post(`/api/alertas/${id}/solicitacoes-exclusao`).set(comToken(await tokenOperador())).send({ motivo: 'x' });
    expect(r.status).toBe(503);
  });

  test('solicitação avaliada por outro usuário no mesmo instante → 409', async () => {
    const id = await criarAlerta();
    const s = await repositorios.alertas.criarSolicitacao(id, 2, 'motivo');
    jest.spyOn(repositorios.alertas, 'avaliarSolicitacao').mockResolvedValue(null);
    const r = await request(app).patch(`/api/alertas/${id}/solicitacoes-exclusao/${s.id}`).set(comToken()).send({ decisao: 'APROVADA' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('Esta solicitação já foi avaliada');
  });
});

describe('ehErroDeConexao', () => {
  test('reconhece falhas de conexão e não confunde com erros de dados', () => {
    expect(ehErroDeConexao(erroComCodigo('ECONNREFUSED'))).toBe(true);
    expect(ehErroDeConexao(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(ehErroDeConexao(erroComCodigo('23505'))).toBe(false);
    expect(ehErroDeConexao(new Error('qualquer'))).toBe(false);
    expect(ehErroDeConexao(null)).toBe(false);
  });
});
