# Índice de Risco Sintético, versão 2 (IRS v2)

Este documento descreve o algoritmo de classificação de risco usado pelo SMCQ desde a integração do IRS v2 ao backend. Os pesos, as tabelas de pontuação e as fórmulas reproduzem exatamente o que está implementado em `services/riscoService.js` (função `calcularRiscoAvancadoV2`). A primeira versão (`calcularRiscoAvancado`, IRS v1) permanece no código para comparação e para alertas registrados antes da mudança.

---

## 1. Justificativa da evolução do v1 para o v2

O IRS v1 foi concebido para priorizar ocorrências com ameaça direta a populações urbanas. Dos cinco critérios que o compõem, os dois ligados à população (proximidade urbana e pessoas em risco) concentram 68% do peso. Como a proximidade urbana é medida em relação a apenas dez capitais e decai exponencialmente com a distância, uma ocorrência afastada dessas cidades e sem pessoas em risco declaradas recebia o nível BAIXO independentemente da área afetada ou do vento. Na prática, o v1 deixava de distinguir as queimadas em vegetação nativa, que constituem a maior parte dos focos de calor registrados no país e afetam biomas, áreas protegidas e espécies ameaçadas.

O IRS v2 amplia o escopo do índice para incluir as queimadas nos biomas, e não apenas os incêndios próximos a áreas urbanas. Para isso, acrescenta quatro critérios ambientais:

- **bioma** do ponto da ocorrência;
- **tipo de área** atingida (terra indígena, unidade de conservação, APP, reserva legal, área rural ou urbana);
- **fauna ameaçada** registrada nas proximidades;
- **relevância ecológica**, medida pela distância à unidade de conservação ou terra indígena mais próxima.

Os cinco critérios do v1 foram mantidos, com as mesmas funções de transformação, e cederam peso aos novos critérios. Os critérios ligados à população passaram a somar 29% do peso, e os ambientais, 49%.

Como exemplo, um ponto remoto no Pantanal, com área grande, vento alto e sem pessoas em risco, recebe o nível BAIXO no v1 (IRS = 0,2609) e MODERADO no v2 (IRS = 0,4702), considerando apenas o bioma, sem unidade de conservação nem fauna ameaçada (cenário "Pantanal, só bioma" de `teste-irs-v2-mock.js`).

Os critérios ambientais são preenchidos automaticamente a partir de bases públicas (IBGE, ICMBio, FUNAI e GBIF), consultadas pelo serviço `services/geodadosService.js`. Quando uma base não responde, o serviço usa um valor de reserva (fallback) e registra a fonte efetivamente usada. O operador pode corrigir o bioma e o tipo de área; nesse caso, o valor informado prevalece sobre o detectado, e a origem fica registrada no alerta. As bases estão descritas em [`bases-de-dados.md`](bases-de-dados.md).

---

## 2. Pesos AHP: v1 × v2

| Critério | Peso v1 | Peso v2 |
| :--- | ---: | ---: |
| Área afetada | 0,16 | 0,10 |
| Proximidade urbana | 0,42 | 0,15 |
| Vento | 0,09 | 0,06 |
| Pessoas em risco | 0,26 | 0,14 |
| Propagação temporal (dA/dt) | 0,07 | 0,06 |
| Bioma | — | 0,20 |
| Tipo de área | — | 0,12 |
| Fauna ameaçada | — | 0,10 |
| Relevância ecológica | — | 0,07 |
| **Soma** | **1,00** | **1,00** |

---

## 3. Tabelas de pontuação dos critérios ambientais

Cada critério é convertido em um fator entre 0 e 1.

### 3.1 Bioma

| Bioma | Fator |
| :--- | ---: |
| Amazônia | 1,0 |
| Pantanal | 1,0 |
| Mata Atlântica | 0,9 |
| Cerrado | 0,7 |
| Caatinga | 0,6 |
| Pampa | 0,5 |
| Outro (ponto fora dos biomas mapeados) | 0,5 |
| Urbano | 0,3 |

