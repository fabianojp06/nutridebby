import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Document, Image, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { and, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import sharp from 'sharp';
import type { Db } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { soltarArquivosDoPreparo, travarDocumentoAntesDaCota } from './arquivos-do-preparo';
import { formatarCodigo } from './codigo';
import { EMITIDOS, MAX_PIXELS_FOTO, TIPO_DOCUMENTO_ROTULO, type TipoDocumento } from './constantes';
import { TransicaoInvalidaError } from './erros';
import type { ConteudoDocumento } from './parecer';
import { fotosLidas, registrarAssinatura } from './registrar-assinatura';

/** A4 a 300 dpi no lado maior: legível na farmácia, sem levar a foto original. */
const LADO_MAX_PAGINA = 3508;

/** Só o worker importa este arquivo (guarda de grafo). Ele importa `registrar-assinatura.ts`, sem sessão (D23). */
export async function renderizarDigitalizada(d: { paginas: { dados: Buffer; formato: 'jpg' }[]; codigo: string; urlVerificacao: string; titulo?: string }): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.urlVerificacao, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  // R2 do pre-flight do Plano 13: o título do PDF assinado segue o tipo (o parecer não abre como "Receita")
  const titulo = d.titulo ?? TIPO_DOCUMENTO_ROTULO.receita;
  return renderToBuffer(
    <Document title={`${titulo} (digitalizada)`} creator="NutriDebby" producer="NutriDebby">
      {d.paginas.map((p, i) => (
        <Page key={i} size="A4" style={{ padding: 24, paddingBottom: 72 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          <Image src={{ data: p.dados, format: p.formato }} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <View fixed style={{ position: 'absolute', left: 24, right: 24, bottom: 16, flexDirection: 'row', alignItems: 'center' }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
            <Image src={{ data: qr, format: 'png' }} style={{ width: 40, height: 40, marginRight: 8 }} />
            <Text style={{ fontSize: 8, flex: 1 }}>{`Documento digitalizado · Código de verificação: ${formatarCodigo(d.codigo)} · Verifique em ${d.urlVerificacao}`}</Text>
          </View>
        </Page>
      ))}
    </Document>,
  );
}

class JaFeitoError extends Error {}
class FotoInvalidaError extends Error {}

/**
 * RN-157: a foto NUNCA entra no PDF como veio. O pdfkit embute o JPEG com o APP1 (EXIF: GPS — muitas vezes a casa da
 * nutricionista —, modelo e série do aparelho) e não aplica a orientação. Aqui: limite de pixels, rotate() (aplica a
 * orientação do EXIF antes de descartá-lo) e o pipeline do diário e da capa (sem metadados, fundo branco).
 */
async function normalizarPagina(dados: Buffer): Promise<{ dados: Buffer; formato: 'jpg' }> {
  try {
    return { dados: await paraJpegSemMetadados(sharp(dados, { limitInputPixels: MAX_PIXELS_FOTO, failOn: 'error' }).rotate(), LADO_MAX_PAGINA), formato: 'jpg' };
  } catch {
    throw new FotoInvalidaError();
  }
}

/**
 * RN-157: o PDF novo com as fotos e o rodapé; a ida a "assinado" (tipo digitalizada) no registrar; depois, regra 9: cada
 * foto e o base no seu apagarArquivo, com o ponteiro no naMesmaTransacao (soltarArquivosDoPreparo). A versão lida (o código
 * e as fotos) amarra o registrar e o marcarFalhou (correções do /code-review high dos PRs #18 e #19): "Voltar a editar" +
 * novo preparo + envio novo enquanto este job monta (outro código), ou um envio novo depois de 1 h com o MESMO código
 * (outras fotos) → a versão nova, também "pendente", não é assinada com as fotos antigas nem marcada "falhou".
 */
export async function montarPdfDigitalizado(
  data: { tenantId: string; documentoId: string; userId: string },
  deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDigitalizada },
): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const agora = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const d = await withTenant(ctx, async (tx) => (await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.digitalizacaoStatus, 'pendente'))))[0] ?? null, db);
  if (!d || !d.codigo || !d.digitalizacao?.length) return 'ignorado';
  const codigo = d.codigo;
  const fotos = d.digitalizacao;
  const marcarFalhou = () =>
    withTenant(ctx, (tx) => tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou' }).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.digitalizacaoStatus, 'pendente'), eq(signedDocuments.codigo, codigo), fotosLidas(fotos))), db);
  // US-004 / RN-15 (como gerarPdfDoDocumento): consultório suspenso com o job na fila não assina nem publica a verificação
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorado';
  }
  try {
    // uma por vez (não Promise.all): até 5 fotos de 40 MP decodificadas juntas pesariam no worker de todos
    const paginas: { dados: Buffer; formato: 'jpg' }[] = [];
    for (const c of fotos) paginas.push(await normalizarPagina(await readFile(resolverCaminho(deps.dataDir, c))));
    const pdf = await (deps.renderizar ?? renderizarDigitalizada)({ paginas, codigo, urlVerificacao: urlDoApp(deps.appUrl, `/v/${codigo}`), titulo: TIPO_DOCUMENTO_ROTULO[d.tipo as TipoDocumento] });
    const sha = createHash('sha256').update(pdf).digest('hex');
    const copia = (d.conteudo as ConteudoDocumento).copia!.profissional;
    await salvarArquivo(ctx, {
      tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: d.patientId, substitui: d.basePdfPath ?? undefined,
      antesDaReserva: async (tx) => {
        const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId)).for('update');
        if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new JaFeitoError();
        await travarDocumentoAntesDaCota(tx, d.id); // paciente → documento → tenant (I2 do PR #19)
      },
      registrar: async (tx, arq) => {
        await registrarAssinatura(tx, {
          documentoId: d.id, codigo, patientId: d.patientId, tenantId: data.tenantId, caminho: arq.caminho, sha256: sha, tipo: 'digitalizada',
          emissor: null, assinanteNome: null, userId: data.userId, agora, copia, base: d.basePdfPath,
          versao: { codigo, digitalizacao: fotos }, // a versão lida: mesmo código, ainda "pendente" e as mesmas fotos
          appUrl: deps.appUrl,
        });
      },
    }, { db, dataDir: deps.dataDir });
    // regra 9: os ponteiros ficaram na assinatura; cada foto e o base saem agora no SEU apagar. R11: uma falha aqui (o
    // documento já está assinado) não vira "falhou" nem retry — a varredura da T7 repete a limpeza
    await soltarArquivosDoPreparo(ctx, d.id, EMITIDOS, { db, dataDir: deps.dataDir }).catch((err: unknown) =>
      logger.warn({ tenantId: data.tenantId, documentoId: data.documentoId, motivo: 'soltar_preparo', err: err instanceof Error ? err.name : 'erro' }, 'arquivos do preparo não soltos (a varredura tenta de novo)'),
    );
    return 'pronto';
  } catch (e) {
    if (e instanceof JaFeitoError || e instanceof TransicaoInvalidaError) {
      // casa só a versão lida (mesmo código e mesmas fotos) ainda "pendente": numa versão nova — outro código ou outro
      // envio, mesmo que também "pendente" — não muda nada
      await marcarFalhou();
      return 'ignorado';
    }
    if (e instanceof FotoInvalidaError || e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      // foto ilegível ou acima do limite de pixels não melhora na próxima tentativa: falha já, sem laço no pg-boss
      logger.warn({ documentoId: data.documentoId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : e instanceof FotoInvalidaError ? 'foto' : 'erro' }, 'PDF da digitalização não montado');
      await marcarFalhou();
      return 'falhou';
    }
    throw e;
  }
}
