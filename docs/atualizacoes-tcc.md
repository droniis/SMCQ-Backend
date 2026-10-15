# Atualizações do documento do TCC para o IRS v2

Textos para colar no documento do TCC, refletindo a integração do IRS v2 (Etapas C a F), a persistência em banco de dados (Etapa G, Seção 5 deste arquivo) o tipo de ocorrência (Etapa H, Seção 6) e o alinhamento do sistema à documentação (Etapa I, Seção 7), outubro de 2026.

> **Atenção:** o documento do TCC não estava disponível durante a redação. Os textos foram escritos a partir do sistema implementado, sem comparação com a redação atual. As seções são indicadas pelos identificadores usados no projeto (RF05, RF07, UC03, UC07, HU10, RNF01, RNF14, Quadro 2, Capítulos 5 a 7). Antes de colar, confira a numeração e ajuste os termos ao glossário do documento.

---

## 1. RF05: classificação de risco (nova redação)

> **RF05 – Classificar o risco da ocorrência.** O sistema deve classificar automaticamente o risco de cada ocorrência registrada em quatro níveis (Baixo, Moderado, Alto e Crítico), por meio do Índice de Risco Sintético, versão 2 (IRS v2). O índice consiste na soma ponderada, com pesos obtidos pelo método AHP, de nove critérios normalizados entre 0 e 1:
>
> 1. área afetada;
> 2. proximidade urbana;
> 3. vento (intensidade e direção);
> 4. pessoas em risco;
> 5. taxa de propagação da área afetada;
> 6. bioma;
> 7. tipo de área atingida (terra indígena, unidade de conservação, APP, reserva legal, área rural ou urbana);
> 8. fauna ameaçada nas proximidades;
> 9. relevância ecológica (distância à unidade de conservação ou terra indígena mais próxima).
>
> Os critérios ambientais devem ser obtidos automaticamente de bases públicas a partir das coordenadas da ocorrência, permitindo ao operador corrigir o bioma e o tipo de área. Para cada ocorrência, o sistema deve registrar o índice, o nível, a contribuição de cada critério, a origem e a data de obtenção de cada dado e a versão do algoritmo utilizada.

---

## 2. UC07: passo 2 do fluxo principal (dados lidos para a classificação)

> **2.** O sistema lê os dados da ocorrência informados pelo operador: coordenadas, área afetada, intensidade e direção do vento, taxa de propagação, presença de pessoas em risco, tipo de ocorrência (queimada em vegetação ou incêndio em área urbana) e, quando corrigidos pelo operador, bioma e tipo de área. Para as coordenadas da ocorrência, o sistema obtém das bases públicas:
>
> - o bioma (IBGE);
> - a unidade de conservação que contém o ponto ou está próxima (ICMBio);
> - a terra indígena que contém o ponto ou está próxima (FUNAI);
> - as espécies animais ameaçadas registradas a até 50 km (GBIF);
> - os focos de calor registrados a até 50 km nos últimos sete dias (INPE).
>
> Os valores informados pelo operador prevalecem sobre os detectados.

Fluxo alternativo sugerido para o mesmo caso de uso:

> **FA – Base pública indisponível (no passo 2).** Se uma base pública não responder dentro do tempo limite, o sistema utiliza um valor de reserva para o critério correspondente, registra a fonte efetivamente utilizada e prossegue com a classificação. A indisponibilidade de bases externas não impede o registro da ocorrência.

---

## 3. Capítulo 5: endpoints e campos novos

### 3.1 Endpoints (acrescentar à tabela de rotas da API)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/alertas/geodados-preview?lat=&lng=` | Retorna os dados ambientais de um ponto (bioma, unidade de conservação, terra indígena, fauna ameaçada e focos de calor) sem registrar ocorrência. Responde 400 para coordenadas inválidas. |
| GET | `/api/alertas/:id/geodados` | Retorna os dados ambientais registrados na ocorrência; na ausência deles, consulta as bases em tempo real, sem registrar o resultado. |

Rotas existentes com comportamento alterado:

| Método | Rota | Alteração |
| :--- | :--- | :--- |
| POST | `/api/alertas` | Passa a classificar a ocorrência pelo IRS v2 e aceita os campos opcionais `bioma` e `tipoArea` (correções do operador). |
| GET | `/api/alertas/:id/risco` | Passa a retornar o cálculo registrado na criação da ocorrência, com os nove critérios e a versão do algoritmo, em vez de recalculá-lo a cada consulta. |

Todas as rotas continuam exigindo autenticação por token JWT.

### 3.2 Campos novos da ocorrência (acrescentar ao modelo de dados ou ao dicionário de dados)

| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `irs` | número (0 a 1) | Índice de Risco Sintético (mantém-se também `pontuacaoRisco`, com o mesmo valor) |
| `sigmoide` | número (0 a 1) | Valor da função sigmoide aplicada ao IRS, usado para definir o nível |
| `detalhes` | objeto | Para cada um dos nove critérios: valor de entrada, fator, peso, contribuição e origem do dado |
| `bioma` / `biomaOrigem` | texto | Bioma considerado no cálculo e sua origem ("detectado" ou "informado") |
| `tipoArea` / `tipoAreaOrigem` | texto | Tipo de área considerado e sua origem ("detectado" ou "informado") |
| `areaCriticaFauna` | texto | Nível de fauna ameaçada considerado (crítica, ameaçada, vulnerável, sem espécies, urbana) |
| `proximaUC` | booleano | Indica unidade de conservação ou terra indígena a menos de 10 km |
| `geodados` | objeto | Dados ambientais consultados, com a fonte (`fontes`) e a data de obtenção (`obtidoEm`) de cada um |
| `versaoAlgoritmo` | texto | Versão do algoritmo de classificação ("IRS v2"; ocorrências sem o campo são tratadas como "IRS v1") |

### 3.3 Componentes novos (diagrama de componentes ou de classes do backend)

