# Análises complementares da validação do IRS

- **Data de execução:** 2026-10-20
- **Semente:** 20261025 (`config.SEMENTE`, a mesma do sorteio e do bootstrap da validação)
- **Reamostragens do bootstrap:** 2000 (as mesmas de `scripts/validacao/validar-irs.js`); IC 95% pelo método percentil
- **Pesos do IRS:** não foram alterados nem recalculados. Níveis e escores vêm de `data/validacao/resultados.json` (`porFoco`), como publicados.
- **Dados:** `data/validacao/amostra.json`, `amostra.csv` e `resultados.json` (somente leitura); no item C2, também os CSV brutos do INPE em `data/validacao/bruto/` (SHA-256 conferidos com `fontes.json`). N = 294 focos.
- **Gerado por:** `node scripts/analises/analises-complementares.js` → `data/analises/analises-complementares.json`

Salvo indicação contrária, a referência é a regra principal (0 → Baixo; tercis das contagens > 0), com 182/52/24/36 focos em Baixo/Moderado/Alto/Crítico.

## A. Bootstrap pareado

Em cada uma das réplicas, os mesmos focos sorteados são usados para os três modelos; as diferenças são calculadas réplica a réplica.

| Modelo | κ ponderado quadrático [IC 95%] | Acurácia [IC 95%] |
| --- | --- | --- |
| IRS v2 | 0,111 [0,009; 0,209] | 35,0% [29,6%; 40,8%] |
| IRS v1 | 0,019 [−0,017; 0,061] | 59,5% [53,7%; 65,3%] |
| Linha de base | 0,114 [0,019; 0,210] | 29,3% [24,1%; 34,7%] |

| Diferença | Δκ [IC 95%] | Δ acurácia [IC 95%] |
| --- | --- | --- |
| IRS v2 − IRS v1 | 0,092 [0,003; 0,173] | −24,5 p.p. [−32,0; −16,3] |
| IRS v2 − Linha de base | −0,003 [−0,053; 0,042] | 5,8 p.p. [2,0; 9,2] |

Os intervalos de cada modelo e da diferença v2 − linha de base são idênticos aos de `resultados.json` (conferido pelo script).

**Interpretação:** o IC da diferença de κ entre v2 e v1 fica inteiramente acima de zero, e o da diferença v2 − linha de base inclui o zero; em acurácia, a v1 supera a v2 porque classifica quase todos os focos como Baixo, a classe majoritária.

## B. Bootstrap por agrupamento

Reamostram-se grupos inteiros com reposição (cada réplica sorteia tantos grupos quantos existem), o que preserva a dependência entre focos do mesmo município ou do mesmo dia.

| Reamostragem | Grupos | κ v2 | κ v1 | κ base | Δκ v2 − v1 | Δκ v2 − base |
| --- | --- | --- | --- | --- | --- | --- |
| Simples (focos) | 294 | 0,111 [0,009; 0,209] | 0,019 [−0,017; 0,061] | 0,114 [0,019; 0,210] | 0,092 [0,003; 0,173] | −0,003 [−0,053; 0,042] |
| B1 · município | 187 | 0,111 [−0,013; 0,219] | 0,019 [−0,034; 0,082] | 0,114 [−0,003; 0,221] | 0,092 [0,001; 0,173] | −0,003 [−0,055; 0,045] |
| B2 · dia de detecção | 50 | 0,111 [−0,020; 0,238] | 0,019 [−0,020; 0,070] | 0,114 [−0,006; 0,222] | 0,092 [−0,022; 0,198] | −0,003 [−0,047; 0,043] |

Razão entre a largura do IC por agrupamento e a do bootstrap simples:

| Agrupamento | Focos por grupo (mín./mediana/máx.) | κ v2 | κ v1 | κ base | Δκ v2 − v1 | Δκ v2 − base |
| --- | --- | --- | --- | --- | --- | --- |
| B1 · município | 1/1/12 | 1,16 | 1,49 | 1,17 | 1,01 | 1,06 |
| B2 · dia | 1/5/19 | 1,29 | 1,16 | 1,19 | 1,29 | 0,96 |

