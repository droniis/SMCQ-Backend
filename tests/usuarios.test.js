// ============================================================
// GESTÃO DE USUÁRIOS (Etapa I5, RF04, UC08, HU02)
// - Matriz de permissões COMPLETA: cada perfil × cada ação × cada perfil-alvo
// - Casos sobre si mesmo, último gestor ativo, validações e e-mail repetido
// - Desativação lógica: sem login, sessão encerrada, nome mantido nos registros
// - Auditoria de cada ação (quem fez, o quê, quando), sem senha
// ============================================================
const request = require('supertest');
const { criarFetchFalso } = require('./helpers/fetchFalso');
const usuarioService = require('../services/usuarioService');

const fetchOriginal = global.fetch;
let app;
const tokens = {};

// Usuários padrão: 1 Admin (ADMINISTRADOR), 2 Operador (OPERADOR), 3 Gestor (GESTOR)
const PADRAO = {
  GESTOR: { chave: 'gestor', id: 3, email: 'gestor@smcq.com', senha: 'gestor123' },
  ADMINISTRADOR: { chave: 'admin', id: 1, email: 'admin@smcq.com', senha: 'admin123' },
  OPERADOR: { chave: 'operador', id: 2, email: 'operador@smcq.com', senha: 'operador123' }
};
const PERFIS = Object.keys(PADRAO);

const comToken = (chaveOuToken) => ({ Authorization: `Bearer ${tokens[chaveOuToken] || chaveOuToken}` });
const login = (email, senha) => request(app).post('/api/login').send({ email, senha });

let contador = 0;
const novoEmail = () => `usuario${++contador}@teste.smcq.com`;

// Cadastra (pelo gestor padrão) um usuário com o perfil pedido; desativa se ativo = false
async function criarAlvo(perfil, { ativo = true } = {}) {
  const r = await request(app).post('/api/usuarios').set(comToken('gestor'))
    .send({ nome: `Alvo ${perfil} ${contador}`, email: novoEmail(), perfil, senha: 'provisoria123' });
  expect(r.status).toBe(201);
  if (!ativo) {
    expect((await request(app).patch(`/api/usuarios/${r.body.id}/ativo`).set(comToken('gestor')).send({ ativo: false })).status).toBe(200);
  }
  return { ...r.body, ativo };
}
const lerUsuario = async (id) => (await request(app).get(`/api/usuarios/${id}`).set(comToken('gestor'))).body;
const auditoriaDe = async (id) => (await request(app).get(`/api/usuarios/${id}/auditoria`).set(comToken('gestor'))).body;

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = jest.fn(criarFetchFalso().fetchFalso);
  app = require('../server');
  for (const { chave, email, senha } of Object.values(PADRAO)) {
    tokens[chave] = (await login(email, senha)).body.token;
  }
});

