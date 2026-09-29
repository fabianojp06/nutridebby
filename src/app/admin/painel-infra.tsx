import { getDb } from '@/db/client';
import { getEnv } from '@/env';
import { formatarBytes } from '@/lib/format';
import { DISCO_LIMITE, percentualDisco, statfsDoDiretorio, ultimosBackups, type UltimoBackup } from '@/modules/plataforma/monitoramento';

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

function Linha({ rotulo, b }: { rotulo: string; b?: UltimoBackup }) {
  if (!b) return <li>{`${rotulo}: nenhum backup registrado`}</li>;
  const tamanho = b.bytes ? ` (${formatarBytes(b.bytes)})` : '';
  return <li>{`${rotulo}: ${b.ok ? 'concluído' : 'FALHOU'} em ${quando(b.concluidoEm)}${tamanho}`}</li>;
}

/** Situação do backup (RNF-05) e do disco (RNF-13) para o admin. */
export async function PainelInfra() {
  const backups = await ultimosBackups(getDb());
  const disco = await statfsDoDiretorio(getEnv().DATA_DIR).then(percentualDisco, () => null);
  return (
    <section aria-labelledby="infra-titulo" className="rounded border p-4 text-sm">
      <h2 id="infra-titulo" className="mb-2 font-semibold">Servidor</h2>
      <ul className="space-y-1">
        <Linha rotulo="Backup do banco" b={backups.find((b) => b.tipo === 'banco')} />
        <Linha rotulo="Backup dos arquivos" b={backups.find((b) => b.tipo === 'arquivos')} />
        <li className={disco !== null && disco >= DISCO_LIMITE ? 'font-semibold text-red-700' : undefined}>
          {disco === null ? 'Disco: não foi possível medir' : `Disco da VPS: ${disco}% usado${disco >= DISCO_LIMITE ? ` (acima do limite de ${DISCO_LIMITE}%)` : ''}`}
        </li>
      </ul>
    </section>
  );
}
