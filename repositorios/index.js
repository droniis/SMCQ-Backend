// ============================================================
// ESCOLHA DA PERSISTÊNCIA (variável de ambiente PERSISTENCIA)
//   postgres → PostgreSQL (dados permanecem após reiniciar)
//   memoria  → em memória (padrão; usada pelos testes automatizados)
// As duas implementações têm a mesma interface.
// ============================================================
require('dotenv').config({ quiet: true });

const TIPOS = ['postgres', 'memoria'];
const tipo = (process.env.PERSISTENCIA || 'memoria').trim().toLowerCase();
if (!TIPOS.includes(tipo)) {
  throw new Error(`PERSISTENCIA inválida: "${process.env.PERSISTENCIA}". Use ${TIPOS.join(' ou ')}.`);
}

let repositorios;
if (tipo === 'postgres') {
  const { configuracaoBanco, explicarErroBanco } = require('../db/conexao');
  configuracaoBanco(); // falha já na inicialização se o .env estiver incompleto
  const { obterPool, encerrar } = require('./postgres/pool');
  repositorios = {
    tipo,
    usuarios: require('./postgres/usuarioRepositorio'),
    alertas: require('./postgres/alertaRepositorio'),
    // Confere a conexão e se o banco foi preparado (db:init e db:seed); só informa, não derruba o servidor
    async verificarConexao() {
      try {
        const { rows: [{ total }] } = await obterPool().query('SELECT count(*)::int AS total FROM usuario');
        const { DB_HOST = 'localhost', DB_PORT = 5432, DB_NAME = 'smcq' } = process.env;
        console.log(`   🗄️  PostgreSQL conectado: ${DB_NAME} em ${DB_HOST}:${DB_PORT} (${total} usuários)`);
        if (total === 0) console.warn('   ⚠️  Nenhum usuário cadastrado. Execute: npm run db:seed');
        return true;
      } catch (err) {
        console.error(`   ❌ PostgreSQL indisponível: ${explicarErroBanco(err)}`);
        console.error('      O servidor continua no ar; as rotas que usam dados responderão 503 até o banco voltar.');
        return false;
      }
    },
    encerrar
  };
} else {
  repositorios = {
    tipo,
    usuarios: require('./memoria/usuarioRepositorio'),
    alertas: require('./memoria/alertaRepositorio'),
    async verificarConexao() {
      console.log('   ⚠️  Persistência em MEMÓRIA: os dados somem ao reiniciar (PERSISTENCIA=postgres no .env para usar o banco).');
      return true;
    },
    async encerrar() {}
  };
}

module.exports = repositorios;
