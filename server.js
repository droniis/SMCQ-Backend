require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const classificacao = require('./services/classificacaoService');
const geodadosService = require('./services/geodadosService');

const app = express();
const PORT = 3000;

// Segredo dos tokens: obrigatório no .env. Só os testes (Jest define NODE_ENV=test) têm valor padrão.
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'segredo-apenas-para-testes' : null);
if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET não definido. Crie o arquivo .env a partir do .env.example e preencha JWT_SECRET.');
    console.error('   Para gerar um valor: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
}

// Middlewares
app.use(cors());
app.use(express.json());

// ============================================================
// DADOS EM MEMÓRIA (SIMULAÇÃO DE BANCO)
// ============================================================
const usuarios = [
    {
        id: 1,
        nome: 'Admin',
        email: 'admin@smcq.com',
        senha: bcrypt.hashSync('admin123', 8),
        perfil: 'ADMINISTRADOR'
    },
    {
        id: 2,
        nome: 'Operador',
        email: 'operador@smcq.com',
        senha: bcrypt.hashSync('operador123', 8),
        perfil: 'OPERADOR'
    },
    {
        id: 3,
        nome: 'Gestor',
        email: 'gestor@smcq.com',
        senha: bcrypt.hashSync('gestor123', 8),
        perfil: 'GESTOR'
    }
];

let alertas = [];
let alertaIdCounter = 1;
let solicitacaoIdCounter = 1;

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

// Alertas com exclusão lógica não são encontrados pelas rotas normais
function buscarAlertaAtivo(id) {
    return alertas.find(a => a.id === id && !a.excluido);
}

function nomeDoUsuario(id) {
    const usuario = usuarios.find(u => u.id === id);
    return usuario ? usuario.nome : null;
}

// Exclusão lógica: o alerta continua guardado para auditoria, mas some das listagens
function excluirAlerta(alerta, usuarioId) {
    const agora = new Date().toISOString();
    alerta.excluido = true;
    alerta.excluidoEm = agora;
    alerta.excluidoPor = usuarioId;
    alerta.atualizadoEm = agora;
    alerta.historico.push({
        campo: 'excluido',
        valorAnterior: false,
        valorNovo: true,
        alteradoPor: usuarioId,
        alteradoEm: agora
    });
}

// Alertas criados antes do IRS v2 não têm a versão gravada: são do v1
function comVersao(alerta) {
    if (!alerta.versaoAlgoritmo) alerta.versaoAlgoritmo = classificacao.versaoDoAlerta(alerta);
    return alerta;
}

// ============================================================
// ROTA DE LOGIN (PÚBLICA)
// ============================================================
app.post('/api/login', (req, res) => {
    const { email, senha } = req.body;
    const usuario = usuarios.find(u => u.email === email);
    if (!usuario) {
        return res.status(401).json({ erro: 'Usuário não encontrado' });
    }
    if (!bcrypt.compareSync(senha, usuario.senha)) {
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
});

// ============================================================
// ROTAS PROTEGIDAS (REQUEREM TOKEN)
// ============================================================
app.use('/api', autenticarToken);

// Listar alertas (sem os excluídos)
app.get('/api/alertas', (req, res) => {
    res.json(alertas.filter(a => !a.excluido).map(comVersao));
});

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
app.post('/api/alertas', async (req, res) => {
    const { titulo, descricao, areaAfetada, zonaUrbana, vento, pessoasRisco, latitude, longitude, estado, municipio } = req.body;
    if (!titulo || !areaAfetada || !vento || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ erro: 'Título, área, vento e localização são obrigatórios' });
    }
    if (!classificacao.validarCoordenadas(latitude, longitude)) {
        return res.status(400).json({ erro: 'Coordenadas inválidas: latitude entre -90 e 90 e longitude entre -180 e 180' });
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
    const novoAlerta = {
        id: alertaIdCounter++,
        titulo,
        descricao: descricao || '',
        status: 'NOVO',
        ...risco,
        direcaoVento,
        dA_dt,
        latitude,
        longitude,
        estado: estado || '',
        municipio: municipio || '',
        cep: req.body.cep || '',
        logradouro: req.body.logradouro || '',
        numero: req.body.numero || '',
        bairro: req.body.bairro || '',
        areaAfetada,
        zonaUrbana: zonaUrbana || false,
        vento,
        pessoasRisco: pessoasRisco || false,
        criadoPor: req.usuario.id,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        historico: [],
        solicitacoesExclusao: [],
        excluido: false,
        excluidoEm: null
    };
    alertas.push(novoAlerta);
    res.status(201).json(novoAlerta);
});