- **`classificacaoService`:** integra a ocorrência ao IRS v2. Obtém os geodados, aplica as correções do operador e calcula o índice.
- **`geodadosService`:** consulta IBGE, ICMBio, FUNAI, GBIF e INPE com tempo limite, cache e valores de reserva. Carrega os focos de calor do INPE em segundo plano ao iniciar o servidor.
- **`cacheService`:** cache em memória com tempo de expiração.

Se houver diagrama de sequência do UC07, incluir as chamadas a `classificacaoService` e `geodadosService` entre o recebimento da ocorrência e o cálculo do índice.

---

## 4. Outros pontos do TCC que ficaram desatualizados

### 4.1 Seção do algoritmo de classificação (fundamentação ou desenvolvimento)

Se o texto descreve o IRS com cinco critérios e os pesos 0,42 / 0,26 / 0,16 / 0,09 / 0,07, ele descreve o **IRS v1**. Substituir pela descrição do v2, disponível em [`irs-v2.md`](irs-v2.md):
- justificativa da evolução;
- tabela de pesos v1 × v2;
- tabelas de pontuação dos critérios ambientais;
- fórmulas, sigmoide e limiares.

Inserir também a observação:

> No critério "tipo de área", a pontuação reflete a relevância ambiental da área atingida; o risco à população é capturado separadamente pelos critérios de proximidade urbana e pessoas em risco.

### 4.2 Quadro 2: tecnologias

Conferir se o quadro inclui:
- **Jest + Supertest:** testes unitários e de API, com as bases externas simuladas.
- **ESLint:** análise estática do código.
- **Bases públicas:** IBGE, ICMBio/INDE, FUNAI, GBIF e INPE no backend; OpenStreetMap, Nominatim, Photon e ViaCEP no frontend.

A relação completa das bases, com a forma de acesso e a condição de uso, está em [`bases-de-dados.md`](bases-de-dados.md).

### 4.3 HU10: visualizar os fatores do índice

A história passa a ser atendida pela tela "Detalhes do Alerta" (rota `/alertas/:id` do frontend). Texto sugerido para a seção de implementação ou de telas:

> A tela de detalhes da ocorrência apresenta:
> - o IRS e o nível de risco, na cor da classificação;
> - a contribuição de cada um dos nove critérios, em barras proporcionais ao peso de cada critério;
> - a versão do algoritmo;
> - as fontes dos dados ambientais, com a data de obtenção de cada uma.

Sugere-se incluir capturas da tela de detalhes e do formulário de registro com a caixa "Dados ambientais".

### 4.4 RNF01: desempenho (até 2 s em 95% das requisições)

Texto sugerido para a verificação do requisito:

> Para atender ao RNF01, os dados ambientais são consultados quando o operador escolhe o local da ocorrência no mapa e permanecem em cache por uma hora, de modo que o registro subsequente no mesmo ponto não depende de consultas externas. Os arquivos de focos de calor do INPE são carregados em segundo plano na inicialização do servidor e renovados a cada 45 minutos. Em medições realizadas em 14/10/2026:
> - o registro de uma ocorrência com os dados em cache levou cerca de 2 ms;
> - em um ponto ainda não consultado, levou entre 0,2 e 1,0 s.

### 4.5 RNF14: cobertura de testes (mínimo de 70%)

> A suíte de testes automatizados reúne 153 testes (Jest e Supertest), executados sem acesso à internet e sem depender do banco de dados. A cobertura de linhas do código da aplicação (servidor, serviços e camada de persistência) é de 95,2%. No serviço de classificação de risco (`riscoService`), é de 97,9%.

(Números atualizados na Etapa G; a versão anterior deste texto citava 105 testes e 94,9%.)

O escopo e os números por arquivo estão no README, seção "Testes e lint".

### 4.6 RNF18: reprodutibilidade

O resultado já está em [`validacao-irs.md`](validacao-irs.md), Seção 2.5: resultados idênticos em duas execuções. Conferir se o RNF18 é citado com esse resultado.

### 4.7 Capítulos 6 e 7: validação e considerações finais

- Os textos das Seções 6.1 e 6.3 e o parágrafo para o Capítulo 7 estão prontos em [`validacao-irs.md`](validacao-irs.md).
- Se o Capítulo 7 ou a seção de limitações disser que o sistema considera apenas o risco a populações urbanas, ou que um fator ambiental é trabalho futuro, atualizar: os critérios ambientais foram incorporados no IRS v2.
- Permanecem como trabalhos futuros os itens listados em `validacao-irs.md`, Seção 2.7.

### 4.8 Referências

Acrescentar, conforme o que for citado no texto final:
- Cohen (1960) e Cohen (1968);
- Landis e Koch (1977);
- Efron e Tibshirani (1993);
- Hyndman e Fan (1996);
- INPE/BDQueimadas e Open-Meteo, já em formato ABNT em `validacao-irs.md`;
- IBGE, ICMBio, FUNAI e GBIF, como fontes dos dados ambientais.

Para estas últimas, os links e as datas de acesso estão em [`bases-de-dados.md`](bases-de-dados.md).

---

## 5. Persistência em banco de dados (Etapa G, outubro de 2026)

Até a Etapa F, os dados ficavam em memória e se perdiam a cada reinício do servidor. Na Etapa G, eles passaram a ser gravados no PostgreSQL, conforme previsto na documentação. As rotas da API, os formatos de resposta e as regras de permissão não mudaram.

### 5.1 Quadro 2: tecnologias (acrescentar)

| Tecnologia | Versão | Finalidade no SMCQ |
| :--- | :--- | :--- |
| PostgreSQL | 18 | Sistema gerenciador de banco de dados relacional. Armazena usuários, ocorrências, classificações de risco, histórico, observações e solicitações de exclusão |
| node-postgres (`pg`) | 8 | Driver de acesso ao PostgreSQL a partir do Node.js, com consultas SQL parametrizadas, sem ORM |
| dotenv | 18 | Leitura das credenciais e configurações a partir de variáveis de ambiente (arquivo `.env`, fora do controle de versão) |
| pg_dump | 18 | Geração das cópias de segurança do banco (RNF07) |

Texto sugerido para acompanhar o quadro:

