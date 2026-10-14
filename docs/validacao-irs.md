# Validação do Índice de Risco Sintético (IRS)

Textos prontos para as Seções 6.1 e 6.3 e para o Capítulo 7 do TCC. Todos os números vêm de arquivos gerados pelos scripts de `scripts/validacao/`, executados em 14/10/2026:

- `data/validacao/amostra-meta.json`: composição da amostra e regras do gabarito;
- `data/validacao/resultados.json`: métricas, intervalos de confiança, sensibilidade e cenários;
- `data/validacao/bruto/fontes.json`: URL, data e hash SHA-256 de cada arquivo do INPE.

Versão validada: `calcularRiscoAvancadoV2` (pesos `PESOS_AHP_V2`) de `services/riscoService.js`. O IRS v1 (`calcularRiscoAvancado`), ainda usado pela rota `POST /api/alertas`, foi avaliado sobre a mesma amostra, para comparação.

---

## 1. Texto para a Seção 6.1

### 1.1 Substituição do trecho com marcadores

> Trecho original: "uma amostra de [N] ocorrências do período de [mês/ano a mês/ano]"
>
> **Texto novo:** "uma amostra de 294 ocorrências do período de agosto/2026 a setembro/2026"

### 1.2 Composição da amostra

A amostra foi extraída dos arquivos mensais de focos de calor do Programa Queimadas do INPE referentes a julho, agosto e setembro de 2026. O mês de julho foi usado apenas para obter o dia anterior ao primeiro dia do período. Para evitar que um mesmo incêndio fosse contado várias vezes por satélites diferentes, foram considerados apenas os focos do satélite de referência do INPE (AQUA_M-T), totalizando 50.888 registros. Desse conjunto, 39.609 focos eram elegíveis: dia de detecção (dia 0, em UTC) entre 01/08/2026 e 23/09/2026 e bioma informado. Os sete últimos dias do período (24 a 30/09/2026) ficaram fora do sorteio, para que todo foco sorteado tivesse sete dias de observação posterior.

O sorteio foi estratificado em sete estratos disjuntos, com semente fixa (20261025) e 43 focos por estrato:

- um estrato urbano, com os focos situados a até 50 km de uma das dez cidades de referência do sistema;
- seis estratos de bioma, com os demais focos.

O Pampa tinha apenas 36 focos elegíveis e entrou integralmente, o que resultou em N = 294. A Tabela 6.X apresenta a distribuição.

**Tabela 6.X – Composição da amostra de validação**

| Estrato | Sorteados | Elegíveis |
|---|---:|---:|
| Amazônia | 43 | 19.369 |
| Cerrado | 43 | 14.594 |
| Caatinga | 43 | 3.167 |
| Mata Atlântica | 43 | 1.898 |
| Pantanal | 43 | 222 |
| Pampa | 36 | 36 |
| Urbano (≤ 50 km de uma das 10 cidades) | 43 | 323 |
| **Total** | **294** | **39.609** |

Considerando o bioma informado pelo INPE, inclusive para os focos do estrato urbano, a amostra reúne 65 focos na Amazônia, 53 no Cerrado, 48 na Mata Atlântica, 47 na Caatinga, 43 no Pantanal e 38 no Pampa.

### 1.3 Fontes de dados e proxies utilizados

As entradas do IRS foram montadas exclusivamente com informações disponíveis no dia do foco:

- **Coordenadas e bioma:** obtidos do próprio registro do INPE.
- **Área afetada:** como o INPE não informa a área queimada por foco, adotou-se como proxy o número de focos a até 1 km no mesmo dia, incluindo o próprio. As faixas são fixas: 1 foco = PEQUENA, 2 a 3 = MÉDIA, 4 ou mais = GRANDE.
- **Taxa de crescimento (dA/dt):** número de outros focos a até 1 km no dia 0 menos o número de focos a até 1 km no dia anterior, com mínimo zero.
- **Pessoas em risco:** considerada presente quando o foco está a até 50 km de uma das dez cidades de referência do sistema. É o mesmo raio usado para fauna e focos no serviço de geodados.
- **Proximidade urbana:** segue a lista de dez cidades já usada pelo sistema, sem alteração.
- **Vento:** velocidade máxima e direção dominante a 10 m no dia 0, obtidas da API histórica do Open-Meteo (OPEN-METEO, 2026). A velocidade foi convertida em classes pela escala de Beaufort: BAIXO abaixo de 20 km/h (força ≤ 3), MODERADO de 20 a 38 km/h (forças 4 e 5), ALTO a partir de 39 km/h (força ≥ 6). A direção, que na convenção meteorológica indica de onde o vento vem, foi somada a 180° para expressar o sentido para onde ele sopra, que é o sentido comparado pelo IRS com o vetor foco → cidade.
- **Unidades de conservação, terras indígenas, fauna ameaçada e relevância ecológica:** obtidas pelo serviço de geodados do próprio sistema, que consulta ICMBio, FUNAI e GBIF. As 294 consultas foram atendidas pelas fontes primárias, sem uso de fallback.
- **Zona urbana:** considerada falsa em todos os focos, por falta de dado.

Todas as respostas externas foram armazenadas em cache em disco, o que permite reproduzir o experimento sem novas consultas.

### 1.4 Classificação de referência (gabarito)

O gabarito de cada foco é o número de outros focos do mesmo satélite registrados a até 10 km nos sete dias seguintes ao dia 0. O plano original previa agrupar essa contagem em quatro faixas pelos quartis. Na amostra, entretanto, 182 dos 294 focos (61,9%) tiveram contagem zero. Com isso, o primeiro e o segundo quartis coincidem (Q1 = Q2 = 0) e o nível MODERADO fica vazio.

Por esse motivo, adotou-se como análise principal uma regra alternativa, definida antes do cálculo do IRS sobre a amostra:

- contagem zero corresponde a BAIXO ("sem propagação");
- as contagens positivas (n = 112) são divididas pelos tercis T1 = 2 e T2 = 5, ambos calculados por interpolação linear, método 7 de Hyndman e Fan (1996);
- resultam MODERADO para 1 a 2 focos, ALTO para 3 a 5 e CRÍTICO para 6 ou mais;
- em caso de empate com um limite, o foco fica no nível inferior.

A distribuição do gabarito principal ficou em 182 BAIXO, 52 MODERADO, 24 ALTO e 36 CRÍTICO. A regra original, por quartis (Q1 = 0; Q2 = 0; Q3 = 2), foi mantida como análise secundária, com 182 BAIXO, 0 MODERADO, 52 ALTO e 60 CRÍTICO. Esse procedimento constitui um desvio em relação ao plano descrito na Seção 6.2.

### 1.5 Controle de vazamento de dados

As entradas do IRS e da linha de base são calculadas a partir de uma visão dos focos limitada ao dia 0. Qualquer consulta a uma data posterior interrompe o processamento com erro. Os focos dos dias 1 a 7 são acessados somente pela função que calcula o gabarito.

Um teste automatizado (`tests/vazamento.test.js`) verifica que a inclusão de dezenas de focos futuros junto ao ponto não altera as entradas, o IRS nem a linha de base. O teste verifica também que o dA/dt reage ao dia anterior e não ao dia seguinte.

---

## 2. Textos e tabelas para a Seção 6.3

### 2.1 Cenários controlados

Os cenários são os oito da tabela comparativa do teste `teste-irs-v2-mock.js` e os dois casos extremos (pior e melhor caso) verificados no mesmo arquivo. O nível esperado foi preenchido apenas onde o teste o afirma explicitamente.

No cenário "Pantanal, só bioma", o arquivo de teste exige apenas um nível diferente de BAIXO. A validação adotou a formulação "ALTO ou CRÍTICO", fixada pelo autor antes da execução dos cenários.

**Tabela 6.Y – Cenários controlados**