afterAll(() => {
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

// ============================================================
// MATRIZ DE PERMISSÕES
// ============================================================
// Resultado esperado de cada ação, conforme o perfil de quem faz e o perfil do alvo
const ESPERADO = {
  cadastrar: (ator) => (ator === 'GESTOR' ? 201 : 403),
  editarDados: (ator, alvo) => (ator === 'GESTOR' || (ator === 'ADMINISTRADOR' && alvo === 'OPERADOR') ? 200 : 403),
  mudarPerfil: (ator) => (ator === 'GESTOR' ? 200 : 403),
  redefinirSenha: (ator, alvo) => (ator === 'GESTOR' || (ator === 'ADMINISTRADOR' && alvo === 'OPERADOR') ? 200 : 403),
  desativar: (ator, alvo) => (ator === 'GESTOR' || (ator === 'ADMINISTRADOR' && alvo === 'OPERADOR') ? 200 : 403),
  reativar: (ator, alvo) => (ator === 'GESTOR' || (ator === 'ADMINISTRADOR' && alvo === 'OPERADOR') ? 200 : 403)
};
// Para "mudar perfil": um perfil diferente do atual (OPERADOR → ADMINISTRADOR é a promoção que o admin não pode fazer)
const OUTRO_PERFIL = { GESTOR: 'OPERADOR', ADMINISTRADOR: 'OPERADOR', OPERADOR: 'ADMINISTRADOR' };

const combinacoes = (acao) => PERFIS.flatMap(ator => PERFIS.map(alvo => [ator, alvo, ESPERADO[acao](ator, alvo)]));

describe('matriz: CADASTRAR (perfil de quem cadastra × perfil cadastrado)', () => {
  test.each(combinacoes('cadastrar'))('%s cadastra %s → %i', async (ator, perfil, status) => {
    const email = novoEmail();
    const r = await request(app).post('/api/usuarios').set(comToken(PADRAO[ator].chave))
      .send({ nome: 'Novo usuário', email, perfil, senha: 'provisoria123' });
    expect(r.status).toBe(status);
    const lista = (await request(app).get('/api/usuarios').set(comToken('gestor'))).body;
    expect(lista.some(u => u.email === email)).toBe(status === 201);
    if (status === 201) {
      expect(r.body).toMatchObject({ email, perfil, ativo: true, senhaProvisoria: true });
      expect(r.body).not.toHaveProperty('senhaHash');
    }
  });
});

describe('matriz: EDITAR nome e e-mail', () => {
  test.each(combinacoes('editarDados'))('%s edita %s → %i', async (ator, perfilAlvo, status) => {
    const alvo = await criarAlvo(perfilAlvo);
    const email = novoEmail();
    const r = await request(app).patch(`/api/usuarios/${alvo.id}`).set(comToken(PADRAO[ator].chave)).send({ nome: 'Nome editado', email });
    expect(r.status).toBe(status);
    const depois = await lerUsuario(alvo.id);
    if (status === 200) {
      expect(depois).toMatchObject({ nome: 'Nome editado', email });
      expect((await auditoriaDe(alvo.id))[0]).toMatchObject({ acao: 'EDITADO', realizadoPor: PADRAO[ator].id });
    } else {
      expect(depois).toMatchObject({ nome: alvo.nome, email: alvo.email });
    }
  });
});

describe('matriz: MUDAR PERFIL', () => {
  test.each(combinacoes('mudarPerfil'))('%s muda o perfil de %s → %i', async (ator, perfilAlvo, status) => {
    const alvo = await criarAlvo(perfilAlvo);
    const novo = OUTRO_PERFIL[perfilAlvo];
    const r = await request(app).patch(`/api/usuarios/${alvo.id}`).set(comToken(PADRAO[ator].chave)).send({ perfil: novo });
    expect(r.status).toBe(status);
    expect((await lerUsuario(alvo.id)).perfil).toBe(status === 200 ? novo : perfilAlvo);
    if (status === 200) {
      expect((await auditoriaDe(alvo.id))[0]).toMatchObject({ acao: 'EDITADO', alteracoes: { perfil: { anterior: perfilAlvo, novo } } });
    }
  });

  test('ADMINISTRADOR não promove operador a nenhum outro perfil', async () => {
    for (const perfil of ['ADMINISTRADOR', 'GESTOR']) {
      const alvo = await criarAlvo('OPERADOR');
      expect((await request(app).patch(`/api/usuarios/${alvo.id}`).set(comToken('admin')).send({ perfil })).status).toBe(403);
    }
  });

  test('ADMINISTRADOR pode reenviar o mesmo perfil OPERADOR junto com outros campos (não é mudança)', async () => {
    const alvo = await criarAlvo('OPERADOR');
    expect((await request(app).patch(`/api/usuarios/${alvo.id}`).set(comToken('admin')).send({ perfil: 'OPERADOR', nome: 'Só o nome' })).status).toBe(200);
  });
});

describe('matriz: REDEFINIR SENHA PROVISÓRIA', () => {
  test.each(combinacoes('redefinirSenha'))('%s redefine a senha de %s → %i', async (ator, perfilAlvo, status) => {
    const alvo = await criarAlvo(perfilAlvo);
    const r = await request(app).patch(`/api/usuarios/${alvo.id}`).set(comToken(PADRAO[ator].chave)).send({ senha: 'nova-provisoria' });
    expect(r.status).toBe(status);
    expect((await login(alvo.email, 'nova-provisoria')).status).toBe(status === 200 ? 200 : 401);
    expect((await login(alvo.email, 'provisoria123')).status).toBe(status === 200 ? 401 : 200);
    if (status === 200) {
      expect(r.body.senhaProvisoria).toBe(true);
      expect((await auditoriaDe(alvo.id))[0]).toMatchObject({ acao: 'SENHA_REDEFINIDA', alteracoes: {} });
    }
  });
});

describe('matriz: DESATIVAR', () => {
  test.each(combinacoes('desativar'))('%s desativa %s → %i', async (ator, perfilAlvo, status) => {
    const alvo = await criarAlvo(perfilAlvo);
    const r = await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken(PADRAO[ator].chave)).send({ ativo: false });
    expect(r.status).toBe(status);
    expect((await lerUsuario(alvo.id)).ativo).toBe(status !== 200);
    expect((await login(alvo.email, 'provisoria123')).status).toBe(status === 200 ? 401 : 200);
    if (status === 200) {
      expect((await auditoriaDe(alvo.id))[0]).toMatchObject({
        acao: 'DESATIVADO', alteracoes: { ativo: { anterior: true, novo: false } }, realizadoPor: PADRAO[ator].id
      });
    }
  });
});

describe('matriz: REATIVAR', () => {
  test.each(combinacoes('reativar'))('%s reativa %s → %i', async (ator, perfilAlvo, status) => {
    const alvo = await criarAlvo(perfilAlvo, { ativo: false });
    const r = await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken(PADRAO[ator].chave)).send({ ativo: true });
    expect(r.status).toBe(status);
    expect((await lerUsuario(alvo.id)).ativo).toBe(status === 200);
    expect((await login(alvo.email, 'provisoria123')).status).toBe(status === 200 ? 200 : 401);
    if (status === 200) {
      expect((await auditoriaDe(alvo.id))[0]).toMatchObject({ acao: 'REATIVADO', realizadoPor: PADRAO[ator].id });
    }
  });
});

