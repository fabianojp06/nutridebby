import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { signFileUrl } from '@/lib/signed-url';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { RetornoDaTela } from '@/app/painel/exames/retorno';
import { ROTULO_NEUTRA } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { abrirExame } from '@/modules/exames/detalhe';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { formatarData } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../prontuario';
import { VerReferencia } from '../ver-referencia';
import { ExcluirExame } from './excluir-exame';
import { NotaForm, type ModeloDeNota } from './nota-form';

export const dynamic = 'force-dynamic';

const X = MSG_EXAMES.exame;
const C = MSG_EXAMES.classificacao;
const N = MSG_EXAMES.nota;
const ID_DO_TITULO = 'exame-titulo';

/**
 * Plano 22 (T5a, US-372, US-373, RN-379 a RN-383, spec §7 "Detalhe do exame"): o exame aberto — a tabela "Marcador ·
 * Valor · Referência do laudo · Classificação · Ver referência" (a neutra pela faixa do laudo e, ao lado, a categoria do
 * consultório com "(faixa do consultório)"; os avisos fixos antes da tabela, ligados a ela), a "Nota de interpretação" e
 * "Editar", "Versões anteriores", "Baixar laudo", "Excluir". Lê só por `abrirExame` (pelos dois ids, com o `auditRead`);
 * exame de outro paciente → 404. Paciente bloqueado: só leitura. O título do prontuário (h1) é o nome do paciente; o desta
 * tela é o h2 que recebe o foco depois de salvar ou apagar a nota.
 */
export default async function ExamePage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/exames/[exameId]'>) {
  const { id, exameId } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const e = await abrirExame(ctx, paciente.id, exameId);
  if (!e) notFound();
  const busca = await searchParams;
  const bloqueado = paciente.status === 'bloqueado';
  const base = `/painel/pacientes/${paciente.id}/exames`;
  const data = formatarData(e.data);
  const retorno = busca.nota === 'salva' ? N.salva : busca.nota === 'apagada' ? N.apagada : '';
  const marcador = typeof busca.r === 'string' ? busca.r : '';
  const comClassificacao = e.linhas.some((l) => l.neutra || l.categoria);
  const comCategoria = e.linhas.some((l) => l.categoria);
  const descritos = [comClassificacao ? 'exame-aviso-classificacao' : null, comCategoria ? 'exame-aviso-gestacao' : null].filter(Boolean).join(' ') || undefined;
  // RN-375: os modelos dos exames fora da faixa do laudo (neutra "Abaixo"/"Acima") que casam com o catálogo
  const modelos: ModeloDeNota[] = [];
  for (const l of e.linhas) {
    if (l.neutra !== 'abaixo' && l.neutra !== 'acima') continue;
    const texto = l.modeloNota?.[l.neutra];
    const rotulo = N.modelo(l.nome, l.neutra);
    if (texto && !modelos.some((m) => m.rotulo === rotulo)) modelos.push({ rotulo, texto });
  }

  return (
    <section aria-labelledby={ID_DO_TITULO} className="max-w-6xl space-y-4">
      <p>
        <Link href={base} className="inline-flex min-h-11 items-center text-link underline">
          {MSG_EXAMES.comparativo.voltar}
        </Link>
      </p>
      <h2 id={ID_DO_TITULO} tabIndex={-1} className="wrap-break-word text-lg font-semibold">
        {`${e.titulo} — ${data}`}
      </h2>
      <RetornoDaTela texto={retorno} marcador={marcador} focarTitulo={ID_DO_TITULO} />
      <div className="flex flex-wrap items-center gap-4">
        {!bloqueado && (
          <Link href={`${base}/${e.id}/editar`} aria-label={X.editarRotulo(e.titulo, data)} className="inline-flex min-h-11 items-center text-link underline">
            {X.editar}
          </Link>
        )}
        <Link href={`${base}/${e.id}/versoes`} className="inline-flex min-h-11 items-center text-link underline">
          {X.versoes}
        </Link>
        {e.arquivoPath && (
          <a href={signFileUrl(e.arquivoPath)} rel="noreferrer" className="inline-flex min-h-11 items-center text-link underline">
            Baixar laudo
          </a>
        )}
        {!bloqueado && <ExcluirExame patientId={paciente.id} exameId={e.id} rotulo={`Excluir o exame ${e.titulo} de ${data}`} noApp={!!e.noAppEm} />}
      </div>

      {e.linhas.length === 0 ? (
        <p>{X.semValores}</p>
      ) : (
        <div className="space-y-2">
          {comClassificacao && (
            <p id="exame-aviso-classificacao" className="text-sm text-suave">
              {C.aviso}
            </p>
          )}
          {comCategoria && (
            <p id="exame-aviso-gestacao" className="text-sm text-suave">
              {C.gestacao}
            </p>
          )}
          <div role="region" aria-labelledby="exame-valores-legenda" tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-3px]">
            <table className="w-full text-left" aria-describedby={descritos}>
              <caption id="exame-valores-legenda" className="sr-only">
                {X.valoresDoExame(e.titulo)}
              </caption>
              <thead className="text-sm text-suave">
                <tr>
                  <th scope="col" className="px-2 py-1">Marcador</th>
                  <th scope="col" className="px-2 py-1">Valor</th>
                  <th scope="col" className="px-2 py-1">Referência do laudo</th>
                  <th scope="col" className="px-2 py-1">Classificação</th>
                  <th scope="col" className="px-2 py-1">{MSG_EXAMES.ref.botao}</th>
                </tr>
              </thead>
              <tbody>
                {e.linhas.map((l, i) => (
                  <tr key={`${i}-${l.nome}`} className="border-t border-linha align-top">
                    <th scope="row" className="px-2 py-1 font-normal">{l.nome}</th>
                    <td className="px-2 py-1">{`${formatarDecimal(l.valor, casasDecimais(l.valor))}${l.unidade ? ` ${l.unidade}` : ''}`}</td>
                    <td className="wrap-break-word px-2 py-1">{l.referencia ?? '—'}</td>
                    <td className="px-2 py-1">
                      {l.neutra ? ROTULO_NEUTRA[l.neutra] : '—'}
                      {l.categoria && <span className="block">{`${l.categoria.nome} ${C.faixaDoConsultorio}`}</span>}
                    </td>
                    <td className="px-2 py-1">
                      <VerReferencia marcador={l.nome} referencia={l.referencia} refMin={l.refMin} refMax={l.refMax} faixas={l.faixasDoConsultorio} unidadeDoCatalogo={l.unidadeDoCatalogo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section aria-labelledby="nota-titulo" className="max-w-3xl space-y-3 rounded-2xl border border-borda bg-cartao p-3">
        <h3 id="nota-titulo" className="font-semibold">
          {N.titulo}
        </h3>
        {bloqueado ? (
          <>
            {e.nota ? <p className="wrap-break-word whitespace-pre-line">{e.nota.texto}</p> : <p>—</p>}
            <Aviso tipo="aviso" papel="nenhum">{MSG_BLOQUEADO}</Aviso>
          </>
        ) : (
          <NotaForm key={e.nota?.versao ?? 0} patientId={paciente.id} exameId={e.id} texto={e.nota?.texto ?? null} modelos={modelos} />
        )}
      </section>
    </section>
  );
}
