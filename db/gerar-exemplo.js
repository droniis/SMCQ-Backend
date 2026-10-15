// ============================================================
// npm run db:exemplo — gera db/smcq-exemplo.sql (base de dados de
// exemplo para entrega): esquema + dados de demonstração.
//
// 1. Cria o banco temporário smcq_exemplo (o banco "smcq" não é tocado);
// 2. aplica o esquema e o seed (usuários de demonstração);
// 3. cadastra alertas e usuários pela própria API (IRS v2 e geodados reais — requer
//    internet) e os movimenta: status, observações, edição com recálculo do IRS,
//    solicitações de exclusão, troca de senha provisória e desativação;
// 4. exporta: db/schema.sql + dados em INSERTs simples (sem comandos
//    exclusivos do psql), para abrir também no Query Tool do pgAdmin;
// 5. confere a restauração num segundo banco temporário e apaga os dois.
//
// Senhas: só os hashes bcrypt das senhas de DEMONSTRAÇÃO documentadas
// no README (admin123, operador123, gestor123) e dos dois usuários
// cadastrados aqui (SENHA_EXEMPLO e SENHA_EXEMPLO_DEFINITIVA). Nenhuma senha real.
// ============================================================
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const { configuracaoBanco, explicarErroBanco } = require('./conexao');
const { executarPg } = require('./ferramentasPg');

const BANCO = 'smcq_exemplo';
const BANCO_VERIFICACAO = 'smcq_exemplo_verificacao';
const SAIDA = path.join(__dirname, 'smcq-exemplo.sql');
const TABELAS = ['usuario', 'alerta', 'localizacao', 'fator_risco', 'classificacao_risco', 'contribuicao_criterio',
  'historico_status', 'observacao', 'arquivo_anexo', 'solicitacao_exclusao', 'auditoria_usuario'];

// Usuários cadastrados pelo gestor (senhas de demonstração): a brigadista troca a senha
// provisória no primeiro acesso; o outro operador é desativado.
const SENHA_EXEMPLO = 'provisoria123';
const SENHA_EXEMPLO_DEFINITIVA = 'brigadista123';
const USUARIOS = {
  brigadista: { nome: 'Brigadista Exemplo', email: 'brigadista@smcq.com', perfil: 'OPERADOR', senha: SENHA_EXEMPLO },
  desligado: { nome: 'Operador Desligado', email: 'desligado@smcq.com', perfil: 'OPERADOR', senha: SENHA_EXEMPLO }
};

