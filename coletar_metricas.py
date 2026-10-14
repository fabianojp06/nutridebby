#!/usr/bin/env python3
"""Coleta as métricas reais do NutriDebby para o status report diário.
Rode dentro do clone do repositório (fabianojp06/nutridebby). Usa só git,
`gh api` (REST — o GraphQL não funciona na nuvem) e HTTPS público.
Uso: python3 coletar_metricas.py [AAAA-MM-DD]   (data do relatório em Brasília; padrão: hoje)
Saída: JSON em stdout. Campo ausente = null, com o motivo em "erros".
"""
import json, re, subprocess, sys, urllib.request
from collections import Counter, OrderedDict
from datetime import datetime, timedelta, timezone

REPO = "fabianojp06/nutridebby"
BRT = timezone(timedelta(hours=-3))
BACKLOG = "docs/superpowers/plans/2026-09-27-nutridebby-backlog.md"
erros = []


def sh(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def gh(path):
    try:
        return json.loads(sh("gh", "api", path))
    except Exception as e:  # noqa: BLE001
        erros.append(f"gh api {path.split('?')[0]}: {getattr(e, 'stderr', '') or e}".strip()[:200])
        return None


def iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def brt(dt, fmt="%d/%m %Hh%M"):
    return dt.astimezone(BRT).strftime(fmt) if dt else None


ref = datetime.strptime(sys.argv[1], "%Y-%m-%d").date() if len(sys.argv) > 1 else datetime.now(BRT).date()
fim = datetime(ref.year, ref.month, ref.day, 6, 0, tzinfo=BRT)
ini = fim - timedelta(days=1)
out = OrderedDict(data_ref=str(ref), janela_inicio=ini.isoformat(), janela_fim=fim.isoformat())

# --- git (main) ---
try:
    try:
        sh("git", "fetch", "--quiet", "--unshallow", "origin", "main")
    except Exception:  # já completo
        sh("git", "fetch", "--quiet", "origin", "main")
    log = sh("git", "log", "origin/main", "--since=" + (fim - timedelta(days=15)).isoformat(), "--format=%cI")
    datas = [iso(x).astimezone(BRT).date() for x in log.split()]
    c = Counter(datas)
    out["commits_por_dia"] = [[(ref - timedelta(days=i)).strftime("%d/%m"), c.get(ref - timedelta(days=i), 0)] for i in range(13, -1, -1)]
    out["commits_24h"] = int(sh("git", "rev-list", "--count", "origin/main", "--since=" + ini.isoformat(), "--until=" + fim.isoformat()).strip())
    out["ultimos_commits_24h"] = [l for l in sh("git", "log", "origin/main", "--since=" + ini.isoformat(), "--until=" + fim.isoformat(), "--format=%h %s").splitlines()][:15]
    migs = sorted(f for f in sh("git", "ls-tree", "--name-only", "origin/main", "drizzle/").split() if f.endswith(".sql"))
    out["migrations"] = {"total": len(migs), "ultima": migs[-1].split("/")[-1] if migs else None}
    testes = sh("git", "grep", "-cE", r"^\s*(it|test)(\.each\([^)]*\))?\(", "origin/main", "--", "*.test.ts", "*.test.tsx", "*.spec.ts")
    out["testes_estaticos"] = sum(int(l.rsplit(":", 1)[1]) for l in testes.splitlines() if l)
    out["arquivos_de_teste"] = len(testes.splitlines())
except Exception as e:  # noqa: BLE001
    erros.append(f"git: {e}")

# --- backlog do repositório ---
try:
    md = sh("git", "show", f"origin/main:{BACKLOG}")
    sec, por_secao = None, OrderedDict()
    pend = []
    for l in md.splitlines():
        if l.startswith("## "):
            sec = l[3:].strip(); continue
        if not l.startswith("|") or "↳" in l or l.startswith("|---") or l.startswith("| ID"):
            continue
        cel = [x.strip() for x in l.strip().strip("|").split("|")]
        st = cel[-1]
        k = "feito" if "✅" in st else "andamento" if "🔄" in st else "bloqueado" if "⛔" in st else "a_fazer" if "⬜" in st else None
        if not k:
            continue
        d = por_secao.setdefault(sec, {"feito": 0, "andamento": 0, "bloqueado": 0, "a_fazer": 0})
        d[k] += 1
        resp = cel[-3] if len(cel) >= 3 else ""
        if k != "feito" and re.search(r"Você|Debby|Adv", resp):
            pend.append({"id": cel[0], "texto": re.sub(r"\*\*|~~|`", "", cel[1])[:140], "dono": resp, "situacao": k})
    tot = {k: sum(v[k] for v in por_secao.values()) for k in ("feito", "andamento", "bloqueado", "a_fazer")}
    out["backlog"] = {"por_secao": por_secao, "total": tot, "itens": sum(tot.values())}
    out["pendencias_de_terceiros"] = pend
except Exception as e:  # noqa: BLE001
    erros.append(f"backlog: {e}")

# --- GitHub: PRs e CI ---
prs = gh(f"repos/{REPO}/pulls?state=all&sort=updated&direction=desc&per_page=12") or []
runs = (gh(f"repos/{REPO}/actions/runs?per_page=60") or {}).get("workflow_runs", [])


def ci_do_pr(n, sha):
    rs = [r for r in runs if r.get("head_sha") == sha or f"-pr-{n}-" in (r.get("name") or "") or f"ci-pr-{n}" in (r.get("display_title") or "")]
    if not rs:
        return None
    r = rs[0]
    return r.get("conclusion") or r.get("status")


out["prs"] = []
for p in prs:
    m = iso(p.get("merged_at"))
    out["prs"].append({"numero": p["number"], "titulo": p["title"], "estado": "mesclado" if m else p["state"],
                       "rascunho": p.get("draft", False), "mesclado_em": brt(m), "atualizado_em": brt(iso(p.get("updated_at"))),
                       "ci": ci_do_pr(p["number"], (p.get("head") or {}).get("sha"))})
out["prs_mesclados_24h"] = [p["number"] for p in prs if p.get("merged_at") and ini <= iso(p["merged_at"]) < fim]
out["prs_abertos"] = [p["number"] for p in prs if p["state"] == "open"]
deploys = [r for r in runs if (r.get("name") or "") == "deploy" and r.get("head_branch") == "main"]
if deploys:
    d = deploys[0]
    out["ultimo_deploy"] = {"quando": brt(iso(d.get("updated_at") or d.get("created_at"))), "resultado": d.get("conclusion") or d.get("status"),
                            "commit": (d.get("head_commit") or {}).get("message", "").splitlines()[0][:100]}
falhas = [r for r in runs if r.get("conclusion") == "failure" and iso(r.get("created_at")) and iso(r["created_at"]) >= ini]
out["ci_falhas_24h"] = [{"nome": r.get("name"), "ramo": r.get("head_branch"), "quando": brt(iso(r.get("created_at")))} for r in falhas]

# --- produção ---
try:
    with urllib.request.urlopen("https://nutri.wsscloud.tech/api/health", timeout=15) as r:
        out["producao"] = {"http": r.status, "corpo": json.loads(r.read().decode())}
except urllib.error.HTTPError as e:
    out["producao"] = {"http": e.code, "corpo": None}
except Exception as e:  # noqa: BLE001
    out["producao"] = None; erros.append(f"health: {e}")

out["erros"] = erros
print(json.dumps(out, ensure_ascii=False, indent=1))