Origem do valor, em ordem de prioridade: bioma informado pelo operador; camada de biomas do IBGE; fallback pelo centróide de referência mais próximo, entre 16 centróides, sendo o ponto classificado como "Urbano" quando está a mais de 300 km de todos eles.

### 3.2 Tipo de área

| Tipo de área | Fator |
| :--- | ---: |
| Terra Indígena | 1,0 |
| Unidade de Conservação federal | 1,0 |
| Unidade de Conservação estadual | 0,85 |
| Área de Preservação Permanente (APP) | 0,8 |
| Reserva Legal | 0,7 |
| Área rural | 0,4 |
| Área urbana | 0,3 |

Origem do valor, em ordem de prioridade: tipo informado pelo operador; terra indígena (FUNAI) ou unidade de conservação (ICMBio) que contém o ponto, com a UC municipal pontuada como estadual; na ausência de ambas, área urbana se o alerta foi marcado como zona urbana, ou área rural caso contrário.

No critério "tipo de área", a pontuação reflete a relevância ambiental da área atingida; o risco à população é capturado separadamente pelos critérios de proximidade urbana e pessoas em risco.

### 3.3 Fauna ameaçada

Considera as espécies do reino animal com registro de ocorrência no GBIF a até 50 km do ponto, classificadas pela Lista Vermelha da IUCN. O nível é o da categoria mais grave com ao menos uma espécie.

| Nível | Critério | Fator |
| :--- | :--- | ---: |
| Crítica | ao menos uma espécie criticamente em perigo (CR) | 1,0 |
| Ameaçada | ao menos uma espécie em perigo (EN) | 0,8 |
| Vulnerável | ao menos uma espécie vulnerável (VU) | 0,6 |
| Sem espécies | nenhuma espécie CR, EN ou VU registrada | 0,3 |
| Urbana | área urbana, sem dado de fauna | 0,2 |

### 3.4 Relevância ecológica

Distância do ponto à unidade de conservação ou terra indígena mais próxima.

| Faixa de distância | Fator |
| :--- | ---: |
| dentro de UC/TI ou a menos de 10 km | 1,0 |
| de 10 a 50 km | 0,6 |
| mais de 50 km, ou sem informação | 0,3 |

---

## 4. Fórmulas

### 4.1 Critérios herdados do v1

As funções de transformação são as mesmas do IRS v1.

**Área afetada e pessoas em risco** (mapeamento direto):

$$
\varphi_{\text{área}} = \begin{cases} 0{,}33 & \text{pequena} \\ 0{,}66 & \text{média} \\ 1{,}0 & \text{grande} \end{cases}
\qquad
\varphi_{\text{pessoas}} = \begin{cases} 1 & \text{há pessoas em risco} \\ 0 & \text{caso contrário} \end{cases}
$$

**Proximidade urbana: decaimento exponencial.** Sendo $d$ a distância, em quilômetros, até a cidade mais próxima de uma lista fixa de dez capitais (São Paulo, Rio de Janeiro, Brasília, Belo Horizonte, Salvador, Manaus, Porto Alegre, Curitiba, Recife e Fortaleza), calculada pela fórmula de Haversine com raio terrestre de 6.371 km:

$$
\varphi_{\text{urb}} = e^{-0{,}2\,d}
$$

**Vento: produto escalar.** Sendo $\theta$ o ângulo entre o vetor do vento, que indica o sentido para onde o vento sopra (em graus, com 0° no norte e sentido horário, valor padrão de 45°), e o vetor que liga o ponto da ocorrência à cidade mais próxima:

$$
\varphi_{\text{vento}} = I \cdot \frac{1 + \cos\theta}{2},
\qquad
I = \begin{cases} 0{,}33 & \text{baixo} \\ 0{,}66 & \text{moderado} \\ 1{,}0 & \text{alto} \end{cases}
$$

O termo $(1 + \cos\theta)/2$ é o cosseno do ângulo entre os dois vetores, obtido pelo produto escalar normalizado e reescalado para [0, 1]. Vale 1 quando o vento sopra em direção à cidade e 0 quando sopra no sentido oposto.

**Propagação temporal: derivada.** Sendo $dA/dt$ a taxa de crescimento da área afetada:

