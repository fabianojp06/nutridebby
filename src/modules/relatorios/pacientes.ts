import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { prepararSecao, type DepsRel, type OpcoesRel, type TenantRel } from './comum';
import { FAIXAS_ETARIAS, MSG_RELATORIOS } from './constantes';
import { limitesDoMes, type Periodo } from './periodo';
import type { LinhaContagem, RelPacientes } from './tipos';

const L = MSG_RELATORIOS.pacientes.linhas;
/** RN-485: "Menos de 18" (dado antigo) fica na fase da vida, só quando existe; as faixas da tabela são as de 18 em diante. */
const MENOS_DE_18 = FAIXAS_ETARIAS[0];
const FAIXAS = FAIXAS_ETARIAS.slice(1);

/**
 * US-480 (RN-483 a RN-487), numa consulta só a `patients` (pelo `patients_tenant_status_idx`). Situação sem os
 * anonimizados; sexo e fase da vida só dos ativos, com a idade em anos completos **hoje** no fuso (RN-485); novos por mês
 * pela data do cadastro no fuso, com todas as situações e os anonimizados (o número do passado não muda, RN-487). Só
 * números: nenhum nome, nenhum `auditRead` (RN-493). Na sessão da recepção (T11b), a linha "Bloqueados" não existe e o
 * total é só do que ela vê (RE-D39; a RLS esconde bloqueados e anonimizados).
 */
export async function relatorioPacientes(ctx: TenantContext, tenant: TenantRel, p: Periodo, o: OpcoesRel, deps: DepsRel = {}): Promise<RelPacientes> {
  prepararSecao(ctx, tenant, 'pacientes', p, o);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  const meses = p.meses.map((m) => limitesDoMes(m, tenant.fuso));
  return withTenant(
    ctx,
    async (tx) => {
      const vivo = sql`anonimizado_em is null`;
      const ativo = sql`${vivo} and status = 'ativo'`;
      const idade = sql`extract(year from age(${hoje}::date, data_nascimento))`;
      const faixa = (min: number, max: number | null) => sql`${ativo} and ${idade} >= ${min}${max === null ? sql`` : sql` and ${idade} <= ${max}`}`;
      const conta = (condicao: SQL) => sql`count(*) filter (where ${condicao})::int`;
      const { rows } = await tx.execute<{
        ativos: number;
        arquivados: number;
        bloqueados: number;
        feminino: number;
        masculino: number;
        sem_sexo: number;
        menos_de_18: number;
        adultos: number;
        idosos: number;
        sem_nascimento: number;
        faixas: number[];
        novos: number[];
      }>(sql`
        select
          ${conta(ativo)} as ativos,
          ${conta(sql`${vivo} and status = 'arquivado'`)} as arquivados,
          ${conta(sql`${vivo} and status = 'bloqueado'`)} as bloqueados,
          ${conta(sql`${ativo} and sexo = 'F'`)} as feminino,
          ${conta(sql`${ativo} and sexo = 'M'`)} as masculino,
          ${conta(sql`${ativo} and sexo is null`)} as sem_sexo,
          ${conta(faixa(MENOS_DE_18.min, MENOS_DE_18.max))} as menos_de_18,
          ${conta(faixa(18, 59))} as adultos,
          ${conta(faixa(60, null))} as idosos,
          ${conta(sql`${ativo} and data_nascimento is null`)} as sem_nascimento,
          array[${sql.join(FAIXAS.map((f) => conta(faixa(f.min, f.max))), sql`, `)}]::int[] as faixas,
          array[${sql.join(meses.map((m) => conta(sql`created_at >= ${m.inicio} and created_at < ${m.fim}`)), sql`, `)}]::int[] as novos
        from patients
        where tenant_id = ${ctx.tenantId}`);
      const r = rows[0];
      const comBloqueados = o.acesso.papel === 'nutri';
      const fase: LinhaContagem[] = [
        ...(r.menos_de_18 > 0 ? [{ rotulo: L.menosDe18, n: r.menos_de_18 }] : []),
        { rotulo: L.adultos, n: r.adultos },
        { rotulo: L.idosos, n: r.idosos },
        { rotulo: L.semNascimento, n: r.sem_nascimento },
      ];
      return {
        situacao: {
          ativos: r.ativos,
          arquivados: r.arquivados,
          ...(comBloqueados ? { bloqueados: r.bloqueados } : {}),
          total: r.ativos + r.arquivados + (comBloqueados ? r.bloqueados : 0),
        },
        sexo: [
          { rotulo: L.feminino, n: r.feminino },
          { rotulo: L.masculino, n: r.masculino },
          { rotulo: L.naoInformado, n: r.sem_sexo },
        ],
        fase,
        faixas: FAIXAS.map((f, i) => ({ rotulo: f.rotulo, n: r.faixas[i] })),
        novosPorMes: p.meses.map((mes, i) => ({ mes, n: r.novos[i] })),
      };
    },
    deps.db ?? getDb(),
  );
}
