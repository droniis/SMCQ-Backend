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
| `GESTOR` | `gestor@smcq.com` | `gestor123` | Registrar e acompanhar alertas; solicitar exclusão |

## Estrutura de pastas

```
SMCQ-Backend/
├── server.js               # Servidor Express: dados em memória, autenticação e rotas
├── services/
│   └── riscoService.js     # Algoritmo multicritério de classificação de risco (IRS)
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
| `POST` | `/alertas` | Registra um alerta e calcula o risco |
| `GET` | `/alertas/:id/risco` | Detalha o cálculo de risco do alerta |
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
| `zonaUrbana` | booleano | não | Guardado, mas não entra no cálculo de risco |
| `direcaoVento` | número (graus) | não | 0 = norte, sentido horário. Padrão `45` |
| `dA_dt` | número | não | Taxa de crescimento da área. Padrão `0` |

O alerta devolvido traz, além dos campos enviados: `id`, `status` (`NOVO` | `EM_ANALISE` | `EM_ATENDIMENTO` | `RESOLVIDO`), `risco` (`BAIXO` | `MODERADO` | `ALTO` | `CRITICO`), `pontuacaoRisco` (o IRS, de 0 a 1), `criadoPor`, `criadoEm`, `atualizadoEm`, `historico` e `solicitacoesExclusao`.

Exemplo de resposta do `GET /alertas/:id/risco`:

```json
{
  "alertaId": 1,
  "irs": 0.9378,
  "sigmoide": 0.9876,
  "nivel": "CRITICO",
  "detalhes": {
    "area":    { "valorBruto": "GRANDE", "fator": 1, "peso": 0.16, "contribuicao": 0.16 },
    "urbano":  { "cidadeProxima": "São Paulo", "distanciaKm": 0, "fator": 1, "peso": 0.42, "contribuicao": 0.42 },
    "vento":   { "direcaoGraus": 45, "intensidade": "ALTO", "fator": 0.8536, "peso": 0.09, "contribuicao": 0.0768 },
    "pessoas": { "valorBruto": true, "fator": 1, "peso": 0.26, "contribuicao": 0.26 },
    "tempo":   { "dA_dt": 0, "fator": 0.3, "peso": 0.07, "contribuicao": 0.021 }
  }
}
```

### Exclusão de alertas

A exclusão é **lógica**: o alerta recebe `excluido: true`, `excluidoEm` e `excluidoPor`, some das listagens e passa a responder `404` nas demais rotas, mas continua guardado para auditoria.

| Método | Rota | Quem | Descrição |
| :--- | :--- | :--- | :--- |
| `DELETE` | `/alertas/:id` | Administrador | Exclui o alerta diretamente |
| `POST` | `/alertas/:id/solicitacoes-exclusao` | Operador, Gestor | Solicita a exclusão: `{ motivo }`. Só uma solicitação pendente por alerta |
| `GET` | `/solicitacoes-exclusao` | Todos | Lista as solicitações (o administrador vê todas; os demais, só as próprias). Aceita `?status=PENDENTE\|APROVADA\|REJEITADA` |
| `PATCH` | `/alertas/:id/solicitacoes-exclusao/:sid` | Administrador | Avalia a solicitação: `{ decisao: "APROVADA" \| "REJEITADA", resposta? }`. Aprovar exclui o alerta |

## Algoritmo de classificação de risco

O risco de cada alerta é calculado em `services/riscoService.js` por um **Índice de Risco Sintético (IRS)**: uma soma ponderada de cinco critérios, cada um normalizado entre 0 e 1, com pesos obtidos pelo método AHP (matriz de comparação de Saaty).

```
IRS = Σ (peso do critério × fator do critério)
```

| Critério | Peso | Como o fator é calculado |
| :--- | :--- | :--- |
| Proximidade urbana | 0,42 | Distância `d` (km, fórmula de Haversine) até a cidade mais próxima de uma lista fixa de 10 capitais: `e^(−0,2·d)` |
| Pessoas em risco | 0,26 | `1` se há pessoas em risco, `0` caso contrário |
| Área afetada | 0,16 | Pequena `0,33`, média `0,66`, grande `1,0` |
| Vento | 0,09 | Intensidade (baixo `0,33`, moderado `0,66`, alto `1,0`) × alinhamento `(1 + cos θ) / 2`, em que `θ` é o ângulo entre a direção do vento e a direção do alerta até a cidade mais próxima |
| Propagação temporal | 0,07 | `ln(1 + dA/dt) / 1,1`, limitado a 1. Sem taxa informada, usa `0,3` |

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

## Limitações conhecidas

- **Dados em memória.** Reiniciar o servidor apaga alertas e solicitações.
- **Proximidade urbana restrita a 10 cidades.** O fator urbano cai a quase zero além de cerca de 25 km. Um alerta distante dessas cidades e sem pessoas em risco é sempre classificado como `BAIXO`, qualquer que seja a área ou o vento.
- **Segredo do JWT e porta fixos no código.** Adequado apenas para desenvolvimento e demonstração.

O modelo multicritério prioriza ocorrências com ameaça direta a populações urbanas, conforme o escopo do SMCQ. Trabalhos futuros podem incorporar um fator independente de risco ambiental para áreas remotas.

## Licença

Distribuído sob a licença MIT. Veja o arquivo [LICENSE](LICENSE).
