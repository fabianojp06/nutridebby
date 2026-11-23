import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { mensagemDaFalha, mensagemDoComando, reiniciarDoisFatores } from '@/modules/plataforma/reiniciar-2fa';

// P09-02 (b) / manual técnico §6.9.1: quando nenhum admin consegue entrar (troca do AUTH_SECRET). Mexe no banco em que
// roda: em produção, só o dono, com OK explícito e snapshot no hPanel antes (regras 3 e 5 do servidor).
const email = process.argv[2];
if (!email) {
  console.error('Uso: pnpm admin:reiniciar-2fa <email>');
  process.exit(1);
}
try {
  const r = await reiniciarDoisFatores(email, { origem: 'cli', adminId: null });
  console.log(`Verificação em duas etapas reiniciada; ${r.sessoesRevogadas} sessão(ões) encerrada(s).`);
  console.log(mensagemDoComando(r.papel)); // Plano 26 (RE-D20): obrigatória também para a recepção
} catch (e) {
  console.error(mensagemDaFalha(e)); // erro inesperado: nome e SQLSTATE, nunca a mensagem (regra 3)
  process.exitCode = 1;
} finally {
  await stopBoss();
  await closeDb();
}