| Cenário | Nível esperado | IRS | Nível obtido (IRS) | Nível obtido (linha de base) | IRS acertou? |
|---|---|---:|---|---|---|
| Pior caso (todos os critérios no máximo) | CRÍTICO | 0,9912 | CRÍTICO | CRÍTICO | Sim |
| Melhor caso (todos os critérios no mínimo) | BAIXO | 0,1937 | BAIXO | BAIXO | Sim |
| SP urbano | — | 0,7262 | CRÍTICO | CRÍTICO | — |
| Pantanal, só bioma | ALTO ou CRÍTICO | 0,4702 | MODERADO | MODERADO | Não |
| Pantanal em UC + fauna | — | 0,6412 | CRÍTICO | CRÍTICO | — |
| Amazônia, só bioma | — | 0,4713 | MODERADO | MODERADO | — |
| Amazônia em TI + fauna | — | 0,6623 | CRÍTICO | CRÍTICO | — |
| Cerrado (Brasília) | — | 0,5068 | ALTO | MODERADO | — |
| Caatinga (Recife) | — | 0,4369 | MODERADO | MODERADO | — |
| Pampa (Porto Alegre) | — | 0,4169 | MODERADO | MODERADO | — |

O IRS acertou 2 dos 3 cenários com nível esperado documentado. Nos demais, IRS e linha de base coincidiram em 9 dos 10 cenários, divergindo apenas no Cerrado (Brasília).

### 2.2 Resultados sobre a amostra real

**Tabela 6.Z – Desempenho sobre a amostra (N = 294; gabarito principal)**

| Métrica | IRS v2 | IRS v1 | Linha de base | Referência: sempre BAIXO |
|---|---|---|---|---|
| Acurácia | 35,0% [29,6; 40,8] | 59,5% [53,7; 65,3] | 29,3% [24,1; 34,7] | 61,9% |
| Recall do nível CRÍTICO | 8,3% (3/36) | 0,0% (0/36) | 8,3% (3/36) | 0,0% |
| Kappa ponderado quadrático | 0,111 [0,009; 0,209] | 0,019 [−0,017; 0,061] | 0,114 [0,019; 0,210] | 0,000 |

Entre colchetes: intervalo de confiança de 95% por bootstrap percentil, com 2.000 reamostragens e semente 20261025 (EFRON; TIBSHIRANI, 1993). A referência "sempre BAIXO" atribui a todos os focos a classe majoritária do gabarito.

Diferença pareada IRS v2 − linha de base:

| Métrica | Diferença | IC 95% |
|---|---|---|
| Acurácia | +5,7 pp | [+2,0; +9,2] pp |
| Kappa ponderado | −0,003 | [−0,053; +0,042] |

**Recall por nível (gabarito principal)**

| Nível | IRS v2 | IRS v1 | Linha de base |
|---|---:|---:|---:|
| BAIXO | 36,8% | 96,2% | 29,7% |
| MODERADO | 48,1% | 0,0% | 46,2% |
| ALTO | 33,3% | 0,0% | 20,8% |
| CRÍTICO | 8,3% | 0,0% | 8,3% |
| Níveis previstos (B/M/A/C) | 91/130/59/14 | 282/12/0/0 | 74/139/59/22 |

**Análise secundária (gabarito por quartis: 182/0/52/60)**

| Métrica | IRS v2 | IRS v1 | Linha de base | Sempre BAIXO |
|---|---|---|---|---|
| Acurácia | 28,9% [23,8; 34,4] | 59,5% | 26,2% [21,1; 31,6] | 61,9% |
| Recall do nível CRÍTICO | 8,3% | 0,0% | 13,3% | 0,0% |
| Kappa ponderado quadrático | 0,129 [0,022; 0,230] | 0,009 | 0,129 [0,026; 0,227] | 0,000 |

### 2.3 Matriz de confusão do IRS v2

**Tabela 6.W – Matriz de confusão do IRS v2 (gabarito principal; linhas = gabarito, colunas = nível atribuído pelo IRS)**

| Gabarito \ IRS | BAIXO | MODERADO | ALTO | CRÍTICO | Total |
|---|---:|---:|---:|---:|---:|
| BAIXO | **67** | 74 | 34 | 7 | 182 |
| MODERADO | 12 | **25** | 13 | 2 | 52 |
| ALTO | 5 | 9 | **8** | 2 | 24 |
| CRÍTICO | 7 | 22 | 4 | **3** | 36 |
| Total | 91 | 130 | 59 | 14 | 294 |

