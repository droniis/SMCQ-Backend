require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const classificacao = require('./services/classificacaoService');
const geodadosService = require('./services/geodadosService');
const ocorrencia = require('./services/ocorrenciaService');
const statusService = require('./services/statusService');
const edicao = require('./services/edicaoService');
const { ehErroDeConexao, explicarErroBanco } = require('./db/conexao');

const app = express();
const PORT = 3000;

// Segredo dos tokens: obrigatório no .env. Só os testes (Jest define NODE_ENV=test) têm valor padrão.
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'segredo-apenas-para-testes' : null);
if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET não definido. Crie o arquivo .env a partir do .env.example e preencha JWT_SECRET.');
    console.error('   Para gerar um valor: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
}

// ============================================================
// PERSISTÊNCIA: PostgreSQL ou memória, conforme PERSISTENCIA no .env
// (repositorios/index.js). Configuração inválida impede a inicialização.
// ============================================================
let repositorios;
try {
    repositorios = require('./repositorios');
} catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
}
const { usuarios, alertas } = repositorios;

// Middlewares
app.use(cors());
app.use(express.json());

// Rotas assíncronas: um erro (ex.: banco fora do ar) segue para o tratador de erros no fim do arquivo
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================
// FUNÇÃO DE AUTENTICAÇÃO (MIDDLEWARE)
// ============================================================
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (err) {
        // 401 = sessão inválida ou expirada; 403 fica reservado para permissão negada
        return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
// Administrador e Gestor excluem alertas direto e avaliam as solicitações; o Operador solicita a exclusão
function podeExcluirDireto(req) {
    return ['ADMINISTRADOR', 'GESTOR'].includes(req.usuario.perfil);
}

// Alertas criados antes do IRS v2 não têm a versão gravada: são do v1
function comVersao(alerta) {
    if (!alerta.versaoAlgoritmo) alerta.versaoAlgoritmo = classificacao.versaoDoAlerta(alerta);
    return alerta;
}

// Alerta com o nome de cada autor (criação, histórico, observações, solicitações),
// resolvido pelo id do usuário. Usuários desativados continuam com o nome nos registros.
async function comNomes(alerta) {
    const historico = alerta.historico || [];
    const observacoes = alerta.observacoes || [];
    const solicitacoes = alerta.solicitacoesExclusao || [];
    const nomes = await usuarios.nomesPorIds([
        alerta.criadoPor,
        ...historico.map(h => h.alteradoPor),
        ...observacoes.map(o => o.criadoPor),
        ...solicitacoes.flatMap(s => [s.solicitadoPor, s.resolvidoPor])
    ]);
    const nome = (id) => (id == null ? null : nomes[id] ?? null);
    const resultado = {
        ...comVersao(alerta),
        criadoPorNome: nome(alerta.criadoPor),
        historico: historico.map(h => ({ ...h, alteradoPorNome: nome(h.alteradoPor) })),
        solicitacoesExclusao: solicitacoes.map(s => ({ ...s, solicitadoPorNome: nome(s.solicitadoPor), resolvidoPorNome: nome(s.resolvidoPor) }))
    };
    if (alerta.observacoes) resultado.observacoes = observacoes.map(o => ({ ...o, criadoPorNome: nome(o.criadoPor) }));
    return resultado;
}

const TAMANHO_MAXIMO_OBSERVACAO = 2000;

// ============================================================
// ROTA DE LOGIN (PÚBLICA)
// ============================================================
app.post('/api/login', rota(async (req, res) => {
    const { email, senha } = req.body;
    const usuario = await usuarios.buscarPorEmail(email);
    if (!usuario) {
        return res.status(401).json({ erro: 'Usuário não encontrado' });
    }
    if (!bcrypt.compareSync(senha, usuario.senhaHash)) {
        return res.status(401).json({ erro: 'Senha incorreta' });
    }
    const token = jwt.sign(
        { id: usuario.id, email: usuario.email, perfil: usuario.perfil },
        JWT_SECRET,
        { expiresIn: '2h' }
    );
    res.json({
        token,
        usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            perfil: usuario.perfil
        }
    });
}));

// ============================================================
// ROTAS PROTEGIDAS (REQUEREM TOKEN)
// ============================================================
app.use('/api', autenticarToken);

