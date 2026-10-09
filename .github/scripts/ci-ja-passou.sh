#!/usr/bin/env bash
# Deploy sem repetir o CI que o PR já passou (dono, 09/10/2026 — economia de minutos do GitHub Actions, plano Free).
#
# Num push na main, decide se o deploy pode pular o ci.yml e publicar direto. Escreve `pular=true|false` em
# $GITHUB_OUTPUT (ou na saída padrão, fora do Actions). Só pula quando TUDO abaixo vale:
#   1. o commit da main ($SHA) é o merge de um PR para a main (API: commits/{sha}/pulls, merged_at e
#      merge_commit_sha = $SHA);
#   2. a árvore do commit da main é IDÊNTICA à do head do PR (git rev-parse <sha>^{tree}) e a main anterior
#      ($BEFORE) está no histórico do head — o CI do PR (que roda no merge do head com a base) testou esta árvore;
#   3. a execução mais recente do ci.yml (evento pull_request) DESTE PR (nome `ci-pr-<n>-<base.sha>`, gravado pelo
#      run-name do ci.yml; nunca só o head_sha), do próprio repositório (fork não), com a base dela no histórico do head,
#      terminou em success, com os jobs quality, test, e2e e image em success. PR só de documentação (test/e2e/image pulados pelo job mudancas)
#      não pula: o deploy roda o CI, que já é curto nesse caso e decide sozinho não publicar.
# Qualquer dúvida — entrada ausente, API fora do ar, resposta estranha, árvore diferente, CI cancelado, com falha
# ou em andamento — vira pular=false (CI completo, como antes). O script nunca falha o job.
#
# Entradas (ambiente): REPO (dono/repositório), SHA (commit da main), BEFORE (main anterior), BASE_BRANCH (padrão
# main) e GH_TOKEN (GITHUB_TOKEN, lido só pelo `gh`; nunca impresso). Roda dentro do clone (fetch-depth 0).
# Testado em test/ci-ja-passou.test.ts (gh falso + repositórios git de verdade).
set -uo pipefail

saida() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "pular=$1" >> "$GITHUB_OUTPUT"; else echo "pular=$1"; fi
}

nao() {
  echo "CI completo: $*"
  saida false
  exit 0
}

e_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