$$
\varphi_{\text{tempo}} = \begin{cases} \min\!\left(1,\ \dfrac{\ln(1 + dA/dt)}{1{,}1}\right) & dA/dt > 0 \\[2mm] 0{,}3 & dA/dt \le 0 \text{ ou não informado} \end{cases}
$$

O divisor 1,1 corresponde aproximadamente a $\ln 3$, isto é, ao valor de $\ln(1 + dA/dt)$ para a taxa de referência $dA/dt = 2$.

### 4.2 Soma ponderada

Os fatores dos critérios ambientais vêm das tabelas da Seção 3. O índice é a soma ponderada dos nove fatores:

$$
\text{IRS} = \sum_{i=1}^{9} w_i \, \varphi_i, \qquad \sum_{i=1}^{9} w_i = 1, \qquad 0 \le \text{IRS} \le 1
$$

em que $w_i$ são os pesos AHP v2 da Seção 2.

### 4.3 Sigmoide e limiares de classificação

O IRS passa por uma função sigmoide com inclinação $k = 10$ e ponto central $\mu = 0{,}5$:

$$
S = \frac{1}{1 + e^{-k\,(\text{IRS} - \mu)}} = \frac{1}{1 + e^{-10\,(\text{IRS} - 0{,}5)}}
$$

| Valor de S | Nível | IRS equivalente |
| :--- | :--- | :--- |
| $S < 0{,}25$ | BAIXO | IRS < 0,3901 |
| $0{,}25 \le S < 0{,}50$ | MODERADO | 0,3901 ≤ IRS < 0,5000 |
| $0{,}50 \le S < 0{,}75$ | ALTO | 0,5000 ≤ IRS < 0,6099 |
| $S \ge 0{,}75$ | CRÍTICO | IRS ≥ 0,6099 |

Como a sigmoide é estritamente crescente, os limiares sobre $S$ equivalem a limiares sobre o próprio IRS, dados por $\text{IRS} = \mu + \ln\big(p / (1 - p)\big)/k$ para $p \in \{0{,}25;\ 0{,}50;\ 0{,}75\}$.

### 4.4 Rastreabilidade do cálculo

Para cada alerta, o sistema grava o IRS, o valor da sigmoide, o nível e, para cada um dos nove critérios, o valor de entrada, o fator, o peso, a contribuição ($w_i \varphi_i$) e a origem do dado. Grava também os geodados consultados, com a fonte e a data de obtenção de cada um, e a versão do algoritmo (`"IRS v2"`). Esses dados atendem à necessidade de visualizar os fatores que contribuíram para o índice e são exibidos na tela de detalhes do alerta.

---

## 5. Resultados da validação

O IRS v2 foi validado com focos de calor reais do Programa Queimadas do INPE, comparando-o a uma linha de base sem pesos AHP e sem funções de transformação, e ao IRS v1. O método, os resultados numéricos e as limitações estão em [`validacao-irs.md`](validacao-irs.md). Em síntese:

- **Concordância com o gabarito:** o IRS v2 apresentou concordância leve com o gabarito de propagação do fogo, estatisticamente acima de zero, e desempenho superior ao do IRS v1, cuja concordância foi praticamente nula.
- **Comparação com a linha de base:** pelo critério definido no plano de validação (Kappa ponderado), o IRS v2 não se mostrou superior à linha de base. A diferença entre os dois não foi estatisticamente significativa, embora o IRS v2 tenha obtido acurácia ligeiramente maior.
- **Principal achado, a divergência de construto:** o IRS foi concebido para priorizar o atendimento conforme o risco à população e a relevância ambiental, enquanto o gabarito disponível mede apenas a propagação do fogo nos dias seguintes.
- **Robustez:** a classificação foi totalmente reprodutível e mostrou-se estável frente a variações de ±10% nos pesos AHP.
- **Limitação do modelo atual:** o critério de proximidade urbana ficou próximo de zero para a grande maioria dos focos, porque considera apenas dez capitais. A substituição pelas sedes municipais do IBGE é indicada como trabalho futuro.
