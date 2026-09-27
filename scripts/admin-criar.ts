import { closeDb } from '@/db/client';
import { AdminBootstrapError, createAdmin } from '@/modules/plataforma/admin-bootstrap';

const email = process.argv[2];
if (!email) {
  console.error('Uso: pnpm admin:criar <email>');
  process.exit(1);
}
try {
  const { link } = await createAdmin(email);
  console.log('Admin criado. Abra o link abaixo para definir a senha (válido por 1 hora, uso único):');
  console.log(link);
  console.log('No primeiro acesso, a verificação em duas etapas será obrigatória.');
} catch (e) {
  console.error(e instanceof AdminBootstrapError ? e.message : 'Erro inesperado ao criar admin');
  process.exitCode = 1;
} finally {
  await closeDb();
}