// Listar alertas (sem os excluídos). Filtro opcional: ?tipoOcorrencia=QUEIMADA_VEGETACAO | INCENDIO_URBANO
app.get('/api/alertas', rota(async (req, res) => {
    const { tipoOcorrencia } = req.query;
    if (tipoOcorrencia !== undefined && !ocorrencia.tipoValido(tipoOcorrencia)) {
        return res.status(400).json({ erro: `Tipo de ocorrência inválido: ${tipoOcorrencia}. Valores aceitos: ${ocorrencia.TIPOS_OCORRENCIA.join(', ')}` });
    }
    res.json((await alertas.listarAtivos({ tipoOcorrencia })).map(comVersao));
}));

// Geodados de um ponto, sem criar alerta. O frontend chama ao clicar no mapa:
// a resposta fica em cache e o POST seguinte, no mesmo ponto, já a encontra pronta.
// Declarada antes das rotas /api/alertas/:id.
app.get('/api/alertas/geodados-preview', async (req, res) => {
    const { lat, lng } = req.query;
    if (!classificacao.validarCoordenadas(lat, lng)) {
        return res.status(400).json({ erro: 'Parâmetros lat e lng obrigatórios, numéricos, com lat entre -90 e 90 e lng entre -180 e 180' });
    }
    try {
        res.json(await geodadosService.obterGeodadosCompletos(Number(lat), Number(lng)));
    } catch (err) {
        res.status(500).json({ erro: `Falha ao obter geodados: ${err.message}` });
    }
});

// Criar novo alerta, classificado pelo IRS v2
app.post('/api/alertas', rota(async (req, res) => {
    const { titulo, descricao, areaAfetada, vento, pessoasRisco, latitude, longitude } = req.body;
    if (!titulo || !areaAfetada || !vento || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ erro: 'Título, área, vento e localização são obrigatórios' });
    }
    if (!classificacao.validarCoordenadas(latitude, longitude)) {
        return res.status(400).json({ erro: 'Coordenadas inválidas: latitude entre -90 e 90 e longitude entre -180 e 180' });
    }
    // Tipo de ocorrência: se vier junto com o antigo "zonaUrbana", prevalece o tipo (services/ocorrenciaService.js)
    const { tipoOcorrencia, zonaUrbana, erro: erroTipo } = ocorrencia.resolverTipoOcorrencia(req.body);
    if (erroTipo) {
        return res.status(400).json({ erro: erroTipo });
    }
    // Incêndio urbano exige endereço; queimada em vegetação, só as coordenadas
    const { endereco, erros: errosEndereco } = ocorrencia.lerEndereco(req.body, tipoOcorrencia);
    if (errosEndereco.length > 0) {
        return res.status(400).json({ erro: errosEndereco.join('; ') });
    }
    // Bioma e tipo de área corrigidos pelo operador prevalecem sobre os detectados
    const informados = classificacao.lerCamposInformados(req.body);
    if (informados.erros.length > 0) {
        return res.status(400).json({ erro: informados.erros.join('; ') });
    }
    // Opcionais do cálculo de risco: direção do vento em graus e taxa de crescimento da área
    const direcaoVento = req.body.direcaoVento ?? 45;
    const dA_dt = req.body.dA_dt ?? 0;
    let risco;
    try {
        // Falha das bases externas não impede o cálculo: o geodadosService usa fallback
        risco = await classificacao.classificarAlerta(
            { latitude, longitude, areaAfetada, vento, pessoasRisco, zonaUrbana, direcaoVento, dA_dt },
            informados
        );
    } catch (err) {
        return res.status(500).json({ erro: `Falha ao classificar o risco: ${err.message}` });
    }
    // Alerta, classificação, contribuições e o 1º registro do histórico gravados juntos (transação no PostgreSQL)
    const criadoEm = new Date().toISOString();
    const novoAlerta = await alertas.criar({
        titulo,
        descricao: descricao || '',
        tipoOcorrencia,
        status: 'NOVO',
        ...risco,
        direcaoVento,
        dA_dt,
        // Coordenadas sempre como número (o banco as guarda em DOUBLE PRECISION)
        latitude: Number(latitude),
        longitude: Number(longitude),
        ...endereco,
        areaAfetada,
        // Valor efetivo usado no cálculo (derivado do tipo de ocorrência, ou o enviado por cliente antigo)
        zonaUrbana,
        vento,
        pessoasRisco: pessoasRisco || false,
        criadoPor: req.usuario.id,
        criadoEm,
        atualizadoEm: criadoEm,
        // Auditoria da criação (RNF04): todo alerta nasce com um registro de histórico, status Novo
        historico: [{ campo: 'status', valorAnterior: null, valorNovo: 'NOVO', alteradoPor: req.usuario.id, alteradoEm: criadoEm }],
        solicitacoesExclusao: [],
        excluido: false,
        excluidoEm: null
    });
    res.status(201).json(novoAlerta);
}));

