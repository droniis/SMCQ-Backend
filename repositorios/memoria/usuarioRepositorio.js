// ============================================================
// USUÁRIOS EM MEMÓRIA (testes e PERSISTENCIA=memoria)
// Os usuários padrão, com senha em hash bcrypt (RNF03), mais os
// cadastrados pela gestão de usuários e a auditoria das ações.
// Mesma interface do repositório PostgreSQL. Devolve cópias.
// ============================================================
const bcrypt = require('bcryptjs');
const usuariosPadrao = require('../../db/usuariosPadrao');

const criadoEm = new Date().toISOString();
const usuarios = usuariosPadrao.map(({ senha, ...u }, i) => ({
  id: i + 1,
  ...u,
  senhaHash: bcrypt.hashSync(senha, 8),
  ativo: true,
  senhaProvisoria: false,
  criadoEm,
  atualizadoEm: criadoEm
}));
let proximoId = usuarios.length + 1;

const auditoria = [];
let proximoIdAuditoria = 1;

const copia = (u) => (u ? { ...u } : null);
const semSenha = ({ senhaHash: _senha, ...u }) => u;
const mesmoEmail = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

const erroEmailDuplicado = () =>
  Object.assign(new Error('Já existe um usuário com este e-mail'), { code: 'EMAIL_DUPLICADO' });

function registrarAuditoria(usuarioId, acao, alteracoes, realizadoPor, realizadoEm) {
  auditoria.push({ id: proximoIdAuditoria++, usuarioId, acao, alteracoes: structuredClone(alteracoes), realizadoPor, realizadoEm });
}

// Inclui os desativados: o login confere o campo "ativo" e explica o motivo
async function buscarPorEmail(email) {
  if (typeof email !== 'string') return null;
  return copia(usuarios.find(u => mesmoEmail(u.email, email)));
}

async function buscarPorId(id) {
  return copia(usuarios.find(u => u.id === id));
}

// filtro.perfil: ADMINISTRADOR | GESTOR | OPERADOR; filtro.ativo: true | false (null = todos)
async function listar({ perfil = null, ativo = null } = {}) {
  return usuarios
    .filter(u => (!perfil || u.perfil === perfil) && (ativo === null || u.ativo === ativo))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id)
    .map(u => semSenha(copia(u)));
}

// dados: { nome, email, perfil, senhaHash, senhaProvisoria } → usuário criado (com auditoria CRIADO)
async function criar(dados, realizadoPor) {
  if (usuarios.some(u => mesmoEmail(u.email, dados.email))) throw erroEmailDuplicado();
  const agora = new Date().toISOString();
  const usuario = { id: proximoId++, ...dados, ativo: true, criadoEm: agora, atualizadoEm: agora };
  usuarios.push(usuario);
  registrarAuditoria(usuario.id, 'CRIADO', { nome: dados.nome, email: dados.email, perfil: dados.perfil }, realizadoPor, agora);
  return copia(usuario);
}

// aplicar(alvo, { gestoresAtivos }) → { campos, auditoria } (usuarioService); se lançar erro, nada muda.
// → o usuário atualizado (ou o mesmo, se nada mudou); null se não existe
async function atualizar(id, realizadoPor, aplicar) {
  const alvo = usuarios.find(u => u.id === id);
  if (!alvo) return null;
  const gestoresAtivos = usuarios.filter(u => u.perfil === 'GESTOR' && u.ativo).length;
  const { campos, auditoria: registros } = aplicar(copia(alvo), { gestoresAtivos });
  if (registros.length === 0 && Object.keys(campos).length === 0) return copia(alvo);
  if ('email' in campos && usuarios.some(u => u.id !== id && mesmoEmail(u.email, campos.email))) throw erroEmailDuplicado();
  const agora = new Date().toISOString();
  Object.assign(alvo, campos, { atualizadoEm: agora });
  for (const r of registros) registrarAuditoria(id, r.acao, r.alteracoes, realizadoPor, agora);
  return copia(alvo);
}

function nomeDoUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  return usuario ? usuario.nome : null;
}

// Nomes dos autores (alertas, histórico, observações) → { [id]: nome }. Inclui usuários desativados.
async function nomesPorIds(ids) {
  return Object.fromEntries([...new Set(ids)].filter(id => id != null).map(id => [id, nomeDoUsuario(id)]));
}

// Auditoria de um usuário, da ação mais recente para a mais antiga
async function listarAuditoria(usuarioId) {
  return auditoria
    .filter(a => a.usuarioId === usuarioId)
    .sort((a, b) => b.realizadoEm.localeCompare(a.realizadoEm) || b.id - a.id)
    .map(a => ({ ...structuredClone(a), realizadoPorNome: nomeDoUsuario(a.realizadoPor) }));
}

module.exports = { buscarPorEmail, buscarPorId, listar, criar, atualizar, nomeDoUsuario, nomesPorIds, listarAuditoria };
