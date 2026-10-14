// ============================================================
// ALERTAS NO POSTGRESQL
// Decompõe o alerta nas tabelas do modelo (alerta, localizacao,
// fator_risco, classificacao_risco, contribuicao_criterio,
// historico_status, observacao, solicitacao_exclusao) e o remonta
// no MESMO formato devolvido pela API desde o protótipo em memória.
// Toda gravação que envolve mais de uma tabela roda em transação.
// ============================================================
const { obterPool, emTransacao } = require('./pool');
const { PESOS_AHP_V2 } = require('../../services/riscoService');

// Ordem dos critérios no "detalhes" devolvido (a mesma do cálculo)
const ORDEM_CRITERIOS = Object.keys(PESOS_AHP_V2);

const iso = (data) => (data ? data.toISOString() : null);
// JSONB: null/undefined viram NULL do SQL; o resto vai serializado
const json = (valor) => (valor === undefined || valor === null ? null : JSON.stringify(valor));

// Agrupa linhas por alerta_id → Map(alertaId → [linhas])
function agrupar(rows, chave = 'alerta_id') {
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r[chave])) mapa.set(r[chave], []);
    mapa.get(r[chave]).push(r);
  }
  return mapa;
}

function montarSolicitacao(r) {
  return {
    id: r.id,
    solicitadoPor: r.solicitado_por,
    motivo: r.motivo,
    status: r.status,
    criadoEm: iso(r.criado_em),
    resolvidoEm: iso(r.resolvido_em),
    resolvidoPor: r.resolvido_por,
    resposta: r.resposta
  };
}

function montarDetalhes(contribuicoes) {
  if (contribuicoes.length === 0) return null;
  const posicao = (c) => {
    const i = ORDEM_CRITERIOS.indexOf(c.criterio);
    return i === -1 ? ORDEM_CRITERIOS.length : i;
  };
  return Object.fromEntries(
    [...contribuicoes].sort((a, b) => posicao(a) - posicao(b)).map(c => [c.criterio, c.detalhe])
  );
}

function montarAlerta(r, { contribuicoes, historico, observacoes, solicitacoes }) {
  const alerta = {
    id: r.id,
    titulo: r.titulo,
    descricao: r.descricao,
    status: r.status,
    bioma: r.bioma,
    biomaOrigem: r.bioma_origem,
    tipoArea: r.tipo_area,
    tipoAreaOrigem: r.tipo_area_origem,
    areaCriticaFauna: r.area_critica_fauna,
    proximaUC: r.proxima_uc,
    irs: r.irs,
    pontuacaoRisco: r.irs, // nome usado desde o v1; mantido para o frontend
    sigmoide: r.sigmoide,
    risco: r.nivel,
    detalhes: montarDetalhes(contribuicoes),
    geodados: r.geodados,
    versaoAlgoritmo: r.versao_algoritmo,
    direcaoVento: r.direcao_vento,
    dA_dt: r.da_dt,
    latitude: r.latitude,
    longitude: r.longitude,
    estado: r.estado,
    municipio: r.municipio,
    cep: r.cep,
    logradouro: r.logradouro,
    numero: r.numero,
    bairro: r.bairro,
    areaAfetada: r.area_afetada,
    zonaUrbana: r.zona_urbana,
    vento: r.vento,
    pessoasRisco: r.pessoas_risco,
    criadoPor: r.criado_por,
    criadoEm: iso(r.criado_em),
    atualizadoEm: iso(r.atualizado_em),
    historico: historico.map(h => ({
      campo: h.campo,
      valorAnterior: h.valor_anterior,
      valorNovo: h.valor_novo,
      alteradoPor: h.alterado_por,
      alteradoEm: iso(h.alterado_em)
    })),
    solicitacoesExclusao: solicitacoes.map(montarSolicitacao),
    excluido: r.excluido,
    excluidoEm: iso(r.excluido_em)
  };
  // Como no protótipo: estes campos só aparecem depois da primeira exclusão / observação
  if (r.excluido_por !== null) alerta.excluidoPor = r.excluido_por;
  if (observacoes.length > 0) {
    alerta.observacoes = observacoes.map(o => ({ texto: o.texto, criadoPor: o.criado_por, criadoEm: iso(o.criado_em) }));
  }
  return alerta;
}