// Um alerta, com os nomes dos autores (tela de Detalhes)
app.get('/api/alertas/:id', rota(async (req, res) => {
    const alerta = await alertas.buscarAtivo(parseInt(req.params.id));
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    res.json(await comNomes(alerta));
}));

// Detalhamento do cálculo de risco do alerta (IRS, sigmoide e contribuição de cada critério).
// IRS v2: o cálculo gravado na criação. Alerta antigo do v1: recalculado pelo v1, como antes.
app.get('/api/alertas/:id/risco', rota(async (req, res) => {
    const id = parseInt(req.params.id);
    const alerta = await alertas.buscarAtivo(id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    res.json(classificacao.detalhamentoDoRisco(alerta));
}));

// Lê e valida a edição pedida para um alerta ativo. → { alerta, campos } ou, se recusada, { status, erro }.
// Ordem: inexistente → 404; resolvido → 422; campo não editável → 422; valor inválido → 400.
async function prepararEdicao(id, corpo) {
    const alerta = await alertas.buscarAtivo(id);
    if (!alerta) return { status: 404, erro: 'Alerta não encontrado' };
    if (alerta.status === 'RESOLVIDO') return { status: 422, erro: 'Alerta resolvido não pode ser editado' };
    const { campos, erros, naoEditaveis } = edicao.lerEdicao(corpo);
    if (naoEditaveis.length > 0) {
        return {
            status: 422,
            erro: `Campos não editáveis: ${naoEditaveis.join(', ')}. Editáveis: ${edicao.CAMPOS_EDITAVEIS.join(', ')} (localização e tipo de ocorrência não podem ser alterados)`
        };
    }
    if (erros.length > 0) return { status: 400, erro: erros.join('; ') };
    return { alerta, campos };
}

// Simula a edição sem gravar: mostra se o nível de risco mudaria (aviso antes de salvar).
// Usa os geodados gravados no alerta; não consulta as bases externas.
app.post('/api/alertas/:id/risco/simulacao', rota(async (req, res) => {
    const preparo = await prepararEdicao(parseInt(req.params.id), req.body);
    if (preparo.erro) {
        return res.status(preparo.status).json({ erro: preparo.erro });
    }
    const { alerta, campos } = preparo;
    const { risco } = edicao.aplicarEdicao(alerta, campos);
    res.json({
        alertaId: alerta.id,
        recalculado: Boolean(risco),
        nivelAtual: alerta.risco,
        nivelNovo: risco ? risco.risco : alerta.risco,
        irsAtual: alerta.irs,
        irsNovo: risco ? risco.irs : alerta.irs,
        mudaNivel: Boolean(risco) && risco.risco !== alerta.risco
    });
}));

// Geodados do alerta: os gravados na criação; se não houver, consulta em tempo real (sem gravar)
app.get('/api/alertas/:id/geodados', rota(async (req, res) => {
    const alerta = await alertas.buscarAtivo(parseInt(req.params.id));
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    if (alerta.geodados) {
        return res.json({ alertaId: alerta.id, origem: 'salvo', geodados: alerta.geodados });
    }
    if (!classificacao.validarCoordenadas(alerta.latitude, alerta.longitude)) {
        return res.status(422).json({ erro: 'O alerta não tem coordenadas válidas para consultar os geodados' });
    }
    try {
        const geodados = await geodadosService.obterGeodadosCompletos(Number(alerta.latitude), Number(alerta.longitude));
        res.json({ alertaId: alerta.id, origem: 'tempo-real', geodados });
    } catch (err) {
        res.status(500).json({ erro: `Falha ao obter geodados: ${err.message}` });
    }
}));

// Editar a ocorrência (RF11, HU04): todos os perfis. Corpo parcial com os campos editáveis.
// Se mudar uma entrada do cálculo, o IRS é recalculado com os geodados gravados, na mesma transação.
app.patch('/api/alertas/:id', rota(async (req, res) => {
    const id = parseInt(req.params.id);
    const preparo = await prepararEdicao(id, req.body);
    if (preparo.erro) {
        return res.status(preparo.status).json({ erro: preparo.erro });
    }
    try {
        // A edição é reaplicada sobre o alerta travado no repositório (pode ter mudado desde a leitura)
        const alerta = await alertas.editar(id, req.usuario.id, (atual) => edicao.aplicarEdicao(atual, preparo.campos));
        if (!alerta) {
            return res.status(404).json({ erro: 'Alerta não encontrado' }); // excluído enquanto a requisição chegava
        }
        res.json(await comNomes(alerta));
    } catch (err) {
        if (err.code === 'ALERTA_RESOLVIDO') {
            return res.status(422).json({ erro: 'Alerta resolvido não pode ser editado' });
        }
        throw err;
    }
}));

// Atualizar status do alerta (o status anterior vai para o histórico).
// Só as transições do UC05 FA01 (services/statusService.js); as demais → 422, sem alterar nada.
app.patch('/api/alertas/:id/status', rota(async (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!(await alertas.buscarAtivo(id))) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    if (!statusService.statusValido(status)) {
        return res.status(400).json({ erro: 'Status inválido' });
    }
    try {
        const alerta = await alertas.atualizarStatus(id, status, req.usuario.id);
        if (!alerta) {
            return res.status(404).json({ erro: 'Alerta não encontrado' }); // excluído enquanto a requisição chegava
        }
        res.json(await comNomes(alerta));
    } catch (err) {
        if (err.code === 'TRANSICAO_INVALIDA') {
            return res.status(422).json({ erro: 'Transição de status não permitida' });
        }
        throw err;
    }
}));

