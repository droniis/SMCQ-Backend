// ============================================================
// VALIDAÇÃO DO IRS — ETAPA 2.1: COLETA DOS FOCOS DO INPE
// Baixa os CSVs mensais de focos de calor do Programa Queimadas
// (INPE) e guarda os arquivos brutos em data/validacao/bruto/,
// com um fontes.json que registra URL, data/hora, tamanho e hash
// de cada download.
//
// Ordem de tentativa (Cap. 6 do TCC):
//   a) CSV mensal  → .../focos/csv/mensal/Brasil/
//   b) CSV diário  → .../focos/csv/diario/Brasil/
// Os nomes dos arquivos vêm da listagem do diretório, não são
// montados "no escuro". Se nenhuma das duas fontes tiver os dados,
// o script para e pede a exportação manual pelo BDQueimadas.
//
// Rodar: node scripts/validacao/coletar-dados.js
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { requisitarComTentativas, USER_AGENT, TIMEOUT_MS } = require('./http');
const { PERIODO } = require('./config');

const RAIZ = path.join(__dirname, '..', '..');
const PASTA_BRUTO = path.join(RAIZ, 'data', 'validacao', 'bruto');
const ARQUIVO_FONTES = path.join(PASTA_BRUTO, 'fontes.json');

const BASE_MENSAL = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/';
const BASE_DIARIO = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/';
const BDQUEIMADAS = 'https://terrabrasilis.dpi.inpe.br/queimadas/bdqueimadas/';

// Lista os arquivos .csv de um diretório do servidor do INPE (página de índice HTML)
async function listarDiretorio(url) {
  const resposta = await requisitarComTentativas(url);
  const html = await resposta.text();
  return [...html.matchAll(/href="([^"]+\.csv)"/g)].map(m => m[1]);
}

// AAAAMM de cada mês entre duas datas (inclusive)
function mesesEntre(inicio, fim) {
  const meses = [];
  const atual = new Date(`${inicio.slice(0, 7)}-01T00:00:00Z`);
  const ultimo = new Date(`${fim.slice(0, 7)}-01T00:00:00Z`);
  while (atual <= ultimo) {
    meses.push(atual.toISOString().slice(0, 7).replace('-', ''));
    atual.setUTCMonth(atual.getUTCMonth() + 1);
  }
  return meses;
}