// Carrega alertas completos. db = pool ou client de uma transação em andamento.
async function carregar(db, { id = null, incluirExcluidos = false } = {}) {
  const filtros = [];
  const params = [];
  if (!incluirExcluidos) filtros.push('NOT a.excluido');
  if (id !== null) {
    params.push(id);
    filtros.push(`a.id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT a.*,
            l.latitude, l.longitude, l.estado, l.municipio, l.cep, l.logradouro, l.numero, l.bairro,
            f.area_afetada, f.vento, f.direcao_vento, f.pessoas_risco, f.zona_urbana, f.da_dt,
            f.bioma, f.bioma_origem, f.tipo_area, f.tipo_area_origem, f.area_critica_fauna, f.proxima_uc, f.geodados,
            c.id AS classificacao_id, c.versao_algoritmo, c.irs, c.sigmoide, c.nivel
       FROM alerta a
       JOIN localizacao l ON l.alerta_id = a.id
       JOIN fator_risco f ON f.alerta_id = a.id
       LEFT JOIN classificacao_risco c ON c.alerta_id = a.id
      ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
      ORDER BY a.id`,
    params
  );
  if (rows.length === 0) return [];

  const ids = rows.map(r => r.id);
  const classificacoes = rows.map(r => r.classificacao_id).filter(c => c !== null);
  const [contribuicoes, historico, observacoes, solicitacoes] = await Promise.all([
    db.query('SELECT * FROM contribuicao_criterio WHERE classificacao_id = ANY($1)', [classificacoes]),
    db.query('SELECT * FROM historico_status WHERE alerta_id = ANY($1) ORDER BY alterado_em, id', [ids]),
    db.query('SELECT * FROM observacao WHERE alerta_id = ANY($1) ORDER BY criado_em, id', [ids]),
    db.query('SELECT * FROM solicitacao_exclusao WHERE alerta_id = ANY($1) ORDER BY id', [ids])
  ]);
  const porClassificacao = agrupar(contribuicoes.rows, 'classificacao_id');
  const porAlerta = {
    historico: agrupar(historico.rows),
    observacoes: agrupar(observacoes.rows),
    solicitacoes: agrupar(solicitacoes.rows)
  };
  return rows.map(r => montarAlerta(r, {
    contribuicoes: porClassificacao.get(r.classificacao_id) || [],
    historico: porAlerta.historico.get(r.id) || [],
    observacoes: porAlerta.observacoes.get(r.id) || [],
    solicitacoes: porAlerta.solicitacoes.get(r.id) || []
  }));
}

async function carregarUm(db, id, opcoes = {}) {
  const [alerta] = await carregar(db, { id, ...opcoes });
  return alerta || null;
}

// Bloqueia a linha do alerta ativo até o fim da transação; false se não existe ou já foi excluído
async function travarAtivo(client, id) {
  const { rowCount } = await client.query('SELECT 1 FROM alerta WHERE id = $1 AND NOT excluido FOR UPDATE', [id]);
  return rowCount > 0;
}

async function registrarHistorico(client, alertaId, campo, valorAnterior, valorNovo, usuarioId, quando) {
  await client.query(
    `INSERT INTO historico_status (alerta_id, campo, valor_anterior, valor_novo, alterado_por, alterado_em)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [alertaId, campo, json(valorAnterior), json(valorNovo), usuarioId, quando]
  );
}

// Exclusão lógica: o alerta continua guardado para auditoria, mas some das listagens
async function marcarExcluido(client, id, usuarioId, agora) {
  await client.query(
    'UPDATE alerta SET excluido = TRUE, excluido_em = $2, excluido_por = $3, atualizado_em = $2 WHERE id = $1',
    [id, agora, usuarioId]
  );
  await registrarHistorico(client, id, 'excluido', false, true, usuarioId, agora);
}

// ------------------------------------------------------------
// Operações usadas pelas rotas (mesma interface do repositório em memória)
// ------------------------------------------------------------

async function listarAtivos() {
  return carregar(obterPool());
}

async function buscarAtivo(id) {
  return carregarUm(obterPool(), id);
}

// Alerta + localização + fatores de entrada + classificação + contribuições: tudo ou nada
async function criar(d) {
  return emTransacao(async (client) => {
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO alerta (titulo, descricao, status, criado_por, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [d.titulo, d.descricao, d.status, d.criadoPor, d.criadoEm, d.atualizadoEm]
    );
    await client.query(
      `INSERT INTO localizacao (alerta_id, latitude, longitude, estado, municipio, cep, logradouro, numero, bairro)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, d.latitude, d.longitude, d.estado, d.municipio, d.cep, d.logradouro, d.numero, d.bairro]
    );
    await client.query(
      `INSERT INTO fator_risco (alerta_id, area_afetada, vento, direcao_vento, pessoas_risco, zona_urbana, da_dt,
                                bioma, bioma_origem, tipo_area, tipo_area_origem, area_critica_fauna, proxima_uc, geodados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, d.areaAfetada, d.vento, d.direcaoVento, d.pessoasRisco, d.zonaUrbana, d.dA_dt,
        d.bioma, d.biomaOrigem, d.tipoArea, d.tipoAreaOrigem, d.areaCriticaFauna, d.proximaUC, json(d.geodados)]
    );
    const { rows: [{ id: classificacaoId }] } = await client.query(
      `INSERT INTO classificacao_risco (alerta_id, versao_algoritmo, irs, sigmoide, nivel, calculado_em)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, d.versaoAlgoritmo, d.irs, d.sigmoide, d.risco, d.criadoEm]
    );
    for (const [criterio, detalhe] of Object.entries(d.detalhes || {})) {
      await client.query(
        `INSERT INTO contribuicao_criterio (classificacao_id, criterio, fator, peso, contribuicao, detalhe)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [classificacaoId, criterio, detalhe.fator, detalhe.peso, detalhe.contribuicao, json(detalhe)]
      );
    }
    return carregarUm(client, id);
  });
}

// Status + registro no histórico
async function atualizarStatus(id, status, usuarioId) {
  return emTransacao(async (client) => {
    const { rows } = await client.query('SELECT status FROM alerta WHERE id = $1 AND NOT excluido FOR UPDATE', [id]);
    if (rows.length === 0) return null;
    const agora = new Date().toISOString();
    await client.query('UPDATE alerta SET status = $2, atualizado_em = $3 WHERE id = $1', [id, status, agora]);
    await registrarHistorico(client, id, 'status', rows[0].status, status, usuarioId, agora);
    return carregarUm(client, id);
  });
}

async function adicionarObservacao(id, texto, usuarioId) {
  return emTransacao(async (client) => {
    if (!(await travarAtivo(client, id))) return null;
    const agora = new Date().toISOString();
    await client.query(
      'INSERT INTO observacao (alerta_id, texto, criado_por, criado_em) VALUES ($1, $2, $3, $4)',
      [id, texto, usuarioId, agora]
    );
    await client.query('UPDATE alerta SET atualizado_em = $2 WHERE id = $1', [id, agora]);
    return carregarUm(client, id);
  });
}

// Exclusão direta: as solicitações pendentes ficam atendidas (APROVADA)
async function excluir(id, usuarioId) {
  return emTransacao(async (client) => {
    if (!(await travarAtivo(client, id))) return null;
    const agora = new Date().toISOString();
    await marcarExcluido(client, id, usuarioId, agora);
    await client.query(
      `UPDATE solicitacao_exclusao SET status = 'APROVADA', resolvido_em = $2, resolvido_por = $3
        WHERE alerta_id = $1 AND status = 'PENDENTE'`,
      [id, agora, usuarioId]
    );
    return carregarUm(client, id, { incluirExcluidos: true });
  });
}

// → a solicitação criada; null se o alerta não existe; erro SOLICITACAO_PENDENTE se já há uma pendente
async function criarSolicitacao(alertaId, usuarioId, motivo) {
  try {
    const { rows } = await obterPool().query(
      `INSERT INTO solicitacao_exclusao (alerta_id, solicitado_por, motivo, criado_em)
       SELECT id, $2, $3, $4 FROM alerta WHERE id = $1 AND NOT excluido
       RETURNING *`,
      [alertaId, usuarioId, motivo, new Date().toISOString()]
    );
    return rows.length ? montarSolicitacao(rows[0]) : null;
  } catch (err) {
    // O índice único uq_solic_pendente garante uma só pendente por alerta, mesmo com pedidos simultâneos
    if (err.code === '23505' && err.constraint === 'uq_solic_pendente') {
      throw Object.assign(new Error('Já existe uma solicitação de exclusão pendente'), { code: 'SOLICITACAO_PENDENTE' });
    }
    throw err;
  }
}

// filtro.solicitadoPor: só as desse usuário (null = todas); filtro.status: PENDENTE | APROVADA | REJEITADA
async function listarSolicitacoes({ solicitadoPor = null, status = null } = {}) {
  const { rows } = await obterPool().query(
    `SELECT s.*, a.titulo AS alerta_titulo, a.excluido AS alerta_excluido,
            us.nome AS solicitado_por_nome, ur.nome AS resolvido_por_nome
       FROM solicitacao_exclusao s
       JOIN alerta a ON a.id = s.alerta_id
       LEFT JOIN usuario us ON us.id = s.solicitado_por
       LEFT JOIN usuario ur ON ur.id = s.resolvido_por
      WHERE ($1::int IS NULL OR s.solicitado_por = $1)
        AND ($2::text IS NULL OR s.status = $2)
      ORDER BY s.criado_em DESC, s.id DESC`,
    [solicitadoPor, status || null]
  );
  return rows.map(r => ({
    ...montarSolicitacao(r),
    alertaId: r.alerta_id,
    alertaTitulo: r.alerta_titulo,
    alertaExcluido: r.alerta_excluido,
    solicitadoPorNome: r.solicitado_por_nome,
    resolvidoPorNome: r.resolvido_por_nome
  }));
}

// Aprova ou rejeita uma solicitação PENDENTE; aprovada, exclui o alerta na mesma transação.
// → a solicitação avaliada; null se ela não está mais pendente
async function avaliarSolicitacao(alertaId, solicitacaoId, decisao, resposta, usuarioId) {
  return emTransacao(async (client) => {
    if (!(await travarAtivo(client, alertaId))) return null;
    const agora = new Date().toISOString();
    const { rows } = await client.query(
      `UPDATE solicitacao_exclusao SET status = $3, resolvido_em = $4, resolvido_por = $5, resposta = $6
        WHERE id = $1 AND alerta_id = $2 AND status = 'PENDENTE'
        RETURNING *`,
      [solicitacaoId, alertaId, decisao, agora, usuarioId, resposta]
    );
    if (rows.length === 0) return null;
    if (decisao === 'APROVADA') await marcarExcluido(client, alertaId, usuarioId, agora);
    return montarSolicitacao(rows[0]);
  });
}

module.exports = {
  listarAtivos,
  buscarAtivo,
  criar,
  atualizarStatus,
  adicionarObservacao,
  excluir,
  criarSolicitacao,
  listarSolicitacoes,
  avaliarSolicitacao
};
