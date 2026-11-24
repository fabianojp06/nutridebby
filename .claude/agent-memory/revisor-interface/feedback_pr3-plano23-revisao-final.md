---
name: pr3-plano23-revisao-final
description: Revisão final do PR 3 do Plano 23 (solicitações, aniversariantes, retorno) - 0 Critical, 3 Important; correções que o branch empilhado deixou no PR seguinte (sr-only relative, EXCECOES do SUS-108), consentimento do portal sem anúncio
metadata:
  type: feedback
---
Revisão final do PR 3 (24/11/2026, tip cc5fde0d, worktree de leitura sobre plano-23-pr2). Textos da §6.2 (Solicitações, Horários, Aniversariantes,
portal, página pública, saída, e-mails) conferidos: todos batem. Padrões que passaram (não reabrir): Dialogo com foco inicial em "Voltar"/"Cancelar",
`redirect` com `?ok=` de lista fechada em vez de erro dentro do Dialogo (I-1/I-2 da T8), chave de Horários com marcador/aria-disabled,
remount do estado por mudança de searchParams (a página do Next é chaveada por query: `marcados` e o Dialogo aberto somem depois do redirect).

1. **Branch empilhado: correção de lente no PR de cima.** O PR 3 foi cortado em cc5fde0d, mas dois commits que ele precisa ficaram na faixa do PR 4:
   2597def5 (`relative overflow-x-auto` em aniversariantes/selecao.tsx: o `sr-only` absolute do th "Ações" esticava a página a 360 px) e a entrada de
   EXCECOES de selecao.tsx em `src/app/formularios-reset.test.ts` (veio no dc92253a). Sem eles, o E2E de axe a 360 px ("rola na horizontal") e a guarda
   SUS-108 (`<input checked>` controlado com `<form action={fn}>` sem ref) falham no PR 3 isolado. **How to apply:** ao revisar um PR cortado de um branch
   maior, procure `git log base..branch-completo -- <arquivos do PR>`: correção posterior de arquivo do PR deve estar nele.
2. Bloco de consentimento do portal (`perfil/aniversario.tsx`): `<form><button>` de "Autorizar" e de "Retirar autorização" são o mesmo elemento no
   mesmo lugar (o React atualiza no lugar, o foco fica); a situação ("Autorizado em…") é um `<p>` sem `role="status"`: leitor de tela não ouve a
   confirmação (WCAG 4.1.3). Correção barata: `role="status"` no parágrafo da situação (já está montado). `disabled={pendente}` no botão focado.
3. Minors: tabela de Aniversariantes sem `caption` e, a 360 px, rolagem interna com min-w-640 (a §7 pede lista de cartões < 768 px; a coluna Ações fica
   fora da tela); guia `agenda` v3 e `horarios` v2 não falam de Solicitações/Aniversariantes/chave (T12, no PR 4: vira defeito se o PR 3 for ao ar antes);
   `AvisoDaLista` vazio (`<p role=status>`) soma 24 px de `space-y-6` no topo de Minhas consultas; "Pedido enviado" da página pública entra já com o
   texto num `role=status` e o botão focado some (igual ao `pronto` antigo).
