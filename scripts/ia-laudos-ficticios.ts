import path from 'node:path';
import { gerarLaudos } from '@/modules/ia/avaliacao/laudos-ficticios';

/** `pnpm ia:laudos [pasta]` — gera os 20 laudos fictícios e os gabaritos (padrão: ../nutridebby-avaliacao-ia, fora do repositório). */
const dir = path.resolve(process.argv[2] ?? process.env.IA_AVALIACAO_DIR ?? '../nutridebby-avaliacao-ia');
const raiz = path.resolve('.');
if (dir === raiz || dir.startsWith(raiz + path.sep)) {
  console.error('Escolha uma pasta FORA do repositório (os laudos não entram no git).');
  process.exit(1);
}
const arquivos = await gerarLaudos(dir);
console.info(`${arquivos.length} laudos fictícios gravados em ${dir}`);
