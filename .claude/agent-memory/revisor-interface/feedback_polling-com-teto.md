---
name: polling-com-teto
description: Erro recorrente — polling de estado (leitura da IA, PDF) com teto fixo curto deixa a tela presa em "carregando" quando a fila do worker demora mais
metadata:
  type: feedback
---
Ao revisar componente que consulta o estado de um job e dá `router.refresh()` quando muda, comparar o teto do polling com o pior caso real da fila (concorrência do `boss.work`, retries com backoff, expiração do job).

**Why:** na revisão final do Plano 11 (07/10/2026), `EstadoIa` parava depois de 60 × 3 s (3 min), mas a fila `ia` roda um job por vez para todos os consultórios e repete 429/500/529 com backoff de 30–120 s; a tela ficava em "Lendo o laudo… isso leva até 1 minuto." sem nunca mostrar o resultado nem anunciar nada.

**How to apply:** procurar `setInterval`/contador com teto em componentes de estado; se o teto for menor que o prazo em que o job ainda pode terminar (ex.: o `expirar-ia` de 30 min), é Important. Correção: continuar com intervalo maior até o prazo do job, sem texto novo. Ver [[live-region-e-avisos-de-estado]].