// Ocorrências de demonstração: uma queimada em vegetação por bioma e um incêndio urbano
// (endereço com ponto de referência, sem número). Como o frontend, enviam tipoOcorrencia, não zonaUrbana.
const VEGETACAO = 'QUEIMADA_VEGETACAO';
const ALERTAS = [
  { tipoOcorrencia: VEGETACAO, titulo: 'Queimada próxima à Transpantaneira', descricao: 'Fumaça intensa avistada por moradores', areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: true, latitude: -16.68, longitude: -56.67, estado: 'MT', municipio: 'Poconé' },
  { tipoOcorrencia: VEGETACAO, titulo: 'Foco em área de pastagem', descricao: 'Fogo em pasto seco às margens da rodovia', areaAfetada: 'MEDIA', vento: 'MODERADO', pessoasRisco: false, latitude: -14.13, longitude: -47.51, estado: 'GO', municipio: 'Alto Paraíso de Goiás' },
  { tipoOcorrencia: VEGETACAO, titulo: 'Incêndio em área de floresta', descricao: 'Coluna de fumaça visível da BR-163', areaAfetada: 'GRANDE', vento: 'ALTO', pessoasRisco: false, latitude: -7.04, longitude: -55.42, estado: 'PA', municipio: 'Novo Progresso' },
  { tipoOcorrencia: VEGETACAO, titulo: 'Queima de vegetação de caatinga', descricao: 'Pequeno foco controlado por brigadistas', areaAfetada: 'PEQUENA', vento: 'BAIXO', pessoasRisco: false, latitude: -9.39, longitude: -40.5, estado: 'PE', municipio: 'Petrolina' },
  { tipoOcorrencia: VEGETACAO, titulo: 'Fogo em encosta de mata', descricao: 'Fogo próximo a residências', areaAfetada: 'MEDIA', vento: 'MODERADO', pessoasRisco: true, latitude: -22.95, longitude: -43.25, estado: 'RJ', municipio: 'Rio de Janeiro' },
  { tipoOcorrencia: VEGETACAO, titulo: 'Queimada em campo nativo', descricao: 'Registro de teste: será excluído após aprovação', areaAfetada: 'PEQUENA', vento: 'MODERADO', pessoasRisco: false, latitude: -30.89, longitude: -55.53, estado: 'RS', municipio: "Sant'Ana do Livramento" },
  { tipoOcorrencia: 'INCENDIO_URBANO', titulo: 'Incêndio em terreno baldio', descricao: 'Fogo em entulho e mato seco, fumaça atingindo prédios vizinhos', areaAfetada: 'PEQUENA', vento: 'MODERADO', pessoasRisco: true, latitude: -23.551269, longitude: -46.634371, cep: '01001000', logradouro: 'Terreno baldio próximo à Praça da Sé', numero: 'S/N', bairro: 'Sé', estado: 'SP', municipio: 'São Paulo' }
];

async function comBancoAdministrativo(sql) {
  const cliente = new Client({ ...configuracaoBanco(), database: 'postgres' });
  await cliente.connect();
  try {
    for (const comando of sql) await cliente.query(comando);
  } finally {
    await cliente.end();
  }
}
const recriar = (banco) => comBancoAdministrativo([`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`, `CREATE DATABASE ${banco} ENCODING 'UTF8'`]);
const apagar = (...bancos) => comBancoAdministrativo(bancos.map(b => `DROP DATABASE IF EXISTS ${b} WITH (FORCE)`));

