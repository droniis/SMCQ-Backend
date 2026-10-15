// ============================================================
// MEU PERFIL E ALTERAR SENHA (Etapa I6, UC04)
// - Todo usuário edita o próprio nome e e-mail (e-mail único), sem mudar o perfil
// - Troca da própria senha informando a atual (UC04 passos 4 a 6)
// - Senha provisória: troca obrigatória antes de usar as demais rotas
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');

const fetchOriginal = global.fetch;
let app;
let tokenGestor;

const PROVISORIA = 'provisoria123';
const comToken = (token) => ({ Authorization: `Bearer ${token}` });
const login = (email, senha) => request(app).post('/api/login').send({ email, senha });

let contador = 0;
// Usuário novo (cadastrado pelo gestor, com senha provisória) → { usuario, token }
async function novoUsuario(perfil = 'OPERADOR') {
  const email = `perfil${++contador}@teste.smcq.com`;
  const { body: usuario } = await request(app).post('/api/usuarios').set(comToken(tokenGestor))
    .send({ nome: `Pessoa ${contador}`, email, perfil, senha: PROVISORIA });
  const token = (await login(email, PROVISORIA)).body.token;
  return { usuario, token };
}
const trocarSenha = (token, senhaAtual, novaSenha) =>
  request(app).patch('/api/perfil/senha').set(comToken(token)).send({ senhaAtual, novaSenha });
// Usuário novo que já trocou a senha provisória → { usuario, token, senha }
async function usuarioDefinitivo(perfil) {
  const { usuario, token } = await novoUsuario(perfil);
  expect((await trocarSenha(token, PROVISORIA, 'definitiva123')).status).toBe(200);
  return { usuario, token, senha: 'definitiva123' };
}
const auditoriaDe = async (id) => (await request(app).get(`/api/usuarios/${id}/auditoria`).set(comToken(tokenGestor))).body;

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = jest.fn(criarFetchFalso().fetchFalso);
  app = require('../server');
  tokenGestor = (await login('gestor@smcq.com', 'gestor123')).body.token;
});

afterAll(() => {
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

// ------------------------------------------------------------
describe('GET /api/perfil', () => {
  test.each(['OPERADOR', 'ADMINISTRADOR', 'GESTOR'])('%s lê os próprios dados, sem o hash da senha', async (perfil) => {
    const { usuario, token } = await usuarioDefinitivo(perfil);
    const r = await request(app).get('/api/perfil').set(comToken(token));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: usuario.id, email: usuario.email, perfil, ativo: true, senhaProvisoria: false });
    expect(r.body).not.toHaveProperty('senhaHash');
  });

  test('sem token → 401', async () => {
    expect((await request(app).get('/api/perfil')).status).toBe(401);
  });
});

// ------------------------------------------------------------
describe('PATCH /api/perfil: nome e e-mail', () => {
  const editar = (token, corpo) => request(app).patch('/api/perfil').set(comToken(token)).send(corpo);

  test.each(['OPERADOR', 'ADMINISTRADOR', 'GESTOR'])('%s edita o próprio nome e e-mail; auditoria EDITADO feita por ele mesmo', async (perfil) => {
    const { usuario, token, senha } = await usuarioDefinitivo(perfil);
    const email = `novo${++contador}@teste.smcq.com`;
    const r = await editar(token, { nome: '  Nome Novo  ', email: `  ${email.toUpperCase()} ` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nome: 'Nome Novo', email, perfil });
    expect((await auditoriaDe(usuario.id))[0]).toMatchObject({
      acao: 'EDITADO', realizadoPor: usuario.id,
      alteracoes: { nome: { anterior: usuario.nome, novo: 'Nome Novo' }, email: { anterior: usuario.email, novo: email } }
    });
    // Entra com o e-mail novo; o antigo deixa de valer
    expect((await login(email, senha)).status).toBe(200);
    expect((await login(usuario.email, senha)).status).toBe(401);
  });

  test('não muda o próprio perfil (422); reenviar o mesmo perfil é aceito', async () => {
    const { token } = await usuarioDefinitivo('OPERADOR');
    const r = await editar(token, { perfil: 'GESTOR' });
    expect(r.status).toBe(422);
    expect(r.body.erro).toBe('Você não pode alterar o seu próprio perfil');
    expect((await request(app).get('/api/perfil').set(comToken(token))).body.perfil).toBe('OPERADOR');
    expect((await editar(token, { perfil: 'OPERADOR', nome: 'Mesmo perfil' })).status).toBe(200);
  });

  test.each([
    ['nome vazio', { nome: '  ' }],
    ['e-mail inválido', { email: 'sem-arroba' }],
    ['senha (tem rota própria)', { senha: 'outrasenha' }],
    ['ativo', { ativo: false }]
  ])('%s → 400, sem alterar nada', async (_caso, corpo) => {
    const { usuario, token } = await usuarioDefinitivo('OPERADOR');
    expect((await editar(token, corpo)).status).toBe(400);
    expect((await request(app).get('/api/perfil').set(comToken(token))).body).toMatchObject({ nome: usuario.nome, email: usuario.email, ativo: true });
  });

  test('e-mail de outro usuário → 409 (sem diferenciar maiúsculas)', async () => {
    const { token } = await usuarioDefinitivo('OPERADOR');
    expect((await editar(token, { email: 'GESTOR@smcq.com' })).status).toBe(409);
  });

  test('mesmos valores → 200 sem novo registro de auditoria', async () => {
    const { usuario, token } = await usuarioDefinitivo('OPERADOR');
    const antes = (await auditoriaDe(usuario.id)).length;
    expect((await editar(token, { nome: usuario.nome, email: usuario.email })).status).toBe(200);
    expect(await auditoriaDe(usuario.id)).toHaveLength(antes);
  });
});

