import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { paraWinAnsi as w } from '@/modules/pacientes/prontuario-pdf';
import { formatarCodigo } from './codigo';
import { AREA_ASSINATURA as A, linhaDaVersao, RESSALVA_PARECER } from './constantes';
import { CABECALHO_VALORES, linhaDoValor, MSG_PARECER, rotuloDoExame, type ConteudoDocumento, type ConteudoParecer } from './parecer';
import { descreverItem, type ConteudoReceita } from './prescricao';
import type { ConteudoSolicitacao } from './solicitacao';
import { assertNever, rotuloDoTipo } from './tipos-de-documento';

/** Só o worker importa este arquivo (guarda de grafo em exportacao.test.ts). Plano 13: a receita e o parecer. Plano 22: a solicitação. */
export type DadosPdfDocumento = { conteudo: ConteudoDocumento; codigo: string; urlVerificacao: string; data: string; cor: string; logo: Buffer | null; nomeConsultorio: string };

const ALTURA_RODAPE = 150; // o quadro (y1 62 → y2 132) + a faixa do código; o conteúdo nunca passa por baixo
const s = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: ALTURA_RODAPE, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  item: { marginTop: 8 },
  itemTitulo: { fontFamily: 'Helvetica-Bold' },
  secao: { marginTop: 12, fontFamily: 'Helvetica-Bold' },
  cabecalho: { fontSize: 8, color: '#666666' },
  ressalva: { marginTop: 14, fontSize: 9, fontFamily: 'Helvetica-Oblique' },
  carimbo: { marginTop: 18, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#999999' },
  quadro: { position: 'absolute', left: A.x1, bottom: A.y1, width: A.x2 - A.x1, height: A.y2 - A.y1, borderWidth: 1, borderColor: '#999999', borderStyle: 'dashed' },
  rodape: { position: 'absolute', left: 36, right: 36, bottom: 16, flexDirection: 'row', alignItems: 'center' },
});

function CorpoReceita({ c }: { c: ConteudoReceita }) {
  return (
    <>
      {c.itens.map((it, i) => {
        const x = descreverItem(it);
        return (
          <View key={i} style={s.item} wrap={false}>
            <Text style={s.itemTitulo}>{w(`${i + 1}. ${x.titulo}`)}</Text>
            {x.linhas.map((l) => <Text key={l}>{w(l)}</Text>)}
          </View>
        );
      })}
      {c.orientacoes ? <Text style={{ marginTop: 12 }}>{w(`Orientações gerais: ${c.orientacoes}`)}</Text> : null}
    </>
  );
}

/**
 * US-141 v0.5 (PDF proposto): "Exames considerados" com a cópia congelada (RN-148) — por exame, "{título} — dd/mm/aaaa" e a
 * tabela, ou "(laudo no prontuário, sem valores lançados)"; a origem dos valores NÃO sai aqui (Q13-2 ★); depois a avaliação,
 * a conduta e os encaminhamentos (se houver) e a ressalva fixa da D5.
 */
function CorpoParecer({ c }: { c: ConteudoParecer }) {
  return (
    <>
      <Text style={s.secao}>Exames considerados</Text>
      {/* Revisão do plano: um exame tem até 50 linhas (exames.ts, MAX_LINHAS) e passa da altura útil (842 − 36 − ALTURA_RODAPE).
          wrap={false} no exame inteiro faria o react-pdf desenhar o bloco numa página só, por cima do quadro "Assinatura digital"
          e do rodapé. Como no plano-pdf.tsx: o título não fica sozinho no fim da página (minPresenceAhead) e só cada linha é
          indivisível. */}
      {c.exames.map((e) => (
        <View key={e.id} style={s.item}>
          <Text style={s.itemTitulo} minPresenceAhead={28}>{w(rotuloDoExame(e))}</Text>
          {e.valores.length === 0 ? (
            <Text wrap={false}>{w(`(${MSG_PARECER.semValores})`)}</Text>
          ) : (
            <>
              <Text style={s.cabecalho} minPresenceAhead={14}>{w(CABECALHO_VALORES)}</Text>
              {e.valores.map((v, i) => <Text key={i} wrap={false}>{w(linhaDoValor(v))}</Text>)}
            </>
          )}
        </View>
      ))}
      <Text style={s.secao}>Avaliação nutricional</Text>
      <Text>{w(c.avaliacao)}</Text>
      {c.conduta ? (
        <>
          <Text style={s.secao}>Conduta e orientações</Text>
          <Text>{w(c.conduta)}</Text>
        </>
      ) : null}
      {c.encaminhamentos ? (
        <>
          <Text style={s.secao}>Encaminhamentos</Text>
          <Text>{w(c.encaminhamentos)}</Text>
        </>
      ) : null}
      <Text style={s.ressalva}>{w(RESSALVA_PARECER)}</Text>
    </>
  );
}