> O armazenamento utiliza o PostgreSQL 18 **sem a extensão espacial PostGIS**. As consultas geográficas do sistema se limitam a distâncias entre pontos, como a proximidade de cidades e de unidades de conservação, calculadas na aplicação pela fórmula de Haversine, conforme admitido pelo RNF17. Latitude e longitude são gravadas em colunas numéricas de precisão dupla, com índice, o que permite filtrar por região com consultas comuns. A adoção do PostGIS fica como evolução possível, caso o sistema passe a exigir operações espaciais mais complexas, como a interseção de polígonos.

### 5.2 Seção 5.1: arquitetura do backend (camada de persistência)

Texto sugerido:

> O backend foi organizado em três camadas:
> - **rotas** (`server.js`): autenticação, validação das entradas e regras de permissão;
> - **serviços** (`services/`): classificação de risco e consulta aos dados ambientais;
> - **persistência** (`repositorios/`): acesso aos dados.
>
> A camada de persistência segue o padrão **Repositório** e oferece duas implementações com a mesma interface:
> - a do **PostgreSQL**, usada na execução real;
> - uma **em memória**, usada nos testes automatizados e em demonstrações sem banco.
>
> A implementação é escolhida pela variável de ambiente `PERSISTENCIA`. Assim, as rotas não dependem do mecanismo de armazenamento, e a suíte de testes roda sem um servidor de banco instalado.
>
> O repositório PostgreSQL decompõe cada ocorrência nas tabelas do modelo de dados e a remonta no mesmo formato JSON devolvido pela API. As operações que envolvem mais de uma tabela são executadas em uma única **transação**: ou tudo é gravado, ou nada é. São elas:
> - o registro da ocorrência, que grava alerta, localização, fatores de risco, classificação, contribuições dos critérios e o primeiro registro do histórico;
> - a mudança de status, com o registro no histórico;
> - a edição da ocorrência, com a nova classificação, as contribuições e o histórico;
> - a exclusão lógica;
> - a avaliação de uma solicitação de exclusão;
> - as alterações de usuários, com o registro na auditoria.
>
> Se o banco de dados estiver indisponível, o servidor permanece em execução, registra a causa no log e responde às requisições com o código HTTP 503. O acesso é restabelecido automaticamente quando o banco volta a operar.

### 5.3 Modelo de dados (diagrama de classes ou modelo físico)

Tabelas criadas a partir do diagrama de classes (script completo em `db/schema.sql`):

| Tabela | Conteúdo | Relação |
| :--- | :--- | :--- |
| `usuario` | Nome, e-mail, hash da senha (bcrypt), perfil, situação (ativo), indicação de senha provisória e datas | — |
| `alerta` | Título, descrição, tipo de ocorrência, status, autor, datas e exclusão lógica | N:1 com `usuario` |
| `localizacao` | Latitude, longitude e endereço | 1:1 com `alerta` |
| `fator_risco` | Dados de entrada do cálculo: área, vento, pessoas em risco, bioma, tipo de área, fauna, proximidade de UC e geodados (JSONB) | 1:1 com `alerta` |
| `classificacao_risco` | Resultado: IRS, sigmoide, nível e versão do algoritmo | 1:1 com `alerta` |
| `contribuicao_criterio` | Fator, peso e contribuição de cada critério | 1:N com `classificacao_risco` (9 no IRS v2) |
| `historico_status` | Campo alterado (status, campo editado ou nível de risco), valores anterior e novo, autor e data | 1:N com `alerta` |
| `observacao` | Texto, autor e data | 1:N com `alerta` |
| `arquivo_anexo` | Nome, caminho, tipo e tamanho do arquivo | 1:N com `alerta` (estrutura prevista, ainda sem rota na API) |
| `solicitacao_exclusao` | Motivo, situação, decisão e autores | 1:N com `alerta` |
| `auditoria_usuario` | Ação sobre o usuário, valores anterior e novo, autor e data | N:1 com `usuario` (o que sofreu a ação e o autor) |

Se o diagrama de classes do documento não separar "dados de entrada" (`fator_risco`) de "resultado" (`classificacao_risco`, `contribuicao_criterio`), ajustá-lo conforme a tabela acima.

### 5.4 Requisitos não funcionais atendidos ou reforçados

- **RNF03 (senhas protegidas):** o banco guarda apenas o hash bcrypt das senhas. As credenciais do banco e o segredo dos tokens JWT ficam em variáveis de ambiente, fora do código e do controle de versão; sem o segredo, o servidor não inicia.
- **RNF04 (auditoria):** cada ocorrência nasce com um registro de histórico, "Novo", com o autor e a data. Mudanças de status, edições e exclusões também geram registros, e as ações sobre usuários ficam em `auditoria_usuario` (Seção 7.9). A exclusão é lógica: a ocorrência permanece no banco para consulta.
- **RNF07 (backup):** o comando `npm run db:backup` gera uma cópia datada do banco com o `pg_dump` e mantém as 30 mais recentes. O agendamento diário é feito pelo Agendador de Tarefas do Windows (instruções no README).
- **RNF17 (cálculo geográfico):** distâncias pela fórmula de Haversine, sem PostGIS.
- **RNF20 (filtros):** índices por data de registro, status, nível de risco e região (estado e município).

### 5.5 Entrega da base de dados

O arquivo `db/smcq-exemplo.sql` atende ao item "base de dados" da entrega. Ele contém o esquema completo e dados de demonstração:
- 5 usuários: os 3 de demonstração e 2 operadores cadastrados pelo gestor, um que trocou a senha provisória e um desativado, com a auditoria dessas ações;
- 7 ocorrências classificadas pelo IRS v2 com dados ambientais reais: 6 queimadas em vegetação, uma por bioma, e 1 incêndio em área urbana;
- histórico de status (inclusive uma ocorrência resolvida) e de edição (com recálculo do risco), observações e solicitações de exclusão pendente, rejeitada e aprovada.

Não contém senhas reais, apenas os hashes das senhas de demonstração. Pode ser carregado com `psql` ou pelo pgAdmin. Sugestão de texto para o apêndice ou para a seção de entrega:

