import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { diaryEntries, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { FOTO_DIARIO_MAX_BYTES, LIMITE_DIARIO_POR_DIA, MSG_DIARIO, REFEICOES_DO_DIARIO, TEXTO_DIARIO_MAX } from './diario-constantes';
import { pacienteDaSessao } from './sessao';

export class DiarioError extends Error {
  override name = 'DiarioError';
  constructor(readonly erros: Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>>) {
    super('Registro do diário inválido');
  }
}

export type RegistroDoDiario = {
  id: string;
  dataHora: Date;
  refeicao: string;
  texto: string | null;
  foto: { estado: 'sem_foto' | 'processando' | 'falhou' } | { estado: 'pronta'; caminho: string };
  comentario: string | null;
  comentadoEm: Date | null;
};

type Deps = { db?: Db; agora?: Date; dataDir?: string; boss?: PgBoss };

/**
 * D12: trava o paciente (a corrida do 11º registro) e conta os registros do dia no fuso do tenant. Paciente fora de
 * "ativo" (RN-08) não registra — requirePaciente já barra; aqui é a garantia dentro da transação.
 */
async function conferirLimite(tx: Tx, patientId: string, fuso: string, agora: Date): Promise<void> {
  const [p] = await tx.select({ status: patients.status }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo') throw new DiarioError({ geral: 'Conta temporariamente indisponível' });
  const hoje = partesNoFuso(agora, fuso).data;
  const [{ n }] = await tx
    .select({ n: count() })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.patientId, patientId), gte(diaryEntries.dataHora, inicioDoDia(hoje, fuso)), lt(diaryEntries.dataHora, inicioDoDia(somarDias(hoje, 1), fuso))));
  if (n >= LIMITE_DIARIO_POR_DIA) throw new DiarioError({ geral: MSG_DIARIO.limite });
}

/**
 * US-042 / RN-07: registro com texto e/ou foto. A foto original (JPEG/PNG/HEIC ≤ 10 MB, tipo pelo conteúdo) entra por
 * salvarArquivo e o registro + o job de conversão vão no `registrar` (mesma transação, CLAUDE.md regra 9). Cota esgotada
 * com texto → o texto é salvo sem a foto (US-042 "Cota de armazenamento"); só a foto → erro da cota.
 */
export async function registrarNoDiario(
  ctx: TenantContext,
  tenant: { fuso: string },
  input: { refeicao: unknown; texto: unknown; foto: Buffer | null },
  deps: Deps = {},
): Promise<{ id: string; semFoto: boolean }> {
  const patientId = pacienteDaSessao(ctx, 'registrarNoDiario');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const refeicao = typeof input.refeicao === 'string' ? input.refeicao : '';
  if (!(REFEICOES_DO_DIARIO as readonly string[]).includes(refeicao)) throw new DiarioError({ refeicao: MSG_DIARIO.refeicao });
  const texto = typeof input.texto === 'string' ? input.texto.normalize('NFC').trim() : '';
  if (texto.length > TEXTO_DIARIO_MAX) throw new DiarioError({ texto: MSG_DIARIO.texto });
  const foto = input.foto && input.foto.length > 0 ? input.foto : null;
  if (!texto && !foto) throw new DiarioError({ geral: MSG_DIARIO.vazio });
  if (foto && foto.length > FOTO_DIARIO_MAX_BYTES) throw new DiarioError({ foto: MSG_DIARIO.foto });

  const soTexto = () =>
    withTenant(
      ctx,
      async (tx) => {
        await conferirLimite(tx, patientId, tenant.fuso, agora);
        const [e] = await tx.insert(diaryEntries).values({ tenantId: ctx.tenantId, patientId, dataHora: agora, refeicao, texto, createdAt: agora, updatedAt: agora }).returning({ id: diaryEntries.id });
        return e.id;
      },
      db,
    );
  if (!foto) return { id: await soTexto(), semFoto: false };

  // Fora da transação: o start do pg-boss não pode esperar segurando a conexão (e a trava) do paciente
  const boss = deps.boss ?? (await getBoss());
  let id = '';
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'diario_foto_original',
        conteudo: foto,
        permitidos: ['jpg', 'png', 'heic'],
        patientId,
        antesDaReserva: (tx) => conferirLimite(tx, patientId, tenant.fuso, agora),
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .insert(diaryEntries)
            .values({ tenantId: ctx.tenantId, patientId, dataHora: agora, refeicao, texto: texto || null, fotoOriginalPath: arquivo.caminho, fotoStatus: 'processando', createdAt: agora, updatedAt: agora })
            .returning({ id: diaryEntries.id });
          id = e.id;
          const job = await boss.send('diario-foto', { tenantId: ctx.tenantId, entryId: e.id }, { db: fromDrizzle(tx, sql) });
          if (!job) throw new Error('A fila recusou a conversão da foto');
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return { id, semFoto: false };
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new DiarioError({ foto: MSG_DIARIO.foto });
    if (e instanceof CotaEsgotadaError) {
      if (!texto) throw new DiarioError({ foto: MSG_COTA_ESGOTADA });
      return { id: await soTexto(), semFoto: true };
    }
    throw e;
  }
}

/** US-042: os registros do paciente da sessão (mais recentes primeiro), com o estado da foto. Leitura auditada (D22). */
export async function diarioDoPaciente(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<RegistroDoDiario[]> {
  const patientId = pacienteDaSessao(ctx, 'diarioDoPaciente');
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, patientId)).orderBy(desc(diaryEntries.dataHora)).limit(o.limite ?? 50);
      if (r.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map(paraRegistro);
}

/** Só `foto_path` (o JPEG convertido) vira caminho assinável; o original (`foto_original_path`) nunca sai daqui. */
export function paraRegistro(e: typeof diaryEntries.$inferSelect): RegistroDoDiario {
  return {
    id: e.id,
    dataHora: e.dataHora,
    refeicao: e.refeicao,
    texto: e.texto,
    foto:
      e.fotoStatus === 'pronta' && e.fotoPath
        ? { estado: 'pronta', caminho: e.fotoPath }
        : { estado: e.fotoStatus === 'pronta' ? 'falhou' : e.fotoStatus === 'removida' ? 'sem_foto' : (e.fotoStatus as 'sem_foto' | 'processando' | 'falhou') },
    comentario: e.comentarioNutri,
    comentadoEm: e.comentadoEm,
  };
}
