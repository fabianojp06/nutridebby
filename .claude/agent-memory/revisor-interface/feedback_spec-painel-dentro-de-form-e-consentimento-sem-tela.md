---
name: spec-painel-dentro-de-form-e-consentimento-sem-tela
description: Erros recorrentes em spec de função de IA nova (21B, 24/11/2026) — painel de ação dentro de form useActionState; aditivo/consentimento novo sem tela de aceite; "nada é gravado" enganoso; guia v+1 para função opt-in
metadata:
  type: feedback
---
1. Painel com botões, input de arquivo e caixas dentro de um `<form action={useActionState}>` existente: `Botao` não tem `type`, então tudo vira submit (Enter em campo numérico dispara o primeiro botão); `<input name=...>` de arquivo vai no corpo da server action (sem `bodySizeLimit` no `next.config.ts`, o padrão é 1 MB). Exigir da spec o contrato: `type="button"`, sem `name`, só campos ocultos no FormData, estado no pai (o `Campos` remonta por `key={state.envio}`).
2. Aditivo/autorização com versão nova e mínimo mantido: conferir se existe tela para aceitar. `ia-secao.tsx` só mostra "Aceitar a versão atual" em `nao_ativada`/`aditivo_desatualizado` (mínimo geral); `perfil/ia/page.tsx` faz `redirect` se a autorização está `vigente`. Spec que mexe só em `src/modules/ia/**` deixa a função morta.
3. PR de texto legal que entra antes da função ligada (merge = deploy) expõe o pedido ao paciente: gating por `liberada`.
4. Texto "Nada é gravado até salvar" quando o arquivo já foi gravado e enviado ao provedor.
5. Guia: subir `versao` por função opt-in reabre o tour de todos (precedente: Plano 11, 14B-2, D20 não subiram).
6. Texto reaproveitado do molde que presume campo editável ("Edite o valor") em tela sem campo.

**Why:** revisão da spec do Plano 21B (leitura do relatório da balança), 24/11/2026: 16 Important, 0 Critical.

**How to apply:** em spec de função de IA ou de painel que se encaixa em formulário existente, ler o `<form>` real, `botao.tsx`, `ia-secao.tsx`, `perfil/ia/page.tsx` e `conteudo.ts` antes de aceitar a afirmação "reaproveita o molde". Ver [[live-region-e-avisos-de-estado]] e [[guia-estatico-x-estado-do-consultorio]].
