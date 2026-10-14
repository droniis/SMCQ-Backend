// ============================================================
// USUÁRIOS PADRÃO DE TESTE
// Os mesmos três perfis do protótipo. As senhas abaixo são de
// demonstração (já documentadas no README); no banco e na memória
// elas ficam apenas como hash bcrypt.
// ============================================================
module.exports = [
  { nome: 'Admin', email: 'admin@smcq.com', senha: 'admin123', perfil: 'ADMINISTRADOR' },
  { nome: 'Operador', email: 'operador@smcq.com', senha: 'operador123', perfil: 'OPERADOR' },
  { nome: 'Gestor', email: 'gestor@smcq.com', senha: 'gestor123', perfil: 'GESTOR' }
];