function rodarScript(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { env: { ...process.env, DB_NAME: BANCO }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script}: ${r.stderr || r.stdout}`);
  console.log(r.stdout.trimEnd().replace(/^/gm, '   '));
}

// Cadastra os alertas e movimenta alguns (status, observações, solicitações) pela API
async function popularPelaApi() {
  process.env.DB_NAME = BANCO;
  process.env.PERSISTENCIA = 'postgres';
  const app = require('../server');
  const repositorios = require('../repositorios');
  const servidor = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://localhost:${servidor.address().port}/api`;
  const api = async (metodo, caminho, token, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${JSON.stringify(body)}`);
    return body;
  };
  const login = async (email, senha) => (await api('POST', '/login', null, { email, senha })).token;
  try {
    const operador = await login('operador@smcq.com', 'operador123');
    const gestor = await login('gestor@smcq.com', 'gestor123');
    const admin = await login('admin@smcq.com', 'admin123');
    const ids = [];
    for (const dados of ALERTAS) {
      const a = await api('POST', '/alertas', operador, dados);
      ids.push(a.id);
      console.log(`   ➕ #${a.id} ${a.tipoOcorrencia} ${a.municipio}/${a.estado}: ${a.bioma}, ${a.tipoArea}, risco ${a.risco} (IRS ${a.irs})`);
    }
    const [pantanal, cerrado, amazonia, caatinga, mata, pampa, urbano] = ids;
    await api('PATCH', `/alertas/${pantanal}/status`, gestor, { status: 'EM_ANALISE' });
    await api('PATCH', `/alertas/${pantanal}/status`, gestor, { status: 'EM_ATENDIMENTO' });
    await api('POST', `/alertas/${pantanal}/observacoes`, operador, { observacao: 'Brigada do PREVFOGO acionada' });
    await api('PATCH', `/alertas/${amazonia}/status`, gestor, { status: 'EM_ANALISE' });
    // Transições do UC05: NOVO → EM_ANALISE → EM_ATENDIMENTO → RESOLVIDO
    for (const status of ['EM_ANALISE', 'EM_ATENDIMENTO', 'RESOLVIDO']) {
      await api('PATCH', `/alertas/${caatinga}/status`, gestor, { status });
    }
    await api('POST', `/alertas/${caatinga}/observacoes`, operador, { observacao: 'Foco extinto pela brigada municipal' });
    await api('POST', `/alertas/${mata}/observacoes`, operador, { observacao: 'Defesa Civil notificada' });
    await api('PATCH', `/alertas/${urbano}/status`, gestor, { status: 'EM_ANALISE' });
    await api('PATCH', `/alertas/${urbano}/status`, gestor, { status: 'EM_ATENDIMENTO' });
    await api('POST', `/alertas/${urbano}/observacoes`, operador, { observacao: 'Corpo de Bombeiros no local' });
    // Solicitação rejeitada, solicitação pendente e solicitação aprovada (exclusão lógica)
    const rejeitada = await api('POST', `/alertas/${cerrado}/solicitacoes-exclusao`, operador, { motivo: 'Possível duplicidade' });
    await api('PATCH', `/alertas/${cerrado}/solicitacoes-exclusao/${rejeitada.id}`, gestor, { decisao: 'REJEITADA', resposta: 'Ocorrências distintas' });
    await api('POST', `/alertas/${mata}/solicitacoes-exclusao`, operador, { motivo: 'Confirmar se o foco já foi registrado pelos bombeiros' });
    const aprovada = await api('POST', `/alertas/${pampa}/solicitacoes-exclusao`, operador, { motivo: 'Alerta cadastrado por engano' });
    await api('PATCH', `/alertas/${pampa}/solicitacoes-exclusao/${aprovada.id}`, admin, { decisao: 'APROVADA', resposta: 'Excluído' });
    // Edição (RF11): muda a área afetada e o vento, entradas do cálculo → IRS recalculado, campos no histórico
    const editado = await api('PATCH', `/alertas/${cerrado}`, gestor, { areaAfetada: 'GRANDE', vento: 'ALTO', descricao: 'Fogo em pasto seco avançou para a vegetação nativa' });
    console.log(`   ✏️  #${cerrado} editado: risco ${editado.risco} (IRS ${editado.irs})`);
    console.log('   ✔ status, observações, edição e solicitações de exclusão registrados');

    // Gestão de usuários (RF04): cadastro com senha provisória, troca no primeiro acesso,
    // edição pelo administrador e desativação pelo gestor (tudo em auditoria_usuario)
    const brigadista = await api('POST', '/usuarios', gestor, USUARIOS.brigadista);
    const desligado = await api('POST', '/usuarios', gestor, USUARIOS.desligado);
    const tokenBrigadista = await login(USUARIOS.brigadista.email, SENHA_EXEMPLO);
    await api('PATCH', '/perfil/senha', tokenBrigadista, { senhaAtual: SENHA_EXEMPLO, novaSenha: SENHA_EXEMPLO_DEFINITIVA });
    await api('POST', `/alertas/${amazonia}/observacoes`, tokenBrigadista, { observacao: 'Equipe em deslocamento pela BR-163' });
    await api('PATCH', `/usuarios/${brigadista.id}`, admin, { nome: 'Brigadista de Exemplo' });
    await api('PATCH', `/usuarios/${desligado.id}/ativo`, gestor, { ativo: false });
    console.log(`   ✔ usuários #${brigadista.id} (senha trocada) e #${desligado.id} (desativado) registrados`);
  } finally {
    await new Promise(resolve => servidor.close(resolve));
    await repositorios.encerrar();
  }
}

