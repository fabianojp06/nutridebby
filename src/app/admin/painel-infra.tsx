import Link from 'next/link';
import { Cartao } from '@/components/ui/cartao';
import { getDb } from '@/db/client';
import { getEnv } from '@/env';
import { formatarBytes } from '@/lib/format';
import { DISCO_LIMITE, percentualDisco, statfsDoDiretorio, ultimosBackups, type UltimoBackup } from '@/modules/plataforma/monitoramento';

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

/** Último backup de cada tipo (RNF-05) e o uso do disco (RNF-13, `null` = não deu para medir). */
async function situacaoDoServidor(): Promise<{ backups: UltimoBackup[]; disco: number | null }> {
  const backups = await ultimosBackups(getDb());
  const disco = await statfsDoDiretorio(getEnv().DATA_DIR).then(percentualDisco, () => null);
  return { backups, disco };
}

/** Falha de backup e disco acima do limite: em destaque (cor E negrito, e o próprio texto diz "FALHOU"/"acima do limite"). */
const DESTAQUE = 'font-semibold text-erro';

function Backup({ rotulo, b, comTamanho = true }: { rotulo: string; b?: UltimoBackup; comTamanho?: boolean }) {
  if (!b) return <>{`${rotulo}: nenhum backup registrado`}</>;
  const tamanho = comTamanho && b.bytes ? ` (${formatarBytes(b.bytes)})` : '';
  return <span className={b.ok ? undefined : DESTAQUE}>{`${rotulo}: ${b.ok ? 'concluído' : 'FALHOU'} em ${quando(b.concluidoEm)}${tamanho}`}</span>;
}

function Disco({ disco }: { disco: number | null }) {
  if (disco === null) return <>Disco: não foi possível medir</>;
  const acima = disco >= DISCO_LIMITE;
  return <span className={acima ? DESTAQUE : undefined}>{`Disco da VPS: ${disco}% usado${acima ? ` (acima do limite de ${DISCO_LIMITE}%)` : ''}`}</span>;
}

/** Situação do backup (RNF-05) e do disco (RNF-13) para o admin: a aba "Servidor" (P16-17). */
export async function PainelInfra() {
  const { backups, disco } = await situacaoDoServidor();
  return (
    <Cartao id="infra-titulo" titulo="Backup e disco">
      <ul className="space-y-2">
        <li><Backup rotulo="Backup do banco" b={backups.find((b) => b.tipo === 'banco')} /></li>
        <li><Backup rotulo="Backup dos arquivos" b={backups.find((b) => b.tipo === 'arquivos')} /></li>
        <li><Disco disco={disco} /></li>
      </ul>
    </Cartao>
  );
}

/** P16-17: o resumo do servidor numa linha, na lista de contas (o backup do banco e o disco), com o link para a aba. */
export async function ResumoDoServidor() {
  const { backups, disco } = await situacaoDoServidor();
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Backup rotulo="Backup do banco" b={backups.find((b) => b.tipo === 'banco')} comTamanho={false} />
      <span aria-hidden="true">·</span>
      <Disco disco={disco} />
      <Link href="/admin/servidor" className="inline-flex min-h-11 items-center font-semibold text-link underline">Ver servidor</Link>
    </p>
  );
}
