# SMCQ — Backend

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-auth-000000?logo=jsonwebtokens&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

API REST do **SMCQ (Sistema de Monitoramento de Queimadas)**, desenvolvido como Trabalho de Conclusão de Curso. O backend autentica usuários, registra ocorrências de queimadas, classifica o risco de cada uma com um algoritmo multicritério e controla o fluxo de exclusão de alertas com aprovação.

> **Protótipo acadêmico.** Os dados ficam em memória e são apagados a cada reinício do servidor. Não há banco de dados.

O frontend (React + Vite) fica em um repositório separado: [SMCQ-TCC](https://github.com/droniis/SMCQ-TCC).

## Sumário

- [Tecnologias](#tecnologias)
- [Instalação e execução](#instalação-e-execução)
- [Usuários de teste](#usuários-de-teste)
- [Estrutura de pastas](#estrutura-de-pastas)
- [API](#api)
- [Algoritmo de classificação de risco](#algoritmo-de-classificação-de-risco)
- [Bases de dados externas](#bases-de-dados-externas)
- [Validação do IRS](#validação-do-irs)
- [Testes e lint](#testes-e-lint)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

## Tecnologias

| Tecnologia | Uso |
| :--- | :--- |
| [Node.js](https://nodejs.org/) | Ambiente de execução |
| [Express](https://expressjs.com/) 4 | Servidor HTTP e rotas |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | Autenticação por token JWT (validade de 2 horas) |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | Hash das senhas |
| [cors](https://github.com/expressjs/cors) | Liberação de acesso para o frontend |
| [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest) | Testes automatizados (unitários e da API); só em desenvolvimento |
| [ESLint](https://eslint.org/) | Análise estática do código; só em desenvolvimento |

Desenvolvido e testado com Node.js 24.x.

## Instalação e execução

Pré-requisito: Node.js 18 ou superior.

```bash
git clone https://github.com/droniis/SMCQ-Backend.git
cd SMCQ-Backend
npm install
node server.js
```

O servidor sobe em `http://localhost:3000` (`npm start` faz o mesmo). A porta é fixa no `server.js`.

Teste rápido:

```bash
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smcq.com","senha":"admin123"}'
```

## Usuários de teste

| Perfil | E-mail | Senha | Pode |
| :--- | :--- | :--- | :--- |
| `ADMINISTRADOR` | `admin@smcq.com` | `admin123` | Tudo, incluindo excluir alertas e avaliar solicitações de exclusão |
| `OPERADOR` | `operador@smcq.com` | `operador123` | Registrar e acompanhar alertas; solicitar exclusão |
| `GESTOR` | `gestor@smcq.com` | `gestor123` | Registrar e acompanhar alertas; excluir alertas e avaliar solicitações de exclusão |

## Estrutura de pastas

```
SMCQ-Backend/
├── server.js               # Servidor Express: dados em memória, autenticação e rotas
├── services/
│   ├── riscoService.js     # Algoritmo multicritério de classificação de risco (IRS v1 e v2)
│   ├── classificacaoService.js # Liga o alerta ao IRS v2: geodados + valores informados + cálculo
│   ├── geodadosService.js  # Bioma, UC, TI, fauna e focos (IBGE, ICMBio, FUNAI, GBIF, INPE)
│   ├── cacheService.js     # Cache em memória com TTL
│   ├── linhaBaseService.js # Linha de base da validação (média simples, sem AHP)
│   └── metricasService.js  # Acurácia, matriz de confusão, recall e kappa ponderado
├── scripts/validacao/      # Validação do IRS com focos reais do INPE
├── data/validacao/         # Amostra, cache das consultas externas e resultados
├── docs/
│   ├── irs-v2.md           # Algoritmo IRS v2: pesos, tabelas, fórmulas e justificativa
│   ├── bases-de-dados.md   # Bases externas: dado usado, forma de acesso e licença
│   ├── validacao-irs.md    # Relatório da validação (Cap. 6 do TCC)
│   └── atualizacoes-tcc.md # Textos para atualizar o documento do TCC
├── tests/                  # Testes Jest e Supertest (sem acesso à internet)
├── package.json
├── package-lock.json
├── README.md
└── LICENSE
```

## API

Base: `http://localhost:3000/api`. Todas as rotas, exceto o login, exigem o cabeçalho `Authorization: Bearer <token>`. Erros voltam sempre no formato `{ "erro": "mensagem" }`.

| Código | Significado |
| :--- | :--- |
| `400` | Dados inválidos ou ausentes |
| `401` | Token ausente, inválido ou expirado (ou credenciais erradas no login) |
| `403` | Usuário autenticado sem permissão para a ação |
| `404` | Alerta ou solicitação não encontrados |
| `409` | Conflito (ex.: já existe solicitação de exclusão pendente) |

### Autenticação

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/login` | Recebe `{ email, senha }` e devolve `{ token, usuario }` |

### Alertas

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/alertas` | Lista os alertas ativos (os excluídos não aparecem) |
| `GET` | `/alertas/geodados-preview?lat=X&lng=Y` | Geodados de um ponto (bioma, UC, TI, fauna, focos), sem criar alerta. `400` se `lat`/`lng` forem inválidos |
| `POST` | `/alertas` | Registra um alerta e calcula o risco pelo IRS v2 |
| `GET` | `/alertas/:id/risco` | Detalha o cálculo de risco do alerta |
| `GET` | `/alertas/:id/geodados` | Geodados gravados no alerta (`origem: "salvo"`); se não houver, consulta em tempo real (`origem: "tempo-real"`), sem gravar |
| `PATCH` | `/alertas/:id/status` | Altera o status: `{ status }` |
| `POST` | `/alertas/:id/observacoes` | Adiciona uma observação: `{ observacao }` |

Corpo do `POST /alertas`:

| Campo | Tipo | Obrigatório | Observação |
| :--- | :--- | :--- | :--- |
| `titulo` | texto | sim | |
| `areaAfetada` | `PEQUENA` \| `MEDIA` \| `GRANDE` | sim | |
| `vento` | `BAIXO` \| `MODERADO` \| `ALTO` | sim | Intensidade do vento |
| `latitude`, `longitude` | número | sim | |
| `descricao` | texto | não | |
| `estado`, `municipio` | texto | não | |
| `cep`, `logradouro`, `numero`, `bairro` | texto | não | |
| `pessoasRisco` | booleano | não | Padrão `false` |
| `zonaUrbana` | booleano | não | Sem UC/TI no ponto e sem tipo de área informado, define o tipo de área: urbana (`true`) ou rural |
| `direcaoVento` | número (graus) | não | Para onde o vento sopra: 0 = norte, sentido horário. Padrão `45` |
| `dA_dt` | número | não | Taxa de crescimento da área. Padrão `0` |
| `bioma` | `AMAZONIA` \| `PANTANAL` \| `MATA_ATLANTICA` \| `CERRADO` \| `CAATINGA` \| `PAMPA` \| `URBANO` \| `OUTRO` | não | Correção do operador: prevalece sobre o bioma detectado. Aceita nome por extenso (`"Mata Atlântica"`). Valor fora da lista → `400` |
| `tipoArea` | `TERRA_INDIGENA` \| `UC_FEDERAL` \| `UC_ESTADUAL` \| `APP` \| `RESERVA_LEGAL` \| `RURAL` \| `URBANA` | não | Correção do operador: prevalece sobre o tipo detectado. Valor fora da lista → `400` |

Latitude e longitude fora da faixa válida (ou não numéricas) → `400`. Falha das bases externas **não** impede o registro: o serviço de geodados usa um valor de reserva (fallback) e registra a fonte usada.

O alerta devolvido traz, além dos campos enviados:

| Campo | Descrição |
| :--- | :--- |
| `id`, `status`, `criadoPor`, `criadoEm`, `atualizadoEm`, `historico`, `solicitacoesExclusao` | Como antes. `status`: `NOVO` \| `EM_ANALISE` \| `EM_ATENDIMENTO` \| `RESOLVIDO` |
| `risco` | Nível: `BAIXO` \| `MODERADO` \| `ALTO` \| `CRITICO` |
| `irs` (e `pontuacaoRisco`, mesmo valor) | Índice de Risco Sintético, de 0 a 1 |
| `sigmoide` | Valor da sigmoide do IRS, usado para o nível |
| `detalhes` | Os 9 critérios: valor de entrada, fator, peso, contribuição e origem |
| `bioma`, `biomaOrigem` | Bioma considerado no cálculo e sua origem: `"detectado"` ou `"informado"` |
| `tipoArea`, `tipoAreaOrigem` | Tipo de área considerado e sua origem: `"detectado"` ou `"informado"` |
| `areaCriticaFauna` | Nível de fauna ameaçada considerado: `CRITICA` \| `AMEACADA` \| `VULNERAVEL` \| `SEM_ESPECIES` \| `URBANA` |
| `proximaUC` | `true` se há UC ou TI a menos de 10 km (ou o ponto está dentro de uma) |
| `geodados` | Objeto completo do serviço de geodados, com `fontes` (de onde veio cada dado) e `obtidoEm` (quando cada dado foi obtido) |
| `versaoAlgoritmo` | `"IRS v2"`. Alerta sem esse campo é tratado como `"IRS v1"` |

**Alertas do IRS v1.** Como os alertas ficam só em memória, não há alertas antigos persistidos: depois de reiniciar o servidor, todos são calculados pelo v2. Por isso não há script de recálculo. Por precaução, um alerta sem `versaoAlgoritmo` aparece como `"IRS v1"` na listagem, e o `GET /alertas/:id/risco` dele continua recalculado pelo v1.

Exemplo de resposta do `GET /alertas/:id/risco` (alerta no Pantanal, IRS v2):

```json
{
  "alertaId": 2,
  "irs": 0.5412,
  "sigmoide": 0.6017,
  "nivel": "ALTO",
  "versaoAlgoritmo": "IRS v2",
  "detalhes": {
    "area":       { "valorBruto": "GRANDE", "fator": 1, "peso": 0.1, "contribuicao": 0.1 },
    "urbano":     { "cidadeProxima": "Brasília", "distanciaKm": 943.2, "fator": 0, "peso": 0.15, "contribuicao": 0 },
    "vento":      { "direcaoGraus": 45, "intensidade": "ALTO", "fator": 0.8872, "peso": 0.06, "contribuicao": 0.0532 },
    "pessoas":    { "valorBruto": false, "fator": 0, "peso": 0.14, "contribuicao": 0 },
    "tempo":      { "dA_dt": 0, "fator": 0.3, "peso": 0.06, "contribuicao": 0.018 },
    "bioma":      { "valorBruto": "PANTANAL", "fonte": "IBGE WFS", "fator": 1, "peso": 0.2, "contribuicao": 0.2 },
    "tipoArea":   { "valorBruto": "RURAL", "nome": null, "fonte": "padrao", "fator": 0.4, "peso": 0.12, "contribuicao": 0.048 },
    "fauna":      { "valorBruto": "AMEACADA", "totalEspecies": 26, "fonte": "geodados", "fator": 0.8, "peso": 0.1, "contribuicao": 0.08 },
    "relevancia": { "faixa": "10-50 km", "distanciaKm": null, "fonte": "geodados", "fator": 0.6, "peso": 0.07, "contribuicao": 0.042 }
  }
}
```

**Desempenho.** O frontend chama o `geodados-preview` quando o usuário escolhe o local no mapa. O resultado fica em cache (1 h), e o `POST` seguinte no mesmo ponto não faz nenhuma consulta externa (cerca de 2 ms). Ao subir, o servidor carrega em segundo plano os CSVs de focos do INPE e os renova a cada 45 min. Em 14/10/2026, um `POST` num ponto nunca consultado levou de 0,2 a 1,0 s.

### Exclusão de alertas

A exclusão é **lógica**: o alerta recebe `excluido: true`, `excluidoEm` e `excluidoPor`, some das listagens e passa a responder `404` nas demais rotas, mas continua guardado para auditoria.

| Método | Rota | Quem | Descrição |
| :--- | :--- | :--- | :--- |
| `DELETE` | `/alertas/:id` | Administrador, Gestor | Exclui o alerta diretamente |
| `POST` | `/alertas/:id/solicitacoes-exclusao` | Operador | Solicita a exclusão: `{ motivo }`. Só uma solicitação pendente por alerta |
| `GET` | `/solicitacoes-exclusao` | Todos | Lista as solicitações (administrador e gestor veem todas; o operador, só as próprias). Aceita `?status=PENDENTE\|APROVADA\|REJEITADA` |
| `PATCH` | `/alertas/:id/solicitacoes-exclusao/:sid` | Administrador, Gestor | Avalia a solicitação: `{ decisao: "APROVADA" \| "REJEITADA", resposta? }`. Aprovar exclui o alerta |

## Algoritmo de classificação de risco

O risco de cada alerta é calculado pelo **Índice de Risco Sintético (IRS) v2** (`calcularRiscoAvancadoV2`, em `services/riscoService.js`): uma soma ponderada de nove critérios, cada um normalizado entre 0 e 1, com pesos AHP. A descrição completa, com as tabelas de pontuação, as fórmulas e a justificativa da mudança, está em [`docs/irs-v2.md`](docs/irs-v2.md).

```
IRS = Σ (peso do critério × fator do critério)
```

| Critério | Peso v2 | Como o fator é calculado |
| :--- | :--- | :--- |
| Bioma | 0,20 | Tabela por bioma (Amazônia e Pantanal `1,0` … urbano `0,3`). IBGE, ou valor informado pelo operador |
| Proximidade urbana | 0,15 | Distância `d` (km, fórmula de Haversine) até a cidade mais próxima de uma lista fixa de 10 capitais: `e^(−0,2·d)` |
| Pessoas em risco | 0,14 | `1` se há pessoas em risco, `0` caso contrário |
| Tipo de área | 0,12 | TI e UC federal `1,0`, UC estadual `0,85`, APP `0,8`, reserva legal `0,7`, rural `0,4`, urbana `0,3`. FUNAI/ICMBio, ou valor informado |
| Área afetada | 0,10 | Pequena `0,33`, média `0,66`, grande `1,0` |
| Fauna ameaçada | 0,10 | Categoria IUCN mais grave a até 50 km (GBIF): crítica `1,0`, em perigo `0,8`, vulnerável `0,6`, sem espécies `0,3` |
| Relevância ecológica | 0,07 | UC/TI a menos de 10 km `1,0`; de 10 a 50 km `0,6`; mais longe `0,3` |
| Vento | 0,06 | Intensidade (baixo `0,33`, moderado `0,66`, alto `1,0`) × alinhamento `(1 + cos θ) / 2`, em que `θ` é o ângulo entre a direção do vento e a direção do alerta até a cidade mais próxima |
| Propagação temporal | 0,06 | `ln(1 + dA/dt) / 1,1`, limitado a 1. Sem taxa informada, usa `0,3` |

O IRS v1 (`calcularRiscoAvancado`), com os cinco primeiros critérios e pesos 0,42 (urbano), 0,26 (pessoas), 0,16 (área), 0,09 (vento) e 0,07 (tempo), continua no código para comparação na validação e para alertas sem versão.

O IRS passa por uma função sigmoide, que acentua a separação entre os níveis:

```
S = 1 / (1 + e^(−10 · (IRS − 0,5)))
```

| Valor de S | Nível |
| :--- | :--- |
| menor que 0,25 | `BAIXO` |
| de 0,25 a menos de 0,50 | `MODERADO` |
| de 0,50 a menos de 0,75 | `ALTO` |
| 0,75 ou mais | `CRITICO` |

As cidades de referência são São Paulo, Rio de Janeiro, Brasília, Belo Horizonte, Salvador, Manaus, Porto Alegre, Curitiba, Recife e Fortaleza.

## Bases de dados externas

Os critérios ambientais vêm de bases públicas, sem chave de acesso: IBGE (bioma), ICMBio via INDE (unidades de conservação), FUNAI (terras indígenas), GBIF (fauna ameaçada) e INPE (focos de calor). O frontend usa OpenStreetMap, Nominatim, Photon e ViaCEP. A validação usou também o Open-Meteo. Dado usado, forma de acesso e licença de cada uma: [`docs/bases-de-dados.md`](docs/bases-de-dados.md).

## Validação do IRS

O IRS v2 foi validado com 294 focos de calor reais do INPE (agosto e setembro de 2026), comparado com uma linha de base sem pesos AHP e com o IRS v1. Método, resultados e limitações estão em [`docs/validacao-irs.md`](docs/validacao-irs.md).

Para reproduzir:

```bash
npm install
node scripts/validacao/coletar-dados.js     # baixa os CSVs mensais do INPE (~250 MB) para data/validacao/bruto/
node scripts/validacao/preparar-amostra.js  # sorteia a amostra e monta as entradas do dia 0 e o gabarito
node scripts/validacao/validar-irs.js       # calcula métricas, sensibilidade e cenários; grava data/validacao/resultados.json
```

- Os CSVs brutos não são versionados (`.gitignore`). O `data/validacao/bruto/fontes.json` registra a URL, a data e o SHA-256 de cada arquivo, para conferir se o download é o mesmo.
- O vento (Open-Meteo) e os geodados ficam em cache em `data/validacao/cache/`. Com o cache versionado, a preparação não refaz nenhuma consulta externa e reproduz exatamente a amostra publicada.
- O sorteio e o bootstrap usam semente fixa (`scripts/validacao/config.js`), onde também ficam todos os parâmetros da validação.
- As entradas do IRS só usam dados do dia do foco. O teste `tests/vazamento.test.js` garante que os focos dos dias seguintes, que formam o gabarito, não influenciam o cálculo.

## Testes e lint

```bash
npm test                  # testes Jest e Supertest (tests/)
npm run test:coverage     # os mesmos testes, com relatório de cobertura (em coverage/)
npm run lint              # ESLint
node teste-irs-v2-mock.js # testes do IRS v2 com geodados simulados
```

Os testes nunca acessam a internet. `tests/helpers/semInternet.js` bloqueia a rede em todos eles, e as bases externas são simuladas por `tests/helpers/fetchFalso.js`. Os testes da API importam o `app` sem abrir porta.

**Cobertura.** O escopo é o código da aplicação: `server.js` e `services/` (configurado em `jest.collectCoverageFrom`, no `package.json`). Os scripts de validação (`scripts/validacao/`) ficam fora: são ferramentas de linha de comando que dependem de rede, e só a biblioteca da amostra é testada (`tests/vazamento.test.js`). Resultado em 14/10/2026, com 105 testes:

| Escopo | Linhas | Instruções | Ramos | Funções |
| :--- | ---: | ---: | ---: | ---: |
| **Geral** (`server.js` + `services/`) | **94,9%** | 93,2% | 85,3% | 92,6% |
| `services/riscoService.js` | 97,9% | 98,1% | 89,5% | 100% |
| `services/classificacaoService.js` | 100% | 100% | 100% | 100% |
| `server.js` | 93,3% | 92,1% | 91,1% | 96,9% |
| `services/geodadosService.js` | 94,5% | 90,2% | 72,5% | 86,4% |
| `services/cacheService.js` | 64,7% | 60,0% | 44,4% | 60,0% |

O RNF14 exige no mínimo 70%. O único arquivo abaixo disso é o `cacheService.js`, cuja parte não testada é a limpeza de entradas vencidas acima de 500 itens.

## Limitações conhecidas

- **Dados em memória.** Reiniciar o servidor apaga alertas e solicitações.
- **Proximidade urbana restrita a 10 cidades.** O fator urbano cai a quase zero além de cerca de 25 km; na validação, ficou abaixo de 0,05 em 98,6% dos focos reais. No IRS v1, isso fazia todo alerta distante dessas cidades e sem pessoas em risco ser `BAIXO`. No v2, os critérios ambientais compensam em parte. Melhoria prevista: usar as sedes municipais do IBGE.
- **Dependência de bases externas.** Sem resposta de uma base, o critério correspondente usa um valor de reserva (marcado em `geodados.fontes`), e o resultado fica menos preciso.
- **Validação do IRS v2.** Concordância leve com o gabarito de propagação do fogo, sem superar a linha de base sem pesos AHP. Detalhes e limitações em [`docs/validacao-irs.md`](docs/validacao-irs.md).
- **Segredo do JWT e porta fixos no código.** Adequado apenas para desenvolvimento e demonstração.

## Licença

Distribuído sob a licença MIT. Veja o arquivo [LICENSE](LICENSE).
