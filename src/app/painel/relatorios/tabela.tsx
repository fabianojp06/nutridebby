import type { ReactNode } from 'react';

/**
 * Plano 26 (RNF-481, §7.1): as tabelas dos Relatórios — `caption` (lida pelo leitor de tela; o título visível é o h3 do
 * bloco) e `th scope`. A tabela por mês (`rolavel`) fica num contêiner com rolagem própria, focável pelo teclado
 * (`role="region"` com o caption como nome, contorno do foco para dentro: molde do fluxo de caixa do Plano 20); a página
 * nunca rola na horizontal. Números à direita, em algarismos tabulares.
 */
export type LinhaDaTabela = { chave: string; rotulo: ReactNode; valores: ReactNode[]; destaque?: boolean; recuo?: boolean };

const CLASSE_DA_TABELA =
  'min-w-full text-left text-sm tabular-nums [&_td]:whitespace-nowrap [&_td]:px-2 [&_td]:py-2 [&_td]:text-right [&_th]:px-2 [&_th]:py-2 [&_thead_th]:whitespace-nowrap [&_thead_th+th]:text-right';

export function Tabela({
  id,
  titulo,
  colunas,
  linhas,
  rolavel = false,
}: {
  id: string;
  titulo: string;
  /** A primeira é o cabeçalho da coluna dos rótulos (vazia: célula sem texto). */
  colunas: string[];
  linhas: LinhaDaTabela[];
  rolavel?: boolean;
}) {
  const captionId = `${id}-caption`;
  const tabela = (
    <table className={CLASSE_DA_TABELA}>
      <caption id={captionId} className="sr-only">
        {titulo}
      </caption>
      <thead>
        <tr>
          {colunas.map((c, i) =>
            c ? (
              <th key={c} scope="col">
                {c}
              </th>
            ) : (
              <td key={`vazia-${i}`} />
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.chave} className={`border-t border-linha ${l.destaque ? 'font-semibold' : ''}`}>
            <th scope="row" className={`${l.destaque ? '' : 'font-normal'} ${l.recuo ? 'pl-6' : ''}`}>
              {l.rotulo}
            </th>
            {l.valores.map((v, i) => (
              <td key={i}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!rolavel) return tabela;
  return (
    <div role="region" aria-labelledby={captionId} tabIndex={0} className="overflow-x-auto p-2 focus-visible:outline-offset-[-3px] print:overflow-visible print:p-0">
      {tabela}
    </div>
  );
}

/** Um bloco dos Relatórios: título (h3), a tabela e as notas. Na impressão, sem a moldura do cartão e sem quebrar ao meio. */
export function Bloco({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2 rounded-3xl border border-borda bg-cartao p-5 print:break-inside-avoid print:border-0 print:p-0">
      <h3 id={id} className="font-titulo text-lg font-semibold">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/** As notas de um bloco (texto da §6.2). */
export function Notas({ textos }: { textos: string[] }) {
  if (!textos.length) return null;
  return (
    <div className="space-y-1 text-sm text-suave">
      {textos.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </div>
  );
}
