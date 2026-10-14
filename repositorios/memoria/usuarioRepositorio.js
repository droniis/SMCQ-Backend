// ============================================================
// USUÁRIOS EM MEMÓRIA (testes e PERSISTENCIA=memoria)
// Os usuários padrão, com senha em hash bcrypt (RNF03).
// ============================================================
const bcrypt = require('bcryptjs');
const usuariosPadrao = require('../../db/usuariosPadrao');

const usuarios = usuariosPadrao.map(({ senha, ...u }, i) => ({
  id: i + 1,
  ...u,
  senhaHash: bcrypt.hashSync(senha, 8)
}));

async function buscarPorEmail(email) {
  const usuario = usuarios.find(u => u.email === email);
  return usuario ? { ...usuario } : null;
}

function nomeDoUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  return usuario ? usuario.nome : null;
}

module.exports = { buscarPorEmail, nomeDoUsuario };