// ============================================================
// AÇÕES SOBRE SI MESMO
// ============================================================
describe('ações sobre si mesmo', () => {
  test('GESTOR não desativa a si mesmo (422)', async () => {
    const r = await request(app).patch('/api/usuarios/3/ativo').set(comToken('gestor')).send({ ativo: false });
    expect(r.status).toBe(422);
    expect((await lerUsuario(3)).ativo).toBe(true);
  });

  test('GESTOR não muda o próprio perfil (422) nem redefine a própria senha por aqui (422)', async () => {
    expect((await request(app).patch('/api/usuarios/3').set(comToken('gestor')).send({ perfil: 'ADMINISTRADOR' })).status).toBe(422);
    expect((await request(app).patch('/api/usuarios/3').set(comToken('gestor')).send({ senha: 'outrasenha' })).status).toBe(422);
    expect((await lerUsuario(3)).perfil).toBe('GESTOR');
    expect((await login('gestor@smcq.com', 'gestor123')).status).toBe(200);
  });

  test('GESTOR edita o próprio nome pela gestão de usuários (200)', async () => {
    const r = await request(app).patch('/api/usuarios/3').set(comToken('gestor')).send({ nome: 'Gestor' });
    expect(r.status).toBe(200);
  });

  test('ADMINISTRADOR e OPERADOR não editam nem desativam a si mesmos por aqui (403)', async () => {
    for (const { chave, id } of [PADRAO.ADMINISTRADOR, PADRAO.OPERADOR]) {
      expect((await request(app).patch(`/api/usuarios/${id}`).set(comToken(chave)).send({ nome: 'x' })).status).toBe(403);
      expect((await request(app).patch(`/api/usuarios/${id}/ativo`).set(comToken(chave)).send({ ativo: false })).status).toBe(403);
    }
  });
});