// AAAAMMDD de cada dia entre duas datas (inclusive)
function diasEntre(inicio, fim) {
  const dias = [];
  const atual = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fim}T00:00:00Z`);
  while (atual <= ultimo) {
    dias.push(atual.toISOString().slice(0, 10).replace(/-/g, ''));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}

// Baixa um arquivo grande direto para o disco, calculando o SHA-256 no caminho.
// O tempo limite de 10 s vale para a conexão e para cada intervalo sem receber dados
// (ver http.js): um CSV de 100 MB não baixa inteiro em 10 s.
async function baixarArquivo(url, destino) {
  const resposta = await requisitarComTentativas(url, { corpoEmFluxo: true });
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const temporario = `${destino}.parcial`;
  await pipeline(
    Readable.fromWeb(resposta.body),
    async function* (fonte) {
      for await (const pedaco of fonte) {
        resposta.renovarPrazo();
        hash.update(pedaco);
        bytes += pedaco.length;
        yield pedaco;
      }
    },
    fs.createWriteStream(temporario)
  );
  resposta.encerrarPrazo();
  fs.renameSync(temporario, destino);
  return {
    url,
    arquivo: path.relative(RAIZ, destino).replace(/\\/g, '/'),
    baixadoEm: new Date().toISOString(),
    bytes,
    sha256: hash.digest('hex'),
    ultimaModificacaoServidor: resposta.headers.get('last-modified')
  };
}

async function main() {
  fs.mkdirSync(PASTA_BRUTO, { recursive: true });
  // O dia −1 do primeiro dia do período é necessário para dA/dt
  const inicioColeta = new Date(`${PERIODO.inicio}T00:00:00Z`);
  inicioColeta.setUTCDate(inicioColeta.getUTCDate() - 1);
  const inicio = inicioColeta.toISOString().slice(0, 10);
  const fim = PERIODO.fim;
  console.log(`Período necessário: ${inicio} a ${fim} (inclui o dia −1 do início, para dA/dt)`);

  const fontes = fs.existsSync(ARQUIVO_FONTES) ? JSON.parse(fs.readFileSync(ARQUIVO_FONTES, 'utf8')) : { downloads: [] };
  const registrar = (registro) => {
    fontes.downloads = fontes.downloads.filter(d => d.arquivo !== registro.arquivo).concat(registro);
    fontes.atualizadoEm = new Date().toISOString();
    fontes.userAgent = USER_AGENT;
    fontes.timeoutMs = TIMEOUT_MS;
    fs.writeFileSync(ARQUIVO_FONTES, JSON.stringify(fontes, null, 2));
  };
  const jaBaixado = (destino) => fs.existsSync(destino) && fontes.downloads.some(d => path.join(RAIZ, d.arquivo) === destino);

  // a) CSV mensal
  const erros = [];
  try {
    const disponiveis = await listarDiretorio(BASE_MENSAL);
    const necessarios = mesesEntre(inicio, fim).map(m => `focos_mensal_br_${m}.csv`);
    const faltando = necessarios.filter(n => !disponiveis.includes(n));
    if (faltando.length > 0) throw new Error(`arquivos mensais ausentes no diretório: ${faltando.join(', ')}`);
    for (const nome of necessarios) {
      const destino = path.join(PASTA_BRUTO, nome);
      if (jaBaixado(destino)) {
        console.log(`  já existe   ${nome}`);
        continue;
      }
      console.log(`  baixando    ${BASE_MENSAL}${nome}`);
      const registro = await baixarArquivo(`${BASE_MENSAL}${nome}`, destino);
      registrar({ ...registro, tipo: 'mensal' });
      console.log(`  ok          ${(registro.bytes / 1e6).toFixed(1)} MB  sha256=${registro.sha256.slice(0, 16)}…`);
    }
    console.log(`\nConcluído pelo CSV mensal. Fontes registradas em ${path.relative(RAIZ, ARQUIVO_FONTES)}`);
    return;
  } catch (err) {
    erros.push(`CSV mensal: ${err.message}`);
    console.log(`  CSV mensal falhou: ${err.message}`);
  }

  // b) CSV diário
  try {
    const disponiveis = await listarDiretorio(BASE_DIARIO);
    const necessarios = diasEntre(inicio, fim).map(d => `focos_diario_br_${d}.csv`);
    const faltando = necessarios.filter(n => !disponiveis.includes(n));
    if (faltando.length > 0) throw new Error(`${faltando.length} arquivos diários ausentes no diretório (ex.: ${faltando[0]})`);
    for (const nome of necessarios) {
      const destino = path.join(PASTA_BRUTO, nome);
      if (jaBaixado(destino)) continue;
      const registro = await baixarArquivo(`${BASE_DIARIO}${nome}`, destino);
      registrar({ ...registro, tipo: 'diario' });
      console.log(`  ok          ${nome}`);
    }
    console.log(`\nConcluído pelo CSV diário. Fontes registradas em ${path.relative(RAIZ, ARQUIVO_FONTES)}`);
    return;
  } catch (err) {
    erros.push(`CSV diário: ${err.message}`);
    console.log(`  CSV diário falhou: ${err.message}`);
  }

  console.error('\nNenhuma fonte automática funcionou:');
  erros.forEach(e => console.error(`  - ${e}`));
  console.error(`\nExporte os focos de ${inicio} a ${fim} manualmente pelo BDQueimadas (${BDQUEIMADAS})`);
  console.error(`e salve os CSVs em ${path.relative(RAIZ, PASTA_BRUTO)}/.`);
  process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { mesesEntre, diasEntre };
