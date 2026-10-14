#!/usr/bin/env python3
"""Gera o Status Report diário do NutriDebby em PDF (A4), no padrão visual dos
relatórios da WSS Sistemas (tons grafite e verde-petróleo, cartões, semáforo).

Feito com ReportLab e as fontes padrão do PDF (Helvetica, não embutidas): o
arquivo fica pequeno (cerca de 20-30 KB), o que importa porque a rotina na
nuvem anexa o PDF ao e-mail em base64. Gráficos vetoriais, sem matplotlib.

Uso:  python3 gerar_status_report_pdf.py dados.json saida.pdf
Dependência: pip install reportlab   (se faltar: pip install --break-system-packages reportlab)
Formato do dados.json: ver exemplo_dados_status.json na mesma pasta do Drive.
Campo ausente vira "não informado" — o script nunca inventa número.
"""
import json, math, sys

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas as rl_canvas

W, H = A4
M = 34                      # margem lateral
CW = W - 2 * M              # largura útil
TOP, BOTTOM = H - 34, 46    # limites verticais do conteúdo
INK, MUTED, LINE, SOFT, ACC = (HexColor(x) for x in ("#14212b", "#5a6b78", "#dde3e8", "#f3f5f7", "#0f6e74"))
TXT2, DARK_SUB = HexColor("#33434f"), HexColor("#c7d3dc")
RAG = {"verde": ("#2f8a4e", "#e8f4ec", "No prazo"), "amarelo": ("#b7791f", "#fbf3e3", "Atenção"),
       "vermelho": ("#b4373b", "#fbeceb", "Crítico"), "cinza": ("#7a8b99", "#eef1f4", "Sem dado")}
PILL = {"ok": ("#2f8a4e", "#e8f4ec"), "warn": ("#9a6512", "#fbf3e3"), "crit": ("#b4373b", "#fbeceb"), "info": ("#3f5566", "#eef1f4")}
NIVEL = {"alto": ("crit", "Alto"), "medio": ("warn", "Médio"), "médio": ("warn", "Médio"), "baixo": ("ok", "Baixo")}
NI = "não informado"
R, B = "Helvetica", "Helvetica-Bold"
TROCA = {"→": "›", "↗": "›", "≥": ">=", "≤": "<=", "✓": "ok", "✅": "ok", "⚠": "!", "−": "-", " ": " ", " ": " "}


def t(s):
    """Texto seguro para as fontes padrão do PDF (WinAnsi)."""
    s = "" if s is None else str(s)
    for a, b in TROCA.items():
        s = s.replace(a, b)
    return s.encode("cp1252", "replace").decode("cp1252")


def num(v, dec=0):
    if v is None or v == "":
        return NI
    if isinstance(v, (int, float)):
        return f"{v:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return str(v)


