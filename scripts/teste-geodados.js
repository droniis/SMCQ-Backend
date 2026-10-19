// ============================================================
// TESTE DO SERVIÇO DE GEODADOS (BASES PÚBLICAS)
// Consulta IBGE, ICMBio, FUNAI, GBIF e INPE para cinco pontos e
// mostra o que cada fonte devolveu e se houve fallback.
//
// Rodar:  node scripts/teste-geodados.js             (usa a internet)
//         node scripts/teste-geodados.js --offline   (simula a rede fora do ar)
// ============================================================
const assert = require('node:assert/strict');

const OFFLINE = process.argv.includes('--offline');
if (OFFLINE) {
  // Toda requisição falha como se não houvesse rede: exercita os fallbacks
  global.fetch = async () => {
    const erro = new TypeError('fetch failed');
    erro.cause = { code: 'ENOTFOUND' };
    throw erro;
  };
}

const geodados = require('../services/geodadosService');
const cache = require('../services/cacheService');

const cenarios = [
  { nome: 'Pantanal',  lat: -16.6869, lng: -56.6744 },
  { nome: 'Amazônia',  lat: -3.4653,  lng: -62.2159 },
  { nome: 'São Paulo', lat: -23.5505, lng: -46.6333 },
  { nome: 'Brasília',  lat: -15.7939, lng: -47.8828 },
  { nome: 'Caatinga',  lat: -8.0476,  lng: -34.8770 }
];

const BIOMAS = ['AMAZONIA', 'PANTANAL', 'MATA_ATLANTICA', 'CERRADO', 'CAATINGA', 'PAMPA', 'URBANO', 'OUTRO'];
const NIVEIS_FAUNA = ['CRITICA', 'AMEACADA', 'VULNERAVEL', 'SEM_ESPECIES'];

let falhas = 0;
function verificar(descricao, fn) {
  try {
    fn();
  } catch (err) {
    falhas++;
    console.log(`  FALHA ${descricao}: ${err.message}`);
  }
}

// O formato do resultado tem de ser o mesmo com a fonte real ou com o fallback
function validarFormato(geo) {
  verificar('bioma conhecido', () => assert.ok(BIOMAS.includes(geo.bioma), geo.bioma));
  verificar('UC nula ou com nome', () => assert.ok(geo.unidadeConservacao === null || typeof geo.unidadeConservacao.nome === 'string'));
  verificar('TI nula ou com nome', () => assert.ok(geo.terraIndigena === null || typeof geo.terraIndigena.nome === 'string'));
  verificar('faixa de área protegida', () => assert.ok(['<10 km', '10-50 km', '>50 km'].includes(geo.faixaAreaProtegida)));
  verificar('nível de fauna', () => assert.ok(NIVEIS_FAUNA.includes(geo.fauna.nivel), geo.fauna.nivel));
  verificar('total de fauna numérico', () => assert.equal(typeof geo.fauna.total, 'number'));
  verificar('total de focos numérico', () => assert.equal(typeof geo.focos.total, 'number'));
  verificar('cinco fontes informadas', () => assert.deepEqual(Object.keys(geo.fontes), ['bioma', 'uc', 'ti', 'fauna', 'focos']));
}

(async () => {
  console.log(OFFLINE ? '\n### MODO OFFLINE: todas as fontes devem cair no fallback\n' : '\n### CONSULTA ÀS BASES PÚBLICAS\n');
  const resumo = [];

  for (const c of cenarios) {
    console.log(`--- ${c.nome} (${c.lat}, ${c.lng})`);
    const inicio = Date.now();
    const geo = await geodados.obterGeodadosCompletos(c.lat, c.lng);
    const tempo = Date.now() - inicio;
    validarFormato(geo);

    const especies = geo.fauna.especies.slice(0, 3).map(e => `${e.nome.split(' ').slice(0, 2).join(' ')} (${e.status})`).join(', ');
    console.log(`  Bioma: ${geo.bioma}  [${geo.fontes.bioma}]`);
    console.log(`  UC:    ${geo.unidadeConservacao ? `${geo.unidadeConservacao.nome} (${geo.unidadeConservacao.categoria})` : 'nenhuma no ponto'}  [${geo.fontes.uc}]`);
    console.log(`  TI:    ${geo.terraIndigena ? `${geo.terraIndigena.nome} (${geo.terraIndigena.etnia})` : 'nenhuma no ponto'}  [${geo.fontes.ti}]`);
    console.log(`  Área protegida mais próxima: ${geo.faixaAreaProtegida}${geo.areaProtegidaProxima ? ` — ${geo.areaProtegidaProxima.nome} (${geo.areaProtegidaProxima.tipo})` : ''}`);
    console.log(`  Fauna: ${geo.fauna.nivel}, ${geo.fauna.total} espécies ${JSON.stringify(geo.fauna.porCategoria)}${especies ? ` — ex.: ${especies}` : ''}  [${geo.fontes.fauna}]`);
    console.log(`  Focos: ${geo.focos.total} em 7 dias (${geo.focos.totalSateliteReferencia} no satélite de referência), ${geo.focos.diasConsultados} dias consultados  [${geo.fontes.focos}]`);
    console.log(`  Tempo total: ${tempo} ms\n`);

    resumo.push({
      ponto: c.nome,
      bioma: geo.bioma,
      UC: geo.unidadeConservacao ? 'sim' : 'não',
      TI: geo.terraIndigena ? 'sim' : 'não',
      'área protegida': geo.faixaAreaProtegida,
      fauna: `${geo.fauna.nivel} (${geo.fauna.total})`,
      focos: geo.focos.total,
      fallbacks: Object.entries(geo.fontes).filter(([, fonte]) => fonte.startsWith('fallback')).map(([nome]) => nome).join(', ') || 'nenhum',
      'tempo (ms)': tempo
    });
  }

  console.table(resumo);

  // Segunda consulta ao primeiro ponto: tem de vir do cache
  console.log('--- Cache: repetindo o primeiro ponto');
  const inicio = Date.now();
  await geodados.obterGeodadosCompletos(cenarios[0].lat, cenarios[0].lng);
  const tempoCache = Date.now() - inicio;
  console.log(`  Tempo com cache: ${tempoCache} ms (${cache.tamanho()} entradas no cache)\n`);
  verificar('a segunda consulta vem do cache', () => assert.ok(tempoCache < 100, `${tempoCache} ms`));

  // Coordenadas inválidas são erro de quem chama, não de rede
  await geodados.obterGeodadosCompletos('abc', 10).then(
    () => verificar('coordenada inválida é rejeitada', () => assert.fail('aceitou coordenada inválida')),
    (err) => verificar('coordenada inválida é rejeitada', () => assert.equal(err.name, 'RangeError'))
  );

  if (OFFLINE) {
    verificar('offline: todas as fontes em fallback', () => {
      assert.ok(resumo.every(r => r.fallbacks === 'bioma, uc, ti, fauna, focos'));
    });
    verificar('offline: bioma pelos centróides', () => {
      assert.deepEqual(resumo.map(r => r.bioma), ['PANTANAL', 'AMAZONIA', 'MATA_ATLANTICA', 'CERRADO', 'CAATINGA']);
    });
  }

  console.log(falhas === 0 ? 'Todas as verificações passaram.' : `${falhas} verificação(ões) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
})();
