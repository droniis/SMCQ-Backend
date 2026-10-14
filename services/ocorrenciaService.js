// ============================================================
// TIPO DE OCORRÊNCIA DO ALERTA
//   QUEIMADA_VEGETACAO → fogo em vegetação (Pantanal, Amazônia...):
//                        basta o ponto; endereço é opcional.
//   INCENDIO_URBANO    → incêndio em área urbana: exige endereço
//                        (rua ou ponto de referência, bairro,
//                        município e UF).
// O tipo NÃO entra na fórmula do IRS: só define o valor padrão de
// uma entrada que já existia, a zona urbana, usada por
// resolverTipoArea (riscoService.js) quando não há UC/TI no ponto
// nem tipo de área informado.
//
// Compatibilidade com clientes antigos, que enviam "zonaUrbana":
//   - tipoOcorrencia enviado → prevalece; zonaUrbana efetiva =
//     (tipoOcorrencia === 'INCENDIO_URBANO') e a enviada é ignorada;
//   - só zonaUrbana → tipo QUEIMADA_VEGETACAO e zonaUrbana como
//     antes (IRS idêntico ao de antes da mudança);
//   - nenhum dos dois → QUEIMADA_VEGETACAO, zonaUrbana false.
// ============================================================

const TIPOS_OCORRENCIA = ['QUEIMADA_VEGETACAO', 'INCENDIO_URBANO'];
const TIPO_PADRAO = 'QUEIMADA_VEGETACAO';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

// Tamanhos das colunas da tabela localizacao (db/schema.sql): acima disso o banco recusaria a gravação
const TAMANHO_MAXIMO = { estado: 60, municipio: 120, cep: 10, logradouro: 200, numero: 20, bairro: 120 };

const NOMES_CAMPOS = {
  logradouro: 'rua ou ponto de referência',
  bairro: 'bairro',
  municipio: 'município',
  estado: 'UF'
};

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor).trim());
const informado = (valor) => valor !== undefined && valor !== null && valor !== '';

function tipoValido(valor) {
  return TIPOS_OCORRENCIA.includes(valor);
}

// Corpo do POST → { tipoOcorrencia, zonaUrbana, erro }
function resolverTipoOcorrencia({ tipoOcorrencia, zonaUrbana }) {
  if (informado(tipoOcorrencia)) {
    if (!tipoValido(tipoOcorrencia)) {
      return { erro: `Tipo de ocorrência inválido: ${tipoOcorrencia}. Valores aceitos: ${TIPOS_OCORRENCIA.join(', ')}` };
    }
    return { tipoOcorrencia, zonaUrbana: tipoOcorrencia === 'INCENDIO_URBANO', erro: null };
  }
  // Cliente antigo: Boolean() mantém a mesma leitura "verdadeira" que o cálculo sempre fez do campo
  return { tipoOcorrencia: TIPO_PADRAO, zonaUrbana: Boolean(zonaUrbana), erro: null };
}

// Endereço do corpo do POST → { endereco, erros: [...] }, com os textos já aparados.
// INCENDIO_URBANO exige rua (ou ponto de referência), bairro, município e UF; o CEP, se vier, tem 8 dígitos.
// QUEIMADA_VEGETACAO não exige endereço.
function lerEndereco(corpo, tipoOcorrencia) {
  const endereco = {
    estado: texto(corpo.estado),
    municipio: texto(corpo.municipio),
    cep: texto(corpo.cep),
    logradouro: texto(corpo.logradouro),
    numero: texto(corpo.numero),
    bairro: texto(corpo.bairro)
  };
  const erros = [];

  if (tipoOcorrencia === 'INCENDIO_URBANO') {
    endereco.estado = endereco.estado.toUpperCase();
    const faltando = Object.keys(NOMES_CAMPOS).filter(campo => !endereco[campo]);
    if (faltando.length > 0) {
      erros.push(`Para incêndio em área urbana, informe: ${faltando.map(c => NOMES_CAMPOS[c]).join(', ')}`);
    }
    if (endereco.estado && !UFS.includes(endereco.estado)) {
      erros.push(`UF inválida: ${endereco.estado}. Use a sigla de um dos 27 estados (ex.: SP)`);
    }
    if (endereco.cep && endereco.cep.replace(/\D/g, '').length !== 8) {
      erros.push('CEP inválido: informe 8 dígitos ou deixe em branco');
    }
  }

  const longos = Object.entries(TAMANHO_MAXIMO).filter(([campo, max]) => endereco[campo].length > max);
  for (const [campo, max] of longos) erros.push(`O campo ${campo} aceita no máximo ${max} caracteres`);

  return { endereco, erros };
}

module.exports = {
  TIPOS_OCORRENCIA,
  TIPO_PADRAO,
  UFS,
  tipoValido,
  resolverTipoOcorrencia,
  lerEndereco
};
