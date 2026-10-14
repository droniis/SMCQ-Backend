# SMCQ — Backend

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-auth-000000?logo=jsonwebtokens&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

API REST do **SMCQ (Sistema de Monitoramento de Queimadas)**, desenvolvido como Trabalho de Conclusão de Curso. O backend autentica usuários, registra ocorrências de queimadas, classifica o risco de cada uma com um algoritmo multicritério e controla o fluxo de exclusão de alertas com aprovação.

> Os dados ficam no **PostgreSQL** e permanecem após reiniciar o servidor. Para demonstração rápida sem banco, há também o modo em memória (`PERSISTENCIA=memoria`), em que os dados se perdem a cada reinício.

O frontend (React + Vite) fica em um repositório separado: [SMCQ-TCC](https://github.com/droniis/SMCQ-TCC).

## Sumário

- [Tecnologias](#tecnologias)
- [Instalação e execução](#instalação-e-execução)
- [Usuários de teste](#usuários-de-teste)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Banco de dados](#banco-de-dados)
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
| [PostgreSQL](https://www.postgresql.org/) 18 | Banco de dados relacional (sem PostGIS: distâncias pela fórmula de Haversine) |
| [pg](https://node-postgres.com/) (node-postgres) | Driver de acesso ao PostgreSQL, com SQL escrito à mão (sem ORM) |
| [dotenv](https://github.com/motdotla/dotenv) | Leitura das configurações e credenciais do arquivo `.env` |
| [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest) | Testes automatizados (unitários e da API); só em desenvolvimento |
| [ESLint](https://eslint.org/) | Análise estática do código; só em desenvolvimento |

Desenvolvido e testado com Node.js 24.x.

## Instalação e execução

Pré-requisitos: Node.js 18 ou superior e PostgreSQL 18 (versões 13 ou superiores também funcionam).

**1. Código e dependências**

```bash
git clone https://github.com/droniis/SMCQ-Backend.git
cd SMCQ-Backend
npm install
```

**2. Banco de dados.** Instale o PostgreSQL (no Windows, pelo instalador oficial, que também instala o pgAdmin) e crie um banco vazio chamado `smcq`, pelo pgAdmin ou pelo terminal:

```bash
createdb -U postgres smcq
```

**3. Arquivo `.env`.** Copie o modelo e preencha:

```bash
copy .env.example .env      # Windows (no Linux/macOS: cp .env.example .env)
```

| Variável | O que colocar |
| :--- | :--- |
| `JWT_SECRET` | Segredo dos tokens. Gere um valor aleatório com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PERSISTENCIA` | `postgres` (banco) ou `memoria` (dados somem ao reiniciar) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Conexão: `localhost`, `5432`, `smcq`, `postgres` |
| `DB_PASSWORD` | Senha do usuário do PostgreSQL definida na instalação |
| `PG_BIN` (opcional) | Pasta `bin` do PostgreSQL, se o `pg_dump` não estiver no PATH nem em `C:\Program Files\PostgreSQL` |
| `BACKUP_RETENCAO` (opcional) | Quantos backups manter (padrão: 30) |

O `.env` não vai para o git. Sem `JWT_SECRET`, o servidor se recusa a iniciar.

**4. Tabelas e usuários de teste**

```bash
npm run db:init    # cria as tabelas e índices (pode ser repetido sem apagar dados)
npm run db:seed    # cadastra os 3 usuários de teste, com senha em hash bcrypt
```

**5. Execução**

```bash
npm start
```

O servidor sobe em `http://localhost:3000` (a porta é fixa no `server.js`) e informa no log se conectou ao banco. Se o PostgreSQL estiver fora do ar, o servidor continua no ar, explica o problema no log e responde `503` até o banco voltar.

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
├── server.js               # Servidor Express: autenticação, rotas e tratamento de erros
├── repositorios/           # Camada de persistência (mesma interface nas duas implementações)
│   ├── index.js            # Escolhe a implementação pela variável PERSISTENCIA
│   ├── postgres/           # PostgreSQL: SQL com o driver pg, transações
│   └── memoria/            # Em memória: testes automatizados e demonstração sem banco
├── db/
│   ├── schema.sql          # Esquema do banco (tabelas, chaves e índices), idempotente
│   ├── smcq-exemplo.sql    # Base de dados de exemplo: esquema + dados de demonstração
│   ├── init.js, seed.js    # npm run db:init / db:seed
│   ├── backup.js           # npm run db:backup (pg_dump)
│   ├── gerar-exemplo.js    # npm run db:exemplo (gera o smcq-exemplo.sql)
│   ├── conexao.js          # Configuração da conexão e mensagens de erro do banco
│   ├── ferramentasPg.js    # Localiza e executa pg_dump e psql
│   └── usuariosPadrao.js   # Usuários de teste
├── backups/                # Backups gerados (fora do git)
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
├── tests/                  # Testes Jest e Supertest (sem internet e sem PostgreSQL)
├── .env.example            # Modelo das variáveis de ambiente (o .env fica fora do git)
├── package.json
├── package-lock.json
├── README.md
└── LICENSE
```

## Banco de dados

### Modelo

O esquema completo está em [`db/schema.sql`](db/schema.sql). As 10 tabelas seguem o diagrama de classes do TCC:

```
usuario ─┬─< alerta ─┬── localizacao          (1:1) coordenadas e endereço
         │           ├── fator_risco          (1:1) dados de ENTRADA do cálculo e geodados (JSONB)
         │           ├── classificacao_risco  (1:1) RESULTADO: IRS, sigmoide, nível, versão do algoritmo
         │           │       └─< contribuicao_criterio   uma linha por critério (9 no IRS v2)
         │           ├─< historico_status     status e exclusão; o 1º registro é a criação
         │           ├─< observacao
         │           ├─< arquivo_anexo        estrutura prevista; ainda sem rota na API
         │           └─< solicitacao_exclusao
```

- **Índices (RNF20)** para os filtros por data, status, nível de risco e região (estado/município), além de coordenadas.
- **Regras garantidas pelo banco:** valores válidos de status, perfil e nível (`CHECK`) e no máximo uma solicitação de exclusão pendente por alerta (índice único parcial).
- **Transações:** a criação do alerta (com classificação, contribuições e histórico), a mudança de status, a exclusão e a avaliação de solicitações gravam tudo ou nada.
- **Senhas:** apenas o hash bcrypt (RNF03).
- **Sem PostGIS:** as distâncias continuam calculadas na aplicação pela fórmula de Haversine (RNF17).

A API devolve os alertas no mesmo formato JSON nos dois modos de persistência; o frontend não percebe diferença.

### Backup (RNF07)

```bash
npm run db:backup
```

Gera `backups/smcq-AAAA-MM-DD_HH-MM-SS.sql` com o `pg_dump` (esquema + dados) e mantém os 30 mais recentes (`BACKUP_RETENCAO` no `.env`). Para restaurar (o arquivo apaga e recria as tabelas):

```bash
psql -U postgres -d smcq -f backups/smcq-2026-10-14_19-42-48.sql
```

**Agendamento diário no Windows (Agendador de Tarefas):**

1. Abra o **Agendador de Tarefas** (`taskschd.msc`) e clique em **Criar Tarefa Básica…**
2. Nome: `SMCQ - backup do banco`. Disparador: **Diariamente**, num horário em que o computador esteja ligado (ex.: 23:00).
3. Ação: **Iniciar um programa**.
   - Programa/script: `cmd.exe`
   - Argumentos: `/c npm run db:backup >> backups\agendamento.log 2>&1`
   - Iniciar em: a pasta do projeto (ex.: `C:\Users\<usuário>\Documentos\smcq-prototype`)
4. Conclua e, nas **Propriedades** da tarefa, marque **Executar estando o usuário conectado ou não** e, em **Configurações**, **Executar a tarefa o mais cedo possível após uma inicialização agendada ser perdida**.
5. Teste com o botão direito → **Executar** e confira o novo arquivo em `backups/` e o `backups\agendamento.log`.

Ou, pelo **Prompt de Comando** (`cmd`, não o PowerShell, pois `%CD%` é sintaxe do cmd), na pasta do projeto:

```bat
schtasks /Create /TN "SMCQ - backup do banco" /SC DAILY /ST 23:00 /TR "cmd.exe /c cd /d \"%CD%\" && npm run db:backup >> backups\agendamento.log 2>&1"
```

O script sai com código diferente de zero em caso de falha, e o Agendador registra o resultado em **Último Resultado da Execução**. Recomenda-se copiar periodicamente a pasta `backups/` para outro disco ou para a nuvem.

### Base de dados de exemplo

[`db/smcq-exemplo.sql`](db/smcq-exemplo.sql) contém o esquema e dados de demonstração: os 3 usuários de teste e 6 alertas, um por bioma, classificados pelo IRS v2 com geodados reais e com status, observações e solicitações de exclusão (pendente, rejeitada e aprovada). Não contém senhas reais, apenas os hashes das senhas de demonstração da tabela [Usuários de teste](#usuários-de-teste). O arquivo não usa comandos exclusivos do `psql`, então também pode ser executado no Query Tool do pgAdmin.

```bash
createdb -U postgres smcq_demo
psql -U postgres -d smcq_demo -f db/smcq-exemplo.sql
```

Para regenerá-lo: `npm run db:exemplo`. O script requer internet; cria e apaga bancos temporários próprios, sem tocar no banco `smcq`, e confere a restauração num banco vazio.

## API

Base: `http://localhost:3000/api`. Todas as rotas, exceto o login, exigem o cabeçalho `Authorization: Bearer <token>`. Erros voltam sempre no formato `{ "erro": "mensagem" }`.

| Código | Significado |
| :--- | :--- |
| `400` | Dados inválidos ou ausentes |
| `401` | Token ausente, inválido ou expirado (ou credenciais erradas no login) |
| `403` | Usuário autenticado sem permissão para a ação |
| `404` | Alerta ou solicitação não encontrados |
| `409` | Conflito (ex.: já existe solicitação de exclusão pendente) |
| `500` | Erro interno inesperado (`{ "erro": "Erro interno do servidor" }`) |
| `503` | Banco de dados indisponível no momento; o motivo fica no log do servidor |

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
| `id`, `status`, `criadoPor`, `criadoEm`, `atualizadoEm`, `solicitacoesExclusao` | Como antes. `status`: `NOVO` \| `EM_ANALISE` \| `EM_ATENDIMENTO` \| `RESOLVIDO` |
| `historico` | Alterações de status e a exclusão. O 1º registro é a criação (RNF04): `{ campo: "status", valorAnterior: null, valorNovo: "NOVO", alteradoPor: <criador> }` |
| `latitude`, `longitude` | Sempre numéricos na resposta, mesmo se enviados como texto |
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

**Alertas do IRS v1.** O banco de dados foi introduzido depois do IRS v2, então todos os alertas gravados são do v2 (a versão fica em `classificacao_risco.versao_algoritmo`). Por isso não há script de recálculo. Por precaução, um alerta sem `versaoAlgoritmo` aparece como `"IRS v1"` na listagem, e o `GET /alertas/:id/risco` dele continua recalculado pelo v1.

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
npm run db:backup         # backup do banco em backups/ (requer PostgreSQL)
npm run db:exemplo        # regenera db/smcq-exemplo.sql (requer PostgreSQL e internet)
node teste-irs-v2-mock.js # testes do IRS v2 com geodados simulados
```

Os testes nunca acessam a internet nem dependem do PostgreSQL:
- `tests/helpers/semInternet.js` bloqueia a rede, e as bases externas são simuladas por `tests/helpers/fetchFalso.js`;
- `tests/helpers/ambienteTeste.js` força a persistência em memória, mesmo que o `.env` aponte para o banco;
- o repositório PostgreSQL é testado com um driver simulado (`tests/postgresRepositorio.test.js` e `tests/postgresPool.test.js`). Esses testes conferem que o alerta remontado das tabelas é igual ao do repositório em memória e que as gravações usam transação (`COMMIT`, ou `ROLLBACK` em caso de falha);
- os testes da API importam o `app` sem abrir porta.

**Cobertura.** O escopo é o código da aplicação: `server.js`, `services/` e `repositorios/` (configurado em `jest.collectCoverageFrom`, no `package.json`). Ficam fora:
- os scripts de validação (`scripts/validacao/`): são ferramentas de linha de comando que dependem de rede, e só a biblioteca da amostra é testada (`tests/vazamento.test.js`);
- os scripts de banco (`db/`): foram verificados manualmente contra o PostgreSQL.

Resultado em 14/10/2026, com 153 testes:

| Escopo | Linhas | Instruções | Ramos | Funções |
| :--- | ---: | ---: | ---: | ---: |
| **Geral** (`server.js` + `services/` + `repositorios/`) | **95,2%** | 93,8% | 83,8% | 93,7% |
| `services/riscoService.js` | 97,9% | 98,1% | 89,5% | 100% |
| `services/classificacaoService.js` | 100% | 100% | 100% | 100% |
| `server.js` | 89,5% | 88,7% | 90,3% | 95,0% |
| `repositorios/postgres/alertaRepositorio.js` | 100% | 97,4% | 77,3% | 100% |
| `repositorios/memoria/alertaRepositorio.js` | 100% | 100% | 87,1% | 100% |
| `services/geodadosService.js` | 94,5% | 90,2% | 72,5% | 86,4% |
| `services/cacheService.js` | 64,7% | 60,0% | 44,4% | 60,0% |

O RNF14 exige no mínimo 70%. O único arquivo abaixo disso é o `cacheService.js`, cuja parte não testada é a limpeza de entradas vencidas acima de 500 itens. No `server.js`, ficam sem cobertura a recusa de iniciar com configuração inválida (`process.exit`) e o bloco que abre a porta.

## Limitações conhecidas

- **Proximidade urbana restrita a 10 cidades.** O fator urbano cai a quase zero além de cerca de 25 km; na validação, ficou abaixo de 0,05 em 98,6% dos focos reais. No IRS v1, isso fazia todo alerta distante dessas cidades e sem pessoas em risco ser `BAIXO`. No v2, os critérios ambientais compensam em parte. Melhoria prevista: usar as sedes municipais do IBGE.
- **Dependência de bases externas.** Sem resposta de uma base, o critério correspondente usa um valor de reserva (marcado em `geodados.fontes`), e o resultado fica menos preciso.
- **Validação do IRS v2.** Concordância leve com o gabarito de propagação do fogo, sem superar a linha de base sem pesos AHP. Detalhes e limitações em [`docs/validacao-irs.md`](docs/validacao-irs.md).
- **Porta fixa no código (3000).** Adequado para desenvolvimento e demonstração.
- **Anexos.** A tabela `arquivo_anexo` existe no banco, mas a API ainda não tem rota de envio de arquivos.
- **Backup local.** O `db:backup` grava no mesmo computador do banco; a cópia para outro disco ou para a nuvem é manual.

## Licença

Distribuído sob a licença MIT. Veja o arquivo [LICENSE](LICENSE).