// ============================================================
// ÚLTIMO GESTOR ATIVO (422)
// Pela API, a regra "não desativa nem rebaixa a si mesmo" já impede
// que o último gestor saia; a proteção abaixo é a garantia final,
// conferida com os gestores travados no repositório.
// ============================================================
describe('nunca fica sem gestor ativo', () => {
  const ator = { id: 99, perfil: 'GESTOR' };
  const ultimo = { id: 7, perfil: 'GESTOR', ativo: true, nome: 'G', email: 'g@x.com' };

  test('desativar o único gestor ativo → 422', () => {
    expect(() => usuarioService.aplicarAtivo(ator, ultimo, false, { gestoresAtivos: 1 }))
      .toThrow(expect.objectContaining({ statusHttp: 422, message: 'O sistema precisa de pelo menos um gestor ativo' }));
  });

  test('rebaixar o único gestor ativo → 422', () => {
    expect(() => usuarioService.aplicarEdicao(ator, ultimo, { perfil: 'OPERADOR' }, { gestoresAtivos: 1 }))
      .toThrow(expect.objectContaining({ statusHttp: 422 }));
  });

  test('com outro gestor ativo, pode', () => {
    expect(usuarioService.aplicarAtivo(ator, ultimo, false, { gestoresAtivos: 2 }).campos).toEqual({ ativo: false });
    expect(usuarioService.aplicarEdicao(ator, ultimo, { perfil: 'OPERADOR' }, { gestoresAtivos: 2 }).campos).toEqual({ perfil: 'OPERADOR' });
  });

  test('desativar gestor já inativo ou mexer em quem não é gestor não depende da contagem', () => {
    expect(usuarioService.aplicarAtivo(ator, { ...ultimo, ativo: false }, false, { gestoresAtivos: 0 }).campos).toEqual({});
    expect(usuarioService.aplicarAtivo(ator, { ...ultimo, perfil: 'OPERADOR' }, false, { gestoresAtivos: 1 }).campos).toEqual({ ativo: false });
  });

  test('pela API: dois gestores; um desativa o outro; o restante não consegue sair', async () => {
    const outro = await criarAlvo('GESTOR');
    const tokenOutro = (await login(outro.email, 'provisoria123')).body.token;
    // O outro gestor desativa o gestor padrão... e o gestor padrão (desativado) perde a sessão
    expect((await request(app).patch('/api/usuarios/3/ativo').set(comToken(tokenOutro)).send({ ativo: false })).status).toBe(200);
    expect((await request(app).get('/api/usuarios').set(comToken('gestor'))).status).toBe(401);
    // O restante não pode se desativar nem se rebaixar
    expect((await request(app).patch(`/api/usuarios/${outro.id}/ativo`).set(comToken(tokenOutro)).send({ ativo: false })).status).toBe(422);
    expect((await request(app).patch(`/api/usuarios/${outro.id}`).set(comToken(tokenOutro)).send({ perfil: 'OPERADOR' })).status).toBe(422);
    // Volta ao estado inicial
    expect((await request(app).patch('/api/usuarios/3/ativo').set(comToken(tokenOutro)).send({ ativo: true })).status).toBe(200);
    tokens.gestor = (await login('gestor@smcq.com', 'gestor123')).body.token;
  });
});

// ============================================================
// CADASTRO: validações e e-mail único
// ============================================================
describe('cadastro', () => {
  const cadastrar = (corpo) => request(app).post('/api/usuarios').set(comToken('gestor')).send(corpo);
  const valido = () => ({ nome: 'Fulana de Tal', email: novoEmail(), perfil: 'OPERADOR', senha: 'provisoria123' });

  test.each([
    ['sem nome', { nome: '' }],
    ['nome só com espaços', { nome: '   ' }],
    ['sem e-mail', { email: undefined }],
    ['e-mail inválido', { email: 'nao-e-email' }],
    ['sem perfil', { perfil: undefined }],
    ['perfil inválido', { perfil: 'CHEFE' }],
    ['sem senha', { senha: undefined }],
    ['senha com 7 caracteres', { senha: '1234567' }],
    ['senha não texto', { senha: 12345678 }],
    ['nome longo', { nome: 'x'.repeat(121) }]
  ])('%s → 400', async (_caso, troca) => {
    const corpo = { ...valido(), ...troca };
    const r = await cadastrar(corpo);
    expect(r.status).toBe(400);
    expect(typeof r.body.erro).toBe('string');
  });

  test('senha com exatamente 8 caracteres é aceita; e-mail gravado aparado e em minúsculas', async () => {
    const email = novoEmail();
    const r = await cadastrar({ ...valido(), email: `  ${email.toUpperCase()}  `, senha: '12345678' });
    expect(r.status).toBe(201);
    expect(r.body.email).toBe(email);
    expect((await login(email, '12345678')).status).toBe(200);
  });

  test('e-mail repetido → 409, inclusive com maiúsculas diferentes', async () => {
    expect((await cadastrar({ ...valido(), email: 'operador@smcq.com' })).status).toBe(409);
    expect((await cadastrar({ ...valido(), email: 'OPERADOR@SMCQ.COM' })).status).toBe(409);
  });

  test('o novo usuário entra com a senha provisória; a auditoria registra CRIADO sem a senha', async () => {
    const corpo = valido();
    const { body: criado } = await cadastrar(corpo);
    const entrada = await login(corpo.email, corpo.senha);
    expect(entrada.status).toBe(200);
    const [registro] = await auditoriaDe(criado.id);
    expect(registro).toMatchObject({
      acao: 'CRIADO', realizadoPor: 3, realizadoPorNome: 'Gestor',
      alteracoes: { nome: corpo.nome, email: corpo.email, perfil: 'OPERADOR' }
    });
    expect(JSON.stringify(registro)).not.toContain(corpo.senha);
  });

  test('sem token → 401', async () => {
    expect((await request(app).post('/api/usuarios').send(valido())).status).toBe(401);
  });
});