> A base de dados acompanha o código-fonte no arquivo `db/smcq-exemplo.sql`, que cria as onze tabelas do modelo e insere dados de demonstração. Para carregá-la, basta criar um banco vazio no PostgreSQL e executar o arquivo (`psql -U postgres -d smcq -f db/smcq-exemplo.sql`).

---

## 6. Tipo de ocorrência (Etapa H, outubro de 2026)

O formulário de registro priorizava o endereço urbano (CEP, rua, número e bairro antes do mapa), o que dificultava o registro de queimadas em vegetação, que não têm rua nem número. Além disso, a marcação "Zona urbana" podia contradizer o tipo de área detectado. A Etapa H substituiu essa marcação pelo **tipo de ocorrência**, primeiro campo do formulário, que adapta a tela e define valores padrão. **A fórmula, os pesos, as tabelas de pontuação e os limiares do IRS v2 não mudaram.**

### 6.1 RF07: registrar ocorrência (nova redação)

> **RF07 – Registrar ocorrência.** O sistema deve permitir ao operador registrar uma ocorrência de fogo, informando primeiro o **tipo de ocorrência**: *queimada em vegetação* ou *incêndio em área urbana*. O formulário deve se adaptar ao tipo:
> - **Queimada em vegetação:** a localização é definida pelo ponto, marcado no mapa, obtido pela localização do dispositivo (GPS) ou digitado em latitude e longitude. O município e a UF são preenchidos automaticamente a partir do ponto, e o endereço é opcional.
> - **Incêndio em área urbana:** são obrigatórios o logradouro (ou um ponto de referência), o bairro, o município e a UF; o CEP e o número são opcionais. O mapa posiciona o ponto a partir do endereço.
>
> O operador também informa o título, a descrição, a área afetada, a intensidade do vento e a presença de pessoas em risco. O tipo de ocorrência define valores padrão, que o operador pode alterar: para incêndio em área urbana, o tipo de área "urbana" e a marcação de pessoas em risco. Uma terra indígena ou unidade de conservação detectada no ponto prevalece sobre o tipo de área padrão.

Se o RF07 do documento tiver outra numeração ou outro escopo, aplicar a redação ao requisito de registro de ocorrência.

### 6.2 UC03: registrar ocorrência

**Novo passo**, no início do fluxo principal (renumerar os seguintes):

> **1.** O operador seleciona o tipo de ocorrência: queimada em vegetação ou incêndio em área urbana. O sistema adapta o formulário ao tipo escolhido e aplica os valores padrão correspondentes.

**Passo de localização** (substitui o passo em que o operador informa o endereço):

> **N.** O operador define o local da ocorrência. Em incêndio em área urbana, informa o endereço (logradouro ou ponto de referência, bairro, município e UF; CEP e número são opcionais), e o sistema posiciona o ponto no mapa. Em queimada em vegetação, marca o ponto no mapa. O sistema consulta os dados ambientais do ponto e os exibe.

**Novo fluxo alternativo:**

> **FA – Local sem endereço (no passo de localização).** Se a ocorrência for uma queimada em vegetação sem logradouro, o operador define o local por um dos meios:
> 1. clica no mapa;
> 2. usa a localização do dispositivo ("Usar minha localização");
> 3. digita a latitude e a longitude, por exemplo as obtidas pelo GPS de uma brigada.
>
> O sistema valida as coordenadas (latitude entre −90 e 90 e longitude entre −180 e 180) e avisa se o ponto parece estar fora do Brasil. Em seguida, posiciona o ponto e preenche automaticamente o município e a UF por geocodificação reversa. O operador pode corrigi-los e, opcionalmente, acrescentar um endereço. Se a permissão de localização for negada, o sistema informa o motivo e mantém disponíveis as outras duas formas. O caso de uso prossegue no passo seguinte.

**Exceção sugerida:**

> **FE – Endereço incompleto em incêndio urbano.** Se faltar logradouro (ou ponto de referência), bairro, município ou UF, o sistema não registra a ocorrência e indica os campos que faltam.

### 6.3 Diagrama de classes

Acrescentar a enumeração **`TipoOcorrencia`** e o atributo **`tipoOcorrencia`** na classe **`Alerta`**:

```
«enumeration»
TipoOcorrencia
--------------------
QUEIMADA_VEGETACAO
INCENDIO_URBANO

Alerta
--------------------
...
- tipoOcorrencia : TipoOcorrencia
...
```

A associação é de `Alerta` para `TipoOcorrencia` (cada alerta tem exatamente um tipo). Na classe de dados de entrada do cálculo (`FatorRisco`, se existir no diagrama), o atributo `zonaUrbana : boolean` pode ser mantido com a observação "derivado do tipo de ocorrência".

Versão em Mermaid, caso o diagrama seja mantido nesse formato:

```mermaid
classDiagram
  class TipoOcorrencia {
    <<enumeration>>
    QUEIMADA_VEGETACAO
    INCENDIO_URBANO
  }
  class Alerta {
    -titulo: String
    -descricao: String
    -tipoOcorrencia: TipoOcorrencia
    -status: StatusAlerta
  }
  Alerta --> "1" TipoOcorrencia
```

### 6.4 Modelo de dados

Nova coluna na tabela `alerta` (a linha da tabela `alerta` na Seção 5.3 já foi atualizada):

