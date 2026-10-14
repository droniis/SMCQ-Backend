// ============================================================
// POOL DE CONEXÕES COMPARTILHADO PELOS REPOSITÓRIOS POSTGRESQL
// ============================================================
const { criarPool, explicarErroBanco } = require('../../db/conexao');

let pool = null;

function obterPool() {
  if (!pool) {
    pool = criarPool();
    // Conexão ociosa que cai (ex.: banco reiniciado) não pode derrubar o servidor
    pool.on('error', err => console.error(`[banco] conexão ociosa perdida: ${explicarErroBanco(err)}`));
  }
  return pool;
}

// Executa fn(client) dentro de BEGIN/COMMIT; qualquer erro desfaz tudo (ROLLBACK)
async function emTransacao(fn) {
  const client = await obterPool().connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function encerrar() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { obterPool, emTransacao, encerrar };
