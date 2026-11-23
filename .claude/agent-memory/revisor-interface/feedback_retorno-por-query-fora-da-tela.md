---
name: retorno-por-query-fora-da-tela
description: Retorno de ação levado por ?param= depois do redirect aparece no fim de uma página longa (Eu) — o redirect leva ao topo e a região viva nasce preenchida
metadata:
  type: feedback
---
Quando uma Server Action (ou um link "Agora não") volta para uma página longa com `?param=` e a mensagem fica no meio ou no fim dela, o paciente não vê nada: a navegação leva ao **topo**, e o `role="status"` montado já com o texto não é anunciado.

**Why:** visto na T8 do Plano 14A (09/10/2026). "Autorizo" → `/p/perfil?ia=autorizou`; a mensagem "Autorização registrada…" fica no cartão Privacidade, abaixo de cinco cartões de Eu. O brief trazia o código assim, e o teste de HTML (`toContain`) passa.

**How to apply:** em todo `redirect('/x?ok=…')` confira onde a mensagem aparece. Se não for no topo, peça `#ancora` no destino e foco no status (`tabIndex={-1}` + `useEffect`, molde `ConfirmarNoMural`), além de `toBeInViewport` no E2E. Ver [[mensagem-sucesso-desmontada]] e [[live-region-e-avisos-de-estado]].

No painel, T7 do Plano 14A (09/10/2026): `router.push('/…/privacidade?ia=papel')` mostra "Termo registrado…" na seção "Uso de IA", a uns 400 px do topo do segmento. Ficou Minor porque o texto está à vista num notebook, mas continua sem anúncio. Também fica preso na URL: aparece ao lado de "Retirou em…" depois de uma retirada.

Painel, T7 do Plano 20 (17/11/2026): seção "Cobrança" da consulta (`/painel/agenda/consultas/[id]`) volta com `?ok=cobranca_*` e a mensagem cai no `Aviso` do topo, acima de "Registrar presença"; o botão que a pessoa tocou (Marcar como recebido, Registrar cobrança) some com o `key` da seção e o foco vai ao body. A spec §7 exige região `role="status"` sempre montada + foco no h1/título depois de salvar (`Mensagens` de `financeiro/mensagens.tsx`), mas vale só para as telas do Financeiro: o reuso de componentes do Financeiro dentro de outra tela (agenda) perde a região e o foco.
