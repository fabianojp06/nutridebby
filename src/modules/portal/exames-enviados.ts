import { and, count, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { detectarTipo } from '@/lib/file-type';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { dataValida, hojeNoFuso, somarAnos } from '@/modules/pacientes/datas';
import {
  ENVIO_FOTO_MAX_BYTES, ENVIO_MAX_FOTOS, ENVIO_MAX_PIXELS, ENVIO_PDF_MAX_BYTES, ENVIO_TOTAL_MAX_BYTES, ENVIOS_PENDENTES_MAX, ENVIOS_POR_DIA_MAX,
  MSG_ENVIO, NOME_ENVIO_MAX, OBSERVACAO_ENVIO_MAX, situacaoParaPaciente, type StatusEnvio,
} from '@/modules/pacientes/exames-enviados-constantes';
import { CotaEsgotadaError, salvarArquivos, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { pacienteDaSessao } from './sessao';

type Campo = 'dataColeta' | 'nome' | 'observacao' | 'arquivos' | 'geral';

/** Recusa com o texto da spec. `status`: o da resposta da rota (404 = recebimento desligado ou envio que não é dele). */
export class EnvioError extends Error {
  override name = 'EnvioError';
  constructor(
    readonly status: 400 | 404 | 409 | 507,
    readonly erros: Partial<Record<Campo, string>>,
  ) {
    super('Envio de exame recusado');
  }
}

/**
 * RN-161 (D13 = b): 1 PDF de até 20 MB OU 1 a 5 fotos JPEG/PNG/HEIC de até 10 MB cada, somando até 30 MB; tipo pelo conteúdo;
 * JPEG/PNG acima de 40 MP recusados pelo CABEÇALHO (sharp metadata, sem decodificar — como a digitalizada, RN-157); o HEIC e o
 * número de páginas do PDF são conferidos no worker. Fora disso, null (a rota mostra a mensagem única da US-160).
 */
export async function classificarArquivos(arquivos: readonly Buffer[]): Promise<{ tipo: 'pdf' | 'fotos' } | null> {
  if (!arquivos.length || arquivos.length > ENVIO_MAX_FOTOS) return null;
  if (arquivos.reduce((s, b) => s + b.length, 0) > ENVIO_TOTAL_MAX_BYTES) return null;
  const exts = arquivos.map((b) => (b.length ? detectarTipo(b)?.ext : undefined));
  if (exts.includes('pdf')) return arquivos.length === 1 && arquivos[0].length <= ENVIO_PDF_MAX_BYTES ? { tipo: 'pdf' } : null;
  for (let i = 0; i < arquivos.length; i++) {
    const ext = exts[i];
    if (ext !== 'jpg' && ext !== 'png' && ext !== 'heic') return null;
    if (arquivos[i].length > ENVIO_FOTO_MAX_BYTES) return null;
    if (ext === 'heic') continue;
    const m = await sharp(arquivos[i], { limitInputPixels: ENVIO_MAX_PIXELS, failOn: 'error' }).metadata().catch(() => null);
    if (!m?.width || !m.height || m.width * m.height > ENVIO_MAX_PIXELS) return null;
  }
  return { tipo: 'fotos' };
}

/** Texto digitado: NFC e sem espaço nas pontas; o nome também junta os espaços (a observação guarda as quebras de linha). */
const texto = (v: unknown, juntarEspacos: boolean): string => {
  if (typeof v !== 'string') return '';
  const t = v.normalize('NFC').trim();
  return juntarEspacos ? t.replace(/\s+/g, ' ') : t;
};
const caracteres = (s: string) => [...s].length; // code points, como o CHECK (char_length)

/**
 * RN-160 / RN-162, conferidas com o paciente TRAVADO (FOR UPDATE; ele pode ter sido arquivado ou bloqueado no meio) e de
 * novo no `antesDaReserva` da transação que grava: recebimento ligado (D18), paciente ativo e não anonimizado, no máximo 10
 * envios aguardando e 5 no dia (fuso do tenant). Os cancelados contam no dia (o limite é de envios, não de pendências).
 * O recebimento ligado é lido SEM trava (revisão do plano; janela aceita pela D18 = a — desligar só esconde a opção e os envios
 * já gravados seguem): um envio que chega no instante em que a nutricionista desliga ainda passa. Travar o tenant não serve:
 * KEY SHARE não conflita com o NO KEY UPDATE de quem desliga, e FOR SHARE fecharia deadlock entre dois envios do mesmo
 * consultório na reserva de cota.
 */
async function conferirAntesDeGravar(tx: Tx, tenantId: string, patientId: string, fuso: string, agora: Date): Promise<void> {
  const [t] = await tx.select({ ligado: tenants.examesPacienteAtivadoEm }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t?.ligado) throw new EnvioError(404, {});
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo' || p.anonimizadoEm) throw new EnvioError(409, { geral: MSG_ENVIO.indisponivel });
  const [{ pendentes }] = await tx
    .select({ pendentes: count() })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.patientId, patientId), inArray(examSubmissions.status, ['processando', 'recebido'])));
  if (pendentes >= ENVIOS_PENDENTES_MAX) throw new EnvioError(409, { geral: MSG_ENVIO.pendentes });
  const hoje = partesNoFuso(agora, fuso).data;
  const [{ noDia }] = await tx
    .select({ noDia: count() })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.patientId, patientId), gte(examSubmissions.createdAt, inicioDoDia(hoje, fuso)), lt(examSubmissions.createdAt, inicioDoDia(somarDias(hoje, 1), fuso))));
  if (noDia >= ENVIOS_POR_DIA_MAX) throw new EnvioError(409, { geral: MSG_ENVIO.porDia });
}

