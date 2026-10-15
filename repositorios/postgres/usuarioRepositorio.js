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

// Nomes dos autores (alertas, histórico, observações) → { [id]: nome }. Inclui usuários desativados.
async function nomesPorIds(ids) {
  const unicos = [...new Set(ids)].filter(id => id != null);
  if (unicos.length === 0) return {};
  const { rows } = await obterPool().query('SELECT id, nome FROM usuario WHERE id = ANY($1)', [unicos]);
  return Object.fromEntries(rows.map(r => [r.id, r.nome]));
}

module.exports = { buscarPorEmail, nomesPorIds };
