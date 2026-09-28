import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getEnv } from '@/env';
import { verifyFileUrl } from '@/lib/signed-url';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};
const erro = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** Arquivos de /data só por URL assinada (TTL 5 min). A assinatura é emitida por quem já checou o acesso. */
export async function GET(req: Request) {
  const v = verifyFileUrl(new URL(req.url).searchParams);
  if (!v.ok) return erro(v.motivo === 'expirado' ? 410 : 403);
  let alvo: string;
  try {
    alvo = resolverCaminho(getEnv().DATA_DIR, v.caminho);
  } catch {
    return erro(403);
  }
  const info = await stat(alvo).catch(() => null);
  if (!info?.isFile()) return erro(404);
  const ext = v.caminho.slice(v.caminho.lastIndexOf('.') + 1);
  return new Response(Readable.toWeb(createReadStream(alvo)) as ReadableStream, {
    headers: {
      'content-type': MIME[ext],
      'content-length': String(info.size),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline',
      'referrer-policy': 'no-referrer',
    },
  });
}
