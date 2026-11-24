---
name: pr2-plano23-revisao-final
description: Revisão final do PR 2 do Plano 23 (agenda: locais, visões, filtros, impressão) - 0 Critical/Important; padrões que passaram e Minors novos (state fora do remount, GET form + Link, aria-label fora do rótulo)
metadata:
  type: feedback
---
Revisão final do branch (24/11/2026, 5ea37bd8 sobre main 58904ef): sem Critical/Important. Textos da spec §6.2 conferidos linha a linha
(MSG_LOCAIS, MSG_VISOES, legenda, impressão, Perfil, cabeçalho público): todos batem.

Padrões que o PR acertou (não reabrir): grade/lista dupla com `hidden md:table`/`md:hidden`; impressão em tabela única com `tfoot`
dentro de região `overflow-x-auto` com foco; `caption.sr-only` (nenhum `sr-only` solto em região rolável); links de visão por
`hrefDaAgenda`; foco no h1 + status por marcador `?r=` em Locais; só tokens `--nd-*` (bloqueio usa text-aviso sobre aviso-fundo, AA nos dois modos).

Minors novos:
1. Estado `useState` no pai de um formulário com `key={state.envio}` (RegraForm de Horários): depois do sucesso o select remonta com o
   principal, mas o estado do pai guarda o local escolhido antes - a caixa "Também atender por videoconferência" some/aparece
   desalinhada do select. Procurar `useState` fora do elemento que leva `key`.
2. Formulário GET de servidor (filtros.tsx) com `defaultValue` + link "Limpar filtros" (soft nav): campo editado e não enviado fica sujo e
   continua mostrando o valor, com a lista sem filtro. Corrige com `key` pelos filtros ativos nos dois forms.
3. `aria-label="Definir {nome} como principal"` não contém o texto visível "Definir como principal" (WCAG 2.5.3); os outros
   (Editar/Arquivar/Excluir/Reativar {nome}) contêm.
4. Guia `agenda` (versao 2) também aparece em Locais (padrao ampliado) mas fala de "Dia, semana ou lista" e os passos não têm alvo
   lá; guia `horarios` ainda diz "modalidade" (campo que saiu). Adiado para a T12 no ledger; vira defeito se o PR 2 for ao ar antes.
5. Chips de horário do portal (`SeletorHorarios`, py-1) ficam com ~34 px; os rádios de local ganharam min-h-11. Pré-existente.

**How to apply:** em tela de agenda/portal nova, conferir 1 e 2 (estado/DOM sujo) e se o guia citado ainda descreve os campos da tela.
