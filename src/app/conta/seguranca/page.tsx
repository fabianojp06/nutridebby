import { BotaoSair } from '@/components/botao-sair';
import { requireUser } from '@/lib/session';
import { SECURITY_PATH } from '@/lib/session-rules';
import { Enable2fa } from './enable-2fa';
import { Aviso } from '@/components/ui/aviso';

export const dynamic = 'force-dynamic';

export default async function SegurancaPage() {
  const { user } = await requireUser(['admin', 'nutri'], SECURITY_PATH);
  return (
    <div data-tema="claro" className="min-h-dvh bg-fundo font-sans text-texto">
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-titulo text-2xl font-semibold">Segurança da conta</h1>
          {/* quem cai aqui obrigado a ativar o 2FA precisa poder sair sem configurar */}
          <BotaoSair />
        </div>
        {user.twoFactorEnabled ? (
          <p>A verificação em duas etapas está ativa.</p>
        ) : (
          <>
            {user.appRole === 'admin' && (
              <Aviso tipo="aviso" papel="alert">
                Para usar a administração, ative a verificação em duas etapas.
              </Aviso>
            )}
            <Enable2fa />
          </>
        )}
      </main>
    </div>
  );
}
