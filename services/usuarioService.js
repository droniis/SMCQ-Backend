// ============================================================
// GESTÃO DE USUÁRIOS (RF04, UC08, HU02): validação e permissões
//
// Matriz de permissões (decidida pela equipe):
//   CADASTRAR  → só GESTOR, de qualquer perfil.
//   EDITAR     → GESTOR edita qualquer usuário (nome, e-mail, perfil,
//                senha provisória), mas não muda o próprio perfil nem
//                redefine a própria senha por aqui (usa "Meu perfil").
//                ADMINISTRADOR edita só OPERADOR, sem mudar o perfil.
//                OPERADOR não edita outros usuários.
//   DESATIVAR / REATIVAR → GESTOR, qualquer usuário menos ele mesmo;
//                ADMINISTRADOR, só OPERADOR.
//   Nunca pode faltar um GESTOR ativo (422).
// Listar usuários e ver a auditoria: GESTOR e ADMINISTRADOR.
//
// As funções aqui não gravam nada. As de "aplicar" recebem o usuário
// alvo já travado pelo repositório e lançam ErroHttp quando a regra
// é violada; o tratador de erros do server.js devolve o status.
// ============================================================

const PERFIS = ['ADMINISTRADOR', 'GESTOR', 'OPERADOR'];
const TAMANHO = { nome: 120, email: 160 };   // colunas da tabela usuario (db/schema.sql)
const SENHA_MINIMA = 8;
const SENHA_MAXIMA = 72;                     // o bcrypt ignora o que passa de 72 bytes
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ErroHttp extends Error {
  constructor(statusHttp, mensagem) {
    super(mensagem);
    this.statusHttp = statusHttp;
  }
}
const proibido = (mensagem) => new ErroHttp(403, mensagem);
const regraViolada = (mensagem) => new ErroHttp(422, mensagem);

// ------------------------------------------------------------
// Permissões
// ------------------------------------------------------------
const ehGestor = (ator) => ator.perfil === 'GESTOR';
const ehAdmin = (ator) => ator.perfil === 'ADMINISTRADOR';

function podeGerenciar(ator) {
  return ehGestor(ator) || ehAdmin(ator);
}

function podeCadastrar(ator) {
  return ehGestor(ator);
}

// Editar nome, e-mail e senha provisória
function podeEditar(ator, alvo) {
  if (ehGestor(ator)) return true;
  if (ehAdmin(ator)) return alvo.perfil === 'OPERADOR';
  return false;
}

// Desativar e reativar
function podeAlterarAtivo(ator, alvo) {
  if (ehGestor(ator)) return true;   // a si mesmo: regra de negócio (422), conferida em aplicarAtivo
  if (ehAdmin(ator)) return alvo.perfil === 'OPERADOR';
  return false;
}

// Mensagens de 403 para cada ação
const MENSAGENS = {
  gerenciar: 'Apenas gestores e administradores gerenciam usuários',
  cadastrar: 'Apenas gestores cadastram usuários',
  editar: 'Administradores editam apenas usuários com perfil Operador; operadores não editam outros usuários',
  perfil: 'Apenas gestores alteram o perfil de um usuário',
  ativo: 'Administradores desativam e reativam apenas usuários com perfil Operador; operadores não desativam usuários'
};

// ------------------------------------------------------------
// Validação dos campos
// ------------------------------------------------------------
const normalizarEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

function validarNome(valor, erros) {
  const nome = typeof valor === 'string' ? valor.trim() : '';
  if (!nome) erros.push('O nome é obrigatório');
  else if (nome.length > TAMANHO.nome) erros.push(`O nome aceita no máximo ${TAMANHO.nome} caracteres`);
  return nome;
}

function validarEmail(valor, erros) {
  const email = normalizarEmail(valor);
  if (!email) erros.push('O e-mail é obrigatório');
  else if (email.length > TAMANHO.email) erros.push(`O e-mail aceita no máximo ${TAMANHO.email} caracteres`);
  else if (!EMAIL_VALIDO.test(email)) erros.push('E-mail inválido');
  return email;
}

function validarPerfil(valor, erros) {
  if (!PERFIS.includes(valor)) erros.push(`Perfil inválido: ${valor}. Valores aceitos: ${PERFIS.join(', ')}`);
  return valor;
}

function validarSenha(valor, erros, nome = 'A senha') {
  if (typeof valor !== 'string' || valor.length < SENHA_MINIMA) erros.push(`${nome} deve ter pelo menos ${SENHA_MINIMA} caracteres`);
  else if (valor.length > SENHA_MAXIMA) erros.push(`${nome} aceita no máximo ${SENHA_MAXIMA} caracteres`);
  return valor;
}

// Cadastro: { nome, email, perfil, senha } → { dados, erros }
function lerCadastro(corpo = {}) {
  const erros = [];
  const dados = {
    nome: validarNome(corpo.nome, erros),
    email: validarEmail(corpo.email, erros),
    perfil: validarPerfil(corpo.perfil, erros),
    senha: validarSenha(corpo.senha, erros, 'A senha provisória')
  };
  return { dados, erros };
}

