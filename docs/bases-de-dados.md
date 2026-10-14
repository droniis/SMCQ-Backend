# Bases de dados externas

Bases públicas consultadas pelo SMCQ (backend, frontend e scripts de validação). Na coluna de licença consta **somente** o que está declarado na página oficial de cada base, consultada em 14/10/2026. Onde a página oficial não declara uma licença ou um termo de uso, consta **"verificar"**. Informações obtidas apenas em fontes secundárias, como listas de discussão, não foram consideradas.

## Bases usadas no cálculo de risco (backend)

| Base | Link | Dado usado | Forma de acesso | Licença / condição de uso |
| :--- | :--- | :--- | :--- | :--- |
| IBGE: Biomas do Brasil (1:250.000) | https://geoservicos.ibge.gov.br/geoserver/ows | Bioma do ponto (camada `CREN:lm_bioma_250`) | WFS 1.0.0 (GeoServer), consulta `INTERSECTS` ao ponto; `services/geodadosService.js` | **verificar**: a página do serviço não declara licença |
| ICMBio: Limites das Unidades de Conservação federais, publicados pela INDE | https://geoservicos.inde.gov.br/geoserver/ICMBio/ows | UC que contém o ponto (nome, categoria, esfera) e faixa de distância à UC mais próxima (camada `ICMBio:limiteucsfederais_a`) | WFS 1.0.0 (GeoServer), consultas `INTERSECTS` e `DWITHIN` (10 e 50 km) | **verificar**: o portal da INDE (https://inde.gov.br/) não traz licença nem termo de uso dos dados, apenas a nota "© 2026 Infraestrutura Nacional de Dados Espaciais - INDE" |
| FUNAI: Terras Indígenas | https://geoserver.funai.gov.br/geoserver/Funai/ows | TI que contém o ponto (nome, etnia, área, fase) e faixa de distância à TI mais próxima (camada `Funai:tis_poligonais`) | WFS 1.0.0 (GeoServer), consultas `INTERSECTS` e `DWITHIN` (10 e 50 km) | **verificar**: a página do serviço não declara licença |
| GBIF: Global Biodiversity Information Facility | https://api.gbif.org/v1/occurrence/search | Número de espécies animais com ocorrência a até 50 km, por categoria da Lista Vermelha da IUCN (CR, EN, VU) | API REST pública, sem chave, com agregação por espécie (`facet=scientificName`) | Cada conjunto de dados de ocorrência tem uma de três licenças atribuídas pelo publicador: **CC0** ("no conditions for use"), **CC BY** ("use with attribution") ou **CC BY-NC** ("non-commercial use with attribution"). A citação é esperada mesmo sob CC0 ("attribution is expected"). Fonte: documentação oficial do GBIF (https://docs.gbif.org/course-introduction-to-gbif/en/principles-of-gbif-mediated-data.html). A página https://www.gbif.org/terms recusou o acesso automatizado (HTTP 403) e deve ser conferida manualmente |
| INPE: Programa Queimadas (focos de calor diários) | https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/ | Focos de calor dos últimos 7 dias a até 50 km do ponto (exibição; não entram no IRS) | Download dos CSVs diários (HTTPS), com cache em memória e aquecimento em segundo plano | **verificar**: o servidor de arquivos e o portal do Programa Queimadas (https://terrabrasilis.dpi.inpe.br/queimadas/portal/) não declaram licença nem forma de citação |

## Bases usadas na validação do IRS (scripts)

| Base | Link | Dado usado | Forma de acesso | Licença / condição de uso |
| :--- | :--- | :--- | :--- | :--- |
| INPE: Programa Queimadas (focos de calor mensais) | https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/ | Focos de 07, 08 e 09/2026: amostra, proxies do dia 0 e gabarito | Download dos CSVs mensais (`scripts/validacao/coletar-dados.js`); URL, data e SHA-256 em `data/validacao/bruto/fontes.json` | **verificar** (como acima) |
| Open-Meteo: Historical Weather API | https://archive-api.open-meteo.com/v1/archive | Velocidade máxima e direção dominante do vento a 10 m no dia do foco | API REST pública, sem chave, com cache em disco (`data/validacao/cache/open-meteo.json`) | "API data are offered under Attribution 4.0 International (**CC BY 4.0**)", com a exigência: "You must include a link next to any location Open-Meteo data are displayed" (https://open-meteo.com/en/licence). A página de licença não trata de uso comercial ou não comercial da API gratuita |

## Bases usadas pelo frontend (mapa e endereço)

| Base | Link | Dado usado | Forma de acesso | Licença / condição de uso |
| :--- | :--- | :--- | :--- | :--- |
| OpenStreetMap: dados e mapa base | https://tile.openstreetmap.org | Imagens (tiles) do mapa base | Leaflet, direto do navegador | Dados: "licensed under the Open Data Commons Open Database License (**ODbL**)", com crédito obrigatório ("Provide credit to OpenStreetMap by displaying our attribution notice") (https://www.openstreetmap.org/copyright). Tiles: a Tile Usage Policy exige a atribuição visível no mapa e veda o uso pesado (https://operations.osmfoundation.org/policies/tiles/). O SMCQ exibe a atribuição no canto do mapa |
| Nominatim (OSM Foundation) | https://nominatim.openstreetmap.org | Endereço ↔ coordenadas (reserva do Photon) | API REST pública, chamada só em ações do usuário | Usage Policy: "an absolute maximum of 1 request per second", identificação da aplicação por Referer ou User-Agent, atribuição visível e cache dos resultados (https://operations.osmfoundation.org/policies/nominatim/). Dados sob a ODbL do OpenStreetMap |
| Photon (komoot) | https://photon.komoot.io | Endereço ↔ coordenadas | API REST pública, chamada só em ações do usuário | "You can use the API for your project, but please be fair - extensive usage will be throttled" e "We do not guarantee for the availability" (https://photon.komoot.io/). Licença dos dados: **verificar**, pois a página não declara |
| ViaCEP | https://viacep.com.br/ws | CEP → logradouro, bairro, município e UF | API REST pública, sem chave | A página não traz licença. Declara: "Uso massivo para validação de bases de dados locais, poderá automaticamente bloquear seu acesso por tempo indeterminado" e "Não distribuímos ou comercializamos bases de dados" (https://viacep.com.br/). Licença: **verificar** |

## Observações

- **Uso sem chave e com cautela:** nenhuma das bases exige chave de acesso. As consultas usam tempo limite e cache (1 h no backend; em disco na validação) para respeitar os limites de uso. O frontend chama os serviços de endereço apenas em ações do usuário.
- **Pendências "verificar" nas bases governamentais:** para IBGE, ICMBio/INDE, FUNAI e INPE, recomenda-se confirmar a licença ou o termo de uso com cada órgão antes da entrega final, ou registrar no TCC que se trata de dados públicos de órgãos federais, citados como fonte conforme a ABNT.
- **Fallback:** quando uma base não responde, o sistema usa um valor de reserva e registra a fonte efetivamente usada em `geodados.fontes` (por exemplo, `fallback-centroides`).