// ============================================================
// EDIÇÃO: validações, 404, 409 e "sem mudança"
// ============================================================
describe('edição', () => {
  const editar = (id, corpo, chave = 'gestor') => request(app).patch(`/api/usuarios/${id}`).set(comToken(chave)).send(corpo);

  test('usuário inexistente → 404 (editar, desativar, ler, auditoria)', async () => {
    expect((await editar(99999, { nome: 'x' })).status).toBe(404);
    expect((await request(app).patch('/api/usuarios/99999/ativo').set(comToken('gestor')).send({ ativo: false })).status).toBe(404);
    expect((await request(app).get('/api/usuarios/99999').set(comToken('gestor'))).status).toBe(404);
    expect((await request(app).get('/api/usuarios/99999/auditoria').set(comToken('gestor'))).status).toBe(404);
  });

  test.each([
    ['nome vazio', { nome: '' }],
    ['e-mail inválido', { email: 'x' }],
    ['perfil inválido', { perfil: 'CHEFE' }],
    ['senha curta', { senha: 'curta' }],
    ['campo não aceito (ativo vai pela rota própria)', { ativo: false }],
    ['campo não aceito (senhaProvisoria)', { senhaProvisoria: false }]
  ])('%s → 400, sem alterar nada', async (_caso, corpo) => {
    const alvo = await criarAlvo('OPERADOR');
    expect((await editar(alvo.id, corpo)).status).toBe(400);
    expect(await lerUsuario(alvo.id)).toMatchObject({ nome: alvo.nome, email: alvo.email, perfil: 'OPERADOR', ativo: true });
  });

  test('e-mail de outro usuário → 409', async () => {
    const alvo = await criarAlvo('OPERADOR');
    expect((await editar(alvo.id, { email: 'Admin@smcq.com' })).status).toBe(409);
  });

  test('mesmos valores → 200 sem novo registro de auditoria', async () => {
    const alvo = await criarAlvo('OPERADOR');
    const r = await editar(alvo.id, { nome: alvo.nome, email: alvo.email, perfil: 'OPERADOR' });
    expect(r.status).toBe(200);
    expect(await auditoriaDe(alvo.id)).toHaveLength(1); // só o CRIADO
  });

  test('auditoria registra cada campo alterado (anterior → novo)', async () => {
    const alvo = await criarAlvo('OPERADOR');
    const email = novoEmail();
    await editar(alvo.id, { nome: 'Outro nome', email, perfil: 'ADMINISTRADOR' });
    expect((await auditoriaDe(alvo.id))[0].alteracoes).toEqual({
      nome: { anterior: alvo.nome, novo: 'Outro nome' },
      email: { anterior: alvo.email, novo: email },
      perfil: { anterior: 'OPERADOR', novo: 'ADMINISTRADOR' }
    });
  });

  test('desativar quem já está desativado → 200 sem novo registro; "ativo" não booleano → 400', async () => {
    const alvo = await criarAlvo('OPERADOR', { ativo: false });
    const antes = (await auditoriaDe(alvo.id)).length;
    expect((await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken('gestor')).send({ ativo: false })).status).toBe(200);
    expect(await auditoriaDe(alvo.id)).toHaveLength(antes);
    expect((await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken('gestor')).send({ ativo: 'false' })).status).toBe(400);
    expect((await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken('gestor')).send({})).status).toBe(400);
  });
});

