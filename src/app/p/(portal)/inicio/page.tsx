import Link from 'next/link';
import { BarraDeAcoes } from '@/components/portal/barra-de-acoes';
import { Faixa } from '@/components/portal/faixa';
import { MiniJornada } from '@/components/portal/mini-jornada';
import { MSG_G } from '@/components/portal/textos';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { dataDaFaixa } from '@/modules/portal/datas-portal';
import { miniJornadaDoPaciente } from '@/modules/portal/jornada';
import { muralDoPaciente } from '@/modules/portal/mural';
import { MSG_MURAL } from '@/modules/portal/mural-regras';
import { molduraDaSecao } from '../../moldura';
import { AtualizarAoVoltar } from './atualizar-ao-voltar';
import { CartoesDoAparelho } from './cartoes-do-aparelho';
import { MuralLista } from './mural-lista';

export const dynamic = 'force-dynamic';

/**
 * Plano 16 (US-191, §4.3): Hoje — a faixa com a saudação e a mini-jornada, o mural do consultório (leitura: nada é
 * gravado para ele existir; não é chat, RN-193), os cartões do aparelho e a barra de ações. Duas transações curtas: o mural
 * e a mini-jornada (D2).
 */
export default async function Hoje() {
  const acesso = await requirePaciente('/p/inicio');
  const { ctx, tenant, vinculo, data } = acesso;
  const agora = new Date();
  const [moldura, mural, mini] = await Promise.all([molduraDaSecao(acesso), muralDoPaciente(ctx, tenant, agora), miniJornadaDoPaciente(ctx, tenant, agora)]);
  return (
    <>
      <Faixa {...moldura} atual="/p/inicio" titulo={MSG_G.titulos.hoje(mural.primeiroNome)} subtitulo={dataDaFaixa(hojeNoFuso(tenant.fuso, agora))}>
        <MiniJornada linha1={mini.linha1} linha2={mini.linha2} complemento={mini.complemento} pontos={mini.pontos} fuso={tenant.fuso} />
      </Faixa>
      <main data-guia="mural" className="flex-1 space-y-4 p-4">
        <CartoesDoAparelho conta={data.user.id} dono={vinculo.patientId} chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} />
        <p>
          <Link id="ver-todo-diario" href="/p/diario" className="inline-flex min-h-11 items-center font-semibold text-link underline">{MSG_MURAL.verTodoDiario}</Link>
        </p>
        <MuralLista mural={mural} fuso={tenant.fuso} />
        <p className="text-sm text-suave">{MSG_MURAL.rodape}</p>
      </main>
      <BarraDeAcoes exames={Boolean(tenant.examesPacienteAtivadoEm)} podeAgendar={mini.podeAgendar} />
      <AtualizarAoVoltar />
    </>
  );
}