### 2.4 Análise de sensibilidade

Cada peso AHP foi aumentado e reduzido em 10%, e o conjunto foi renormalizado para somar 1. Em seguida, contou-se quantos dos 294 focos mudaram de nível em relação ao IRS original.

**Tabela 6.V – Sensibilidade do IRS v2 aos pesos AHP (% de focos que mudaram de nível)**

| Critério | Peso | +10% | −10% |
|---|---:|---:|---:|
| Proximidade urbana | 0,15 | 3,1% | 2,7% |
| Bioma | 0,20 | 2,7% | 2,7% |
| Pessoas em risco | 0,14 | 2,7% | 2,0% |
| Fauna | 0,10 | 1,4% | 0,7% |
| Área afetada | 0,10 | 1,0% | 0,3% |
| Vento | 0,06 | 0,3% | 0,7% |
| Tempo (dA/dt) | 0,06 | 0,7% | 0,3% |
| Tipo de área | 0,12 | 0,3% | 0,7% |
| Relevância ecológica | 0,07 | 0,3% | 0,7% |

### 2.5 Interpretação dos resultados

**Resultado frente ao critério da Seção 6.2.** Pelo critério definido na Seção 6.2, o IRS v2 não se mostrou superior à linha de base. Os coeficientes Kappa ponderados foram praticamente iguais (0,111 e 0,114), e o intervalo de confiança da diferença inclui zero (−0,053 a +0,042).

O IRS v2 apresenta concordância leve com o gabarito, na escala de Landis e Koch (1977), com intervalo de confiança inteiramente acima de zero. Obtém ganho de acurácia de 5,7 pontos percentuais sobre a linha de base (IC 95%: 2,0 a 9,2 pp) e desempenho claramente superior ao do IRS v1, cujo Kappa é praticamente nulo (0,019; IC 95%: −0,017 a 0,061).

A acurácia do IRS v1 (59,5%) e a da referência "sempre BAIXO" (61,9%) ilustram por que a acurácia isolada é inadequada neste problema. Com 61,9% dos focos no nível BAIXO, um classificador que atribui BAIXO a quase todos os casos alcança acurácia elevada sem nenhuma capacidade discriminativa. O IRS v1 faz isso em 96% dos focos, porque concentra 42% do peso no critério urbano, que é praticamente nulo na amostra.

Os três modelos identificaram corretamente apenas 3 dos 36 focos do nível CRÍTICO (recall de 8,3%), no melhor caso.

**Divergência de construto, o principal achado.** O IRS foi concebido para priorizar o atendimento, combinando risco à população e relevância ambiental da área atingida. O gabarito, por sua vez, mede a propagação do fogo nos dias seguintes.

Quase metade do peso do IRS v2 (49%) está em critérios ambientais estáticos: bioma, tipo de área, fauna e relevância ecológica. Esses critérios expressam a importância do que está em risco, mas não têm relação direta com a probabilidade de o fogo se alastrar. Outros 29% estão nos critérios de proximidade urbana e pessoas em risco, que também não medem propagação.

Assim, um IRS elevado em uma terra indígena amazônica com fauna criticamente ameaçada é coerente com o propósito do sistema, ainda que o foco se extinga no dia seguinte. A baixa concordância observada indica, portanto, sobretudo que o gabarito disponível mede um fenômeno diferente daquele para o qual o índice foi projetado, e não necessariamente que a priorização proposta seja inadequada.

**Demais fatores.** Três fatores adicionais contribuem para o resultado:

1. **Baixa variância dos critérios dinâmicos.** Os critérios dinâmicos, que poderiam se relacionar com a propagação, tiveram baixa variância na amostra:
   - a área afetada ocupou apenas duas das três classes;
   - o vento não atingiu a classe ALTO (máximo de 29,7 km/h);
   - o dA/dt foi nulo em 75% dos focos;
   - o critério urbano ficou abaixo de 0,05 em 98,6% deles.
