// ============================================================
// FERRAMENTAS DE LINHA DE COMANDO DO POSTGRESQL (pg_dump, psql)
// Localiza o executável: PG_BIN no .env → PATH → instalação padrão
// do Windows (C:\Program Files\PostgreSQL\<versão>\bin, a mais nova).
// A senha vai pela variável PGPASSWORD do processo filho, nunca
// pela linha de comando (que fica visível na lista de processos).
// ============================================================
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { configuracaoBanco } = require('./conexao');

const EXT = process.platform === 'win32' ? '.exe' : '';

function localizarBinario(nome) {
  const candidatos = [];
  if (process.env.PG_BIN) candidatos.push(path.join(process.env.PG_BIN, nome + EXT));
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidatos.push(path.join(dir, nome + EXT));
  }
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && fs.existsSync(base)) {
    fs.readdirSync(base)
      .filter(v => /^\d+/.test(v))
      .sort((a, b) => parseFloat(b) - parseFloat(a))
      .forEach(v => candidatos.push(path.join(base, v, 'bin', nome + EXT)));
  }
  const encontrado = candidatos.find(c => fs.existsSync(c));
  if (!encontrado) {
    throw new Error(`${nome} não encontrado. Defina PG_BIN no .env com a pasta bin do PostgreSQL (ex.: C:\\Program Files\\PostgreSQL\\18\\bin).`);
  }
  return encontrado;
}

// Executa uma ferramenta do PostgreSQL com a conexão do .env (banco opcionalmente trocado)
function executarPg(nome, args, { banco } = {}) {
  const cfg = configuracaoBanco();
  const conexao = ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', banco || cfg.database];
  const r = spawnSync(localizarBinario(nome), [...conexao, ...args], {
    env: { ...process.env, PGPASSWORD: cfg.password },
    encoding: 'utf8'
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${nome} terminou com código ${r.status}: ${(r.stderr || '').trim()}`);
  return r;
}

module.exports = { localizarBinario, executarPg };
