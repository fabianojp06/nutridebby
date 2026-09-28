// T10-R4: rasteriza um SVG (stdin) para PNG de até 512 px (stdout) num processo isolado, para o
// pai poder matá-lo (SIGKILL) se a rasterização passar do tempo — o `.timeout()` do sharp não
// limita o librsvg. Deve continuar em .mjs puro (sem TypeScript/aliases): roda com `node` direto,
// tanto em dev quanto na imagem (o Dockerfile copia /app/scripts e /app/node_modules).
// Nunca escreve o conteúdo do arquivo em stderr/stdout além do PNG.
import sharp from 'sharp';

const LADO_MAX = 512;
sharp.concurrency(1);

const partes = [];
for await (const parte of process.stdin) partes.push(parte);

try {
  const png = await sharp(Buffer.concat(partes), { density: 300, limitInputPixels: 40_000_000, failOn: 'error' })
    .rotate()
    .resize(LADO_MAX, LADO_MAX, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  process.stdout.write(png, () => process.exit(0));
} catch {
  process.exit(2);
}
