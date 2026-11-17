import Link from 'next/link';
import { ComiAssim } from '@/components/portal/comi-assim';
import { signFileUrl } from '@/lib/signed-url';
import { MSG_DIARIO, ROTULO_RESPOSTA } from '@/modules/portal/diario-constantes';
import { MSG_MURAL, type ItemDoMural, type Mural } from '@/modules/portal/mural-regras';
import { QuandoLocal } from '../../quando-local';
import { ConfirmarNoMural } from './confirmar-no-mural';

const B = MSG_MURAL.botoes;
const LINK = 'inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-3 text-sm font-semibold text-link';

function Acoes({ item, guia }: { item: ItemDoMural; guia: boolean }) {
  const link = (href: string, texto: string, extra?: string) => (
    <Link href={href} className={LINK}>
      {texto}
      {extra && <span className="sr-only">{` ${extra}`}</span>}
    </Link>
  );
  switch (item.tipo) {
    case 'refeicao':
      return (
        <div data-guia={guia ? 'respostas' : undefined} className="flex flex-wrap items-start gap-2">
          {link(`/p/plano/refeicao/${item.refeicaoId}`, B.verRefeicao)}
          {!item.respondida && <ComiAssim refeicaoId={item.refeicaoId} />}
        </div>
      );
    case 'registro':
    case 'comentario':
      return link('/p/diario', B.verDiario);
    case 'exame':
      return link('/p/exames', B.verExames);
    case 'consulta':
      return (
        <div className="flex flex-wrap items-start gap-2">
          {link(`/p/agenda/${item.consultaId}`, B.verConsulta)}
          {/* sempre montado: depois do refresh (podeConfirmar = false) a confirmação continua na tela e anunciada */}
          <ConfirmarNoMural id={item.consultaId} podeConfirmar={item.podeConfirmar} />
        </div>
      );
    case 'plano':
      return link('/p/plano', B.verPlano);
    case 'conteudo':
      return link(`/p/conteudos/${item.conteudoId}`, B.abrir, item.titulo);
    case 'documentos':
      return link('/p/documentos', B.verDocumentos);
  }
}

function Corpo({ item, fuso }: { item: ItemDoMural; fuso: string }) {
  switch (item.tipo) {
    case 'registro':
      return (
        <>
          <p className="font-medium">{`${item.refeicao}${item.resposta ? ` · ${ROTULO_RESPOSTA[item.resposta]}` : ''}`}</p>
          {item.texto && <p className="whitespace-pre-line">{item.texto}</p>}
          {item.foto.estado === 'pronta' && (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (CLAUDE.md regra 9)
            <img src={signFileUrl(item.foto.caminho)} alt={`Foto do registro de ${item.refeicao}`} className="max-h-60 rounded-xl" />
          )}
          {item.foto.estado === 'processando' && <p className="text-sm">{MSG_DIARIO.processando}</p>}
          {item.foto.estado === 'falhou' && <p className="text-sm text-erro">{MSG_DIARIO.fotoFalhou}</p>}
        </>
      );
    case 'consulta':
      return <p><QuandoLocal semFuso={item.texto.semFuso} comFuso={item.texto.comFuso} fuso={fuso} /></p>;
    default:
      return <p className="whitespace-pre-line">{item.texto}</p>;
  }
}

/**
 * RNF-191, RN-194, §11.1 (correção da revisão do plano): autor VISÍVEL em todo item — "Você", "Aviso do app" ou o rótulo do
 * comentário dela —, não só o lado ou a cor do balão (que lembraria um chat, R-190). O comentário da nutricionista tem
 * estilo próprio (borda de destaque), diferente do aviso automático.
 */
// wrap-break-word (overflow-wrap, herdado pelo corpo e pelo rótulo do autor): o texto livre — comentário com um link longo
// (RN-194), o diário, o título do conteúdo — quebra dentro do balão e nunca alarga a página a 320 px (RNF-191, CS-193)
const ESTILO = {
  voce: 'ml-8 space-y-2 rounded-2xl bg-p-clara p-3 wrap-break-word',
  consultorio: 'mr-8 space-y-2 rounded-2xl border border-borda bg-cartao p-3 wrap-break-word',
  nutricionista: 'mr-8 space-y-2 rounded-2xl border border-borda border-l-4 border-l-marca bg-cartao p-3 wrap-break-word',
} as const;
function Item({ item, fuso, guia }: { item: ItemDoMural; fuso: string; guia: boolean }) {
  const autor = item.tipo === 'comentario' ? MSG_MURAL.nutricionistaComentou(item.sobre) : MSG_MURAL.autor[item.autor];
  return (
    <li className={ESTILO[item.autor]}>
      <p className="text-sm text-suave">
        <span className="font-semibold text-texto">{autor}</span>
        {item.hora && ' · '}
        {item.hora && <QuandoLocal semFuso={item.hora.semFuso} comFuso={item.hora.comFuso} fuso={fuso} />}
      </p>
      <Corpo item={item} fuso={fuso} />
      <Acoes item={item} guia={guia} />
    </li>
  );
}

/** Plano 16 (§4.3, RN-195): "Dias anteriores" recolhido acima; Hoje em ordem crescente; vazio com o texto da spec. */
export function MuralLista({ mural, fuso }: { mural: Mural; fuso: string }) {
  const primeiraRefeicao = mural.hoje.find((i) => i.tipo === 'refeicao')?.chave;
  return (
    <>
      {mural.anteriores.length > 0 && (
        <details className="rounded-2xl border border-borda bg-cartao p-3">
          <summary className="min-h-11 cursor-pointer font-semibold">{MSG_MURAL.diasAnteriores}</summary>
          {mural.anteriores.map((d) => (
            <section key={d.dia} aria-labelledby={`dia-${d.dia}`} className="mt-3 space-y-2">
              <h3 id={`dia-${d.dia}`} className="text-center text-sm font-semibold text-suave">{d.rotulo}</h3>
              <ol className="space-y-2">
                {d.itens.map((i) => <Item key={i.chave} item={i} fuso={fuso} guia={false} />)}
              </ol>
            </section>
          ))}
        </details>
      )}
      {/* decide pelo dia, não pelo mural todo: com itens só em "Dias anteriores" (toda manhã de quem já usa o app), Hoje
          ainda diz o texto da spec (§4.3) em vez de ficar em branco */}
      {mural.hoje.length === 0 ? (
        <p>{mural.semPlano ? MSG_MURAL.vazio : mural.semRefeicaoHoje ? MSG_MURAL.semRefeicaoHoje : MSG_MURAL.nadaAgora}</p>
      ) : (
        <ol aria-label="Hoje" className="space-y-2">
          {mural.hoje.map((i) => <Item key={i.chave} item={i} fuso={fuso} guia={i.chave === primeiraRefeicao} />)}
        </ol>
      )}
    </>
  );
}
