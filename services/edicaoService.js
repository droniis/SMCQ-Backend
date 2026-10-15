// ============================================================
// EDIÇÃO DE OCORRÊNCIA (RF11, HU04)
//   Editáveis: título, descrição, área afetada, vento, pessoas em
//   risco, bioma e tipo de área informados.
//   NÃO editáveis nesta versão: localização (coordenadas e endereço)
//   e tipo de ocorrência.
// Se mudar alguma entrada do cálculo, o IRS é recalculado com os
// geodados JÁ GRAVADOS no alerta (classificarComGeodados), sem nova
// consulta às bases externas. Fórmula, pesos e limiares continuam
// só em riscoService.js.
// ============================================================

const { classificarComGeodados, lerCamposInformados } = require('./classificacaoService');

const CAMPOS_EDITAVEIS = ['titulo', 'descricao', 'areaAfetada', 'vento', 'pessoasRisco', 'bioma', 'tipoArea'];
const AREAS_AFETADAS = ['PEQUENA', 'MEDIA', 'GRANDE'];
const INTENSIDADES_VENTO = ['BAIXO', 'MODERADO', 'ALTO'];
const TAMANHO_MAXIMO_TITULO = 200; // coluna alerta.titulo (db/schema.sql)

// Campos simples do alerta, na ordem em que entram no histórico
const CAMPOS_DADOS = ['titulo', 'descricao', 'areaAfetada', 'vento', 'pessoasRisco'];

// Corpo do PATCH → { campos, erros: [...], naoEditaveis: [...] }.
// "campos" só traz o que veio no corpo, já validado e normalizado.
// bioma/tipoArea null ou '' = deixar de informar (volta a valer o detectado).
function lerEdicao(corpo) {
  const campos = {};
  const erros = [];
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { campos, erros: ['Corpo da requisição inválido'], naoEditaveis: [] };
  }
  const naoEditaveis = Object.keys(corpo).filter(c => !CAMPOS_EDITAVEIS.includes(c));
  const veio = (campo) => Object.prototype.hasOwnProperty.call(corpo, campo);

  if (veio('titulo')) {
    const titulo = typeof corpo.titulo === 'string' ? corpo.titulo.trim() : '';
    if (!titulo) erros.push('O título é obrigatório');
    else if (titulo.length > TAMANHO_MAXIMO_TITULO) erros.push(`O título aceita no máximo ${TAMANHO_MAXIMO_TITULO} caracteres`);
    else campos.titulo = titulo;
  }
  if (veio('descricao')) {
    if (corpo.descricao === null) campos.descricao = '';
    else if (typeof corpo.descricao === 'string') campos.descricao = corpo.descricao.trim();
    else erros.push('A descrição deve ser um texto');
  }
  if (veio('areaAfetada')) {
    if (AREAS_AFETADAS.includes(corpo.areaAfetada)) campos.areaAfetada = corpo.areaAfetada;
    else erros.push(`Área afetada inválida: ${corpo.areaAfetada}. Valores aceitos: ${AREAS_AFETADAS.join(', ')}`);
  }
  if (veio('vento')) {
    if (INTENSIDADES_VENTO.includes(corpo.vento)) campos.vento = corpo.vento;
    else erros.push(`Vento inválido: ${corpo.vento}. Valores aceitos: ${INTENSIDADES_VENTO.join(', ')}`);
  }
  if (veio('pessoasRisco')) {
    if (typeof corpo.pessoasRisco === 'boolean') campos.pessoasRisco = corpo.pessoasRisco;
    else erros.push('Pessoas em risco deve ser verdadeiro ou falso');
  }
  // Mesma validação e normalização do cadastro ("Mata Atlântica" → MATA_ATLANTICA)
  const informados = lerCamposInformados({
    bioma: veio('bioma') ? corpo.bioma : undefined,
    tipoArea: veio('tipoArea') ? corpo.tipoArea : undefined
  });
  erros.push(...informados.erros);
  if (veio('bioma')) campos.bioma = informados.bioma;
  if (veio('tipoArea')) campos.tipoArea = informados.tipoArea;

  return { campos, erros, naoEditaveis };
}

// Bioma e tipo de área que o operador informou (null = vale o detectado)
function informadosDoAlerta(alerta) {
  return {
    bioma: alerta.biomaOrigem === 'informado' ? alerta.bioma : null,
    tipoArea: alerta.tipoAreaOrigem === 'informado' ? alerta.tipoArea : null
  };
}

const erroResolvido = () =>
  Object.assign(new Error('Alerta resolvido não pode ser editado'), { code: 'ALERTA_RESOLVIDO' });

// Aplica a edição ao alerta atual (sem gravar).
// → { dados, risco, historico }
//   dados     → valores finais dos campos simples (titulo, descricao, areaAfetada, vento, pessoasRisco)
//   risco     → campos da nova classificação (mesmo formato de classificarComGeodados) ou null se nada do cálculo mudou
//   historico → [{ campo, valorAnterior, valorNovo }] com cada valor que mudou, inclusive o nível de risco
// Os repositórios chamam esta função com o alerta já travado, para que um alerta resolvido
// no meio do caminho também seja recusado (erro ALERTA_RESOLVIDO).
function aplicarEdicao(alerta, campos) {
  if (alerta.status === 'RESOLVIDO') throw erroResolvido();

  const anteriores = {
    titulo: alerta.titulo,
    descricao: alerta.descricao || '',
    areaAfetada: alerta.areaAfetada,
    vento: alerta.vento,
    pessoasRisco: Boolean(alerta.pessoasRisco)
  };
  const dados = { ...anteriores };
  for (const campo of CAMPOS_DADOS) if (campo in campos) dados[campo] = campos[campo];

  const informadosAntes = informadosDoAlerta(alerta);
  const informados = { ...informadosAntes };
  if ('bioma' in campos) informados.bioma = campos.bioma;
  if ('tipoArea' in campos) informados.tipoArea = campos.tipoArea;

  const historico = CAMPOS_DADOS
    .filter(campo => dados[campo] !== anteriores[campo])
    .map(campo => ({ campo, valorAnterior: anteriores[campo], valorNovo: dados[campo] }));

  const mudouCalculo = ['areaAfetada', 'vento', 'pessoasRisco'].some(c => dados[c] !== anteriores[c])
    || informados.bioma !== informadosAntes.bioma
    || informados.tipoArea !== informadosAntes.tipoArea;
  if (!mudouCalculo) return { dados, risco: null, historico };

  // Mesmas entradas da criação (server.js), agora com os geodados gravados
  const risco = classificarComGeodados({
    latitude: Number(alerta.latitude),
    longitude: Number(alerta.longitude),
    areaAfetada: dados.areaAfetada,
    vento: dados.vento,
    pessoasRisco: dados.pessoasRisco,
    zonaUrbana: alerta.zonaUrbana,
    direcaoVento: alerta.direcaoVento ?? 45,
    dA_dt: alerta.dA_dt ?? 0
  }, informados, alerta.geodados || null);

  // Bioma e tipo de área: registra o valor CONSIDERADO no cálculo, e o nível de risco se mudou
  for (const [campo, anterior, novo] of [
    ['bioma', alerta.bioma, risco.bioma],
    ['tipoArea', alerta.tipoArea, risco.tipoArea],
    ['risco', alerta.risco, risco.risco]
  ]) {
    if ((anterior ?? null) !== (novo ?? null)) historico.push({ campo, valorAnterior: anterior ?? null, valorNovo: novo ?? null });
  }
  return { dados, risco, historico };
}

module.exports = { CAMPOS_EDITAVEIS, lerEdicao, aplicarEdicao, informadosDoAlerta };
