// ============================================================
// FETCH FALSO PARA OS TESTES
// Substitui o fetch global: os testes nunca acessam a internet.
// Responde como cada base externa do geodadosService (IBGE, ICMBio,
// FUNAI, GBIF e INPE), conforme o cenário configurado, e falha
// quando o cenário pede. Uma URL não prevista faz o teste falhar.
// ============================================================

const CABECALHO_INPE = 'id,lat,lon,data_hora_gmt,satelite,municipio,estado';

// Cenário padrão: ponto no Pantanal, fora de UC/TI, com espécies EN no GBIF
const CENARIO_PADRAO = {
  falhar: [],                 // fontes que falham: 'IBGE', 'ICMBio', 'FUNAI', 'GBIF', 'INPE'
  bioma: 'Pantanal',
  ucDentro: [],               // feições devolvidas pelo filtro INTERSECTS do ICMBio
  ucProximas: [],             // feições devolvidas pelos filtros DWITHIN do ICMBio
  tiDentro: [],
  tiProximas: [],
  especiesPorCategoria: { CR: [], EN: [{ name: 'Pteronura brasiliensis', count: 5 }], VU: [] },
  linhasInpe: ['f1,-16.700,-56.700,2026-10-10 12:00:00,AQUA_M-T,POCONÉ,MATO GROSSO']
};

function respostaJson(corpo) {
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

function respostaTexto(texto) {
  return { ok: true, status: 200, text: async () => texto, json: async () => JSON.parse(texto) };
}

const falhaDeRede = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });

function identificarFonte(url) {
  if (url.includes('geoservicos.ibge.gov.br')) return 'IBGE';
  if (url.includes('geoservicos.inde.gov.br')) return 'ICMBio';
  if (url.includes('geoserver.funai.gov.br')) return 'FUNAI';
  if (url.includes('api.gbif.org')) return 'GBIF';
  if (url.includes('dataserver-coids.inpe.br')) return 'INPE';
  return null;
}

// Cria o fetch falso. `cenario` pode ser alterado entre os testes (cenario.falhar = [...]).
function criarFetchFalso(alteracoes = {}) {
  const cenario = { ...CENARIO_PADRAO, ...alteracoes };
  const chamadas = [];

  const fetchFalso = async (url) => {
    const fonte = identificarFonte(String(url));
    chamadas.push({ url: String(url), fonte });
    if (!fonte) throw new Error(`fetch falso: URL não prevista nos testes: ${url}`);
    if (cenario.falhar.includes(fonte)) throw falhaDeRede();

    const parametros = new URL(String(url)).searchParams;
    const filtro = parametros.get('CQL_FILTER') || '';
    const dentro = filtro.startsWith('INTERSECTS');
    switch (fonte) {
      case 'IBGE':
        return respostaJson({ features: [{ properties: { bioma: cenario.bioma } }] });
      case 'ICMBio':
        return respostaJson({ features: (dentro ? cenario.ucDentro : cenario.ucProximas).map(p => ({ properties: p })) });
      case 'FUNAI':
        return respostaJson({ features: (dentro ? cenario.tiDentro : cenario.tiProximas).map(p => ({ properties: p })) });
      case 'GBIF': {
        const categoria = parametros.get('iucnRedListCategory');
        return respostaJson({ count: 0, facets: [{ field: 'SCIENTIFIC_NAME', counts: cenario.especiesPorCategoria[categoria] || [] }] });
      }
      case 'INPE':
        return respostaTexto([CABECALHO_INPE, ...cenario.linhasInpe].join('\n'));
    }
  };

  return { fetchFalso, cenario, chamadas };
}

module.exports = { criarFetchFalso, CENARIO_PADRAO };