BASE_BRANCH="${BASE_BRANCH:-main}"
[[ "${REPO:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || nao "REPO ausente ou inválido"
e_sha "${SHA:-}" || nao "SHA ausente ou inválido"
e_sha "${BEFORE:-}" && [[ ! "$BEFORE" =~ ^0+$ ]] || nao "sem main anterior (primeiro push ou BEFORE inválido)"

# 1. o commit da main é o merge de um PR para a main
pulls="$(gh api "repos/${REPO}/commits/${SHA}/pulls" 2>/dev/null)" || nao "a API de PRs do commit falhou"
pr="$(jq -c --arg sha "$SHA" --arg base "$BASE_BRANCH" '
  [ .[]? | select(.merged_at != null and .merge_commit_sha == $sha and .base.ref == $base) ]
  | if length == 1 then .[0] else empty end' <<<"$pulls" 2>/dev/null)" || nao "resposta inesperada da API de PRs"
[[ -n "$pr" ]] || nao "o commit ${SHA} não é o merge de um PR para a ${BASE_BRANCH}"
numero="$(jq -r '.number' <<<"$pr")"
head="$(jq -r '.head.sha' <<<"$pr")"
[[ "$numero" =~ ^[0-9]+$ ]] || nao "número do PR inválido"
e_sha "$head" || nao "head do PR inválido"
echo "Commit ${SHA} = merge do PR #${numero} (head ${head})"

# 2. mesma árvore e o head contém a main anterior
if ! git cat-file -e "${head}^{commit}" 2>/dev/null; then
  git fetch --no-tags --quiet origin "+refs/pull/${numero}/head:refs/remotes/origin/pr-${numero}" 2>/dev/null \
    || nao "não consegui buscar o head do PR #${numero}"
  git cat-file -e "${head}^{commit}" 2>/dev/null || nao "o head do PR #${numero} mudou depois do merge"
fi
arvore_main="$(git rev-parse --verify --quiet "${SHA}^{tree}")" || nao "commit da main ausente no clone"
arvore_head="$(git rev-parse --verify --quiet "${head}^{tree}")" || nao "árvore do head ausente"
[[ "$arvore_main" == "$arvore_head" ]] || nao "a árvore da main (${arvore_main}) difere da do head do PR (${arvore_head})"
git merge-base --is-ancestor "$BEFORE" "$head" 2>/dev/null \
  || nao "o PR não estava atualizado com a main anterior (${BEFORE}); o CI dele testou outra árvore"
echo "Árvore idêntica à do head do PR: ${arvore_main}"

# 3. o CI do head passou, com os jobs exigidos em success
runs="$(gh api "repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100" 2>/dev/null)" \
  || nao "a API de execuções do CI falhou"
# Só as execuções DESTE PR (revisão do branch): o mesmo head pode ter rodado noutro PR, com outra base (PR empilhado, base
# trocada sem push) — o CI de PR testa o merge do head com a base, então outra base = outra árvore. A API só preenche
# workflow_runs[].pull_requests com o PR aberto; depois do merge (quando o deploy roda) vem vazio. Por isso o ci.yml grava
# no nome da execução (run-name → display_title) o número do PR e o base.sha do momento em que ela foi criada:
# `ci-pr-<n>-<sha>`. Execução sem esse nome (anterior ao run-name) não serve. PR de fork: head_repository diferente.
# A base do PR ser a main já foi conferida na API de pulls do commit (passo 1), que funciona depois do merge.
run="$(jq -c --arg head "$head" --arg numero "$numero" --arg repo "$REPO" '
  [ .workflow_runs[]? | select(.head_sha == $head and .event == "pull_request"
      and .head_repository.full_name == $repo
      and ((.display_title // "") | test("^ci-pr-[0-9]+-[0-9a-f]{40}$"))
      and ((.display_title | capture("^ci-pr-(?<n>[0-9]+)-").n) == $numero)) ]
  | sort_by(.created_at) | last // empty' <<<"$runs" 2>/dev/null)" || nao "resposta inesperada da API de execuções"
[[ -n "$run" ]] || nao "nenhuma execução do CI do PR #${numero} (nome ci-pr-${numero}-<base>, do próprio repositório) para o head ${head}"
run_id="$(jq -r '.id' <<<"$run")"
titulo="$(jq -r '.display_title' <<<"$run")"
[[ "$titulo" =~ ^ci-pr-([0-9]+)-([0-9a-f]{40})$ ]] || nao "nome da execução ${run_id} fora do padrão"
[[ "${BASH_REMATCH[1]}" == "$numero" ]] || nao "a execução ${run_id} é de outro PR"
base_run="${BASH_REMATCH[2]}"
# a base daquela execução já estava no head: o merge que o CI testou tem a árvore do head
git merge-base --is-ancestor "$base_run" "$head" 2>/dev/null \
  || nao "a base da execução ${run_id} (${base_run}) não está no histórico do head; o CI testou outra árvore"
estado="$(jq -r '"\(.status)/\(.conclusion)"' <<<"$run")"
[[ "$run_id" =~ ^[0-9]+$ ]] || nao "id da execução inválido"
[[ "$estado" == "completed/success" ]] || nao "a execução ${run_id} do CI do head está ${estado}"

jobs="$(gh api "repos/${REPO}/actions/runs/${run_id}/jobs?filter=latest&per_page=100" 2>/dev/null)" \
  || nao "a API de jobs falhou"
for job in quality test e2e image; do
  conclusao="$(jq -r --arg n "$job" '
    [ .jobs[]? | select(.name == $n) ] | if length == 1 then (.[0].conclusion // "nula") else "ausente" end' \
    <<<"$jobs" 2>/dev/null)" || nao "resposta inesperada da API de jobs"
  [[ "$conclusao" == "success" ]] || nao "job ${job} da execução ${run_id}: ${conclusao}"
done

echo "CI já passou no PR #${numero} (execução ${run_id}): o deploy publica sem repetir o CI"
saida true
