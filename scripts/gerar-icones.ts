// D21: ícones do PWA a partir do SVG (rodar com `pnpm icones` quando a arte mudar; os PNG ficam no repositório).
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile('public/icones/icone.svg');
const saidas: [string, number][] = [
  ['public/icones/icone-192.png', 192],
  ['public/icones/icone-512.png', 512],
  ['public/icones/icone-maskable-512.png', 512],
  ['public/icones/apple-touch-icon.png', 180],
];
for (const [arquivo, lado] of saidas) {
  await sharp(svg, { density: 384 }).resize(lado, lado).png({ compressionLevel: 9 }).toFile(arquivo);
}
console.log(`ícones gerados: ${saidas.length}`);
