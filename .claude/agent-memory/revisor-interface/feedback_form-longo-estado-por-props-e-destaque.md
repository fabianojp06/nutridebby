---
name: form-longo-estado-por-props-e-destaque
description: Erros de interface do formulário de cadastro em seções (Plano 18, T7a) — text-destaque como cor de link, estado controlado reiniciado por identidade de prop, formulário longo sem foco no primeiro erro, alvos abaixo de 44 px
metadata:
  type: feedback
---
1. `text-destaque` é a cor da marca "sempre a original, fundo com texto branco nos dois modos" (globals.css). Como cor de TEXTO de link
   no cartão escuro ela não chega a AA. O token de link é `text-link` (`--nd-link`, tem valor claro e escuro). Um axe só pega isso
   com o estado de erro aberto (o link do CPF repetido), então o E2E padrão não vê.
2. Padrão `if (valoresVistos !== v) { setX(v.x) }` com `v = state.valores ?? inicial`: `inicial` vem do servidor e ganha identidade
   nova a cada refresh do RSC (Etiquetas e "Reenviar convite" na mesma página fazem `revalidatePath`). Campo CONTROLADO (a Observação,
   texto livre de até 1.000 caracteres) volta ao valor salvo e o digitado se perde, enquanto os campos não controlados mantêm o
   digitado. Comparar por conteúdo ou só reiniciar quando `state.valores` mudar.
3. Formulário de 25 campos com `noValidate` e erro só do servidor, sem foco no primeiro erro nem aviso perto do botão: é o
   [[erro-longe-do-botao]] de novo. Procure `useEffect` com `focus()` em `[aria-invalid]` ou um resumo `role="alert"` junto do botão.
4. Contador de caracteres sem região viva: o plano pede "região viva montada antes do texto". Anunciar a cada tecla atrapalha;
   o certo é região sempre montada que só troca o texto em limiar (ex.: 900 e acima do limite).
5. Alvos de 44 px: o `Campo` compartilhado (`src/components/campo.tsx`) tem `p-2` sem `min-h-11` (42 px) e as caixas de marcar do
   WhatsApp ficam em `flex items-start` sem `min-h-11`; o implementador pôs `min-h-11` nos rádios e nos selects e esqueceu o resto.

**Why:** achados da revisão da T7a do Plano 18 (17/11/2026), commit f9bbd26.

**How to apply:** em formulário novo, grep `text-destaque` fora de `bg-destaque`, `valoresVistos`/`!== v` com campo controlado, e
procure foco no erro. Ver [[react19-reset-formulario]].

6. Plano 27 T2 (23/11/2026, commit db486909): cartão "Envio automático" (`EnvioAutomaticoForm`) com `useState(inicial.*)` e sem `key`.
   O "Arquivar" do modelo automático faz `revalidatePath` sem redirect: o texto do servidor vira "desligado", mas a caixa "Enviar
   sozinho" segue marcada ("Ligado") porque o estado do cliente não relê as props. Cartão de configuração com estado controlado
   precisa de `key` derivada do estado salvo (ou `key={JSON.stringify(inicial)}`) na página que o monta.

7. Plano 27 T7b (24/11/2026, commit 9cca5640): `NovaMeta`/`FormularioDaMeta` (`plano-alimentar/metas/nova-meta.tsx`) com `useState` controlado e o sucesso por
   `redirect(...?meta=adicionada#metas-titulo)` na mesma rota: o componente não remonta, então o formulário segue aberto e preenchido depois de
   "Meta adicionada." (duplo clique em "Adicionar meta" cria a segunda). Em formulário de criação controlado, dê `key` que muda com o resultado
   (ex.: id da meta mais nova ou contagem) ou limpe o estado no sucesso. O E2E só lê o status e não vê isso.
