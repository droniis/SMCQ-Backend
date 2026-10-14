// Configuração do ESLint (formato "flat config", ESLint 9+)
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/', 'data/', '**/*.bak', '**/*.bak.*']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      // Variáveis com _ no início são descartadas de propósito (ex.: desestruturação para remover um campo)
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } }
  }
];
