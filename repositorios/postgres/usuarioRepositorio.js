// ============================================================
// USUÁRIOS NO POSTGRESQL (tabela usuario)
// ============================================================
const { obterPool } = require('./pool');

async function buscarPorEmail(email) {
  const { rows } = await obterPool().query(
    'SELECT id, nome, email, senha_hash, perfil FROM usuario WHERE email = $1 AND ativo',
    [email]
  );
  if (rows.length === 0) return null;
  const { senha_hash, ...usuario } = rows[0];
  return { ...usuario, senhaHash: senha_hash };
}

module.exports = { buscarPorEmail };
