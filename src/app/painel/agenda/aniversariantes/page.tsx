import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { aniversariantesDoMes } from '@/modules/agenda/aniversarios';
import { nomeDoMesDoAno } from '@/modules/agenda/calendario';
import { MSG_ANIVERSARIO as M, nomeDaNutricionista } from '@/modules/agenda/constantes';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { abaDeSolicitacoes } from '@/modules/agenda/solicitacoes';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { Mensagens } from '../../financeiro/mensagens';
import { marcadorDoEnvio } from '../../financeiro/topo';
import { AbasDaAgenda } from '../abas';
import { enviarAction, registrarAction, retirarAction } from './actions';
import { TabelaDosAniversariantes, type LinhaDoAniversario } from './selecao';

export const dynamic = 'force-dynamic';

/** O h1 recebe o foco depois das ações (`?ok=` + `?envio=`), como a fila Solicitações. */
const ID_TITULO = 'titulo-aniversariantes';
const LINK = 'inline-flex min-h-11 items-center rounded-full border border-borda px-4 font-semibold';

/** O mês vizinho ('AAAA-MM'). */
function mesVizinho(mes: string, passo: 1 | -1): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + passo, 1));
  return d.toISOString().slice(0, 7);
}

/** A volta das ações pela URL — lista fechada; o número só com dígitos (a URL nunca vira texto na tela). */
function retorno(sp: Record<string, string | string[] | undefined>): string {
  if (sp.ok === 'agendadas') return M.agendadas(typeof sp.n === 'string' && /^\d{1,4}$/.test(sp.n) ? Number(sp.n) : 0);
  if (sp.ok === 'autorizada') return M.autorizacaoRegistrada;
  if (sp.ok === 'retirada') return M.autorizacaoRetirada;
  return '';
}

/**
 * Plano 23 (US-412 a US-414, §7): "Aniversariantes de {mês}" — os pacientes ativos com aniversário no mês, com nome de
 * registro, dia, idade que completa e a situação; "Mês anterior" e "Próximo mês" (só o mês corrente envia); a seleção, a
 * prévia do envio e a autorização em cada linha. Leitura da agenda: sem `auditRead` (RN-414, US-412). O nome da
 * nutricionista (prévia e WhatsApp) é o profissional, ou o de exibição.
 */
export default async function AniversariantesPage({ searchParams }: PageProps<'/painel/agenda/aniversariantes'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/aniversariantes');
  const sp = await searchParams;
  const agora = new Date();
  const r = await aniversariantesDoMes(ctx, tenant, typeof sp.mes === 'string' ? sp.mes : undefined, { agora });
  const solicitacoes = await abaDeSolicitacoes(ctx, tenant, { agora });
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const { minutos } = partesNoFuso(agora, tenant.fuso);
  const nomeDoMes = nomeDoMesDoAno(`${r.mes}-01`);
  const futuro = r.mes > hoje.slice(0, 7);
  const texto = retorno(sp);
  const nutri = nomeDaNutricionista(tenant);
  const linhas: LinhaDoAniversario[] = r.lista.map((a) => ({
    patientId: a.patientId,
    nome: a.nome,
    dia: `${a.dia.slice(8, 10)}/${a.dia.slice(5, 7)}`,
    faz: a.faz,
    situacao: M.situacao[a.situacao],
    pode: r.corrente && a.situacao === 'pode_receber',
    deHoje: a.dia === hoje,
    autorizado: a.autorizadoEm !== null,
    podeRetirar: a.podeRetirar,
    menorHoje: a.menorHoje,
    whatsapp: a.whatsapp ? { telefone: a.whatsapp.telefone, primeiroNome: primeiroNome(a.whatsapp.nome) } : null,
    registrar: registrarAction.bind(null, a.patientId, r.mes),
    retirar: retirarAction.bind(null, a.patientId, r.mes),
  }));
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 id={ID_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">{M.titulo(nomeDoMes)}</h1>
      <AbasDaAgenda atual="aniversariantes" solicitacoes={solicitacoes} />
      <Mensagens texto={texto} tipo="ok" focar={texto !== ''} marcador={marcadorDoEnvio(sp.envio)} alvos={[ID_TITULO]} />
      <nav aria-label={M.navegacaoDoMes} className="flex flex-wrap gap-2">
        <Link href={`/painel/agenda/aniversariantes?mes=${mesVizinho(r.mes, -1)}`} className={LINK}>{M.mesAnterior}</Link>
        <Link href={`/painel/agenda/aniversariantes?mes=${mesVizinho(r.mes, 1)}`} className={LINK}>{M.proximoMes}</Link>
      </nav>
      <p className="text-sm text-suave">{M.semNascimento}</p>
      {futuro && <p>{M.envioAbre(nomeDoMes)}</p>}
      {linhas.length === 0 ? (
        <p>{M.vazio}</p>
      ) : (
        <TabelaDosAniversariantes linhas={linhas} corrente={r.corrente} nutri={nutri} saemAgora={minutos >= 9 * 60 && minutos < 21 * 60} enviar={enviarAction.bind(null, r.mes)} />
      )}
    </main>
  );
}
