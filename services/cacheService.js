// ============================================================
// CACHE EM MEMÓRIA COM TTL
// Evita repetir consultas às bases públicas (geodadosService).
// Os dados se perdem ao reiniciar o servidor, como os alertas.
// ============================================================

const TTL_PADRAO_MS = 60 * 60 * 1000; // 1 hora
// Acima deste tamanho, as entradas vencidas são removidas a cada gravação
const LIMITE_ENTRADAS = 500;

const cache = new Map();

// Devolve o valor guardado ou null se a chave não existe ou já venceu
function get(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expira) {
    cache.delete(key);
    return null;
  }
  return item.valor;
}

function set(key, valor, ttlMs = TTL_PADRAO_MS) {
  if (cache.size >= LIMITE_ENTRADAS) removerVencidos();
  cache.set(key, { valor, expira: Date.now() + ttlMs });
}

// Uma entrada vencida só sai do mapa quando é lida; esta limpeza cobre as que nunca mais são lidas
function removerVencidos() {
  const agora = Date.now();
  for (const [key, item] of cache) {
    if (agora > item.expira) cache.delete(key);
  }
}

// Esvazia o cache (usado nos testes)
function limpar() {
  cache.clear();
}

function tamanho() {
  return cache.size;
}

module.exports = { get, set, limpar, tamanho, TTL_PADRAO_MS };