// Adicionar observação (texto obrigatório, até 2.000 caracteres)
app.post('/api/alertas/:id/observacoes', rota(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!(await alertas.buscarAtivo(id))) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const observacao = typeof req.body.observacao === 'string' ? req.body.observacao.trim() : '';
    if (!observacao) {
        return res.status(400).json({ erro: 'O texto da observação é obrigatório' });
    }
    if (observacao.length > TAMANHO_MAXIMO_OBSERVACAO) {
        return res.status(400).json({ erro: `A observação aceita no máximo ${TAMANHO_MAXIMO_OBSERVACAO} caracteres` });
    }
    const alerta = await alertas.adicionarObservacao(id, observacao, req.usuario.id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' }); // excluído enquanto a requisição chegava
    }
    res.json(await comNomes(alerta));
}));

// ============================================================
// EXCLUSÃO DE ALERTAS (COM FLUXO DE APROVAÇÃO)
// ============================================================

// Excluir alerta diretamente (Administrador e Gestor).
// Solicitações que ainda estavam pendentes ficam atendidas pela exclusão direta.
app.delete('/api/alertas/:id', rota(async (req, res) => {
    if (!podeExcluirDireto(req)) {
        return res.status(403).json({ erro: 'Apenas administradores e gestores podem excluir alertas. Solicite a exclusão.' });
    }
    const alerta = await alertas.excluir(parseInt(req.params.id), req.usuario.id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    res.json(alerta);
}));

// Solicitar a exclusão de um alerta (Operador)
app.post('/api/alertas/:id/solicitacoes-exclusao', rota(async (req, res) => {
    if (podeExcluirDireto(req)) {
        return res.status(400).json({ erro: 'Administradores e gestores excluem o alerta diretamente' });
    }
    const id = parseInt(req.params.id);
    if (!(await alertas.buscarAtivo(id))) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) {
        return res.status(400).json({ erro: 'O motivo da exclusão é obrigatório' });
    }
    try {
        const solicitacao = await alertas.criarSolicitacao(id, req.usuario.id, motivo);
        if (!solicitacao) {
            return res.status(404).json({ erro: 'Alerta não encontrado' });
        }
        res.status(201).json(solicitacao);
    } catch (err) {
        if (err.code === 'SOLICITACAO_PENDENTE') {
            return res.status(409).json({ erro: 'Já existe uma solicitação de exclusão pendente para este alerta' });
        }
        throw err;
    }
}));

