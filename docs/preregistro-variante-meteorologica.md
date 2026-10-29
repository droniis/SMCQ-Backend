# Pré-registro: variante meteorológica do IRS e amostra independente de outubro de 2026

Registrado em 29/10/2026, às 14h30, **antes** de baixar ou consultar qualquer dado de focos de outubro de 2026. O commit deste arquivo serve de comprovação da data. Nenhum item abaixo será alterado depois de observados os resultados. Se for preciso mudar algo por motivo técnico (por exemplo, falha de uma base de dados), a mudança será registrada em uma seção "Desvios do pré-registro", com o motivo, sem apagar o texto original.

## 1. Motivação

O artigo e o TCC recomendam incorporar ao índice variáveis meteorológicas e de comportamento do fogo, como os dias sem chuva, a precipitação, a potência radiativa do fogo (FRP) e o Risco de Fogo do INPE. Recomendam também avaliar qualquer recalibração em uma amostra independente, de outro período. A revisão do orientador de 26/10/2026 pediu que essa correção fosse testada. Este documento define o teste antes da coleta dos dados.

## 2. O que **não** muda

- `services/riscoService.js` (pesos e fórmulas do IRS v2), `scripts/validacao/`, `data/validacao/`, `docs/validacao-irs.md` e `docs/irs-v2.md` não são alterados. O IRS v2 usado no sistema continua o mesmo.
- As variantes abaixo existem só nos scripts de análise (`scripts/analises/`) e **não** passam a ser usadas pelo sistema.

## 3. Variantes avaliadas

Todas partem do escore contínuo do IRS v2 (soma ponderada dos nove critérios, antes da sigmoide), calculado exatamente como na validação principal.

**IRS-M (variante meteorológica).**

IRS-M = 0,75 × IRS v2 + 0,25 × RF

- RF é o Risco de Fogo do INPE informado no próprio registro do foco (campo `RiscoFogo`, entre 0 e 1). Pelo método do INPE (Setzer; Sismanoglu; Santos, 2019), ele já combina os dias sem chuva, a precipitação, a temperatura, a umidade relativa e o tipo de vegetação. Por isso, os dias sem chuva e a precipitação **não** entram como critérios separados, o que evita contá-los duas vezes.
- O peso de 0,25 foi escolhido para que o fator meteorológico seja o maior critério isolado do índice. Os pesos do IRS v2 são multiplicados por 0,75; o maior deles, o bioma, passa de 0,20 para 0,15. A soma dos pesos continua igual a 1.
- Sem RF no registro (valor ausente ou negativo), usa-se 0,5, e a quantidade desses casos é relatada.

**IRS-MF (variante meteorológica com intensidade do fogo).**

IRS-MF = 0,65 × IRS v2 + 0,25 × RF + 0,10 × F

- F = min(1, ln(1 + FRP) / ln(1 + 500)), com o FRP em MW, do próprio registro (intensidade no momento da detecção, informação disponível no dia 0).
- Como o FRP passa a ser entrada, o IRS-MF é avaliado **apenas** com a referência de propagação, e não com a referência baseada no FRP.

**Classificação.** O escore de cada variante passa pela mesma sigmoide e pelos mesmos limites do IRS v2: S = 1/(1 + e^(−10·(escore − 0,5))); Baixo < 0,25 ≤ Moderado < 0,50 ≤ Alto < 0,75 ≤ Crítico. Os limites não são recalibrados.

**Comparações.** IRS v2, linha de base (média simples dos nove critérios, como na validação principal), IRS-M e IRS-MF.

## 4. Amostra independente (outubro de 2026)

O procedimento é o mesmo da validação principal, mudando só o período:

- satélite de referência AQUA_M-T;
- focos com dia de detecção entre 01/10/2026 e 21/10/2026. O último dia é o que permite observar os 7 dias seguintes com os dados publicados pelo INPE até 28/10/2026;
- sorteio estratificado com a mesma semente (20261025) e os mesmos estratos (Amazônia, Cerrado, Pantanal, Mata Atlântica, Caatinga, Pampa e o estrato de até 50 km das 10 cidades), com 43 focos por estrato; o estrato com menos focos entra inteiro;
- os mesmos critérios aproximados (área, evolução temporal, pessoas em risco, vento pelo Open-Meteo e escala de Beaufort, bioma, áreas protegidas e fauna pelas mesmas bases públicas);
- a mesma referência principal (outros focos a até 10 km nos 7 dias seguintes; 0 = Baixo; 1–2 = Moderado; 3–5 = Alto; 6 ou mais = Crítico), mantendo os cortes da validação principal, sem novos tercis;
- a segunda referência: FRP acima da mediana da amostra de outubro.

Os dados de outubro ficam em `data/analises/outubro/`, separados dos de agosto e setembro.

## 5. Métricas e critério de decisão

- Kappa ponderado quadrático, acurácia, recall e precisão da classe Crítico, F1 macro, AUC da propagação (com × sem detecção posterior) e, para o IRS-M, a correlação de Spearman e a AUC com o FRP.
- Intervalos de confiança de 95% por bootstrap percentil com 2.000 réplicas e semente 20261025. As diferenças são pareadas (mesmos registros em cada réplica), por registro e por dia de detecção.
- **Critério principal, definido agora:** a variante meteorológica será considerada uma melhora se, na amostra de outubro, a diferença de kappa ponderado **IRS-M − IRS v2** tiver intervalo de confiança de 95% inteiramente acima de zero no bootstrap por registro. O mesmo critério é aplicado ao IRS-MF e também à comparação com a linha de base.
- Como análise secundária, as variantes também são calculadas na amostra de agosto e setembro. Esse resultado é apenas descritivo, porque a escolha das variáveis foi motivada por análises dessa amostra.

## 6. Compromissos de relato

- Todos os resultados acima serão relatados no artigo e no TCC, favoráveis ou não, inclusive o desempenho do IRS v2 na amostra de outubro.
- Os pesos das variantes não serão ajustados depois de observados os resultados.
- A comparação com a área queimada mapeada não faz parte deste teste e continua como trabalho futuro.
