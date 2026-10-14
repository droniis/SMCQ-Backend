// ============================================================
// npm run db:init — cria as tabelas e índices (db/schema.sql).
// Idempotente: não apaga nem altera dados existentes.
// ============================================================
const fs = require('fs');
const path = require('path');
const { criarPool, explicarErroBanco } = require('./conexao');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = criarPool();
  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    console.log(`✅ Esquema aplicado. Tabelas (${rows.length}): ${rows.map(r => r.table_name).join(', ')}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`❌ Falha ao criar o esquema: ${explicarErroBanco(err)}`);
  process.exit(1);
});