// Detalhamento do cálculo de risco do alerta (IRS, sigmoide e contribuição de cada critério).
// IRS v2: o cálculo gravado na criação. Alerta antigo do v1: recalculado pelo v1, como antes.
app.get('/api/alertas/:id/risco', (req, res) => {
    const id = parseInt(req.params.id);
    const alerta = buscarAlertaAtivo(id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    res.json(classificacao.detalhamentoDoRisco(alerta));
});

// Geodados do alerta: os gravados na criação; se não houver, consulta em tempo real (sem gravar)
app.get('/api/alertas/:id/geodados', async (req, res) => {
    const alerta = buscarAlertaAtivo(parseInt(req.params.id));
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
});

// Atualizar status do alerta
app.patch('/api/alertas/:id/status', (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const alerta = buscarAlertaAtivo(id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const statusValidos = ['NOVO', 'EM_ANALISE', 'EM_ATENDIMENTO', 'RESOLVIDO'];
    if (!statusValidos.includes(status)) {
        return res.status(400).json({ erro: 'Status inválido' });
    }
    // Guarda o status atual antes de sobrescrever, para o histórico
    const statusAnterior = alerta.status;
    alerta.status = status;
    alerta.atualizadoEm = new Date().toISOString();
    if (!alerta.historico) alerta.historico = [];
    alerta.historico.push({
        campo: 'status',
        valorAnterior: statusAnterior,
        valorNovo: status,
        alteradoPor: req.usuario.id,
        alteradoEm: new Date().toISOString()
    });
    res.json(alerta);
});

// Adicionar observação
app.post('/api/alertas/:id/observacoes', (req, res) => {
    const id = parseInt(req.params.id);
    const { observacao } = req.body;
    const alerta = buscarAlertaAtivo(id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    if (!alerta.observacoes) alerta.observacoes = [];
    alerta.observacoes.push({
        texto: observacao,
        criadoPor: req.usuario.id,
        criadoEm: new Date().toISOString()
    });
    alerta.atualizadoEm = new Date().toISOString();
    res.json(alerta);
});

// ============================================================
// EXCLUSÃO DE ALERTAS (COM FLUXO DE APROVAÇÃO)
// ============================================================

// Excluir alerta diretamente (Administrador e Gestor)
app.delete('/api/alertas/:id', (req, res) => {
    if (!podeExcluirDireto(req)) {
        return res.status(403).json({ erro: 'Apenas administradores e gestores podem excluir alertas. Solicite a exclusão.' });
    }
    const alerta = buscarAlertaAtivo(parseInt(req.params.id));
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    excluirAlerta(alerta, req.usuario.id);
    // Solicitações que ainda estavam pendentes ficam atendidas pela exclusão direta
    alerta.solicitacoesExclusao
        .filter(s => s.status === 'PENDENTE')
        .forEach(s => {
            s.status = 'APROVADA';
            s.resolvidoEm = alerta.excluidoEm;
            s.resolvidoPor = req.usuario.id;
        });
    res.json(alerta);
});

// Solicitar a exclusão de um alerta (Operador)
app.post('/api/alertas/:id/solicitacoes-exclusao', (req, res) => {
    if (podeExcluirDireto(req)) {
        return res.status(400).json({ erro: 'Administradores e gestores excluem o alerta diretamente' });
    }
    const alerta = buscarAlertaAtivo(parseInt(req.params.id));
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) {
        return res.status(400).json({ erro: 'O motivo da exclusão é obrigatório' });
    }
    if (alerta.solicitacoesExclusao.some(s => s.status === 'PENDENTE')) {
        return res.status(409).json({ erro: 'Já existe uma solicitação de exclusão pendente para este alerta' });
    }
    const solicitacao = {
        id: solicitacaoIdCounter++,
        solicitadoPor: req.usuario.id,
        motivo,
        status: 'PENDENTE',
        criadoEm: new Date().toISOString(),
        resolvidoEm: null,
        resolvidoPor: null,
        resposta: ''
    };
    alerta.solicitacoesExclusao.push(solicitacao);
    res.status(201).json(solicitacao);
});

// Listar solicitações de exclusão: Administrador e Gestor veem todas; o Operador, só as próprias.
// Aceita ?status=PENDENTE|APROVADA|REJEITADA
app.get('/api/solicitacoes-exclusao', (req, res) => {
    const { status } = req.query;
    const lista = alertas.flatMap(alerta =>
        alerta.solicitacoesExclusao.map(s => ({
            ...s,
            alertaId: alerta.id,
            alertaTitulo: alerta.titulo,
            alertaExcluido: alerta.excluido,
            solicitadoPorNome: nomeDoUsuario(s.solicitadoPor),
            resolvidoPorNome: nomeDoUsuario(s.resolvidoPor)
        }))
    )
        .filter(s => podeExcluirDireto(req) || s.solicitadoPor === req.usuario.id)
        .filter(s => !status || s.status === status)
        .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    res.json(lista);
});

// Aprovar ou rejeitar uma solicitação de exclusão (Administrador e Gestor)
app.patch('/api/alertas/:id/solicitacoes-exclusao/:sid', (req, res) => {
    if (!podeExcluirDireto(req)) {
        return res.status(403).json({ erro: 'Apenas administradores e gestores podem avaliar solicitações de exclusão' });
    }
    const alerta = buscarAlertaAtivo(parseInt(req.params.id));
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const solicitacao = alerta.solicitacoesExclusao.find(s => s.id === parseInt(req.params.sid));
    if (!solicitacao) {
        return res.status(404).json({ erro: 'Solicitação não encontrada' });
    }
    const { decisao, resposta } = req.body;
    if (!['APROVADA', 'REJEITADA'].includes(decisao)) {
        return res.status(400).json({ erro: 'Decisão inválida: use APROVADA ou REJEITADA' });
    }
    if (solicitacao.status !== 'PENDENTE') {
        return res.status(409).json({ erro: 'Esta solicitação já foi avaliada' });
    }
    solicitacao.status = decisao;
    solicitacao.resolvidoEm = new Date().toISOString();
    solicitacao.resolvidoPor = req.usuario.id;
    solicitacao.resposta = typeof resposta === 'string' ? resposta.trim() : '';
    if (decisao === 'APROVADA') {
        excluirAlerta(alerta, req.usuario.id);
    }
    res.json(solicitacao);
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
    // Baixa os focos do INPE em segundo plano, para nenhum POST esperar o download
    geodadosService.aquecerFocosInpe();
});

module.exports = app;
