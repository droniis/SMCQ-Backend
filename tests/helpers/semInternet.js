// Executado antes de cada arquivo de teste (jest.setupFiles): bloqueia o acesso à
// internet. Um teste que precise de bases externas usa o fetch falso (fetchFalso.js).
global.fetch = async (url) => {
  throw new Error(`Acesso à internet bloqueado nos testes: ${url}`);
};
