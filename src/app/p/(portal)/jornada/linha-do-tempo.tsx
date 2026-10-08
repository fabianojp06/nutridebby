import Link from 'next/link';
import { MSG_JORNADA, type Marco } from '@/modules/portal/jornada-regras';
import { QuandoLocal } from '../../quando-local';

/**
 * Plano 16 (§4.5, molde GV-Jornada): da próxima consulta para a primeira. O marco da próxima é âmbar com contorno de 2 px
 * (RN-207; 1,55:1 sozinho contra o fundo claro) e nunca é a única pista — o texto diz "próxima consulta". A orientação é a
 * dela, verbatim (RN-194). Sem texto do sistema com voz de orientação ("Leve suas dúvidas anotadas." não entra).
 */
export function LinhaDoTempo({ marcos, fuso }: { marcos: Marco[]; fuso: string }) {
  return (
    <ol aria-label="Linha do tempo" className="space-y-5 border-l-2 border-borda pl-5">
      {marcos.map((m) => (
        <li key={m.tipo === 'proxima' ? `proxima-${m.consultaId}` : `${m.tipo}-${m.data}-${m.titulo}`} className="relative space-y-2">
          <span
            aria-hidden="true"
            className={m.tipo === 'proxima' ? 'absolute -left-[1.85rem] top-1 size-4 rounded-full border-2 border-p-marco-texto bg-p-marco' : 'absolute -left-[1.7rem] top-1.5 size-3 rounded-full bg-marca'}
          />
          {m.tipo === 'proxima' ? (
            <>
              <h2 className="font-portal-titulo text-lg font-bold">
                <QuandoLocal semFuso={m.quando.semFuso} comFuso={m.quando.comFuso} fuso={fuso} />
                {` · ${MSG_JORNADA.proxima}`}
              </h2>
              <p>{m.modalidade}</p>
              <Link href={`/p/agenda/${m.consultaId}`} className="inline-flex min-h-11 items-center font-semibold text-link underline">{MSG_JORNADA.verConsulta}</Link>
            </>
          ) : (
            <>
              <h2 className="font-portal-titulo text-lg font-bold">{m.tipo === 'atendimento' && m.primeira ? `${m.titulo} · ${MSG_JORNADA.primeira}` : m.titulo}</h2>
              {m.medidas.length > 0 && <p>{m.medidas.map((x) => x.texto).join(' · ')}</p>}
              {m.tipo === 'atendimento' && m.orientacao && (
                <div className="rounded-2xl bg-p-clara p-3">
                  <p className="text-sm font-semibold">{MSG_JORNADA.orientacao}</p>
                  <p className="whitespace-pre-line">{m.orientacao}</p>
                </div>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
