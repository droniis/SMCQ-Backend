// Executado antes de cada arquivo de teste (jest.setupFiles): os testes usam
// sempre a persistência em memória, mesmo que o .env aponte para o PostgreSQL.
// O dotenv não sobrescreve variáveis já definidas, então isto prevalece.
process.env.PERSISTENCIA = 'memoria';
