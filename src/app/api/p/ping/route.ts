export const dynamic = 'force-dynamic';

/** D6: o selo offline confere se há rede de verdade ("lie-fi": navigator.onLine verdadeiro e a rede não responde). */
export function GET(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
