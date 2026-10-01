# Fontes dos dados de alimentos

| Arquivo | Origem | sha256 |
|---|---|---|
| `Taco_4a_edicao_2011.xls` | TACO — Tabela Brasileira de Composição de Alimentos, 4ª ed. revisada e ampliada, NEPA/UNICAMP, 2011. Planilha original, obtida do espelho `raulfdm/taco-api` no commit `06e466ad2f3d76064b587808b1804564b2c40f67` (`references/original-Taco_4a_edicao_2011.xls`) | `b7369a767b14bfe06ff9973957c140b266f9bb7932f870481ef2d99ba0a15ace` |
| `ibge-tabelamedidas_bd.zip` | IBGE — Pesquisa de Orçamentos Familiares 2008–2009: *Tabela de Medidas Referidas para os Alimentos Consumidos no Brasil* (`ftp.ibge.gov.br/Orcamentos_Familiares/Pesquisa_de_Orcamentos_Familiares_2008_2009/Tabela_de_Medidas_Referidas_para_os_Alimentos_Consumidos_no_Brasil/tabelamedidas_bd.zip`) | `3d0ff06acf0b55c22a621f57e6fb218d4505af204ed2be1571bfbe02fbab17c9` |

A TACO pode ser reproduzida desde que citada a fonte: o sistema mostra "TACO 4ª ed. — NEPA/UNICAMP" na tela de alimentos e no rodapé do PDF (INT-04).

- `../taco-4ed.csv` e `../../drizzle/0039_seed_taco.sql` são **gerados** por `pnpm seed:taco`. Não edite à mão: o teste `src/modules/alimentos/taco-fonte.test.ts` refaz os dois a partir da planilha e falha se diferirem.
- `../medidas-ibge.csv` é **curadoria manual** (P-10): cada linha cita a descrição exata do IBGE (coluna "DESCRIÇÃO DO ALIMENTO NA REFERÊNCIA") e os gramas; o teste `medidas-fonte.test.ts` confere cada linha contra a planilha do IBGE. Para ampliar (lista da Debby, E-08): acrescentar linhas, rodar `pnpm drizzle-kit generate --custom --name medidas_ibge_<n>` e `pnpm seed:medidas <arquivo-da-migration>`.
