# Fontes versionadas (SUS-106)

O build não busca mais as fontes no Google Fonts (`next/font/google`): cada busca era uma chance de o CI cair
("Can't resolve '@vercel/turbopack-next/internal/font/google/font'"). Os arquivos abaixo são os mesmos que o
`next/font/google` baixava — o subconjunto **latin** (U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD), baixados
de `fonts.gstatic.com` em 23/11/2026 pela API `css2` com `display=swap` — e são carregados por `next/font/local`
(`src/app/layout.tsx`, `src/app/fontes-painel.ts`, `src/app/p/fontes.ts`). Servidos pelo próprio app (D24, CSP
`font-src 'self'`).

| Arquivo | Família | Pesos (fonte variável) | Uso |
|---|---|---|---|
| `figtree-latin.woff2` | Figtree | 300–900 | texto do painel e do admin (`--font-figtree`) |
| `bricolage-grotesque-latin.woff2` | Bricolage Grotesque | 200–800 | títulos do painel (`--font-bricolage`) |
| `red-hat-display-latin.woff2` | Red Hat Display | 700–900 usados | títulos e números do portal (`--font-redhat`) |
| `atkinson-hyperlegible-next-latin.woff2` | Atkinson Hyperlegible Next | 400–700 usados | texto do portal (`--font-atkinson`) |

Licença: as quatro famílias são distribuídas sob a **SIL Open Font License 1.1** (https://openfontlicense.org), que
permite redistribuir e embutir os arquivos com o software. Fontes: github.com/google/fonts (`ofl/figtree`,
`ofl/bricolagegrotesque`, `ofl/redhatdisplay`, `ofl/atkinsonhyperlegiblenext`).

Diferença do `next/font/google`: só o subconjunto latin (o que o português usa e o que já era pré-carregado). Os
subconjuntos latin-ext e vietnamese não vêm mais: um caractere fora do latin (raro em nome próprio, como "ł" ou "ő")
aparece na fonte de reserva do sistema, só aquele caractere. Para trocar ou atualizar uma fonte, baixe o woff2 do
subconjunto latin pela mesma API e mantenha o nome do arquivo.