/**
 * US-160 / RN-163: o envio nasce "processando". Todos os originais (tipo `exame_original`) entram por `salvarArquivos` com UMA
 * reserva de cota pela soma; o `registrar` grava o envio, as linhas "original" e o job `exame-envio` na MESMA transação —
 * tudo ou nada (DEP-09: a sessão de paciente não desfaria um envio gravado pela metade). Nada vai ao prontuário aqui.
 */
export async function enviarExame(
  ctx: TenantContext,
  tenant: { fuso: string },
  entrada: { dataColeta: unknown; nome: unknown; observacao: unknown; arquivos: Buffer[] },
  deps: { db?: Db; agora?: Date; dataDir?: string; boss?: PgBoss } = {},
): Promise<{ id: string }> {
  const patientId = pacienteDaSessao(ctx, 'enviarExame');
  const conta = ctx.actorUserId;
  if (!conta) throw new Error('enviarExame: sessão de paciente sem conta');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const nome = texto(entrada.nome, true);
  const observacao = texto(entrada.observacao, false);
  // NUL não cabe num `text` do Postgres (SQLSTATE 22021): sem isto, um 500 em vez de um 400
  if (nome.includes('\0') || observacao.includes('\0')) throw new EnvioError(400, { geral: MSG_ENVIO.formulario });
  const erros: Partial<Record<Campo, string>> = {};
  if (caracteres(nome) > NOME_ENVIO_MAX) erros.nome = MSG_ENVIO.nome;
  if (caracteres(observacao) > OBSERVACAO_ENVIO_MAX) erros.observacao = MSG_ENVIO.observacao;
  const dataColeta = typeof entrada.dataColeta === 'string' ? entrada.dataColeta.trim() : '';
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const [p] = await withTenant(ctx, (tx) => tx.select({ nascimento: patients.dataNascimento }).from(patients).where(eq(patients.id, patientId)), db);
  if (!dataValida(dataColeta)) erros.dataColeta = MSG_ENVIO.dataObrigatoria;
  else if (dataColeta > hoje) erros.dataColeta = MSG_ENVIO.dataFutura;
  else if (dataColeta < somarAnos(hoje, -10) || (p?.nascimento && dataColeta < p.nascimento)) erros.dataColeta = MSG_ENVIO.dataConfira;
  if (!(await classificarArquivos(entrada.arquivos))) erros.arquivos = MSG_ENVIO.arquivos;
  if (Object.keys(erros).length) throw new EnvioError(400, erros);
  // barato e antes de mandar até 30 MB ao disco; vale de novo, com a trava, na transação que grava
  await withTenant(ctx, (tx) => conferirAntesDeGravar(tx, ctx.tenantId, patientId, tenant.fuso, agora), db);
  // fora da transação: o start do pg-boss não pode esperar segurando a conexão (e a trava) do paciente
  const boss = deps.boss ?? (await getBoss());
  let id = '';
  try {
    await salvarArquivos(
      ctx,
      {
        tipo: 'exame_original',
        conteudos: entrada.arquivos,
        permitidos: ['pdf', 'jpg', 'png', 'heic'],
        patientId,
        antesDaReserva: (tx) => conferirAntesDeGravar(tx, ctx.tenantId, patientId, tenant.fuso, agora),
        registrar: async (tx, arquivos) => {
          const [e] = await tx
            .insert(examSubmissions)
            .values({ tenantId: ctx.tenantId, patientId, enviadoPor: conta, status: 'processando', dataColeta, nome: nome || null, observacao: observacao || null, createdAt: agora, updatedAt: agora })
            .returning({ id: examSubmissions.id });
          id = e.id;
          await tx.insert(examSubmissionFiles).values(arquivos.map((a, i) => ({ tenantId: ctx.tenantId, patientId, submissionId: e.id, arquivoPath: a.caminho, papel: 'original', ordem: i + 1 })));
          const job = await boss.send('exame-envio', { tenantId: ctx.tenantId, envioId: e.id }, { db: fromDrizzle(tx, sql) });
          if (!job) throw new Error('A fila recusou o processamento do exame enviado');
        },
      },
      { db, dataDir: deps.dataDir },
    );
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new EnvioError(400, { arquivos: MSG_ENVIO.arquivos });
    if (e instanceof CotaEsgotadaError) throw new EnvioError(507, { geral: MSG_ENVIO.cota });
    throw e;
  }
  return { id };
}