| Coluna | Tipo | Restrições | Descrição |
| :--- | :--- | :--- | :--- |
| `tipo_ocorrencia` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'QUEIMADA_VEGETACAO'`, `CHECK (tipo_ocorrencia IN ('QUEIMADA_VEGETACAO', 'INCENDIO_URBANO'))`, índice | Tipo da ocorrência |

Texto sugerido:

> A coluna foi acrescentada por uma migração idempotente (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) no próprio script do esquema. Assim, um banco existente é atualizado com o mesmo comando de criação, sem perda de dados. As ocorrências registradas antes da mudança receberam o tipo "queimada em vegetação". A coluna `fator_risco.zona_urbana` foi mantida e passou a registrar a zona urbana efetivamente usada no cálculo, derivada do tipo de ocorrência.

Para o dicionário de dados da API (Seção 3.2), acrescentar:

| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `tipoOcorrencia` | texto | `QUEIMADA_VEGETACAO` ou `INCENDIO_URBANO` |

### 6.5 API (Capítulo 5)

| Método | Rota | Alteração |
| :--- | :--- | :--- |
| POST | `/api/alertas` | Aceita `tipoOcorrencia`. Em `INCENDIO_URBANO`, exige logradouro (ou ponto de referência), bairro, município e UF válida e, se informado, CEP de 8 dígitos; responde 400 com os campos que faltam. |
| GET | `/api/alertas` | Devolve `tipoOcorrencia` em cada ocorrência e aceita o filtro opcional `?tipoOcorrencia=`. |

Texto sugerido sobre a compatibilidade:

> Para não afetar clientes da versão anterior, a API continua aceitando o campo `zonaUrbana`. Quando a requisição traz `tipoOcorrencia`, ele prevalece e o campo antigo é ignorado. Quando traz apenas `zonaUrbana`, a ocorrência é registrada como queimada em vegetação e o cálculo usa o valor recebido, como antes. Testes automatizados comprovam que, com as mesmas entradas, o índice é idêntico ao calculado antes da mudança.

### 6.6 Painel de controle (Dashboard)

Novo gráfico **"Ocorrências por tipo"** e novo filtro global **"Tipo de ocorrência"**. Texto sugerido:

> O painel de controle apresenta o gráfico "Ocorrências por tipo", com a quantidade de queimadas em vegetação e de incêndios em área urbana no período selecionado. O gráfico pode ser exibido em pizza, barras ou tabela e respeita os filtros globais, entre eles o novo filtro por tipo de ocorrência, que também vale para a lista de alertas e para o mapa. A contagem por tipo também integra o relatório consolidado exportado em CSV.

Na lista de alertas e nos detalhes da ocorrência, o tipo aparece como um rótulo com ícone (árvore para vegetação e edifício para área urbana). A exportação CSV da lista ganhou a coluna "Tipo de ocorrência".

---

## 7. Alinhamento do sistema à documentação (Etapa I, outubro de 2026)

A documentação descrevia funções que o protótipo ainda não tinha. A Etapa I as implementou:
- transições de status controladas;
- observações e histórico na tela de detalhes;
- tela de solicitações de exclusão;
- edição da ocorrência;
- gestão de usuários;
- "Meu perfil", com troca de senha.

**A fórmula, os pesos, as tabelas de pontuação e os limiares do IRS v2 não mudaram.** As permissões são verificadas no backend; o frontend apenas esconde as ações não permitidas.

> **Numeração dos requisitos.** Os textos abaixo seguem a numeração do documento do TCC, conforme a tabela a seguir.

| Identificador | Assunto no TCC |
| :--- | :--- |
| RF04 | Gerenciar usuários |
| RF08 | Excluir alertas (gestor e administrador excluem diretamente; operador solicita a exclusão, avaliada por gestor ou administrador) |
| RF10 | Armazenar o histórico de todas as alterações e dos cálculos de cada ocorrência |
| RF11 | Atualizar os dados de uma ocorrência |
| RF13 | Adicionar observações complementares |
| RF14 | Alterar o status da ocorrência |

### 7.1 Seção 2.1.1: descrição dos atores

> **Operador.** Profissional de campo ou de central (brigadista, bombeiro, agente da Defesa Civil) que registra ocorrências, edita os dados delas, atualiza o status, registra observações e acompanha o histórico. Não exclui ocorrências diretamente: solicita a exclusão, com justificativa, e acompanha a situação das próprias solicitações.
>
> **Administrador.** Responsável pela operação do sistema. Além das funções do operador, exclui ocorrências e aprova ou rejeita solicitações de exclusão. Na gestão de usuários, consulta a lista e a auditoria e edita, desativa e reativa apenas usuários com perfil Operador, sem alterar o perfil deles.
>
> **Gestor.** Responsável pela equipe e pela coordenação das ações. Além das funções do operador, exclui ocorrências e avalia solicitações de exclusão. É o único ator que **cadastra usuários**, de qualquer perfil, e que altera o perfil de um usuário. Edita, desativa e reativa qualquer usuário, exceto desativar a si mesmo. O sistema exige que haja sempre ao menos um gestor ativo.
>
> Todos os atores editam os próprios dados (nome e e-mail) e alteram a própria senha. O perfil de acesso é definido pelo gestor e não pode ser alterado pelo próprio usuário.

**Generalização no diagrama de casos de uso.** Sugere-se modelar **Operador** como ator base, com **Administrador** e **Gestor** como especializações: ambos herdam os casos de uso do operador e acrescentam "Excluir ocorrência" e "Avaliar solicitação de exclusão". O caso de uso **UC08 – Gerenciar usuários** fica associado ao **Gestor** como ator principal e ao **Administrador** como ator secundário, com acesso restrito a operadores (ver 7.4). Os casos de uso **UC01 – Fazer login** e **UC04 – Editar perfil** ficam associados ao ator base, valendo para todos.

```mermaid
flowchart LR
  OP([Operador])
  AD([Administrador])
  GE([Gestor])
  AD -- generaliza --> OP
  GE -- generaliza --> OP
  OP --- UC01[UC01 Fazer login]
  OP --- UC03[UC03 Criar novo alerta]
  OP --- UC04[UC04 Editar perfil e senha]
  OP --- UC05[UC05 Atualizar status]
  OP --- UCED[Editar ocorrência]
  OP --- UCSE[Solicitar exclusão]
  AD --- UCEX[Excluir ocorrência / avaliar solicitação]
  GE --- UCEX
  GE --- UC08[UC08 Gerenciar usuários]
  AD -. só operadores .- UC08