// ------------------------------------------------------------
describe('PATCH /api/perfil/senha', () => {
  test('com a senha atual correta: troca, a antiga deixa de valer, auditoria SENHA_ALTERADA sem a senha', async () => {
    const { usuario, token, senha } = await usuarioDefinitivo('ADMINISTRADOR');
    const r = await trocarSenha(token, senha, 'outra-senha-forte');
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('senhaHash');
    expect((await login(usuario.email, senha)).status).toBe(401);
    expect((await login(usuario.email, 'outra-senha-forte')).status).toBe(200);
    const [registro] = await auditoriaDe(usuario.id);
    expect(registro).toMatchObject({ acao: 'SENHA_ALTERADA', alteracoes: {}, realizadoPor: usuario.id });
    expect(JSON.stringify(registro)).not.toContain('outra-senha-forte');
  });

  test('senha atual errada → 422 (não 401: a sessão continua)', async () => {
    const { token } = await usuarioDefinitivo('OPERADOR');
    const r = await trocarSenha(token, 'errada123', 'outra-senha-forte');
    expect(r.status).toBe(422);
    expect(r.body.erro).toBe('Senha atual incorreta');
    expect((await request(app).get('/api/alertas').set(comToken(token))).status).toBe(200);
  });

  test('nova senha igual à atual → 422', async () => {
    const { token, senha } = await usuarioDefinitivo('OPERADOR');
    expect((await trocarSenha(token, senha, senha)).status).toBe(422);
  });

  test.each([
    ['sem senha atual', { novaSenha: 'outra-senha-forte' }],
    ['sem nova senha', { senhaAtual: 'definitiva123' }],
    ['nova senha com 7 caracteres', { senhaAtual: 'definitiva123', novaSenha: '1234567' }],
    ['nova senha não texto', { senhaAtual: 'definitiva123', novaSenha: 12345678 }]
  ])('%s → 400', async (_caso, corpo) => {
    const { token } = await usuarioDefinitivo('OPERADOR');
    expect((await request(app).patch('/api/perfil/senha').set(comToken(token)).send(corpo)).status).toBe(400);
  });

  test('nova senha com exatamente 8 caracteres é aceita', async () => {
    const { token, senha } = await usuarioDefinitivo('OPERADOR');
    expect((await trocarSenha(token, senha, '12345678')).status).toBe(200);
  });
});

// ------------------------------------------------------------
describe('troca de senha obrigatória no primeiro acesso', () => {
  test('o login informa a senha provisória; as rotas fora de "Meu perfil" respondem 403 com o código', async () => {
    const { usuario, token } = await novoUsuario('GESTOR');
    expect((await login(usuario.email, PROVISORIA)).body.usuario).toMatchObject({ senhaProvisoria: true });
    for (const [metodo, rota] of [['get', '/api/alertas'], ['get', '/api/usuarios'], ['get', '/api/solicitacoes-exclusao'], ['post', '/api/alertas']]) {
      const r = await request(app)[metodo](rota).set(comToken(token)).send({});
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ erro: 'Troque a senha provisória antes de continuar', codigo: 'TROCA_SENHA_OBRIGATORIA' });
    }
    // "Meu perfil" continua disponível
    expect((await request(app).get('/api/perfil').set(comToken(token))).status).toBe(200);
    expect((await request(app).patch('/api/perfil').set(comToken(token)).send({ nome: 'Ajustado' })).status).toBe(200);
  });

  test('depois da troca: liberado com o mesmo token, e o login passa a informar senha definitiva', async () => {
    const { usuario, token } = await novoUsuario('OPERADOR');
    const r = await trocarSenha(token, PROVISORIA, 'definitiva123');
    expect(r.status).toBe(200);
    expect(r.body.senhaProvisoria).toBe(false);
    expect((await request(app).get('/api/alertas').set(comToken(token))).status).toBe(200);
    expect((await login(usuario.email, 'definitiva123')).body.usuario.senhaProvisoria).toBe(false);
  });

  test('senha redefinida pelo gestor volta a ser provisória e bloqueia a sessão em andamento na hora', async () => {
    const { usuario, token } = await usuarioDefinitivo('OPERADOR');
    expect((await request(app).get('/api/alertas').set(comToken(token))).status).toBe(200);
    await request(app).patch(`/api/usuarios/${usuario.id}`).set(comToken(tokenGestor)).send({ senha: 'nova-provisoria' });
    const r = await request(app).get('/api/alertas').set(comToken(token));
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe('TROCA_SENHA_OBRIGATORIA');
  });

  test('a rota de login não é bloqueada, e um desativado com senha provisória continua sem entrar', async () => {
    const { usuario } = await novoUsuario('OPERADOR');
    await request(app).patch(`/api/usuarios/${usuario.id}/ativo`).set(comToken(tokenGestor)).send({ ativo: false });
    expect((await login(usuario.email, PROVISORIA)).status).toBe(401);
  });
});
