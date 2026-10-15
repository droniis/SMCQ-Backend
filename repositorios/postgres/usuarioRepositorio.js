// ============================================================
// USUÁRIOS NO POSTGRESQL (tabelas usuario e auditoria_usuario)
// Mesma interface do repositório em memória. Toda alteração grava
// o usuário e a auditoria na mesma transação.
// ============================================================
const { obterPool, emTransacao } = require('./pool');

const iso = (data) => (data ? data.toISOString() : null);
const COLUNAS = 'id, nome, email, perfil, ativo, senha_provisoria, criado_em, atualizado_em';

// Coluna de cada campo que a gestão de usuários pode alterar
const COLUNA_DO_CAMPO = {
  nome: 'nome',
  email: 'email',
  perfil: 'perfil',
  senhaHash: 'senha_hash',
  senhaProvisoria: 'senha_provisoria',
  ativo: 'ativo'
};

function montarUsuario(r) {
  const usuario = {
    id: r.id,
    nome: r.nome,
    email: r.email,
    perfil: r.perfil,
    ativo: r.ativo,
    senhaProvisoria: r.senha_provisoria,
    criadoEm: iso(r.criado_em),
    atualizadoEm: iso(r.atualizado_em)
  };
  if (r.senha_hash !== undefined) usuario.senhaHash = r.senha_hash;
  return usuario;
}

// E-mail repetido: o UNIQUE da coluna garante, mesmo com cadastros simultâneos
function traduzirErro(err) {
  if (err.code === '23505' && err.constraint === 'usuario_email_key') {
    return Object.assign(new Error('Já existe um usuário com este e-mail'), { code: 'EMAIL_DUPLICADO' });
  }
  return err;
}

async function registrarAuditoria(client, usuarioId, acao, alteracoes, realizadoPor, quando) {
  await client.query(
    `INSERT INTO auditoria_usuario (usuario_id, acao, alteracoes, realizado_por, realizado_em)
     VALUES ($1, $2, $3, $4, $5)`,
    [usuarioId, acao, JSON.stringify(alteracoes || {}), realizadoPor, quando]
  );
}

// Inclui os desativados: o login confere o campo "ativo" e explica o motivo.
// Os e-mails são gravados em minúsculas; lower() cobre os antigos.
async function buscarPorEmail(email) {
  if (typeof email !== 'string') return null;
  const { rows } = await obterPool().query(
    `SELECT ${COLUNAS}, senha_hash FROM usuario WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
  return rows.length ? montarUsuario(rows[0]) : null;
}

async function buscarPorId(id) {
  const { rows } = await obterPool().query(`SELECT ${COLUNAS}, senha_hash FROM usuario WHERE id = $1`, [id]);
  return rows.length ? montarUsuario(rows[0]) : null;
}

// filtro.perfil: ADMINISTRADOR | GESTOR | OPERADOR; filtro.ativo: true | false (null = todos)
async function listar({ perfil = null, ativo = null } = {}) {
  const { rows } = await obterPool().query(
    `SELECT ${COLUNAS} FROM usuario
      WHERE ($1::text IS NULL OR perfil = $1)
        AND ($2::boolean IS NULL OR ativo = $2)
      ORDER BY nome, id`,
    [perfil, ativo]
  );
  return rows.map(montarUsuario);
}

// dados: { nome, email, perfil, senhaHash, senhaProvisoria } → usuário criado (com auditoria CRIADO)
async function criar(dados, realizadoPor) {
  try {
    return await emTransacao(async (client) => {
      const agora = new Date().toISOString();
      const { rows: [linha] } = await client.query(
        `INSERT INTO usuario (nome, email, senha_hash, perfil, senha_provisoria, criado_em, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING ${COLUNAS}`,
        [dados.nome, dados.email, dados.senhaHash, dados.perfil, dados.senhaProvisoria, agora]
      );
      await registrarAuditoria(client, linha.id, 'CRIADO', { nome: dados.nome, email: dados.email, perfil: dados.perfil }, realizadoPor, agora);
      return montarUsuario(linha);
    });
  } catch (err) {
    throw traduzirErro(err);
  }
}

// aplicar(alvo, { gestoresAtivos }) → { campos, auditoria } (usuarioService); se lançar erro, ROLLBACK.
// Os gestores ativos ficam travados até o fim da transação: duas desativações simultâneas
// não conseguem, juntas, deixar o sistema sem gestor.
// → o usuário atualizado (ou o mesmo, se nada mudou); null se não existe
async function atualizar(id, realizadoPor, aplicar) {
  try {
    return await emTransacao(async (client) => {
      const { rows: gestores } = await client.query(
        "SELECT id FROM usuario WHERE perfil = 'GESTOR' AND ativo ORDER BY id FOR UPDATE"
      );
      const { rows } = await client.query(`SELECT ${COLUNAS}, senha_hash FROM usuario WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) return null;
      const alvo = montarUsuario(rows[0]);
      const { campos, auditoria } = aplicar(alvo, { gestoresAtivos: gestores.length });
      const alterados = Object.keys(campos).filter(c => c in COLUNA_DO_CAMPO);
      if (alterados.length === 0 && auditoria.length === 0) return alvo;

      const agora = new Date().toISOString();
      const valores = alterados.map(c => campos[c]);
      const sets = alterados.map((c, i) => `${COLUNA_DO_CAMPO[c]} = $${i + 2}`);
      sets.push(`atualizado_em = $${alterados.length + 2}`);
      const { rows: [linha] } = await client.query(
        `UPDATE usuario SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUNAS}, senha_hash`,
        [id, ...valores, agora]
      );
      for (const r of auditoria) await registrarAuditoria(client, id, r.acao, r.alteracoes, realizadoPor, agora);
      return montarUsuario(linha);
    });
  } catch (err) {
    throw traduzirErro(err);
  }
}

// Nomes dos autores (alertas, histórico, observações) → { [id]: nome }. Inclui usuários desativados.
async function nomesPorIds(ids) {
  const unicos = [...new Set(ids)].filter(id => id != null);
  if (unicos.length === 0) return {};
  const { rows } = await obterPool().query('SELECT id, nome FROM usuario WHERE id = ANY($1)', [unicos]);
  return Object.fromEntries(rows.map(r => [r.id, r.nome]));
}

// Auditoria de um usuário, da ação mais recente para a mais antiga
async function listarAuditoria(usuarioId) {
  const { rows } = await obterPool().query(
    `SELECT a.*, u.nome AS realizado_por_nome
       FROM auditoria_usuario a
       LEFT JOIN usuario u ON u.id = a.realizado_por
      WHERE a.usuario_id = $1
      ORDER BY a.realizado_em DESC, a.id DESC`,
    [usuarioId]
  );
  return rows.map(r => ({
    id: r.id,
    usuarioId: r.usuario_id,
    acao: r.acao,
    alteracoes: r.alteracoes,
    realizadoPor: r.realizado_por,
    realizadoEm: iso(r.realizado_em),
    realizadoPorNome: r.realizado_por_nome
  }));
}

module.exports = { buscarPorEmail, buscarPorId, listar, criar, atualizar, nomesPorIds, listarAuditoria };