```

### 7.2 Requisitos funcionais (nova redação)

> **RF04 – Gerenciar usuários.** O sistema deve permitir ao gestor cadastrar usuários, informando nome, e-mail (único), perfil de acesso (Operador, Administrador ou Gestor) e uma senha provisória, que o usuário deve trocar no primeiro acesso. O sistema deve permitir editar o nome, o e-mail, o perfil e redefinir a senha (de novo provisória), além de desativar e reativar usuários, conforme a matriz de permissões da Seção 7.4. Os usuários não são excluídos fisicamente: o usuário desativado não acessa o sistema, inclusive nas sessões já abertas, e continua identificado nos registros históricos. O sistema deve impedir que fique sem nenhum gestor ativo e registrar em auditoria cada ação sobre um usuário (cadastro, edição, desativação, reativação e troca ou redefinição de senha), com o autor, a data e os valores anterior e novo, sem registrar a senha.

> **RF08 – Excluir ocorrência com aprovação.** O sistema deve permitir ao administrador e ao gestor excluir uma ocorrência. O operador não exclui: solicita a exclusão, informando o motivo, e só pode haver uma solicitação pendente por ocorrência. O administrador e o gestor consultam as solicitações em uma tela própria, com a quantidade de pendentes no menu e filtro por situação, e as aprovam ou rejeitam. A rejeição exige uma resposta ao solicitante. A aprovação exclui a ocorrência. O operador acompanha a situação das próprias solicitações na tela "Minhas solicitações" e nos detalhes da ocorrência. A exclusão é lógica: a ocorrência deixa de aparecer nas listagens, mas permanece no banco de dados para auditoria.

> **RF10 – Consultar o histórico da ocorrência.** O sistema deve exibir, na tela de detalhes da ocorrência, uma linha do tempo com todas as alterações: o registro da criação, as mudanças de status, os campos editados (com os valores anterior e novo), as mudanças do nível de risco e a exclusão, cada uma com o nome do autor e a data.

> **RF11 – Editar ocorrência.** O sistema deve permitir a qualquer usuário autenticado editar o título, a descrição, a área afetada, a intensidade do vento, a presença de pessoas em risco, o bioma e o tipo de área de uma ocorrência que não esteja resolvida nem excluída. A localização e o tipo de ocorrência não podem ser alterados. Se a edição mudar algum dado usado no cálculo, o sistema deve recalcular o risco com os dados ambientais já registrados na ocorrência, sem nova consulta às bases públicas, e informar ao usuário, antes de salvar, se o nível de risco vai mudar. Cada campo alterado, e o nível de risco quando mudar, deve ser registrado no histórico com os valores anterior e novo, o autor e a data.

> **RF13 – Registrar observações.** O sistema deve permitir a qualquer usuário autenticado registrar observações textuais em uma ocorrência (obrigatórias, com até 2.000 caracteres), exibidas na tela de detalhes em ordem cronológica, com o nome do autor e a data. As observações não podem ser editadas nem removidas.

> **RF14 – Atualizar o status da ocorrência.** O sistema deve permitir a qualquer usuário autenticado alterar o status de uma ocorrência somente pelas transições permitidas: de *Novo* para *Em análise*; de *Em análise* para *Em atendimento* ou de volta para *Novo*; de *Em atendimento* para *Resolvido* ou de volta para *Em análise*. *Resolvido* é o estado final. Qualquer outra mudança, inclusive para o mesmo status, deve ser recusada sem alterar a ocorrência. Cada mudança deve ser registrada no histórico com o status anterior, o novo, o autor e a data.

### 7.3 Casos de uso

**UC04 – Editar perfil e alterar senha**

> **Ator principal:** Operador, Administrador ou Gestor (qualquer usuário autenticado).
> **Pré-condição:** o usuário está autenticado.
>
> **Fluxo principal**
> 1. O usuário abre o menu do cabeçalho e seleciona "Meu perfil".
> 2. O sistema exibe o nome, o e-mail e o perfil de acesso; o perfil aparece apenas para leitura.
> 3. O usuário altera o nome ou o e-mail e salva. O sistema valida os dados, verifica se o e-mail não pertence a outro usuário, grava a alteração e a registra na auditoria.
> 4. Para alterar a senha, o usuário informa a senha atual, a nova senha (no mínimo 8 caracteres) e a confirmação.
> 5. O sistema confere a senha atual e verifica se a nova é diferente da atual.
> 6. O sistema grava a nova senha (somente o hash), registra a troca na auditoria, sem a senha, e informa o sucesso.
>
> **FA01 – Troca obrigatória no primeiro acesso.** Se o usuário entrar com uma senha provisória (definida pelo gestor no cadastro ou numa redefinição), o sistema o leva diretamente à tela "Defina a sua senha" e só libera as demais funções depois da troca (passos 4 a 6). O mesmo ocorre, numa sessão já aberta, se o gestor redefinir a senha do usuário.
>
> **FE01 – Senha atual incorreta (passo 5).** O sistema informa "Senha atual incorreta", não altera a senha e mantém a sessão.
> **FE02 – E-mail já cadastrado (passo 3).** O sistema informa que o e-mail pertence a outro usuário e não grava a alteração.

**UC05 – Atualizar status da ocorrência: FA01, transições permitidas**

> **FA01 – Transições permitidas.** O sistema oferece apenas os status de destino válidos para o status atual:
>
> | Status atual | Pode passar para |
> | :--- | :--- |
> | Novo | Em análise |
> | Em análise | Em atendimento ou Novo |
> | Em atendimento | Resolvido ou Em análise |
> | Resolvido | nenhum (estado final; a ocorrência também não pode mais ser editada) |
>
> Se for solicitada uma transição fora da tabela, inclusive para o mesmo status, o sistema recusa a operação, informa "Transição de status não permitida" e não altera a ocorrência.

**UC08 – Gerenciar usuários**

> **Ator principal:** Gestor. **Ator secundário:** Administrador (apenas sobre usuários com perfil Operador).
> **Pré-condição:** o ator está autenticado.
>
> **Fluxo principal (cadastrar usuário)**
> 1. O gestor acessa "Usuários". O sistema lista os usuários com nome, e-mail, perfil e situação, com filtros por perfil e por situação.
> 2. O gestor seleciona "Novo usuário" e informa nome, e-mail, perfil e senha provisória.
> 3. O sistema valida os campos e verifica se o e-mail é único.
> 4. O sistema grava o usuário com a senha provisória (somente o hash), marcando a troca obrigatória no primeiro acesso, e registra o cadastro na auditoria.
>
> **FA01 – Editar usuário.** O ator seleciona um usuário e altera o nome, o e-mail, o perfil ou redefine a senha, conforme a matriz de permissões da Seção 7.4. A senha redefinida passa a ser provisória. O sistema registra na auditoria cada campo alterado, com os valores anterior e novo, sem registrar a senha.
>
> **FA02 – Desativar ou reativar usuário.** O ator seleciona um usuário e o desativa ou reativa, conforme a matriz de permissões. O usuário desativado não consegue entrar no sistema, e as sessões abertas dele deixam de valer imediatamente. Os registros feitos por ele continuam identificados com o seu nome. A ação é registrada na auditoria.
>
> **FA03 – Consultar auditoria.** O ator seleciona um usuário e visualiza as ações realizadas sobre ele: o quê, por quem e quando.
>
> **FE01 – E-mail já cadastrado.** O sistema informa o conflito e não grava.
> **FE02 – Ação não permitida.** Se o perfil do ator não permite a ação sobre o usuário escolhido (por exemplo, um administrador tentando editar um gestor), o sistema recusa a operação. As ações não permitidas também não aparecem na tela.
> **FE03 – Último gestor ativo.** Se a desativação, ou a mudança de perfil, deixaria o sistema sem nenhum gestor ativo, o sistema recusa a operação e informa o motivo.
> **FE04 – Desativar a si mesmo.** O sistema não permite que o gestor desative a própria conta.

### 7.4 Matriz de permissões da gestão de usuários

| Ação | Gestor | Administrador | Operador |
| :--- | :--- | :--- | :--- |
| Listar usuários e consultar a auditoria | Sim | Sim | Não |
| Cadastrar usuário | Sim, de qualquer perfil | Não | Não |
| Editar nome e e-mail, redefinir senha | Qualquer usuário (a própria senha, só em "Meu perfil") | Somente operadores | Não |
| Alterar o perfil | De outros usuários (não o próprio) | Não | Não |
| Desativar e reativar | Qualquer usuário, exceto a si mesmo | Somente operadores | Não |
| Editar o próprio nome e e-mail e alterar a própria senha | Sim | Sim | Sim |

Regra geral: o sistema deve manter sempre ao menos um gestor ativo.

### 7.5 Histórias de usuário

> **HU02 – Gerenciar usuários.** *Como gestor, quero cadastrar, editar, desativar e reativar os usuários do sistema, definindo o perfil de acesso de cada um, para que apenas pessoas autorizadas, com as permissões adequadas à sua função, operem o sistema.*
>
> **Critérios de aceitação:**
> - o cadastro exige nome, e-mail único, perfil e senha provisória, e o novo usuário é obrigado a trocar a senha no primeiro acesso;
> - o administrador edita, desativa e reativa apenas operadores; o operador não gerencia usuários;
> - o usuário desativado não consegue entrar, e os registros feitos por ele são mantidos;
> - o sistema não permite ficar sem um gestor ativo;
> - toda ação sobre um usuário fica registrada na auditoria, com o autor e a data.

> **HU04 – Editar ocorrência.** *Como operador, quero corrigir os dados de uma ocorrência que registrei errado ou que mudaram no local (título, descrição, área afetada, vento, pessoas em risco, bioma e tipo de área), para que a classificação de risco reflita a situação real.*
>
> **Critérios de aceitação:**
> - a edição está disponível para operadores, administradores e gestores, exceto em ocorrências resolvidas ou excluídas;
> - a localização e o tipo de ocorrência não podem ser alterados;
> - se um dado do cálculo mudar, o risco é recalculado com os dados ambientais já registrados, e o usuário é avisado, antes de salvar, se o nível vai mudar;
> - cada campo alterado aparece no histórico da ocorrência com os valores anterior e novo, o autor e a data.

### 7.6 Diagrama de classes

Acrescentar à classe **`Usuario`** os atributos **`ativo`** e **`senhaProvisoria`**, além da data de atualização, e a nova classe **`AuditoriaUsuario`**:

```
Usuario
--------------------
- id : int
- nome : String
- email : String
- senhaHash : String
- perfil : Perfil
- ativo : boolean
- senhaProvisoria : boolean
- criadoEm : DateTime
- atualizadoEm : DateTime

