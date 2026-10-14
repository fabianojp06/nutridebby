# Ramo `status-report`

Ramo isolado (sem o código do app; nunca é mesclado na `main`) com os scripts do
status report diário do NutriDebby, usados pela rotina na nuvem do Claude Code
("Status report diário NutriDebby", todo dia às 06h de Brasília):

- `coletar_metricas.py` — métricas reais (git da `main`, `gh api` REST, `/api/health`, backlog do repositório).
- `gerar_status_report_pdf.py` — PDF A4 com ReportLab e fontes padrão (≈ 20–30 KB, anexado ao e-mail).
- `exemplo_dados_status.json` — formato dos dados que o gerador recebe.

Push neste ramo não dispara CI nem deploy (o CI roda em PR; o deploy, em push na `main`).
Cópia dos arquivos no Drive: statusReportNutriDebby › gerador.