2. **Efeito do bioma.** As pontuações fixas do bioma nem sempre acompanham a propagação observada:
   - na Mata Atlântica, que recebe 0,9 pontos, 33 dos 43 focos não tiveram nenhum foco subsequente, e a acurácia do IRS v2 foi de 20,9%;
   - na Amazônia, o Kappa do estrato foi negativo (−0,14);
   - no Pampa, os 36 focos tiveram gabarito BAIXO. O IRS acertou 35 deles, mas o Kappa do estrato é nulo, pois não há variação no gabarito.
3. **Concentração dos escores na faixa MODERADO.** A mediana do IRS v2 na amostra foi 0,431, e 130 focos (44%) ficaram no intervalo [0,390; 0,500), que corresponde ao nível MODERADO. O índice atribui, assim, MODERADO a 44% dos focos, enquanto 62% do gabarito é BAIXO. Os limiares não foram ajustados à amostra, para preservar a avaliação do modelo tal como está implementado.

**Sensibilidade.** A classificação mostrou-se estável frente a variações de ±10% nos pesos: no máximo 3,1% dos focos mudaram de nível em cada variação. Considerando as 18 variações, 21 focos mudaram de nível em pelo menos uma delas. Todos estão entre os 72 focos (24%) cujo escore fica a menos de 0,02 de um limiar.

O critério de proximidade urbana é o mais sensível, embora seu valor seja quase nulo na amostra. Isso decorre da renormalização: aumentar seu peso reduz proporcionalmente o peso de todos os demais critérios e desloca para baixo o escore dos focos distantes das cidades.

**Reprodutibilidade (RNF18).** Duas execuções completas do IRS v2 sobre a amostra produziram resultados idênticos em 294 de 294 focos (100%), com o mesmo hash SHA-256 das saídas.

### 2.6 Limitações

1. **O gabarito é um proxy de propagação, e não de risco à população.** A contagem de focos nos sete dias seguintes não mede danos a pessoas, bens ou áreas protegidas, que são o objeto central do IRS. Além disso, a regra de faixas precisou ser alterada, como descrito na Seção 1.4.
2. **Focos de calor não são incêndios confirmados.** Os focos de calor são detecções por satélite de anomalias térmicas: aproximações das ocorrências reais, sujeitas a omissões (nuvens, fogo de pequena extensão, horário da passagem) e a detecções que não correspondem a incêndios.
3. **Vários critérios dependem de proxies.**
   - A área afetada e o dA/dt foram estimados pela contagem de focos vizinhos.
   - A presença de pessoas em risco foi inferida pela distância às cidades de referência.
   - A zona urbana foi considerada ausente em todos os focos.
   - O bioma do INPE coincide com o da base do IBGE em 268 dos 294 focos (91%).
   - As camadas de UC, TI e fauna refletem a data da consulta (outubro de 2026), e não a do foco. Os registros de fauna do GBIF dependem do esforço de amostragem de cada região.
4. **Classes vazias nos proxies.** A amostra não contém nenhum foco nas classes GRANDE (área) e ALTO (vento), o que restringe a faixa de valores alcançada pelo IRS. Distribuições:

   | Proxy | Distribuição |
   |---|---|
   | Área afetada | PEQUENA 219 · MÉDIA 75 · GRANDE 0 |
   | Vento | BAIXO 195 · MODERADO 99 · ALTO 0 (máx. 29,7 km/h; mediana 17,4 km/h) |
   | dA/dt | 0 → 220 · 1 → 62 · 2 → 12 |
   | Pessoas em risco | sim 43 · não 251 |
   | Tipo de área | em TI 22 · em UC 16 · demais 256 |
   | Fauna | crítica 115 · ameaçada 97 · vulnerável 70 · sem espécies 12 |
   | Área protegida mais próxima | < 10 km: 85 · 10–50 km: 125 · > 50 km: 84 |

5. **O critério urbano fica próximo de zero para a maioria dos focos.** Esta é uma limitação do modelo atual, e não da amostra. O critério mede a distância a apenas dez capitais com decaimento exponencial. Na amostra:
   - a distância mediana até a cidade mais próxima foi de 433 km (mínimo de 10,2 km; máximo de 1.254,7 km);
   - o valor normalizado do critério teve mínimo 0, mediana 0,000 e máximo 0,130;
   - o valor ficou abaixo de 0,05 em 98,6% dos focos.

   Na linha de base, com decaimento linear até 50 km, o valor ficou abaixo de 0,05 em 86,1% dos focos.