AuditoriaUsuario
--------------------
- id : int
- acao : AcaoAuditoria
- alteracoes : Map<String, {anterior, novo}>
- realizadoEm : DateTime

«enumeration»
AcaoAuditoria
--------------------
CRIADO
EDITADO
DESATIVADO
REATIVADO
SENHA_REDEFINIDA
SENHA_ALTERADA
```

`AuditoriaUsuario` tem duas associações com `Usuario`: o usuário que sofreu a ação (`usuario`, 1) e o usuário que a realizou (`realizadoPor`, 1). Um usuário pode ter várias auditorias (1:N).

```mermaid
classDiagram
  class Usuario {
    -nome: String
    -email: String
    -senhaHash: String
    -perfil: Perfil
    -ativo: boolean
    -senhaProvisoria: boolean
    -criadoEm: DateTime
    -atualizadoEm: DateTime
  }
  class AuditoriaUsuario {
    -acao: AcaoAuditoria
    -alteracoes: Map
    -realizadoEm: DateTime
  }
  class AcaoAuditoria {
    <<enumeration>>
    CRIADO
    EDITADO
    DESATIVADO
    REATIVADO
    SENHA_REDEFINIDA
    SENHA_ALTERADA
  }
  Usuario "1" --> "*" AuditoriaUsuario : sofre
  AuditoriaUsuario --> "1" Usuario : realizadoPor
  AuditoriaUsuario --> "1" AcaoAuditoria
