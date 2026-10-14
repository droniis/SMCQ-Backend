// ============================================================
// npm run db:seed — insere os usuários padrão de teste, com senha
// em hash bcrypt (RNF03). Idempotente: usuário com o mesmo e-mail
// já cadastrado é mantido como está.
// ============================================================
const bcrypt = require('bcryptjs');
const { criarPool, explicarErroBanco } = require('./conexao');
const usuariosPadrao = require('./usuariosPadrao');

const CUSTO_BCRYPT = 10;

async function main() {
  const pool = criarPool();
  try {
    for (const u of usuariosPadrao) {
      const { rowCount } = await pool.query(
        `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [u.nome, u.email, await bcrypt.hash(u.senha, CUSTO_BCRYPT), u.perfil]
      );
      console.log(`${rowCount ? '➕ inserido ' : '= já existia'}  ${u.email} (${u.perfil})`);
    }
    console.log('✅ Seed concluído.');
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  const dica = err.code === '42P01' ? ' Execute antes: npm run db:init' : '';
  console.error(`❌ Falha no seed: ${explicarErroBanco(err)}${dica}`);
  process.exit(1);
});