export type MeuEnvio = {
  id: string;
  enviadoEm: Date;
  dataColeta: string;
  nome: string | null;
  status: StatusEnvio;
  /** §6.2: o texto que o paciente vê. */
  situacao: string;
  /** D17 = a: o próprio PDF limpo, só enquanto aguarda a revisão. */
  podeBaixar: boolean;
  /** "Cancelar envio": no recebido cancela; no processando mostra "Aguarde o processamento terminar." (US-161). */
  mostraCancelar: boolean;
};

/**
 * US-161 / RN-169: os envios do paciente da sessão (RLS por paciente), mais recentes primeiro, sem os cancelados ("some da
 * lista"). Projeção fechada: nunca caminho de arquivo, códigos internos nem a revisão. Leitura do titular auditada (D22).
 */
export async function meusEnvios(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<MeuEnvio[]> {
  const patientId = pacienteDaSessao(ctx, 'meusEnvios');
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select()
        .from(examSubmissions)
        .where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado')))
        .orderBy(desc(examSubmissions.createdAt))
        .limit(o.limite ?? 50);
      if (r.length) await auditRead(tx, { entidade: 'exames_enviados', entidadeId: null, patientId });
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map((e) => ({
    id: e.id,
    enviadoEm: e.createdAt,
    dataColeta: e.dataColeta,
    nome: e.nome,
    status: e.status as StatusEnvio,
    situacao: situacaoParaPaciente(e),
    podeBaixar: e.status === 'recebido' && !!e.arquivoPath,
    mostraCancelar: e.status === 'recebido' || e.status === 'processando',
  }));
}

/** D17 = a / RN-169: o caminho do próprio PDF limpo, só com o envio "recebido" (depois do aceite é laudo: US-044). Auditado. */
export async function pdfDoMeuEnvio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<string | null> {
  const patientId = pacienteDaSessao(ctx, 'pdfDoMeuEnvio');
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx
        .select({ caminho: examSubmissions.arquivoPath })
        .from(examSubmissions)
        .where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'recebido')));
      if (!e?.caminho) return null;
      await auditRead(tx, { entidade: 'exames_enviados', entidadeId: id, patientId });
      return e.caminho;
    },
    db,
  );
}

/**
 * RN-166: a sessão de paciente marca o próprio envio "recebido" como "cancelado" (a única transição que a política e o gatilho
 * deixam) e enfileira `exame-envio-limpar` na MESMA transação; quem apaga os arquivos é o worker. "processando" → "Aguarde o
 * processamento terminar."; outro envio, revisado ou inexistente → 404.
 * `soConferir` (a tela ainda mostrava "Processando…", sem a confirmação da US-161): nunca cancela; só responde a situação
 * ("processando" → 409 "Aguarde…"; "recebido" → nada muda e a tela é refeita com o botão que confirma; outro → 404).
 */
export async function cancelarMeuEnvio(
  ctx: TenantContext,
  id: string,
  deps: { db?: Db; boss?: PgBoss; agora?: Date; soConferir?: boolean } = {},
): Promise<void> {
  const patientId = pacienteDaSessao(ctx, 'cancelarMeuEnvio');
  if (!idValido(id)) throw new EnvioError(404, {});
  if (deps.soConferir) {
    const status = await withTenant(
      ctx,
      async (tx) =>
        (await tx.select({ status: examSubmissions.status }).from(examSubmissions).where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId))))[0]?.status,
      deps.db ?? getDb(),
    );
    if (status === 'processando') throw new EnvioError(409, { geral: MSG_ENVIO.aguarde });
    if (status !== 'recebido') throw new EnvioError(404, {});
    return;
  }
  const boss = deps.boss ?? (await getBoss());
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .update(examSubmissions)
        .set({ status: 'cancelado', updatedAt: agora })
        .where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'recebido')))
        .returning({ id: examSubmissions.id });
      if (!r.length) {
        const [e] = await tx.select({ status: examSubmissions.status }).from(examSubmissions).where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId)));
        if (e?.status === 'processando') throw new EnvioError(409, { geral: MSG_ENVIO.aguarde });
        throw new EnvioError(404, {});
      }
      const job = await boss.send('exame-envio-limpar', { tenantId: ctx.tenantId, envioId: id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a limpeza do envio cancelado');
    },
    deps.db ?? getDb(),
  );
}

/**
 * Plano 16 (RN-192): o paciente da sessão tem envio não cancelado? Decide se a seção "Exames" aparece com o recebimento
 * desligado. Só a existência — nenhum dado do envio sai daqui —, sem auditRead (como as contagens do painel).
 */
export async function temEnvioVisivel(ctx: TenantContext, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'temEnvioVisivel');
  const r = await withTenant(
    ctx,
    (tx) => tx.select({ id: examSubmissions.id }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado'))).limit(1),
    db,
  );
  return r.length > 0;
}