6. **A amostra cobre um único período.** Foram usados dois meses (agosto e setembro de 2026) de uma única temporada de fogo e de um único satélite. O Pampa contribuiu com apenas 36 focos, todos sem propagação.

### 2.7 Trabalhos futuros

1. **Incorporar variáveis meteorológicas e de intensidade.** O próprio registro do INPE já traz número de dias sem chuva, precipitação, potência radiativa do fogo (FRP) e risco de fogo, todos disponíveis no dia da detecção e potencialmente associados à propagação.
2. **Ampliar a referência do critério urbano.** Substituir a lista de dez capitais pelas sedes municipais do IBGE, para que o critério deixe de ser praticamente nulo fora das grandes cidades.
3. **Recalibrar os pesos AHP com especialistas.** Recalibrar os pesos com especialistas em manejo do fogo e defesa civil e validar o modelo resultante em uma amostra independente, de outro período ou temporada. Validar sobre a mesma amostra usada para a calibração produziria sobreajuste.
4. **Construir um gabarito alinhado ao propósito do IRS.** Por exemplo, usar registros de atendimento da defesa civil ou de áreas queimadas que atingiram áreas habitadas ou protegidas, em vez da propagação de focos.

---

## 3. Parágrafo para as Considerações Finais (Capítulo 7)

> A validação do IRS v2 sobre 294 focos de calor do INPE (agosto e setembro de 2026) mostrou resultados totalmente reprodutíveis e concordância leve com a propagação observada do fogo (κ ponderado = 0,111), superior à do IRS v1 (κ ≈ 0). Pelo critério definido, porém, o índice não superou a linha de base sem pesos AHP (κ = 0,114; diferença não significativa). A principal limitação é a divergência de construto: o IRS foi concebido para priorizar o atendimento conforme o risco à população e a relevância ambiental, enquanto o gabarito disponível mede apenas a propagação do fogo. Uma validação definitiva requer uma referência alinhada a esse propósito, avaliada em amostra independente.

---

## Referências

COHEN, Jacob. A coefficient of agreement for nominal scales. **Educational and Psychological Measurement**, v. 20, n. 1, p. 37-46, 1960.

COHEN, Jacob. Weighted kappa: nominal scale agreement with provision for scaled disagreement or partial credit. **Psychological Bulletin**, v. 70, n. 4, p. 213-220, 1968.

EFRON, Bradley; TIBSHIRANI, Robert J. **An introduction to the bootstrap**. New York: Chapman & Hall, 1993.

GBIF. **GBIF Occurrence Search API**. Copenhagen: Global Biodiversity Information Facility, 2026. Disponível em: <https://api.gbif.org/v1/occurrence/search>. Acesso em: 14 out. 2026.

HYNDMAN, Rob J.; FAN, Yanan. Sample quantiles in statistical packages. **The American Statistician**, v. 50, n. 4, p. 361-365, 1996.

INSTITUTO NACIONAL DE PESQUISAS ESPACIAIS (INPE). **Programa Queimadas**: BDQueimadas. São José dos Campos: INPE, 2026. Disponível em: <https://terrabrasilis.dpi.inpe.br/queimadas/bdqueimadas/>. Acesso em: 14 out. 2026.

INSTITUTO NACIONAL DE PESQUISAS ESPACIAIS (INPE). **Focos de queimadas**: arquivos mensais (CSV), Brasil. São José dos Campos: INPE, 2026. Disponível em: <https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/>. Acesso em: 14 out. 2026.

LANDIS, J. Richard; KOCH, Gary G. The measurement of observer agreement for categorical data. **Biometrics**, v. 33, n. 1, p. 159-174, 1977.

OPEN-METEO. **Historical Weather API**. [S. l.]: Open-Meteo, 2026. Disponível em: <https://archive-api.open-meteo.com/v1/archive>. Acesso em: 14 out. 2026.
