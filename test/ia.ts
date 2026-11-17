import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import {
  anamneses,
  anthropometry,
  consultationNotes,
  consultations,
  diaryEntries,
  energyCalcs,
  exams,
  iaAutorizacoes,
  iaGeracoesModelos,
  iaTarefas,
  mealItems,
  mealPlans,
  meals,
  patients,
  storedFiles,
  tenants,
  type PatientRow,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { ConfigIA } from '@/modules/ia/modo';
import { AUTORIZACAO_IA_USOS, AUTORIZACAO_IA_VERSAO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { criarExame } from '@/modules/pacientes/exames';
import { eq } from 'drizzle-orm';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { novoPaciente } from './pacientes';

/** Bytes que o detectarTipo aceita como PDF (para exames cujo conteúdo não é lido). Para um PDF de verdade, `pdfDeTeste`. */
export const PDF_MINIMO = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20)]);

/** A IA liberada pela admin e ativada pela nutricionista, com o aditivo atual (Plano 14A: com o 0.1, o consultório ficaria "aditivo desatualizado"). */
export async function iaPronta(db: Db, tenantId: string, o: { cotaUsd?: number; aditivo?: string } = {}): Promise<void> {
  await db
    .update(tenants)
    .set({ iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: o.aditivo ?? IA_ADITIVO_VERSAO, iaCotaMensalUsd: o.cotaUsd ?? 15 })
    .where(eq(tenants.id, tenantId));
}

/** Plano 14A: paciente com a autorização vigente (os usos da versão atual — os três, Plano 14B — destino `teste` — o dos provedores fake e sandbox). */
export async function pacienteAutorizado(db: Db, ctx: TenantContext, extra: Partial<typeof patients.$inferInsert> = {}): Promise<PatientRow> {
  const p = await novoPaciente(db, ctx, extra);
  await autorizacaoNoBanco(db, ctx.tenantId, p.id);
  return p;
}

/** Exame com laudo gravado pelo caminho real (salvarArquivo). */
export async function exameComLaudo(
  db: Db,
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  o: { dataDir: string; conteudo?: Buffer; valores?: unknown[]; data?: string; now?: Date },
): Promise<string> {
  return criarExame(ctx, tenant, patientId, { titulo: 'Hemograma', data: o.data ?? '2026-09-01', valores: o.valores ?? [], arquivo: o.conteudo ?? PDF_MINIMO }, { db, dataDir: o.dataDir, now: o.now ?? new Date('2026-10-01T15:00:00Z') });
}

/** Plano 14B (RN-120, D11): um carimbo fictício (64 hex) — o CHECK ia_tarefas_carimbo_so_resumo (0113) o exige no resumo. */
export const CARIMBO_TESTE = '0'.repeat(64);

/** Tarefa gravada direto (sem reserva nem fila), para testes de banco e de tela. No resumo, `carimboDados` padrão = CARIMBO_TESTE. */
export async function tarefaNoBanco(db: Db, ctx: TenantContext, patientId: string, examId: string | null, o: Partial<typeof iaTarefas.$inferInsert> = {}): Promise<string> {
  const [t] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(iaTarefas)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          tipo: 'leitura_exame',
          status: 'na_fila',
          examId,
          pedidoPor: ctx.actorUserId ?? randomUUID(),
          modelo: 'claude-opus-5-5',
          promptVersao: 'teste',
          reservaMicroUsd: 0,
          carimboDados: o.tipo === 'resumo_historico' ? CARIMBO_TESTE : null,
          ...o,
        })
        .returning({ id: iaTarefas.id }),
    db,
  );
  return t.id;
}

/** Plano 14B: uma geração de modelos gravada direto (sem reserva nem fila), para os testes de banco e de tela. */
export async function geracaoNoBanco(db: Db, ctx: TenantContext, o: Partial<typeof iaGeracoesModelos.$inferInsert> = {}): Promise<string> {
  const [g] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(iaGeracoesModelos)
        .values({ tenantId: ctx.tenantId, area: 'diabetes', status: 'na_fila', pedidoPor: ctx.actorUserId ?? randomUUID(), modelo: 'claude-sonnet-5-5', promptVersao: 'teste', reservaMicroUsd: 0, ...o })
        .returning({ id: iaGeracoesModelos.id }),
    db,
  );
  return g.id;
}

/** PDF de verdade (abre no pdf-lib), com texto por página e, se pedido, metadados com o "nome do paciente". */
export async function pdfDeTeste(o: { paginas?: number; textos?: string[]; titulo?: string; xmp?: string } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (o.paginas ?? 1); i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(o.textos?.[i] ?? `Glicose de jejum 92 mg/dL (página ${i + 1})`, { x: 50, y: 780, size: 11, font: fonte });
  }
  if (o.titulo) {
    doc.setTitle(o.titulo);
    doc.setAuthor(o.titulo);
    doc.setSubject(o.titulo);
    doc.setKeywords([o.titulo]);
  }
  if (o.xmp) doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(o.xmp, { Type: 'Metadata', Subtype: 'XML' })));
  return Buffer.from(await doc.save());
}

