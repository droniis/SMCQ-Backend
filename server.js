const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'smcq-secret-key';

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
    }
];

let alertas = [];
let alertaIdCounter = 1;

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
        return res.status(403).json({ erro: 'Token inválido' });
    }
}

// ============================================================
// FUNÇÃO DE CÁLCULO DE RISCO
// ============================================================
function calcularRisco(dados) {
    const areaPontos = { PEQUENA: 1, MEDIA: 2, GRANDE: 3 }[dados.areaAfetada] || 0;
    const zonaUrbanaPontos = dados.zonaUrbana ? 3 : 0;
    const ventoPontos = { BAIXO: 1, MODERADO: 2, ALTO: 3 }[dados.vento] || 0;
    const pessoasRiscoPontos = dados.pessoasRisco ? 4 : 0;
    const total = areaPontos + zonaUrbanaPontos + ventoPontos + pessoasRiscoPontos;
    let nivel;
    if (total <= 3) nivel = 'BAIXO';
    else if (total <= 6) nivel = 'MODERADO';
    else if (total <= 9) nivel = 'ALTO';
    else nivel = 'CRITICO';
    return { pontuacao: total, nivel };
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

// Listar alertas
app.get('/api/alertas', (req, res) => {
    res.json(alertas);
});

// Criar novo alerta
app.post('/api/alertas', (req, res) => {
    const { titulo, descricao, areaAfetada, zonaUrbana, vento, pessoasRisco, latitude, longitude } = req.body;
    if (!titulo || !areaAfetada || !vento || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ erro: 'Título, área, vento e localização são obrigatórios' });
    }
    const risco = calcularRisco({ areaAfetada, zonaUrbana, vento, pessoasRisco });
    const novoAlerta = {
        id: alertaIdCounter++,
        titulo,
        descricao: descricao || '',
        status: 'NOVO',
        risco: risco.nivel,
        pontuacaoRisco: risco.pontuacao,
        latitude,
        longitude,
        areaAfetada,
        zonaUrbana: zonaUrbana || false,
        vento,
        pessoasRisco: pessoasRisco || false,
        criadoPor: req.usuario.id,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        historico: []
    };
    alertas.push(novoAlerta);
    res.status(201).json(novoAlerta);
});

// Atualizar status do alerta
app.patch('/api/alertas/:id/status', (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const alerta = alertas.find(a => a.id === id);
    if (!alerta) {
        return res.status(404).json({ erro: 'Alerta não encontrado' });
    }
    const statusValidos = ['NOVO', 'EM_ANALISE', 'EM_ATENDIMENTO', 'RESOLVIDO'];
    if (!statusValidos.includes(status)) {
        return res.status(400).json({ erro: 'Status inválido' });
    }
    alerta.status = status;
    alerta.atualizadoEm = new Date().toISOString();
    if (!alerta.historico) alerta.historico = [];
    alerta.historico.push({
        campo: 'status',
        valorAnterior: alerta.status,
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
    const alerta = alertas.find(a => a.id === id);
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
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 SMCQ Protótipo rodando em http://localhost:${PORT}`);
    console.log(`   👤 Login: admin@smcq.com / admin123`);
    console.log(`   👤 Login: operador@smcq.com / operador123`);
});