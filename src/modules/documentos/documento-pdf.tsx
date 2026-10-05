import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { paraWinAnsi as w } from '@/modules/pacientes/prontuario-pdf';
import { formatarCodigo } from './codigo';
import { AREA_ASSINATURA as A } from './constantes';
import { descreverItem, type ConteudoReceita } from './prescricao';

/** Só o worker importa este arquivo (guarda de grafo em exportacao.test.ts). */
export type DadosPdfDocumento = { conteudo: ConteudoReceita; codigo: string; urlVerificacao: string; data: string; cor: string; logo: Buffer | null; nomeConsultorio: string };

const ALTURA_RODAPE = 150; // o quadro (y1 62 → y2 132) + a faixa do código; o conteúdo nunca passa por baixo
const s = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: ALTURA_RODAPE, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  item: { marginTop: 8 },
  itemTitulo: { fontFamily: 'Helvetica-Bold' },
  carimbo: { marginTop: 18, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#999999' },
  quadro: { position: 'absolute', left: A.x1, bottom: A.y1, width: A.x2 - A.x1, height: A.y2 - A.y1, borderWidth: 1, borderColor: '#999999', borderStyle: 'dashed' },
  rodape: { position: 'absolute', left: 36, right: 36, bottom: 16, flexDirection: 'row', alignItems: 'center' },
});

function Receita({ d, qr }: { d: DadosPdfDocumento; qr: Buffer }) {
  const c = d.conteudo;
  const p = c.copia!.profissional;
  const carimbo = [p.nomeCompleto, 'Nutricionista', p.crn, p.email, p.telefone].join(' · ');
  return (
    <Document title="Receita" author={p.nomeCompleto} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{w(d.nomeConsultorio)}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>Receita</Text>
        <Text>{w(`Paciente: ${c.copia!.paciente.nome}`)}</Text>
        <Text>{`Data de emissão: ${d.data}`}</Text>
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
  return renderToBuffer(<Receita d={d} qr={qr} />);
}