**Interpretação:** os valores pontuais não mudam; a largura do IC do κ da v2 passa de 0,200 (focos) para 0,232 (município) e 0,258 (dia). Por município, o IC inclui o zero em κ v2; por dia, inclui o zero em κ v2 e Δκ v2 − v1. A diferença v2 − linha de base inclui o zero nas três formas de reamostragem.

## C. Sobreposição entre entrada e referência

### C1. Disjunção temporal

- **Entrada:** dias 0 e −1 (scripts/validacao/amostra.js: montarEntradasDia0, l. 186–196, chamada com a visão indice.ate(dia0), que lança erro ao consultar dia posterior, l. 97–105; preparar-amostra.js l. 169).
- **Referência:** dias 1 a 7 (scripts/validacao/amostra.js: calcularGabarito, l. 228–233, laço d = 1..DIAS_GABARITO).

Os conjuntos de dias {−1, 0} e {1, …, 7} são disjuntos. Como cada foco do INPE tem uma única data, **nenhum foco usado na entrada pode entrar na contagem da referência**: a sobreposição foco a foco é 0 por construção, para todos os 294 focos.

Correlação de Spearman entre as contagens da entrada e a contagem da referência:

| Contagem da entrada | Distribuição na amostra | ρ de Spearman |
| --- | --- | --- |
| `n_focos_1km_dia0` (focos a ≤ 1 km no dia 0 (inclui o próprio) → área afetada) | 1: 219 · 2: 63 · 3: 12 | 0,025 |
| `n_outros_focos_1km_dia0` (outros focos a ≤ 1 km no dia 0 → dA/dt) | 0: 219 · 1: 63 · 2: 12 | 0,025 |
| `n_focos_1km_dia_menos1` (focos a ≤ 1 km no dia −1 → dA/dt) | 0: 291 · 1: 3 | 0,118 |
| `dA_dt` (dA/dt = max(0, outros dia 0 − dia −1)) | 0: 220 · 1: 62 · 2: 12 | 0,015 |

As duas primeiras linhas têm o mesmo ρ porque `n_outros_focos_1km_dia0` = `n_focos_1km_dia0` − 1 em todos os focos.

Para comparação, ρ entre o escore contínuo e a contagem da referência: IRS v2 0,150, IRS v1 0,061, linha de base 0,144.

Focos da amostra próximos entre si (distância ≤ 10 km e |Δ dias| ≤ 7): **70 pares**, envolvendo 76 focos (37 pares no mesmo dia). Em 22 focos, outro foco da amostra cai na janela da referência (dias 1 a 7, ≤ 10 km); 26 focos da amostra são contados na referência de outro foco da amostra.

**Interpretação:** não há reuso de focos entre entrada e referência, e as correlações entre as contagens de entrada e a da referência são baixas (|ρ| ≤ 0,118). Por outro lado, 76 dos 294 focos (25,9%) estão a ≤ 10 km e ≤ 7 dias de outro foco da amostra e podem pertencer ao mesmo incêndio; essa dependência é a que o bootstrap por agrupamento (item B) procura levar em conta.

### C2. Sensibilidade: referência sem o entorno imediato (anel de 1 a 10 km)

Referência alternativa: focos a mais de 1 km e até 10 km nos dias 1 a 7, satélite AQUA_M-T. A contagem de 10 km recalculada a partir dos CSV brutos reproduz a publicada nos 294 focos. 25 focos tinham algum foco a ≤ 1 km nos dias 1 a 7 (35 de 677 focos da referência publicada); sem eles, 189 focos ficam com contagem 0.

