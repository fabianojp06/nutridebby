import { closeDb } from '@/db/client';
import { RESET_TOKEN_TTL_S } from '@/lib/auth';
import { AdminBootstrapError, createAdmin } from '@/modules/plataforma/admin-bootstrap';

const email = process.argv[2];
if (!email) {
  console.error('Uso: pnpm admin:criar <email>');
  process.exit(1);
}
try {
  const { link } = await createAdmin(email);
  const horas = RESET_TOKEN_TTL_S / 3600;
  console.log(`Admin criado. Abra o link abaixo para definir a senha (válido por ${horas === 1 ? '1 hora' : `${horas} horas`}, uso único):`);
  console.log(link);
  console.log('No primeiro acesso, a verificação em duas etapas será obrigatória.');
} catch (e) {
  console.error(e instanceof AdminBootstrapError ? e.message : 'Erro inesperado ao criar admin');
  process.exitCode = 1;
} finally {
  await closeDb();
}