class Relatorio:
    def __init__(self, path, d):
        self.d = d
        self.rodape = t(f'WSS Sistemas · Status report {d.get("projeto", "NutriDebby")} · {d.get("data_curta", "")}')
        self.paginas = []
        self.c = rl_canvas.Canvas(path, pagesize=A4, pageCompression=1)
        self.c.setTitle(self.rodape); self.c.setAuthor("WSS Sistemas"); self.c.setSubject("Status report diário")
        self.y = TOP

    # ---------- primitivas ----------
    def wrap(self, txt, font, size, width):
        return simpleSplit(t(txt), font, size, width) or [""]

    def text(self, x, y, s, font=R, size=8, color=INK, align="l"):
        c = self.c; c.setFont(font, size); c.setFillColor(color)
        s = t(s)
        (c.drawString if align == "l" else c.drawRightString if align == "r" else c.drawCentredString)(x, y, s)

    def para(self, x, y, s, width, font=R, size=8, color=INK, lead=None):
        lead = lead or size * 1.32
        for i, ln in enumerate(self.wrap(s, font, size, width)):
            self.text(x, y - i * lead, ln, font, size, color)
        return len(self.wrap(s, font, size, width)) * lead

    def para_h(self, s, width, font=R, size=8, lead=None):
        return len(self.wrap(s, font, size, width)) * (lead or size * 1.32)

    def box(self, x, y, w, h, fill=white, stroke=LINE, r=7, lw=0.8):
        c = self.c; c.setLineWidth(lw); c.setFillColor(fill)
        c.setStrokeColor(stroke if stroke else fill)
        c.roundRect(x, y, w, h, r, stroke=1 if stroke else 0, fill=1)

    def eyebrow(self, x, y, s, color=MUTED):
        c = self.c; c.setFont(R, 6.2); c.setFillColor(color)
        c.drawString(x, y, t(s).upper())

    def pill(self, x, y, sit, rot, align="l", fg=None, bg=None):
        f, b = PILL.get(sit, PILL["info"])
        fg, bg = HexColor(fg or f), HexColor(bg or b)
        s = t(rot); w = self.c.stringWidth(s, B, 6.6) + 10
        if align == "r":
            x -= w
        self.box(x, y - 3, w, 11, fill=bg, stroke=None, r=5.5)
        self.text(x + 5, y, s, B, 6.6, fg)
        return w

    def ensure(self, h):
        if self.y - h < BOTTOM:
            self.nova_pagina()

    def nova_pagina(self, titulo=None):
        self.paginas.append(None); self.c.showPage(); self.y = TOP
        if titulo:
            self.secao(titulo)

    def secao(self, titulo, direita=None):
        self.ensure(30)
        self.text(M, self.y - 12, titulo, B, 12.5)
        if direita:
            self.text(M + CW, self.y - 12, direita, R, 7, MUTED, "r")
        c = self.c; c.setStrokeColor(INK); c.setLineWidth(1.6)
        c.line(M, self.y - 18, M + CW, self.y - 18)
        self.y -= 28

    def painel(self, x, w, h, eyebrow, titulo):
        """Desenha a moldura de um painel no y atual; devolve o y onde o conteúdo começa."""
        self.box(x, self.y - h, w, h, r=8)
        self.eyebrow(x + 11, self.y - 15, eyebrow)
        self.text(x + 11, self.y - 28, titulo, B, 10.5)
        return self.y - 42

    # ---------- blocos ----------
    def capa(self):
        d = self.d; h = 78
        self.box(M, self.y - h, CW, h, fill=INK, stroke=None, r=9)
        self.eyebrow(M + 16, self.y - 18, "WSS Sistemas · Status report diário de projeto", HexColor("#a9bac6"))
        xr = M + CW - 16
        sw = self.c.stringWidth
        meta_w = max(sw(t(d.get("cliente", "")), B, 8.2), sw(t(f'Emitido em {d.get("emitido_em", NI)}'), R, 7.4),
                     sw(t(f'Janela: {d.get("janela", NI)}'), R, 7.4))
        titulo = t(f'{d.get("projeto", "NutriDebby")} — {d.get("data_extenso", NI)}')
        livre = CW - 32 - meta_w - 16
        tam = 16
        while tam > 11 and sw(titulo, B, tam) > livre:
            tam -= 0.5
        self.text(M + 16, self.y - 40, titulo, B, tam, white)
        self.para(M + 16, self.y - 58, d.get("subtitulo", ""), livre, R, 8, DARK_SUB)
        self.text(xr, self.y - 40, d.get("cliente", ""), B, 8.2, white, "r")
        self.text(xr, self.y - 52, f'Emitido em {d.get("emitido_em", NI)}', R, 7.4, DARK_SUB, "r")
        self.text(xr, self.y - 63, f'Janela: {d.get("janela", NI)}', R, 7.4, DARK_SUB, "r")
        self.y -= h + 12

    def veredito(self):
        v = self.d.get("veredito") or {}
        cor, _, lab = RAG.get((v.get("rag") or "cinza").lower(), RAG["cinza"])
        lw = 142; tw = CW - lw - 28
        h = max(78, 24 + self.para_h(v.get("frase") or NI, tw, B, 11.5, 14) + self.para_h(v.get("resumo", ""), tw, R, 8.4, 11.6) + 8)
        x, y0 = M, self.y - h
        self.box(x, y0, CW, h, r=9)
        c = self.c; c.saveState(); p = c.beginPath(); p.roundRect(x, y0, CW, h, 9); c.clipPath(p, stroke=0)
        c.setFillColor(HexColor(cor)); c.rect(x, y0, lw, h, stroke=0, fill=1); c.restoreState()
        cy = y0 + h / 2
        self.eyebrow(x + 13, cy + 16, "Situação geral", HexColor("#ffffff"))
        self.text(x + 13, cy - 4, (v.get("rotulo") or lab).upper(), B, 17, white)
        self.para(x + 13, cy - 19, v.get("tendencia", ""), lw - 22, R, 7.2, white)
        yy = self.y - 18
        yy -= self.para(x + lw + 14, yy, v.get("frase") or NI, tw, B, 11.5, INK, 14) + 2
        self.para(x + lw + 14, yy, v.get("resumo", ""), tw, R, 8.4, TXT2, 11.6)
        self.y -= h + 10

    def kpis(self):
        ks = self.d.get("kpis") or []
        if not ks:
            return
        n = len(ks); g = 7; w = (CW - g * (n - 1)) / n; h = 62
        for i, k in enumerate(ks):
            x = M + i * (w + g); lead = i == 0
            self.box(x, self.y - h, w, h, fill=ACC if lead else white, stroke=None if lead else LINE)
            fg, sub = (white, HexColor("#d3e6e7")) if lead else (INK, MUTED)
            for j, ln in enumerate(self.wrap(k.get("rotulo"), R, 6.2, w - 16)[:2]):
                self.text(x + 8, self.y - 13 - j * 7.5, ln.upper(), R, 6.2, sub)
            val = k.get("valor"); val = "—" if val in (None, "") else val
            self.text(x + 8, self.y - 37, val, B, 15, fg)
            for j, ln in enumerate(self.wrap(k.get("sub") or "", R, 6.6, w - 16)[:2]):
                self.text(x + 8, self.y - 48 - j * 8, ln, R, 6.6, sub)
        self.y -= h + 14

    def dimensoes(self):
        ds = self.d.get("dimensoes") or []
        if not ds:
            return
        self.secao("Saúde por dimensão", "verde · amarelo · vermelho")
        cols, g = 3, 7; w = (CW - g * (cols - 1)) / cols
        for r0 in range(0, len(ds), cols):
            linha = ds[r0:r0 + cols]
            h = 30 + max(self.para_h(x.get("texto") or NI, w - 18, R, 7.6, 10) for x in linha) + 4
            self.ensure(h)
            for i, x in enumerate(linha):
                cor, bg, lab = RAG.get((x.get("rag") or "cinza").lower(), RAG["cinza"])
                xx = M + i * (w + g)
                self.box(xx, self.y - h, w, h)
                c = self.c; c.saveState(); p = c.beginPath(); p.roundRect(xx, self.y - h, w, h, 7); c.clipPath(p, stroke=0)
                c.setFillColor(HexColor(cor)); c.rect(xx, self.y - 3, w, 3, stroke=0, fill=1); c.restoreState()
                self.text(xx + 9, self.y - 17, x.get("nome"), B, 9)
                self.pill(xx + w - 8, self.y - 17, None, x.get("rotulo") or lab, "r", cor, bg)
                self.para(xx + 9, self.y - 30, x.get("texto") or NI, w - 18, R, 7.6, TXT2, 10)
            self.y -= h + g
        self.y -= 6

    def depende(self):
        itens = self.d.get("depende_de_voce") or []
        linhas = []
        for i, x in enumerate(itens, 1):
            linhas.append((f"{i}.", x.get("titulo", ""), x.get("detalhe", "")))
        tw = CW - 46
        alt = [self.para_h(f'{a} — {b}', tw, R, 8.4, 11) for _, a, b in linhas] or [11]
        h = 30 + sum(alt) + 4 * max(len(alt) - 1, 0) + 6
        self.ensure(h)
        self.box(M, self.y - h, CW, h, fill=INK, stroke=None, r=9)
        self.eyebrow(M + 14, self.y - 16, "O que depende de você hoje", HexColor("#a9bac6"))
        yy = self.y - 31
        if not linhas:
            self.text(M + 14, yy, "Nada pendente com você hoje.", R, 8.4, DARK_SUB)
        for (n, a, b), hh in zip(linhas, alt):
            self.text(M + 14, yy, n, B, 8.4, white)
            ws = self.wrap(f"{a} — {b}", R, 8.4, tw)
            first = True; consumed_bold = len(t(a))
            for j, ln in enumerate(ws):
                x0 = M + 28
                if first and ln.startswith(t(a)):
                    self.text(x0, yy - j * 11, t(a), B, 8.4, white)
                    self.text(x0 + self.c.stringWidth(t(a), B, 8.4), yy - j * 11, ln[consumed_bold:], R, 8.4, DARK_SUB)
                else:
                    self.text(x0, yy - j * 11, ln, R, 8.4, DARK_SUB)
                first = False
            yy -= hh + 4
        self.y -= h + 10

    def graficos(self):
        d = self.d; h = 190; g = 8; w1 = CW * 0.62; w2 = CW - w1 - g
        self.ensure(h)
        y0 = self.painel(M, w1, h, "Ritmo", "Commits na main por dia")
        pts = d.get("commits_por_dia") or []
        cx, cy, cw, ch = M + 14, self.y - h + 30, w1 - 28, y0 - (self.y - h + 30) - 14
        if pts:
            vmax = max([p[1] or 0 for p in pts] + [1]); n = len(pts); bw = cw / n
            c = self.c; c.setStrokeColor(LINE); c.setLineWidth(0.5)
            for q in (0.25, 0.5, 0.75, 1):
                c.line(cx, cy + ch * q, cx + cw, cy + ch * q)
            for i, (rot, v) in enumerate(pts):
                v = v or 0; bh = ch * v / vmax; x = cx + i * bw + bw * 0.18
                c.setFillColor(ACC if i == n - 1 else HexColor("#9cc3c5"))
                if bh > 0:
                    c.roundRect(x, cy, bw * 0.64, bh, 1.5, stroke=0, fill=1)
                    self.text(x + bw * 0.32, cy + bh + 3, str(v), B, 6.4, INK, "c")
                self.text(x + bw * 0.32, cy - 9, rot, R, 5.8, MUTED, "c")
        else:
            self.text(cx, cy + ch / 2, NI, R, 8, MUTED)
        self.text(M + 14, self.y - h + 10, d.get("nota_commits", ""), R, 6.8, MUTED)

        b = d.get("backlog") or {}
        fat = [("Feito", b.get("feito"), "#2f8a4e"), ("Em andamento", b.get("andamento"), "#0f6e74"),
               ("Bloqueado", b.get("bloqueado"), "#b4373b"), ("A fazer", b.get("a_fazer"), "#c9d3db")]
        x2 = M + w1 + g
        y0 = self.painel(x2, w2, h, "Backlog", "Itens por situação")
        tot = sum(v or 0 for _, v, _ in fat)
        rr = 40; ccx = x2 + w2 / 2; ccy = y0 - rr - 4
        c = self.c
        if tot:
            a0 = 90.0
            for _, v, cor in fat:
                if not v:
                    continue
                ext = -360.0 * v / tot
                c.setFillColor(HexColor(cor)); c.setStrokeColor(white); c.setLineWidth(1.5)
                c.wedge(ccx - rr, ccy - rr, ccx + rr, ccy + rr, a0, ext, stroke=1, fill=1)
                a0 += ext
            c.setFillColor(white); c.circle(ccx, ccy, rr * 0.62, stroke=0, fill=1)
            self.text(ccx, ccy - 2, f'{num((b.get("feito") or 0) / tot * 100)}%', B, 15, INK, "c")
            self.text(ccx, ccy - 12, "concluído", R, 6.4, MUTED, "c")
        else:
            self.text(ccx, ccy, NI, R, 8, MUTED, "c")
        ly = ccy - rr - 14
        for i, (rot, v, cor) in enumerate(fat):
            lx = x2 + 14 + (i % 2) * (w2 - 28) / 2; yy = ly - (i // 2) * 11
            c.setFillColor(HexColor(cor)); c.circle(lx + 3, yy + 2.3, 3, stroke=0, fill=1)
            self.text(lx + 9, yy, f"{rot} · {num(v)}", R, 7, MUTED)
        self.para(x2 + 14, ly - 26, b.get("fonte", ""), w2 - 28, R, 6.6, MUTED, 8.4)
        self.y -= h + 10

    def fases(self):
        fs = self.d.get("fases") or []
        if not fs:
            return
        rowh = 15; h = 48 + rowh * len(fs)
        self.ensure(h)
        y0 = self.painel(M, CW, h, "Progresso", "Fases e planos")
        bx, bw = M + 170, CW - 170 - 96
        for i, f in enumerate(fs):
            yy = y0 - i * rowh - 4
            tot = f.get("total") or 0; feito = f.get("feitos") or 0; pc = feito / tot * 100 if tot else 0
            cor = HexColor("#2f8a4e") if pc >= 99.9 else (ACC if pc >= 50 else HexColor("#b7791f"))
            self.text(M + 12, yy, f.get("nome"), R, 8)
            self.box(bx, yy - 1, bw, 6.5, fill=HexColor("#eef1f4"), stroke=None, r=3.2)
            if pc > 0:
                self.box(bx, yy - 1, max(bw * pc / 100, 6.5), 6.5, fill=cor, stroke=None, r=3.2)
            self.text(M + CW - 12, yy, f"{feito}/{tot} · {num(pc)}%", R, 7.6, MUTED, "r")
        self.y -= h + 10

    def listas(self):
        d = self.d; g = 8; w = (CW - g) / 2
        cols = [("Últimas 24 horas", "O que foi entregue", d.get("entregue_24h") or [], "tag"),
                ("Próximos passos", "O que vem a seguir", d.get("proximos_passos") or [], "quando")]
        def altura(lst, k):
            hh = 0
            for x in lst:
                tagw = self.c.stringWidth(t(x.get(k) or "•"), B, 6.4) + 10
                tw = w - 30 - tagw
                hh += self.para_h(x.get("titulo"), tw, B, 8.2, 10.4) + self.para_h(x.get("detalhe", ""), tw, R, 7.5, 9.6) + 7
            return hh or 14
        h = 48 + max(altura(l, k) for _, _, l, k in cols)
        self.ensure(h)
        for i, (eb, tit, lst, k) in enumerate(cols):
            x = M + i * (w + g)
            yy = self.painel(x, w, h, eb, tit)
            if not lst:
                self.text(x + 12, yy, "Nada registrado.", R, 7.6, MUTED)
            for it in lst:
                tw_tag = self.pill(x + 12, yy, "info", it.get(k) or "•", fg="#0f6e74", bg="#e6f1f1")
                tx = x + 12 + tw_tag + 6; tw = w - 30 - tw_tag
                yy -= self.para(tx, yy, it.get("titulo"), tw, B, 8.2, INK, 10.4)
                yy -= self.para(tx, yy, it.get("detalhe", ""), tw, R, 7.5, MUTED, 9.6) + 7
        self.y -= h + 10

    def tabela(self, eyebrow, titulo, cols, linhas, x=M, w=CW, vazio=NI):
        """cols: [(cabeçalho, fração da largura)]; linhas: lista de listas de células.
        Célula = texto | ("pill", sit, rótulo) | ("dois", título, subtítulo)."""
        iw = w - 24; ws = [iw * f for _, f in cols]
        def cel_h(cel, cw):
            if isinstance(cel, tuple) and cel[0] == "pill":
                return 11
            if isinstance(cel, tuple) and cel[0] == "dois":
                return self.para_h(cel[1], cw - 6, B, 7.8, 9.6) + self.para_h(cel[2], cw - 6, R, 7, 8.8)
            return self.para_h(cel, cw - 6, R, 7.8, 9.6)
        alts = [max(cel_h(cl, cw) for cl, cw in zip(ln, ws)) + 9 for ln in linhas] or [16]
        h = 56 + sum(alts)
        self.ensure(min(h, TOP - BOTTOM))
        yy = self.painel(x, w, h, eyebrow, titulo)
        cx = x + 12
        for (cab, _), cw in zip(cols, ws):
            self.text(cx, yy, cab.upper(), R, 6, MUTED); cx += cw
        yy -= 5; c = self.c; c.setStrokeColor(LINE); c.setLineWidth(0.6); c.line(x + 12, yy, x + w - 12, yy)
        if not linhas:
            self.text(x + 12, yy - 12, vazio, R, 7.8, MUTED)
        for ln, ah in zip(linhas, alts):
            cx = x + 12; ty = yy - 11
            for cel, cw in zip(ln, ws):
                if isinstance(cel, tuple) and cel[0] == "pill":
                    self.pill(cx, ty, cel[1], cel[2])
                elif isinstance(cel, tuple) and cel[0] == "dois":
                    k = self.para(cx, ty, cel[1], cw - 6, B, 7.8, INK, 9.6)
                    self.para(cx, ty - k, cel[2], cw - 6, R, 7, MUTED, 8.8)
                else:
                    self.para(cx, ty, cel, cw - 6, R, 7.8, INK, 9.6)
                cx += cw
            yy -= ah; c.setStrokeColor(LINE); c.line(x + 12, yy, x + w - 12, yy)
        return h

    def rodape_pagina(self, n, total):
        c = self.c; c.setFont(R, 6.8); c.setFillColor(MUTED)
        c.drawString(M, 24, self.rodape)
        c.drawRightString(M + CW, 24, t(f"Página {n} de {total}"))
        c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(M, 34, M + CW, 34)

    def montar(self):
        d = self.d
        self.capa(); self.veredito(); self.kpis(); self.dimensoes(); self.depende()

        self.nova_pagina(); self.secao("Execução e entregas", d.get("data_curta", ""))
        self.graficos(); self.fases(); self.listas()

        self.nova_pagina(); self.secao("Riscos, operação e pendências", d.get("data_curta", ""))
        prs = [[f'#{p.get("numero")}', p.get("titulo", ""), ("pill",) + tuple(p.get("situacao") or ["info", NI]),
                ("pill",) + tuple(p.get("ci") or ["info", "—"]), p.get("data", "")] for p in d.get("prs") or []]
        h = self.tabela("GitHub", "Pull requests recentes", [("PR", .07), ("Título", .55), ("Situação", .16), ("CI", .11), ("Data", .11)], prs)
        self.y -= h + 10
        rs = []
        for r in d.get("riscos") or []:
            sit, rot = NIVEL.get((r.get("nivel") or "").lower(), ("info", r.get("nivel") or NI))
            rs.append([("dois", r.get("risco", ""), r.get("impacto", "")), ("pill", sit, rot), r.get("acao", ""), r.get("dono", "")])
        h = self.tabela("Gestão de riscos", "Riscos ativos", [("Risco e impacto", .42), ("Nível", .1), ("Ação", .33), ("Dono", .15)], rs)
        self.y -= h + 10

        g = 8; w = (CW - g) / 2
        op = [[o.get("item", ""), o.get("valor") if o.get("valor") not in (None, "") else NI, ("pill",) + tuple(o.get("situacao") or ["info", "—"])] for o in d.get("operacao") or []]
        pe = [[p.get("id", ""), p.get("texto", ""), p.get("dono", "")] for p in d.get("pendencias_externas") or []]
        self.ensure(max(56 + 22 * max(len(op), 1), 56 + 22 * max(len(pe), 1)))
        y_ini = self.y
        h1 = self.tabela("Produção", "Operação", [("Item", .36), ("Valor", .4), ("Situação", .24)], op, M, w)
        self.y = y_ini
        h2 = self.tabela("Fora do código", "Pendências externas", [("ID", .18), ("Pendência", .56), ("Dono", .26)], pe, M + w + g, w, "Nenhuma.")
        self.y = y_ini - max(h1, h2) - 10

        links = d.get("links") or []; fontes = d.get("fontes") or []; ind = d.get("indisponiveis") or []
        hf = sum(self.para_h("• " + f, w - 24, R, 7.4, 9.4) + 2 for f in fontes)
        hi = (14 + sum(self.para_h("• " + f, w - 24, R, 7.4, 9.4) + 2 for f in ind)) if ind else 0
        h = max(48 + 12 * math.ceil(len(links) / 2), 48 + hf + hi) + 6
        self.ensure(h)
        yy = self.painel(M, w, h, "Acesso rápido", "Links")
        for i, l in enumerate(links):
            lx = M + 12 + (i % 2) * (w - 24) / 2; ly = yy - (i // 2) * 12
            self.text(lx, ly, f'{l.get("rotulo")} ›', B, 7.8, ACC)
            self.c.linkURL(l.get("url", ""), (lx, ly - 2, lx + 110, ly + 8), relative=0)
        yy = self.painel(M + w + g, w, h, "Transparência", "Fontes dos dados")
        for f in fontes:
            yy -= self.para(M + w + g + 12, yy, "• " + f, w - 24, R, 7.4, TXT2, 9.4) + 2
        if ind:
            yy -= 4; self.eyebrow(M + w + g + 12, yy, "Sem dado nesta edição"); yy -= 10
            for f in ind:
                yy -= self.para(M + w + g + 12, yy, "• " + f, w - 24, R, 7.4, TXT2, 9.4) + 2
        self.y -= h + 14
        nota =d.get("rodape_texto", "Relatório gerado automaticamente com dados reais coletados no momento da emissão; nenhum número é estimado sem indicação.")
        self.ensure(self.para_h(nota, CW, R, 7, 9))
        self.y -= self.para(M, self.y, nota, CW, R, 7, MUTED, 9)


def gerar(d, path):
    # 1ª passada conta as páginas; 2ª desenha com "Página x de y"
    import io
    r0 = Relatorio(io.BytesIO(), d); r0.montar(); total = len(r0.paginas) + 1
    r = Relatorio(path, d)
    orig = r.nova_pagina
    def nova(titulo=None):
        r.rodape_pagina(len(r.paginas) + 1, total); orig(titulo)
    r.nova_pagina = nova
    r.montar(); r.rodape_pagina(len(r.paginas) + 1, total); r.c.save()
    return total


if __name__ == "__main__":
    dados = json.load(open(sys.argv[1], encoding="utf-8"))
    n = gerar(dados, sys.argv[2])
    print("ok", sys.argv[2], f"{n} páginas")
