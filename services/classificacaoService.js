// ============================================================
// CLASSIFICAÇÃO DE RISCO DE UM ALERTA (IRS v2 + GEODADOS)
// Liga o formulário do alerta ao IRS v2:
//   1. consulta os geodados do ponto (geodadosService, com tempo
//      limite, cache e fallback);
//   2. aplica o que o operador informou manualmente (bioma e tipo
//      de área), que prevalece sobre o detectado;
//   3. calcula o IRS v2 e devolve os campos a gravar no alerta.
// Não altera pesos, tabelas nem fórmulas: tudo isso está em
// riscoService.js, exatamente como foi validado.
// ============================================================

const geodadosService = require('./geodadosService');
const {
  calcularRiscoAvancado,
  calcularRiscoAvancadoV2,
  normalizarChave,
  PONTOS_BIOMA,
  PONTOS_TIPO_AREA
} = require('./riscoService');

const VERSAO_V1 = 'IRS v1';
const VERSAO_V2 = 'IRS v2';

// ------------------------------------------------------------
// Validação das entradas
// ------------------------------------------------------------

// Coordenada numérica e dentro da faixa. Aceita número ou texto decimal ("-16.68");
// recusa texto vazio, notação hexadecimal e afins, que Number() aceitaria.
function coordenadaValida(valor, limite) {
  if (typeof valor === 'number') return Number.isFinite(valor) && Math.abs(valor) <= limite;
  if (typeof valor !== 'string' || !/^\s*-?\d+(\.\d+)?\s*$/.test(valor)) return false;
  return Math.abs(Number(valor)) <= limite;
}

function validarCoordenadas(lat, lng) {
  return coordenadaValida(lat, 90) && coordenadaValida(lng, 180);
}

// Bioma e tipo de área informados pelo operador. Campo vazio = não informado.
// → { bioma, tipoArea, erros: [...] }, com os valores já normalizados ("Mata Atlântica" → MATA_ATLANTICA)
function lerCamposInformados({ bioma, tipoArea }) {
  const erros = [];
  const ler = (valor, tabela, nome) => {
    if (valor === undefined || valor === null || valor === '') return null;
    const chave = normalizarChave(valor);
    if (!(chave in tabela)) {
      erros.push(`${nome} inválido: ${valor}. Valores aceitos: ${Object.keys(tabela).join(', ')}`);
      return null;
    }
    return chave;
  };
  return { bioma: ler(bioma, PONTOS_BIOMA, 'Bioma'), tipoArea: ler(tipoArea, PONTOS_TIPO_AREA, 'Tipo de área'), erros };
}

// ------------------------------------------------------------
// Geodados com proteção extra: obterGeodadosCompletos já trata as falhas
// de rede de cada fonte; isto cobre um erro inesperado do próprio serviço,
// para que nada impeça a criação do alerta.
// ------------------------------------------------------------
async function obterGeodadosSeguro(latitude, longitude) {
  try {
    return await geodadosService.obterGeodadosCompletos(latitude, longitude);
  } catch (err) {
    console.log(`[classificacao] geodados indisponíveis, cálculo com fallback do IRS: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------
// Cálculo do IRS v2 para um alerta
//   dados    → campos do alerta (latitude, longitude, areaAfetada, vento,
//              pessoasRisco, zonaUrbana, direcaoVento, dA_dt)
//   informados → { bioma, tipoArea } já validados (null = não informado)
//   geodados → saída de obterGeodadosCompletos (ou null)
// → campos a gravar no alerta
// ------------------------------------------------------------
function classificarComGeodados(dados, informados, geodados) {
  // No riscoService, o detectado nos geodados prevalece sobre o campo do alerta.
  // Para que o valor INFORMADO prevaleça, ajusta-se a cópia dos geodados que vai
  // para o cálculo; o objeto original é gravado sem alteração.
  const geoCalculo = geodados ? { ...geodados } : {};
  const alertaIrs = { ...dados };
  if (informados.bioma) {
    geoCalculo.bioma = informados.bioma;
    geoCalculo.fonteBioma = 'informado';
  }
  if (informados.tipoArea) {
    // Sem UC/TI na cópia, resolverTipoArea usa o tipo informado. A relevância
    // ecológica não muda: um ponto dentro de UC/TI já tem faixa "<10 km" (fator 1,0).
    geoCalculo.unidadeConservacao = null;
    geoCalculo.terraIndigena = null;
    alertaIrs.tipoArea = informados.tipoArea;
  }

  const resultado = calcularRiscoAvancadoV2(alertaIrs, geoCalculo);
  const { detalhes } = resultado;

  return {
    bioma: detalhes.bioma.valorBruto,
    biomaOrigem: informados.bioma ? 'informado' : 'detectado',
    tipoArea: detalhes.tipoArea.valorBruto,
    tipoAreaOrigem: informados.tipoArea ? 'informado' : 'detectado',
    // Nível de fauna ameaçada considerado no cálculo (CRITICA, AMEACADA, VULNERAVEL, SEM_ESPECIES, URBANA)
    areaCriticaFauna: detalhes.fauna.valorBruto,
    // UC ou TI a menos de 10 km (ou o ponto dentro de uma delas)
    proximaUC: detalhes.relevancia.faixa === '<10 km',
    irs: resultado.irs,
    pontuacaoRisco: resultado.irs, // nome usado desde o v1; mantido para o frontend
    sigmoide: resultado.sigmoide,
    risco: resultado.nivel,
    detalhes,
    geodados: geodados || null,
    versaoAlgoritmo: VERSAO_V2
  };
}

async function classificarAlerta(dados, informados = { bioma: null, tipoArea: null }) {
  const geodados = await obterGeodadosSeguro(Number(dados.latitude), Number(dados.longitude));
  return classificarComGeodados({ ...dados, latitude: Number(dados.latitude), longitude: Number(dados.longitude) }, informados, geodados);
}

// ------------------------------------------------------------
// Alertas sem versão gravada foram calculados pelo v1
// ------------------------------------------------------------
function versaoDoAlerta(alerta) {
  return alerta.versaoAlgoritmo || VERSAO_V1;
}

// Detalhamento do risco de um alerta: o v2 devolve o cálculo GRAVADO (os geodados
// podem mudar com o tempo, e o nível exibido deve ser o que foi atribuído na criação);
// um alerta do v1 continua recalculado pelo v1, como antes.
function detalhamentoDoRisco(alerta) {
  if (versaoDoAlerta(alerta) === VERSAO_V2 && alerta.detalhes) {
    return { alertaId: alerta.id, irs: alerta.irs, sigmoide: alerta.sigmoide, nivel: alerta.risco, detalhes: alerta.detalhes, versaoAlgoritmo: VERSAO_V2 };
  }
  const { irs, sigmoide, nivel, detalhes } = calcularRiscoAvancado(alerta);
  return { alertaId: alerta.id, irs, sigmoide, nivel, detalhes, versaoAlgoritmo: VERSAO_V1 };
}

module.exports = {
  validarCoordenadas,
  lerCamposInformados,
  obterGeodadosSeguro,
  classificarComGeodados,
  classificarAlerta,
  versaoDoAlerta,
  detalhamentoDoRisco,
  VERSAO_V1,
  VERSAO_V2
};