| Referência | Limites (T1; T2) | Baixo/Moderado/Alto/Crítico | Focos que mudaram de nível | κ v2 | κ v1 | κ base |
| --- | --- | --- | --- | --- | --- | --- |
| Publicada (≤ 10 km) | 2; 5 | 182/52/24/36 | — | 0,111 [0,009; 0,209] | 0,019 [−0,017; 0,061] | 0,114 [0,019; 0,210] |
| Anel 1–10 km (tercis recalculados = limites publicados) | 2,00; 5,00 | 189/49/22/34 | 12 | 0,108 [0,008; 0,205] | 0,018 [−0,019; 0,061] | 0,108 [0,016; 0,202] |

Os tercis das contagens positivas do anel são os mesmos da referência publicada (T1 = 2, T2 = 5), de modo que as duas variantes (tercis recalculados e limites publicados) coincidem.

**Interpretação:** sem os focos a até 1 km, 12 focos mudam de nível e os κ variam −0,004 (IRS v2), −0,001 (IRS v1), −0,006 (Linha de base); as variações são pequenas diante da largura dos IC.

## D. Outros cortes da referência

| Corte | Baixo/Moderado/Alto/Crítico | κ v2 | κ v1 | κ base |
| --- | --- | --- | --- | --- |
| principal: 0 \| tercis das contagens > 0 (≤ 2 \| 3–5 \| ≥ 6) | 182/52/24/36 | 0,111 [0,009; 0,209] | 0,019 [−0,017; 0,061] | 0,114 [0,019; 0,210] |
| secundaria: quartis (Q1 = Q2 = 0, Q3 = 2) | 182/0/52/60 | 0,129 [0,022; 0,230] | 0,009 [−0,016; 0,038] | 0,129 [0,026; 0,227] |
| D1: fixos 0 \| 1–2 \| 3–5 \| 6+ (idêntico ao principal) | 182/52/24/36 | 0,111 [0,009; 0,209] | 0,019 [−0,017; 0,061] | 0,114 [0,019; 0,210] |
| D1b: fixos 0 \| 1–4 \| 5–9 \| 10+ | 182/69/18/25 | 0,073 [−0,027; 0,169] | 0,015 [−0,025; 0,059] | 0,078 [−0,012; 0,171] |

Os cortes fixos D1 (0 | 1–2 | 3–5 | 6+) coincidem exatamente com a regra principal, porque os tercis das contagens positivas são T1 = 2 e T2 = 5; por isso foi incluído o corte D1b, mais largo.

### D2. Referência binária (112 com propagação × 182 sem)

Modelo: “houve propagação” quando o nível previsto não é Baixo. Referência trivial “nunca há propagação”: acurácia 61,9%, κ = 0.

| Modelo | Previstos SIM | Acurácia [IC 95%] | κ de Cohen [IC 95%] | Sensibilidade | Especificidade |
| --- | --- | --- | --- | --- | --- |
| IRS v2 | 203 | 52,7% [46,9%; 58,5%] | 0,133 [0,041; 0,226] | 78,6% | 36,8% |
| IRS v1 | 12 | 61,2% [55,4%; 66,7%] | 0,007 [−0,048; 0,068] | 4,5% | 96,2% |
| Linha de base | 220 | 49,7% [43,9%; 55,4%] | 0,100 [0,019; 0,182] | 82,1% | 29,7% |
| Δ IRS v2 − IRS v1 |  | −8,5 p.p. [−17,7; 1,0] | 0,126 [0,023; 0,226] |  |  |
| Δ IRS v2 − linha de base |  | 3,1 p.p. [−0,3; 6,5] | 0,033 [−0,025; 0,092] |  |  |

**Interpretação:** nos quatro cortes de quatro níveis, o κ da v2 varia de 0,073 a 0,129, fica próximo do κ da linha de base e acima do da v1; no corte mais largo (D1b) os IC da v2 e da linha de base incluem o zero. Na referência binária, a v2 tem κ = 0,133, com sensibilidade 78,6% e especificidade 36,8%, e a diferença para a linha de base inclui o zero.