function exportar() {
  const { stdout: dados } = executarPg('pg_dump', ['--data-only', '--column-inserts', '--no-owner', '--no-privileges', '--encoding=UTF8'], { banco: BANCO });
  // Remove os comandos exclusivos do psql (\restrict, \unrestrict), que o pgAdmin não executa
  const dadosPortaveis = dados.split(/\r?\n/).filter(l => !l.startsWith('\\')).join('\n');
  const cabecalho = `-- ============================================================
-- SMCQ — BASE DE DADOS DE EXEMPLO (PostgreSQL 18, sem PostGIS)
-- Gerado por "npm run db:exemplo" em ${new Date().toISOString().slice(0, 10)}.
--
-- Contém o esquema completo (db/schema.sql) e dados de demonstração:
-- ${3 + Object.keys(USUARIOS).length} usuários (um deles desativado) e ${ALERTAS.length} alertas classificados pelo IRS v2 com geodados reais
-- (${ALERTAS.filter(a => a.tipoOcorrencia === VEGETACAO).length} queimadas em vegetação, uma por bioma, e ${ALERTAS.filter(a => a.tipoOcorrencia !== VEGETACAO).length} incêndio em área urbana),
-- com histórico de status e de edição, observações, solicitações de exclusão
-- e a auditoria das ações sobre os usuários.
--
-- Senhas: apenas hashes bcrypt das senhas de DEMONSTRAÇÃO
-- (admin@smcq.com / admin123, operador@smcq.com / operador123,
--  gestor@smcq.com / gestor123, ${USUARIOS.brigadista.email} / ${SENHA_EXEMPLO_DEFINITIVA};
--  ${USUARIOS.desligado.email} está desativado). Nenhuma senha real.
--
-- Como carregar (num banco vazio):
--   createdb -U postgres smcq
--   psql -U postgres -d smcq -f db/smcq-exemplo.sql
-- ou abra este arquivo no Query Tool do pgAdmin e execute.
-- ============================================================

`;
  fs.writeFileSync(SAIDA, cabecalho + fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8') +
    '\n-- ============================================================\n-- DADOS DE EXEMPLO\n-- ============================================================\n' + dadosPortaveis);
}

// Carrega o arquivo gerado num banco vazio e confere a contagem de cada tabela
async function verificar() {
  await recriar(BANCO_VERIFICACAO);
  executarPg('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-f', SAIDA], { banco: BANCO_VERIFICACAO });
  const contar = async (banco) => {
    const cliente = new Client({ ...configuracaoBanco(), database: banco });
    await cliente.connect();
    try {
      const r = {};
      for (const t of TABELAS) r[t] = (await cliente.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      return r;
    } finally {
      await cliente.end();
    }
  };
  const [original, restaurado] = [await contar(BANCO), await contar(BANCO_VERIFICACAO)];
  for (const t of TABELAS) {
    if (original[t] !== restaurado[t]) throw new Error(`restauração divergente em ${t}: ${original[t]} ≠ ${restaurado[t]}`);
  }
  console.log(`   ✔ restauração conferida num banco vazio: ${TABELAS.map(t => `${t}=${restaurado[t]}`).join(', ')}`);
}

async function main() {
  console.log(`1. Criando o banco temporário ${BANCO}`);
  await recriar(BANCO);
  try {
    console.log('2. Esquema e usuários de demonstração');
    rodarScript('init.js');
    rodarScript('seed.js');
    console.log('3. Alertas pela API (consulta os geodados reais)');
    await popularPelaApi();
    console.log(`4. Exportando ${path.relative(process.cwd(), SAIDA)}`);
    exportar();
    console.log('5. Conferindo a restauração');
    await verificar();
    console.log(`✅ ${path.relative(process.cwd(), SAIDA)} gerado (${(fs.statSync(SAIDA).size / 1024).toFixed(1)} KB)`);
  } finally {
    await apagar(BANCO, BANCO_VERIFICACAO);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(`❌ Falha ao gerar o exemplo: ${explicarErroBanco(err)}`);
  process.exit(1);
});