```

Na classe **`HistoricoStatus`** (ou equivalente), o atributo `campo` passa a registrar, além do status, os campos editados da ocorrência e o nível de risco. Se o nome da classe sugerir apenas status, pode-se renomeá-la para `HistoricoAlteracao`.

### 7.7 Modelo de dados

Atualizações já aplicadas nas Seções 5.3 e 5.5: o banco passou de **dez para onze tabelas**.

Novas colunas na tabela `usuario`:

| Coluna | Tipo | Restrições | Descrição |
| :--- | :--- | :--- | :--- |
| `senha_provisoria` | `BOOLEAN` | `NOT NULL`, `DEFAULT FALSE` | Troca de senha obrigatória no próximo acesso |
| `atualizado_em` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Data da última alteração |

A coluna `ativo` já existia no esquema e passou a ser usada.

Nova tabela `auditoria_usuario`:

| Coluna | Tipo | Restrições | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | chave primária | |
| `usuario_id` | `INTEGER` | `NOT NULL`, FK `usuario` | Usuário que sofreu a ação |
| `acao` | `VARCHAR(20)` | `NOT NULL`, `CHECK` com as seis ações | Tipo da ação |
| `alteracoes` | `JSONB` | `NOT NULL`, `DEFAULT '{}'` | `{ campo: { anterior, novo } }`; nunca contém senha |
| `realizado_por` | `INTEGER` | `NOT NULL`, FK `usuario` | Autor da ação |
| `realizado_em` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Data da ação |

Texto sugerido:

> As alterações foram feitas por migração idempotente no próprio script do esquema (`ADD COLUMN IF NOT EXISTS` e `CREATE TABLE IF NOT EXISTS`). Um banco existente é atualizado com o mesmo comando de criação, sem perda de dados, e os usuários já cadastrados permanecem ativos e com senha definitiva. Cada alteração de usuário grava o usuário e a auditoria na mesma transação. A edição de uma ocorrência grava os dados, a nova classificação de risco, as contribuições dos critérios e o histórico também em uma única transação.

### 7.8 API (Capítulo 5)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/alertas/:id` | Uma ocorrência, com os nomes dos autores do histórico, das observações e das solicitações. |
| PATCH | `/api/alertas/:id` | Edita a ocorrência (RF11). Responde 422 para ocorrência resolvida ou campo não editável. |
| POST | `/api/alertas/:id/risco/simulacao` | Calcula o nível de risco que resultaria da edição, sem gravar nada. |
| GET | `/api/perfil` | Dados do próprio usuário. |
| PATCH | `/api/perfil` | Edita o próprio nome e e-mail. |
| PATCH | `/api/perfil/senha` | Altera a própria senha, informando a atual. |
| GET | `/api/usuarios` | Lista os usuários, com filtros por perfil e situação. |
| GET | `/api/usuarios/:id` | Um usuário. |
| GET | `/api/usuarios/:id/auditoria` | Auditoria das ações sobre o usuário. |
| POST | `/api/usuarios` | Cadastra um usuário com senha provisória. |
| PATCH | `/api/usuarios/:id` | Edita nome, e-mail, perfil ou redefine a senha. |
| PATCH | `/api/usuarios/:id/ativo` | Desativa ou reativa um usuário. |

Rotas existentes com comportamento alterado:

| Método | Rota | Alteração |
| :--- | :--- | :--- |
| POST | `/api/login` | Recusa usuário desativado (401) e informa se a senha é provisória. |
| PATCH | `/api/alertas/:id/status` | Aceita somente as transições do UC05 FA01; as demais respondem 422. |
| POST | `/api/alertas/:id/observacoes` | Texto obrigatório, com até 2.000 caracteres. |
| GET | `/api/solicitacoes-exclusao` | Valida o filtro de situação (400 para valor desconhecido). |

Texto sugerido sobre os códigos de resposta:

> A API distingue as falhas pelo código HTTP:
> - **400:** dados inválidos;
> - **401:** usuário não autenticado, sessão expirada ou usuário desativado;
> - **403:** usuário autenticado sem permissão para a ação;
> - **404:** recurso inexistente ou ocorrência excluída;
> - **409:** conflito, como e-mail já cadastrado ou solicitação de exclusão já pendente;
> - **422:** regra de negócio violada, como uma transição de status não permitida, a edição de ocorrência resolvida ou a desativação do último gestor ativo.
>
> As permissões são verificadas no servidor a cada requisição, com os dados atuais do usuário no banco. Assim, desativar um usuário ou redefinir a senha dele produz efeito imediato, mesmo sobre sessões já abertas.

### 7.9 Requisitos não funcionais reforçados

- **RNF03 (senhas protegidas):** senha mínima de 8 caracteres. Senhas definidas por outra pessoa são provisórias e devem ser trocadas no primeiro acesso. A troca da própria senha exige a senha atual. A auditoria nunca registra senhas.
- **RNF04 (auditoria):** além do status e da exclusão, o histórico da ocorrência passa a registrar cada campo editado e as mudanças do nível de risco. As ações sobre usuários ficam na tabela `auditoria_usuario`. Todo registro guarda o autor e a data.

### 7.10 Funcionalidades que continuam previstas para versões futuras

Sugere-se manter estes itens no documento com a indicação "previsto para versão futura" ou movê-los para a seção de trabalhos futuros:

| Item do documento | Situação |
| :--- | :--- |
| **RF12 / UC06 – Anexar arquivos à ocorrência** | A tabela `arquivo_anexo` existe no banco de dados, mas a API não tem rota de envio de arquivos. |
| **UC01 FA01 – Recuperar senha por e-mail** | Não implementado: o sistema não envia e-mails. A tela de login orienta o usuário a procurar o administrador do sistema. A senha é redefinida pelo gestor (ou, para operadores, também pelo administrador) como provisória, e o usuário a troca no acesso seguinte. |
| **RF19 / UC10 – Notificações** | Não implementado. As novas ocorrências aparecem na lista e no painel, e as solicitações de exclusão pendentes, no contador do menu, sem envio de notificações. |
| **RF22 – Configurar os pesos do AHP** | Não implementado: os pesos do IRS v2 são fixos no código (`services/riscoService.js`), com a justificativa em `docs/irs-v2.md`, e alterá-los exige nova versão do algoritmo. |
