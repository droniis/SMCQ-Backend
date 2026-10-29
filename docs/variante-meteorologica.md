# Variante meteorológica do IRS: amostra independente de outubro de 2026

Teste definido em [`preregistro-variante-meteorologica.md`](preregistro-variante-meteorologica.md) (29/10/2026), antes da coleta dos dados de outubro. Gerado por `scripts/analises/analise-variante-meteorologica.js` em 2026-10-29. Os pesos do IRS v2 não foram alterados.

- **IRS-M** = 0,75 × IRS v2 + 0,25 × Risco de Fogo do INPE
- **IRS-MF** = 0,65 × IRS v2 + 0,25 × Risco de Fogo + 0,10 × F(FRP), com F = min(1, ln(1 + FRP)/ln(501)); não é avaliado contra o FRP
- Mesma sigmoide e mesmos limites do IRS v2; bootstrap percentil com 2000 réplicas e semente 20261025

## 1. Amostra de outubro (principal)

244 focos, 20 dias de detecção (2026-10-01 a 2026-10-21), de 21682 elegíveis do AQUA_M-T. Referência (0 | 1–2 | 3–5 | 6+ focos a até 10 km nos 7 dias seguintes): BAIXO 140 · MODERADO 42 · ALTO 32 · CRITICO 30. Risco de Fogo ausente em 1 focos (usado 0,5). Geodados com valor de reserva em 0 focos.

| Métrica | IRS v2 | Linha de base | IRS-M | IRS-MF |
|---|---|---|---|---|
| Kappa ponderado | -0,003 [-0,107; 0,108] | -0,028 [-0,133; 0,079] | 0,131 [0,054; 0,209] | 0,156 [0,084; 0,232] |
| Acurácia | 25,8% [20,1%; 31,6%] | 24,2% [18,9%; 29,5%] | 23,0% [17,6%; 28,3%] | 23,4% [17,6%; 28,7%] |
| F1 macro | 0,201 | 0,203 | 0,206 | 0,207 |
| Recall de Crítico | 6,7% | 6,7% | 13,3% | 16,7% |
| Precisão de Crítico | 10,5% | 9,5% | 11,1% | 13,2% |
| AUC propagação | 0,545 [0,469; 0,617] | 0,523 [0,448; 0,596] | 0,616 [0,542; 0,686] | 0,635 [0,564; 0,702] |
| Spearman com o FRP | -0,049 [-0,178; 0,077] | -0,020 [-0,149; 0,117] | 0,175 [0,045; 0,301] | — |
| AUC FRP > mediana (13,65 MW) | 0,456 [0,386; 0,531] | 0,470 [0,398; 0,545] | 0,554 [0,481; 0,627] | — |

Níveis previstos (Baixo/Moderado/Alto/Crítico): IRS v2 75/112/38/19 · Linha de base 67/110/46/21 · IRS-M 31/48/129/36 · IRS-MF 31/32/143/38.

### Diferenças pareadas

| Diferença | Δ kappa [IC por registro] | IC por dia | Δ AUC propagação [IC por registro] |
|---|---|---|---|
| IRS-M − IRS v2 | 0,134 [0,035; 0,241] | [-0,051; 0,287] | 0,071 [0,010; 0,135] |
| IRS-MF − IRS v2 | 0,159 [0,050; 0,275] | [-0,057; 0,347] | 0,090 [0,023; 0,164] |
| IRS-M − Linha de base | 0,159 [0,063; 0,257] | [-0,001; 0,305] | 0,094 [0,033; 0,157] |
| IRS-MF − Linha de base | 0,184 [0,076; 0,291] | [-0,003; 0,367] | 0,112 [0,043; 0,186] |

### Critério principal (pré-registrado)

- IRS-M − IRS v2: Δκ = 0,134 [0,035; 0,241] → atende ao critério (IC inteiramente acima de zero).
- IRS-MF − IRS v2: Δκ = 0,159 [0,050; 0,275] → atende ao critério (IC inteiramente acima de zero).
- IRS-M − linha de base: Δκ = 0,159 [0,063; 0,257] → atende ao critério (IC inteiramente acima de zero).
- IRS-MF − linha de base: Δκ = 0,184 [0,076; 0,291] → atende ao critério (IC inteiramente acima de zero).

## 2. Amostra de agosto e setembro (secundária, descritiva)

As variáveis das variantes foram escolhidas depois das análises desta amostra; por isso, este resultado não testa a variante, só descreve o seu comportamento nos mesmos 294 focos da validação principal.

| Métrica | IRS v2 | Linha de base | IRS-M | IRS-MF |
|---|---|---|---|---|
| Kappa ponderado | 0,111 [0,009; 0,209] | 0,114 [0,019; 0,210] | 0,140 [0,080; 0,204] | 0,120 [0,064; 0,180] |
| Acurácia | 35,0% [29,6%; 40,8%] | 29,3% [24,1%; 34,7%] | 19,0% [14,6%; 23,8%] | 17,7% [13,6%; 22,4%] |
| F1 macro | 0,270 | 0,224 | 0,183 | 0,169 |
| Recall de Crítico | 8,3% | 8,3% | 27,8% | 27,8% |
| Precisão de Crítico | 21,4% | 13,6% | 14,9% | 13,3% |
| AUC propagação | 0,589 [0,524; 0,654] | 0,581 [0,514; 0,644] | 0,603 [0,537; 0,668] | 0,611 [0,545; 0,676] |
| Spearman com o FRP | 0,141 [0,029; 0,249] | 0,146 [0,039; 0,256] | 0,203 [0,092; 0,309] | — |
| AUC FRP > mediana (17,85 MW) | 0,580 [0,512; 0,648] | 0,577 [0,512; 0,646] | 0,599 [0,534; 0,666] | — |

| Diferença | Δ kappa [IC por registro] | IC por dia | Δ AUC propagação [IC por registro] |
|---|---|---|---|
| IRS-M − IRS v2 | 0,029 [-0,052; 0,110] | [-0,056; 0,121] | 0,013 [-0,034; 0,057] |
| IRS-MF − IRS v2 | 0,009 [-0,076; 0,090] | [-0,080; 0,106] | 0,022 [-0,031; 0,069] |
| IRS-M − Linha de base | 0,026 [-0,046; 0,103] | [-0,047; 0,108] | 0,022 [-0,025; 0,067] |
| IRS-MF − Linha de base | 0,007 [-0,073; 0,085] | [-0,069; 0,089] | 0,031 [-0,020; 0,078] |