/** Foto "de celular": JPEG com EXIF (orientação e um texto no Copyright) — o preparo tem de girar e tirar tudo. */
export async function fotoDeTeste(o: { largura?: number; altura?: number; orientacao?: number; copyright?: string } = {}): Promise<Buffer> {
  const img = sharp({ create: { width: o.largura ?? 4000, height: o.altura ?? 3000, channels: 3, background: '#f0f0f0' } });
  return img.jpeg().withMetadata({ orientation: o.orientacao ?? 6, exif: { IFD0: { Copyright: o.copyright ?? 'Ana Souza' } } }).toBuffer();
}

/**
 * Plano 14A: um evento de autorização gravado pela sessão de paciente SEM conta (canal `link`, como o link do e-mail): o
 * único caminho de teste que a política paciente_autorizacao_propria e o gatilho ia_autorizacoes_regras (0108) aceitam
 * sem conta de login. `registrado_em` e `em` vêm do gatilho. Padrões: autorizou, a versão atual (AUTORIZACAO_IA_VERSAO), os usos da versão atual (os três, Plano 14B),
 * destino `teste` (o dos provedores sandbox/fake).
 */
export async function autorizacaoNoBanco(
  db: Db,
  tenantId: string,
  patientId: string,
  o: { evento?: 'autorizou' | 'retirou'; versao?: string; usos?: string[]; destino?: string; emailHmac?: string } = {},
): Promise<string> {
  const evento = o.evento ?? 'autorizou';
  const autorizou = evento === 'autorizou';
  const [r] = await withTenant(
    { tenantId, role: 'paciente', patientId, semConta: true },
    (tx) =>
      tx
        .insert(iaAutorizacoes)
        .values({
          tenantId, patientId, evento, canal: 'link', emailHmac: o.emailHmac ?? 'hmac-de-teste',
          versao: autorizou ? (o.versao ?? AUTORIZACAO_IA_VERSAO) : null,
          usos: autorizou ? (o.usos ?? [...AUTORIZACAO_IA_USOS]) : null,
          destino: autorizou ? (o.destino ?? 'teste') : null,
        })
        .returning({ id: iaAutorizacoes.id }),
    db,
  );
  return r.id;
}

/** Plano 14A: a linha de stored_files de um termo em papel (sem arquivo no disco; os testes de banco só precisam da FK). */
export async function termoNoDisco(db: Db, ctx: TenantContext, patientId: string): Promise<string> {
  const caminho = `${ctx.tenantId}/ia_autorizacao_termo/${randomUUID()}.pdf`;
  await withTenant(ctx, (tx) => tx.insert(storedFiles).values({ tenantId: ctx.tenantId, tipo: 'ia_autorizacao_termo', caminho, bytes: 100, mime: 'application/pdf', patientId }), db);
  return caminho;
}

/** Plano 14A: a configuração dos testes da IA — provedor falso (destino `teste`), retenção zero ligada, teto da plataforma folgado. */
export const IA_TESTE: ConfigIA = { modo: 'fake', destino: 'teste', modelo: 'claude-opus-5-5', modeloAssistente: 'claude-sonnet-5-5', geo: 'us', tetoGlobalMicroUsd: 50_000_000_000, tetoRascunhoMicroUsd: 1_000_000, retencao: 'zero', modeloPaciente: 'claude-haiku-5-5', nutriDesligada: false };

/**
 * Plano 14B: um prontuário com tudo o que a RN-120 lê — 4 atendimentos com orientações e notas, 6 antropometrias,
 * 3 cálculos, 2 exames com valores (com faixa de referência e título; o mais recente com o laudo em `arquivo_path`),
 * uma anamnese, 3 registros do diário (com o comentário da nutricionista; o mais recente com foto pronta e o original,
 * e a resposta "Comi outra coisa" com a cópia da refeição do plano) e um plano publicado. `marcador`: prefixo dos textos
 * que NUNCA podem sair (referência, título do exame, caminho do laudo, caminhos da foto, comentário do diário, refeição
 * do plano copiada no diário, título do plano) — e os textos livres citam o nome do paciente, que a máscara tira.
 * Gravado como `worker` (sem ator). As linhas de `stored_files` não têm arquivo no disco (os testes só leem o banco).
 */
