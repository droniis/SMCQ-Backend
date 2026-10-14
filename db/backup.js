// ============================================================
// npm run db:backup — cópia de segurança do banco (RNF07)
// Gera backups/smcq-AAAA-MM-DD_HH-MM-SS.sql com pg_dump (SQL puro,
// esquema + dados) e mantém só os BACKUP_RETENCAO mais recentes
// (padrão 30). Sai com código ≠ 0 em caso de falha, para o
// Agendador de Tarefas do Windows registrar o erro.
//
// Restaurar:  psql -U postgres -d smcq -f backups/<arquivo>.sql
// (o arquivo apaga e recria as tabelas: --clean --if-exists)
// ============================================================
const fs = require('fs');
const path = require('path');
const { executarPg } = require('./ferramentasPg');

const PASTA = path.join(__dirname, '..', 'backups');
const RETENCAO = Number(process.env.BACKUP_RETENCAO) || 30;

const doisDigitos = (n) => String(n).padStart(2, '0');
function carimbo(d = new Date()) {
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}` +
    `_${doisDigitos(d.getHours())}-${doisDigitos(d.getMinutes())}-${doisDigitos(d.getSeconds())}`;
}

function main() {
  fs.mkdirSync(PASTA, { recursive: true });
  const arquivo = path.join(PASTA, `smcq-${carimbo()}.sql`);
  try {
    executarPg('pg_dump', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--encoding=UTF8', '-f', arquivo]);
  } catch (err) {
    fs.rmSync(arquivo, { force: true }); // não deixa um backup pela metade
    throw err;
  }
  const kb = (fs.statSync(arquivo).size / 1024).toFixed(1);
  console.log(`✅ Backup gerado: ${path.relative(process.cwd(), arquivo)} (${kb} KB)`);

  // Retenção: apaga os mais antigos além do limite (o nome datado ordena cronologicamente)
  const antigos = fs.readdirSync(PASTA).filter(f => /^smcq-.*\.sql$/.test(f)).sort().reverse().slice(RETENCAO);
  for (const f of antigos) fs.rmSync(path.join(PASTA, f));
  if (antigos.length) console.log(`🧹 ${antigos.length} backup(s) antigo(s) removido(s) (retenção: ${RETENCAO})`);
}

try {
  main();
} catch (err) {
  console.error(`❌ Falha no backup: ${err.message}`);
  process.exit(1);
}