## E. Métricas por classe (regra principal)

### IRS v2

| Referência ↓ / previsto → | Baixo | Moderado | Alto | Crítico | Total |
| --- | --- | --- | --- | --- | --- |
| **Baixo** | 67 | 74 | 34 | 7 | 182 |
| **Moderado** | 12 | 25 | 13 | 2 | 52 |
| **Alto** | 5 | 9 | 8 | 2 | 24 |
| **Crítico** | 7 | 22 | 4 | 3 | 36 |
| **Total previsto** | 91 | 130 | 59 | 14 | 294 |

| Classe | Precisão | Recall | F1 |
| --- | --- | --- | --- |
| Baixo | 73,6% | 36,8% | 0,491 |
| Moderado | 19,2% | 48,1% | 0,275 |
| Alto | 13,6% | 33,3% | 0,193 |
| Crítico | 21,4% | 8,3% | 0,120 |
| **F1 macro** |  |  | **0,270** |

### IRS v1

| Referência ↓ / previsto → | Baixo | Moderado | Alto | Crítico | Total |
| --- | --- | --- | --- | --- | --- |
| **Baixo** | 175 | 7 | 0 | 0 | 182 |
| **Moderado** | 52 | 0 | 0 | 0 | 52 |
| **Alto** | 22 | 2 | 0 | 0 | 24 |
| **Crítico** | 33 | 3 | 0 | 0 | 36 |
| **Total previsto** | 282 | 12 | 0 | 0 | 294 |

| Classe | Precisão | Recall | F1 |
| --- | --- | --- | --- |
| Baixo | 62,1% | 96,2% | 0,754 |
| Moderado | 0,0% | 0,0% | 0,000 |
| Alto | — | 0,0% | 0,000 |
| Crítico | — | 0,0% | 0,000 |
| **F1 macro** |  |  | **0,189** |

### Linha de base

| Referência ↓ / previsto → | Baixo | Moderado | Alto | Crítico | Total |
| --- | --- | --- | --- | --- | --- |
| **Baixo** | 54 | 84 | 32 | 12 | 182 |
| **Moderado** | 11 | 24 | 15 | 2 | 52 |
| **Alto** | 4 | 10 | 5 | 5 | 24 |
| **Crítico** | 5 | 21 | 7 | 3 | 36 |
| **Total previsto** | 74 | 139 | 59 | 22 | 294 |

| Classe | Precisão | Recall | F1 |
| --- | --- | --- | --- |
| Baixo | 73,0% | 29,7% | 0,422 |
| Moderado | 17,3% | 46,2% | 0,251 |
| Alto | 8,5% | 20,8% | 0,120 |
| Crítico | 13,6% | 8,3% | 0,103 |
| **F1 macro** |  |  | **0,224** |

Precisão “—”: o modelo não previu nenhum foco naquela classe; nesse caso o F1 da classe é 0.

**Interpretação:** F1 macro de 0,270 (IRS v2), 0,189 (IRS v1), 0,224 (Linha de base); o desempenho por classe é heterogêneo e deve ser lido junto com a matriz de confusão.

## F. Escores contínuos e limiares calibrados

### F1. AUC (curva ROC)

Empates contam meio ponto (estatística de Mann–Whitney). Os escores de `porFoco` têm até 4 casas decimais: IRS v2 261 valores distintos (64 focos com escore repetido); IRS v1 233 valores distintos (108 focos com escore repetido); Linha de base 271 valores distintos (46 focos com escore repetido).

| Alvo | Positivos/negativos | AUC IRS v2 [IC 95%] | AUC IRS v1 [IC 95%] | AUC Linha de base [IC 95%] |
| --- | --- | --- | --- | --- |
| D2: ≥ 1 foco (SIM) × 0 | 112/182 | 0,589 [0,524; 0,654] | 0,536 [0,468; 0,601] | 0,581 [0,514; 0,644] |
| CRÍTICO × demais níveis (regra principal) | 36/258 | 0,550 [0,459; 0,642] | 0,519 [0,425; 0,618] | 0,569 [0,477; 0,658] |

