# Segunda referência (FRP) e dados para figuras

- **Data de execução:** 2026-10-27
- **Semente:** 20261025 · **Reamostragens:** 2000 (as mesmas da validação); IC 95% pelo método percentil
- **Pesos do IRS:** não alterados. Escores de `data/validacao/resultados.json` (`porFoco`); FRP e Risco de Fogo de `data/validacao/amostra.csv` (somente leitura).
- **Gerado por:** `node scripts/analises/analises-frp.js` → `data/analises/analises-frp.json` e `data/analises/figuras-dados.json`

## A. FRP como segunda referência

A potência radiativa do fogo (FRP, em MW) vem do próprio registro do INPE e existe para os 294 focos. Distribuição: mínimo 3,5, Q1 9,6, mediana 17,9, Q3 40,5, máximo 454,5 MW.

### A1. Correlação de Spearman entre o escore e o FRP

| Modelo | ρ [IC 95%] por registro | IC 95% por dia |
| --- | --- | --- |
| IRS v2 | 0,141 [0,029; 0,249] | [-0,018; 0,286] |
| IRS v1 | 0,084 [-0,026; 0,194] | [-0,062; 0,226] |
| Linha de base | 0,146 [0,039; 0,256] | [-0,006; 0,283] |

### A2. AUC para FRP elevado

**FRP acima da mediana (> 17,85 MW)** — 147 positivos / 147 negativos

| Medida | Valor [IC 95%] por registro | IC 95% por dia |
| --- | --- | --- |
| AUC IRS v2 | 0,580 [0,512; 0,648] | [0,490; 0,664] |
| AUC IRS v1 | 0,549 [0,483; 0,617] | [0,458; 0,638] |
| AUC Linha de base | 0,577 [0,512; 0,646] | [0,490; 0,660] |
| Δ AUC IRS v2 − Linha de base | 0,003 [-0,015; 0,019] | [-0,022; 0,023] |
| Δ AUC IRS v2 − IRS v1 | 0,031 [-0,023; 0,086] | [-0,053; 0,104] |

**FRP no quartil superior (> 40,475 MW)** — 74 positivos / 220 negativos

| Medida | Valor [IC 95%] por registro | IC 95% por dia |
| --- | --- | --- |
| AUC IRS v2 | 0,544 [0,477; 0,611] | [0,447; 0,637] |
| AUC IRS v1 | 0,507 [0,430; 0,583] | [0,426; 0,587] |
| AUC Linha de base | 0,546 [0,475; 0,616] | [0,453; 0,637] |
| Δ AUC IRS v2 − Linha de base | -0,003 [-0,022; 0,017] | [-0,020; 0,014] |
| Δ AUC IRS v2 − IRS v1 | 0,037 [-0,031; 0,105] | [-0,040; 0,112] |

### A3. Concordância entre as duas referências

ρ de Spearman entre o FRP e a contagem da referência principal (10 km, 7 dias): 0,159 [0,047; 0,267]. AUC do FRP para a referência binária de propagação: 0,588 [0,523; 0,653].

**Interpretação:** com o FRP como referência, o IRS v2 tem ρ = 0,141 e AUC = 0,580 [0,512; 0,648] para FRP acima da mediana; a diferença para a linha de base é 0,003 [-0,015; 0,019], com IC que inclui zero.

## B. Risco de Fogo do INPE (comparação descritiva)

O Risco de Fogo calculado pelo INPE acompanha o registro de cada foco; não é entrada do IRS. Focos com valor válido: 288 (sem valor: 6). ρ de Spearman com o IRS v2: -0,035.

| Alvo | Positivos/negativos | AUC Risco de Fogo [IC 95%] | AUC IRS v2, mesmos focos [IC 95%] |
| --- | --- | --- | --- |
| Propagação (≥ 1 detecção a ≤ 10 km nos 7 dias seguintes) | 110/178 | 0,589 [0,526; 0,646] | 0,595 [0,530; 0,657] |
| FRP acima da mediana | 143/145 | 0,579 [0,516; 0,640] | 0,577 [0,510; 0,643] |

**Interpretação:** comparação apenas descritiva, para situar o IRS diante de um índice meteorológico consolidado; não houve ajuste do IRS.

## C. Método do IC da AUC e diferença de kappa na referência binária

- IC da AUC (G1, item F1, e esta análise): bootstrap percentil 95%, 2000 réplicas, semente 20261025, reamostrando registros com reposição (o mesmo usado na G1, item F1).
- Diferença de kappa de Cohen IRS v2 − linha de base na referência binária (G1, item D2): 0,033 [-0,025; 0,092] — o IC inclui zero: as duas não são distinguíveis.

## D. Acurácias sem arredondamento

| Modelo | Acertos | Acurácia |
| --- | --- | --- |
| IRS v2 | 103/294 | 35,03% |
| IRS v1 | 175/294 | 59,52% |
| Linha de base | 86/294 | 29,25% |

Diferenças: IRS v2 − linha de base = 5,78 p.p. (arredondada: 5,8); IRS v2 − IRS v1 = -24,49 p.p. A diferença é calculada sobre os valores não arredondados; subtrair as acurácias já arredondadas (35,0% − 29,3%) dá 5,7.

## E. Dados para figuras

`data/analises/figuras-dados.json` traz os pontos das curvas ROC (IRS v2, IRS v1 e linha de base) para a referência de propagação e para FRP acima da mediana, a área de cada curva pela regra do trapézio (igual à AUC de Mann–Whitney) e os 294 escores do IRS v2 e da linha de base, com os limites atuais 0,390 / 0,500 / 0,610.
