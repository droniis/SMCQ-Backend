// ============================================================
// CONEXÃO COM O POSTGRESQL (driver "pg", sem ORM)
// Credenciais somente por variáveis de ambiente (.env, fora do git).
// ============================================================
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

function configuracaoBanco() {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD não definida. Preencha o arquivo .env (modelo em .env.example).');
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'smcq',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    // Sem banco, a requisição falha em segundos em vez de ficar presa
    connectionTimeoutMillis: 5000
  };
}

function criarPool() {
  return new Pool(configuracaoBanco());
}

// Mensagem legível para as falhas de conexão mais comuns
function explicarErroBanco(err) {
  const { host, port, database, user } = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'smcq',
    user: process.env.DB_USER || 'postgres'
  };
  switch (err.code) {
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
      return `PostgreSQL inacessível em ${host}:${port}. Verifique se o serviço está em execução.`;
    case '28P01':
      return `Usuário ou senha do banco recusados (usuário "${user}"). Confira DB_USER e DB_PASSWORD no .env.`;
    case '3D000':
      return `O banco "${database}" não existe. Crie-o (ex.: createdb -U ${user} ${database}) ou ajuste DB_NAME no .env.`;
    default:
      if (/timeout/i.test(err.message)) return `Tempo esgotado ao conectar ao PostgreSQL em ${host}:${port}.`;
      return err.message;
  }
}

module.exports = { configuracaoBanco, criarPool, explicarErroBanco };