/**
 * Plano 22 (RN-389, EP-D2, US-377): título fixo (o do tipo, no `Documento`), os exames — um painel com o nome dele —, a
 * indicação clínica só se preenchida e as orientações; nenhum campo de laboratório. Texto puro nesta tarefa (T7); a
 * marcação (`lerMarcacao`) entra com o editor.
 */
function CorpoSolicitacao({ c }: { c: ConteudoSolicitacao }) {
  return (
    <>
      <Text style={s.secao} minPresenceAhead={14}>Exames solicitados</Text>
      {c.exames.map((e, i) => <Text key={i} wrap={false}>{w(`${i + 1}. ${e.nome}`)}</Text>)}
      {c.indicacaoClinica ? (
        <>
          <Text style={s.secao} minPresenceAhead={14}>Indicação clínica</Text>
          <Text>{w(c.indicacaoClinica)}</Text>
        </>
      ) : null}
      {c.orientacoes ? (
        <>
          <Text style={s.secao} minPresenceAhead={14}>Orientações</Text>
          <Text>{w(c.orientacoes)}</Text>
        </>
      ) : null}
    </>
  );
}

/** DEP-E7: o corpo por `switch` (nunca "o que não é parecer é receita"). */
function Corpo({ c }: { c: ConteudoDocumento }) {
  switch (c.tipo) {
    case 'receita':
      return <CorpoReceita c={c} />;
    case 'parecer':
      return <CorpoParecer c={c} />;
    case 'solicitacao_exames':
      return <CorpoSolicitacao c={c} />;
    default:
      return assertNever(c);
  }
}

function Documento({ d, qr }: { d: DadosPdfDocumento; qr: Buffer }) {
  const c = d.conteudo;
  const p = c.copia!.profissional;
  const titulo = rotuloDoTipo(c.tipo);
  const retificacao = c.copia!.retificacao;
  const carimbo = [p.nomeCompleto, 'Nutricionista', p.crn, p.email, p.telefone].join(' · ');
  return (
    <Document title={titulo} author={p.nomeCompleto} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{w(d.nomeConsultorio)}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>{w(titulo)}</Text>
        {/* Q13-5 ★ / NGS1.01.01: a versão nova diz qual documento ela substitui */}
        {retificacao ? <Text>{w(linhaDaVersao(retificacao.versao, formatarCodigo(retificacao.substitui)))}</Text> : null}
        <Text>{w(`Paciente: ${c.copia!.paciente.nome}`)}</Text>
        <Text>{`Data de emissão: ${d.data}`}</Text>
        <Corpo c={c} />
        <View style={s.carimbo} wrap={false}>
          <Text>{w(carimbo)}</Text>
          {p.endereco ? <Text>{w(p.endereco)}</Text> : null}
        </View>
        {/* D15 / RN-144 (6): o quadro em branco, em TODA página, na posição gravada em area_assinatura */}
        <View fixed style={s.quadro}>
          <Text style={{ fontSize: 8, color: '#666666', margin: 4 }}>Assinatura digital</Text>
        </View>
        <View fixed style={s.rodape}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          <Image src={{ data: qr, format: 'png' }} style={{ width: 40, height: 40, marginRight: 8 }} />
          <Text style={{ fontSize: 8, flex: 1 }}>{`Código de verificação: ${formatarCodigo(d.codigo)} · Verifique em ${d.urlVerificacao}`}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderizarDocumento(d: DadosPdfDocumento): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.urlVerificacao, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return renderToBuffer(<Documento d={d} qr={qr} />);
}