// ============================================================
// LISTAGEM E AUDITORIA
// ============================================================
describe('listagem', () => {
  test('GESTOR e ADMINISTRADOR listam todos; OPERADOR → 403; nunca sai o hash da senha', async () => {
    for (const chave of ['gestor', 'admin']) {
      const r = await request(app).get('/api/usuarios').set(comToken(chave));
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThanOrEqual(3);
      expect(r.body.every(u => !('senhaHash' in u))).toBe(true);
    }
    expect((await request(app).get('/api/usuarios').set(comToken('operador'))).status).toBe(403);
    expect((await request(app).get('/api/usuarios/1').set(comToken('operador'))).status).toBe(403);
    expect((await request(app).get('/api/usuarios/1/auditoria').set(comToken('operador'))).status).toBe(403);
  });

  test('filtros por perfil e situação', async () => {
    await criarAlvo('OPERADOR', { ativo: false });
    const operadores = (await request(app).get('/api/usuarios?perfil=OPERADOR').set(comToken('gestor'))).body;
    expect(operadores.length).toBeGreaterThan(0);
    expect(operadores.every(u => u.perfil === 'OPERADOR')).toBe(true);
    const desativados = (await request(app).get('/api/usuarios?ativo=false').set(comToken('admin'))).body;
    expect(desativados.length).toBeGreaterThan(0);
    expect(desativados.every(u => u.ativo === false)).toBe(true);
    const ambos = (await request(app).get('/api/usuarios?perfil=GESTOR&ativo=true').set(comToken('gestor'))).body;
    expect(ambos.every(u => u.perfil === 'GESTOR' && u.ativo)).toBe(true);
  });

  test('filtros inválidos → 400', async () => {
    expect((await request(app).get('/api/usuarios?perfil=CHEFE').set(comToken('gestor'))).status).toBe(400);
    expect((await request(app).get('/api/usuarios?ativo=sim').set(comToken('gestor'))).status).toBe(400);
  });

  test('ADMINISTRADOR vê a auditoria de qualquer usuário (somente leitura)', async () => {
    const r = await request(app).get('/api/usuarios/3/auditoria').set(comToken('admin'));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

// ============================================================
// DESATIVAÇÃO LÓGICA: efeitos
// ============================================================
describe('usuário desativado', () => {
  test('não entra, perde a sessão na hora e entra de novo ao ser reativado', async () => {
    const alvo = await criarAlvo('OPERADOR');
    const token = (await login(alvo.email, 'provisoria123')).body.token;
    expect((await request(app).get('/api/alertas').set(comToken(token))).status).toBe(200);

    await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken('gestor')).send({ ativo: false });
    const negado = await login(alvo.email, 'provisoria123');
    expect(negado.status).toBe(401);
    expect(negado.body.erro).toMatch(/desativado/);
    expect((await request(app).get('/api/alertas').set(comToken(token))).status).toBe(401);
    // Senha errada de um desativado não revela a situação
    expect((await login(alvo.email, 'errada123')).body.erro).toBe('Senha incorreta');

    await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken('admin')).send({ ativo: true });
    expect((await login(alvo.email, 'provisoria123')).status).toBe(200);
  });

  test('continua com o nome nos registros: alerta criado por ele, histórico e solicitações', async () => {
    const alvo = await criarAlvo('OPERADOR');
    const token = (await login(alvo.email, 'provisoria123')).body.token;
    const { body: alerta } = await request(app).post('/api/alertas').set(comToken(token))
      .send({ titulo: 'Registro de quem sai', areaAfetada: 'PEQUENA', vento: 'BAIXO', latitude: -16.68, longitude: -56.67 });
    await request(app).post(`/api/alertas/${alerta.id}/solicitacoes-exclusao`).set(comToken(token)).send({ motivo: 'teste' });
    await request(app).patch(`/api/usuarios/${alvo.id}/ativo`).set(comToken('gestor')).send({ ativo: false });

    const lido = (await request(app).get(`/api/alertas/${alerta.id}`).set(comToken('gestor'))).body;
    expect(lido.criadoPorNome).toBe(alvo.nome);
    expect(lido.historico[0].alteradoPorNome).toBe(alvo.nome);
    expect(lido.solicitacoesExclusao[0].solicitadoPorNome).toBe(alvo.nome);
    const solicitacoes = (await request(app).get('/api/solicitacoes-exclusao').set(comToken('gestor'))).body;
    expect(solicitacoes.find(s => s.alertaId === alerta.id).solicitadoPorNome).toBe(alvo.nome);
  });
});

describe('mudança de perfil vale na hora (perfil lido do banco a cada requisição)', () => {
  test('operador promovido a gestor já pode cadastrar, com o mesmo token', async () => {
    const alvo = await criarAlvo('OPERADOR');
    const token = (await login(alvo.email, 'provisoria123')).body.token;
    const cadastro = { nome: 'Indicado', email: novoEmail(), perfil: 'OPERADOR', senha: 'provisoria123' };
    expect((await request(app).post('/api/usuarios').set(comToken(token)).send(cadastro)).status).toBe(403);
    await request(app).patch(`/api/usuarios/${alvo.id}`).set(comToken('gestor')).send({ perfil: 'GESTOR' });
    expect((await request(app).post('/api/usuarios').set(comToken(token)).send(cadastro)).status).toBe(201);
  });
});