Pares positivo–negativo empatados: D2: IRS v2 6/20384, IRS v1 23/20384, Linha de base 8/20384; CRÍTICO × demais níveis (regra principal): IRS v2 7/9288, IRS v1 13/9288, Linha de base 3/9288.

### F2. Limiares calibrados por quantis (na própria amostra)

Limiares escolhidos para que a proporção prevista de cada nível seja a da referência (182/52/24/36). Escores iguais ao limite ficam no nível de baixo, o que, com empates, desvia um pouco as contagens previstas das da referência.

| Modelo | Limiares (B\|M, M\|A, A\|C) | Previstos B/M/A/C | Acurácia | κ calibrado | κ com limiares atuais |
| --- | --- | --- | --- | --- | --- |
| IRS v2 | 0,4537; 0,5266; 0,5793 | 182/52/24/36 | 48,6% | 0,089 | 0,111 |
| IRS v1 | 0,1236; 0,1802; 0,3399 | 182/52/24/36 | 45,9% | 0,015 | 0,019 |
| Linha de base | 0,4735; 0,5493; 0,5987 | 182/52/24/36 | 48,0% | 0,095 | 0,114 |

### F3. Validação cruzada estratificada (5 partes)

Limiares estimados em 4 partes e aplicados na 5ª; partição estratificada pelo nível da referência, semente 20261025. “κ agregado” é calculado sobre as 294 previsões fora da amostra juntas.

| Modelo | κ por parte | κ médio (DP) | κ agregado | Acurácia agregada | κ calibrado na amostra (F2) |
| --- | --- | --- | --- | --- | --- |
| IRS v2 | −0,021; 0,092; 0,011; 0,176; 0,149 | 0,081 (0,085) | 0,086 | 48,6% | 0,089 |
| IRS v1 | −0,087; −0,071; −0,042; 0,215; 0,089 | 0,021 (0,129) | 0,020 | 45,2% | 0,015 |
| Linha de base | 0,004; 0,071; 0,032; 0,148; 0,157 | 0,082 (0,068) | 0,083 | 46,9% | 0,095 |

### F4. Faixas atuais e distribuição dos escores

Faixas atuais do IRS (sigmoide com k = 10 e μ = 0,5): sigmoide 0,25 → IRS ≈ 0,390; sigmoide 0,50 → IRS ≈ 0,500; sigmoide 0,75 → IRS ≈ 0,610. Ou seja: Baixo < 0,390 ≤ Moderado < 0,500 ≤ Alto < 0,610 ≤ Crítico. A linha de base usa os mesmos cortes diretamente no escore.

| Modelo | Mínimo | Q1 | Mediana | Q3 | Máximo | Níveis atuais B/M/A/C |
| --- | --- | --- | --- | --- | --- | --- |
| IRS v2 | 0,2706 | 0,3668 | 0,4313 | 0,4966 | 0,6736 | 91/130/59/14 |
| IRS v1 | 0,0738 | 0,0881 | 0,1028 | 0,1735 | 0,4786 | 282/12/0/0 |
| Linha de base | 0,2723 | 0,3894 | 0,4460 | 0,5202 | 0,7254 | 74/139/59/22 |

**Interpretação:** a AUC da v2 para propagação é 0,589 [0,524; 0,654], acima de 0,5 mas distante de uma separação forte; para o nível Crítico, o IC inclui 0,5. Ajustar os limiares para reproduzir as proporções da referência não aumenta o κ da v2 (0,111 com os limiares atuais; 0,089 calibrado na amostra; 0,081 em média fora da amostra), embora aumente a acurácia, por prever mais focos como Baixo.