const CAMPOS_EDICAO = ['nome', 'email', 'perfil', 'senha'];

// Edição: corpo parcial → { campos, erros } (campos só com o que veio)
function lerEdicao(corpo) {
  const erros = [];
  const campos = {};
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { campos, erros: ['Corpo da requisição inválido'] };
  const desconhecidos = Object.keys(corpo).filter(c => !CAMPOS_EDICAO.includes(c));
  if (desconhecidos.length > 0) erros.push(`Campos não aceitos: ${desconhecidos.join(', ')}. Use: ${CAMPOS_EDICAO.join(', ')}`);
  if ('nome' in corpo) campos.nome = validarNome(corpo.nome, erros);
  if ('email' in corpo) campos.email = validarEmail(corpo.email, erros);
  if ('perfil' in corpo) campos.perfil = validarPerfil(corpo.perfil, erros);
  if ('senha' in corpo) campos.senha = validarSenha(corpo.senha, erros, 'A senha provisória');
  return { campos, erros };
}

// ------------------------------------------------------------
// Regras aplicadas ao usuário alvo (já travado pelo repositório)
// contexto.gestoresAtivos → quantos GESTOR ativos existem agora (incluindo o alvo, se for um)
// ------------------------------------------------------------

// Depois da mudança, ainda resta algum GESTOR ativo?
function verificarGestorRestante(alvo, depois, { gestoresAtivos }) {
  const eraGestorAtivo = alvo.perfil === 'GESTOR' && alvo.ativo;
  const continuaGestorAtivo = depois.perfil === 'GESTOR' && depois.ativo;
  if (eraGestorAtivo && !continuaGestorAtivo && gestoresAtivos <= 1) {
    throw regraViolada('O sistema precisa de pelo menos um gestor ativo');
  }
}

// Edição pela gestão de usuários.
// campos: { nome?, email?, perfil?, senhaHash? } (a senha já chega em hash).
// → { campos, auditoria: [{ acao, alteracoes }] } só com o que mudou
function aplicarEdicao(ator, alvo, campos, contexto) {
  if (!podeEditar(ator, alvo)) throw proibido(MENSAGENS.editar);
  const proprio = ator.id === alvo.id;
  const mudaPerfil = 'perfil' in campos && campos.perfil !== alvo.perfil;
  if (mudaPerfil && !ehGestor(ator)) throw proibido(MENSAGENS.perfil);
  if (mudaPerfil && proprio) throw regraViolada('Você não pode alterar o seu próprio perfil');
  if ('senhaHash' in campos && proprio) throw regraViolada('Para alterar a sua própria senha, use "Meu perfil"');

  const novos = {};
  const alteracoes = {};
  for (const campo of ['nome', 'email', 'perfil']) {
    if (campo in campos && campos[campo] !== alvo[campo]) {
      novos[campo] = campos[campo];
      alteracoes[campo] = { anterior: alvo[campo], novo: campos[campo] };
    }
  }
  verificarGestorRestante(alvo, { ...alvo, ...novos }, contexto);

  const auditoria = [];
  if (Object.keys(alteracoes).length > 0) auditoria.push({ acao: 'EDITADO', alteracoes });
  if ('senhaHash' in campos) {
    // Senha definida por outra pessoa é provisória: o usuário troca no primeiro acesso
    novos.senhaHash = campos.senhaHash;
    novos.senhaProvisoria = true;
    auditoria.push({ acao: 'SENHA_REDEFINIDA', alteracoes: {} });
  }
  return { campos: novos, auditoria };
}

// Desativar (ativo = false) ou reativar (ativo = true)
function aplicarAtivo(ator, alvo, ativo, contexto) {
  if (!podeAlterarAtivo(ator, alvo)) throw proibido(MENSAGENS.ativo);
  if (ator.id === alvo.id) throw regraViolada('Você não pode desativar nem reativar a si mesmo');
  if (alvo.ativo === ativo) return { campos: {}, auditoria: [] };
  verificarGestorRestante(alvo, { ...alvo, ativo }, contexto);
  return {
    campos: { ativo },
    auditoria: [{ acao: ativo ? 'REATIVADO' : 'DESATIVADO', alteracoes: { ativo: { anterior: alvo.ativo, novo: ativo } } }]
  };
}

// Campos que podem sair na API (nunca o hash da senha)
function publico(usuario) {
  if (!usuario) return null;
  const { id, nome, email, perfil, ativo, senhaProvisoria, criadoEm, atualizadoEm } = usuario;
  return { id, nome, email, perfil, ativo, senhaProvisoria, criadoEm, atualizadoEm };
}

module.exports = {
  PERFIS,
  SENHA_MINIMA,
  ErroHttp,
  MENSAGENS,
  podeGerenciar,
  podeCadastrar,
  podeEditar,
  podeAlterarAtivo,
  normalizarEmail,
  validarNome,
  validarEmail,
  validarSenha,
  lerCadastro,
  lerEdicao,
  verificarGestorRestante,
  aplicarEdicao,
  aplicarAtivo,
  publico
};