export async function prontuarioCompleto(db: Db, ctx: TenantContext, patientId: string, marcador = 'MARCADOR'): Promise<void> {
  const w: TenantContext = { tenantId: ctx.tenantId, role: 'worker' };
  const [p] = await withTenant(w, (tx) => tx.select().from(patients).where(eq(patients.id, patientId)), db);
  const primeiro = p.nome.split(' ')[0];
  await withTenant(
    w,
    async (tx) => {
      for (const [i, data] of ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].entries()) {
        const [c] = await tx
          .insert(consultations)
          .values({ tenantId: ctx.tenantId, patientId, data, orientacoesPaciente: `${primeiro} deve beber mais água (${i}).` })
          .returning({ id: consultations.id });
        await tx.insert(consultationNotes).values({ tenantId: ctx.tenantId, patientId, consultationId: c.id, texto: `${marcador}-NOTA ${i}: ${p.nome} comenta ansiedade.` });
      }
      for (const [i, data] of ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].entries()) {
        await tx.insert(anthropometry).values({ tenantId: ctx.tenantId, patientId, data, pesoKg: 82.4 - i * 0.7, alturaCm: 165, circunferencias: { cintura: 90 - i } });
      }
      for (const fator of [1.2, 1.4, 1.5]) {
        await tx.insert(energyCalcs).values({ tenantId: ctx.tenantId, patientId, formula: 'mifflin', pesoKg: 80, alturaCm: 165, idade: 45, sexo: 'F', fatorAtividade: fator, tmb: 1500, get: 1500 * fator });
      }
      const arquivo = async (tipo: 'exame' | 'diario_foto' | 'diario_foto_original', nome: string, mime: string) => {
        const caminho = `${ctx.tenantId}/${tipo}/${marcador}-${nome}-${randomUUID()}`;
        await tx.insert(storedFiles).values({ tenantId: ctx.tenantId, tipo, caminho, bytes: 100, mime, patientId });
        return caminho;
      };
      const laudo = await arquivo('exame', 'LAUDO', 'application/pdf');
      for (const [data, valor] of [['2026-06-01', 110], ['2026-09-01', 98]] as const) {
        await tx.insert(exams).values({
          tenantId: ctx.tenantId,
          patientId,
          data,
          titulo: `${marcador}-TITULO-EXAME`,
          arquivoPath: data === '2026-09-01' ? laudo : null,
          valores: [{ nome: 'Glicose', valor, unidade: 'mg/dL', referencia: `${marcador}-REFERENCIA` }],
        });
      }
      await tx.insert(anamneses).values({
        tenantId: ctx.tenantId,
        patientId,
        data: '2026-06-01',
        templateSnapshot: {
          nome: 'Anamnese geral',
          perguntas: [
            { id: '00000000-0000-4000-8000-0000000000a1', tipo: 'texto_longo', rotulo: 'Rotina', obrigatoria: false },
            { id: '00000000-0000-4000-8000-0000000000a2', tipo: 'sim_nao', rotulo: 'Fuma?', obrigatoria: false },
          ],
        },
        respostas: { '00000000-0000-4000-8000-0000000000a1': `${p.nome} trabalha à noite.`, '00000000-0000-4000-8000-0000000000a2': false },
      });
      const foto = await arquivo('diario_foto', 'FOTO', 'image/jpeg');
      const fotoOriginal = await arquivo('diario_foto_original', 'FOTO-ORIGINAL', 'image/jpeg');
      for (const dias of [1, 2, 40]) {
        await tx.insert(diaryEntries).values({
          tenantId: ctx.tenantId,
          patientId,
          dataHora: new Date(Date.now() - dias * 86_400_000),
          refeicao: 'Almoço',
          texto: `Arroz e feijão. ${primeiro} comeu pouco.`,
          comentarioNutri: `${marcador}-COMENTARIO`,
          // o mais recente (dentro dos 30 dias): foto pronta + original e "Comi outra coisa" com a cópia da refeição do plano
          ...(dias === 1
            ? { fotoPath: foto, fotoOriginalPath: fotoOriginal, fotoStatus: 'pronta', resposta: 'outra_coisa', refeicaoDoPlano: `${marcador}-REFEICAO-PLANO · 12:00`, refeicaoSlot: `${marcador}-REFEICAO-PLANO · 12:00` }
            : {}),
        });
      }
      const [plano] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, patientId, titulo: `${marcador}-TITULO-PLANO`, status: 'publicado', publicadoEm: new Date('2026-09-01T12:00:00Z'), orientacoes: `${p.nome}, evite frituras.` })
        .returning({ id: mealPlans.id });
      const mealId = randomUUID();
      await tx.insert(meals).values({ id: mealId, tenantId: ctx.tenantId, patientId, planId: plano.id, nome: 'Almoço', horario: '12:00', ordem: 0 });
      await tx.insert(mealItems).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        patientId,
        planId: plano.id,
        mealId,
        foodId: '00000000-0000-4000-8000-000000000003',
        quantidadeG: 150,
        ordem: 0,
        nutrientes: { nome: 'Arroz, tipo 1, cozido', origem: 'TACO', kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 },
      });
    },
    db,
  );
}