const SITUACOES_SOLICITACAO = ['PENDENTE', 'APROVADA', 'REJEITADA'];

// Listar solicitações de exclusão: Administrador e Gestor veem todas; o Operador, só as próprias.
// Aceita ?status=PENDENTE|APROVADA|REJEITADA
app.get('/api/solicitacoes-exclusao', rota(async (req, res) => {
    const { status } = req.query;
    if (status && !SITUACOES_SOLICITACAO.includes(status)) {
        return res.status(400).json({ erro: `Situação inválida: ${status}. Valores aceitos: ${SITUACOES_SOLICITACAO.join(', ')}` });
    }
    res.json(await alertas.listarSolicitacoes({
        solicitadoPor: podeExcluirDireto(req) ? null : req.usuario.id,
        status: status || null
    }));
}));

// Aprovar ou rejeitar uma solicitação de exclusão (Administrador e Gestor). A rejeição exige resposta.
app.patch('/api/alertas/:id/solicitacoes-exclusao/:sid', rota(async (req, res) => {
    if (!podeExcluirDireto(req)) {
        return res.status(403).json({ erro: 'Apenas administradores e gestores podem avaliar solicitações de exclusão' });
    }
    const id = parseInt(req.params.id);
    const sid = parseInt(req.params.sid);
    const alerta = await alertas.buscarAtivo(id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const solicitacao = alerta.solicitacoesExclusao.find(s => s.id === sid);
    if (!solicitacao) {
        return res.status(404).json({ erro: 'Solicitação não encontrada' });
    }
    const { decisao } = req.body;
    if (!['APROVADA', 'REJEITADA'].includes(decisao)) {
        return res.status(400).json({ erro: 'Decisão inválida: use APROVADA ou REJEITADA' });
    }
    const resposta = typeof req.body.resposta === 'string' ? req.body.resposta.trim() : '';
    if (decisao === 'REJEITADA' && !resposta) {
        return res.status(400).json({ erro: 'Informe a resposta ao solicitante para rejeitar a solicitação' });
    }
    if (solicitacao.status !== 'PENDENTE') {
        return res.status(409).json({ erro: 'Esta solicitação já foi avaliada' });
    }
    const avaliada = await alertas.avaliarSolicitacao(id, sid, decisao, resposta, req.usuario.id);
    if (!avaliada) {
        return res.status(409).json({ erro: 'Esta solicitação já foi avaliada' }); // avaliada por outro usuário no mesmo instante
    }
    res.json(avaliada);
}));

// ============================================================
// TRATAMENTO DE ERROS
// Banco fora do ar → 503 com mensagem clara (e o motivo no log);
// dado que o banco recusa (tamanho, formato) → 400; demais → 500.
// Erros do próprio Express (ex.: JSON malformado) seguem o tratamento padrão.
// ============================================================
app.use((err, req, res, next) => {
    if (err.status || err.statusCode) return next(err);
    if (ehErroDeConexao(err)) {
        console.error(`[banco] ${req.method} ${req.originalUrl}: ${explicarErroBanco(err)}`);
        return res.status(503).json({ erro: 'Banco de dados indisponível no momento. Tente novamente em instantes.' });
    }
    if (typeof err.code === 'string' && /^(22|23)/.test(err.code)) {
        return res.status(400).json({ erro: `Dados inválidos para gravação: ${err.message}` });
    }
    console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ============================================================
// INICIAR SERVIDOR
// Só quando executado diretamente (node server.js). Importado pelos
// testes (supertest), o app é exportado sem abrir porta nem iniciar
// o aquecimento do cache do INPE.
// ============================================================
if (require.main === module) app.listen(PORT, () => {
    console.log(`🚀 SMCQ Protótipo rodando em http://localhost:${PORT}`);
    console.log(`   👤 Login: admin@smcq.com / admin123`);
    console.log(`   👤 Login: operador@smcq.com / operador123`);
    console.log(`   👤 Login: gestor@smcq.com / gestor123`);
    // Informa no log se o banco está acessível; fora do ar, o servidor segue e responde 503
    repositorios.verificarConexao();
    // Baixa os focos do INPE em segundo plano, para nenhum POST esperar o download
    geodadosService.aquecerFocosInpe();
});

module.exports = app;
