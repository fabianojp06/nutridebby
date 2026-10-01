import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { FONTE_TACO_TEXTO } from '@/modules/alimentos/taco';
import { paraWinAnsi } from '@/modules/pacientes/prontuario-pdf';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { diferencaKcalDoItem, gTexto, kcalTexto, nutrientesDoItem, totalDoDia, totalDosItens } from './calculo';
import type { PlanoCompleto, RefeicaoPlano } from './tipos';

/** Só o worker importa este arquivo (US-026; fora do grafo do Next — guarda em exportacao.test.ts). */
export type DadosPdfPlano = {
  plano: PlanoCompleto;
  nutricionista: { nome: string; crn: string | null };
  paciente: string;
  /** dd/mm/aaaa no fuso do tenant. */
  data: string;
  cor: string;
  logo: Buffer | null;
};

const s = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: 48, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  refeicao: { marginTop: 10, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  item: { marginLeft: 8 },
  sub: { marginLeft: 22, color: '#444444' },
  obs: { marginLeft: 8, color: '#444444', fontStyle: 'italic' },
  rodape: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 8, color: '#666666', flexDirection: 'row', justifyContent: 'space-between' },
});

/** Helvetica padrão (WinAnsi): todo texto do PDF passa por aqui, inclusive o calculado (o "−" de "−11 kcal" vira "-"). */
const w = paraWinAnsi;
const gramas = (g: number) => `${formatarDecimal(g, casasDecimais(g))} g`;
const quantidade = (i: RefeicaoPlano['itens'][number]) => (i.medidaCaseiraTxt ? `${i.medidaCaseiraTxt} (${gramas(i.quantidadeG)})` : gramas(i.quantidadeG));
const porHorario = (rs: RefeicaoPlano[]) => [...rs].sort((a, b) => a.horario.localeCompare(b.horario));
const calculo = (r: RefeicaoPlano) => r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId }));

function Plano({ d }: { d: DadosPdfPlano }) {
  const { plano } = d;
  const total = totalDoDia(plano.refeicoes.map((r) => ({ itens: calculo(r) })));
  return (
    <Document title={plano.titulo} author={d.nutricionista.nome} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <View>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{d.nutricionista.nome}</Text>
            {d.nutricionista.crn && <Text>{d.nutricionista.crn}</Text>}
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> e não tem alt */}
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>{plano.titulo}</Text>
        <Text>Paciente: {d.paciente}</Text>
        <Text>Data: {d.data}</Text>
        {plano.mostrarCalorias && (
          <View>
            <Text>{w(`Total do dia: ${kcalTexto(total.kcal)} kcal`)}</Text>
            <Text>{w(`Proteína: ${gTexto(total.proteinaG)} g · Carboidrato: ${gTexto(total.carboidratoG)} g · Lipídio: ${gTexto(total.lipidioG)} g · Fibra: ${gTexto(total.fibraG)} g`)}</Text>
          </View>
        )}
        {/* A refeição quebra entre páginas (uma maior que a página seria cortada); o título não fica sozinho no
            fim da página (minPresenceAhead) e cada linha de item fica inteira (wrap={false} só no item). */}
        {porHorario(plano.refeicoes).map((r) => (
          <View key={r.id}>
            <Text style={s.refeicao} minPresenceAhead={28}>
              {r.nome} · {r.horario}
              {plano.mostrarCalorias ? w(`  (${kcalTexto(totalDosItens(calculo(r)).kcal)} kcal)`) : ''}
            </Text>
            {r.itens.map((i) => {
              const n = nutrientesDoItem(i.porCem, i.quantidadeG);
              const principal = r.itens.find((x) => x.id === i.substituiItemId);
              const semKcal = n.semValor.includes('kcal');
              const kcal = plano.mostrarCalorias ? w(semKcal ? ' · —' : ` · ${kcalTexto(n.kcal)} kcal`) : '';
              if (!principal) return <Text key={i.id} style={s.item} wrap={false}>• {i.nome} — {quantidade(i)}{kcal}</Text>;
              const difKcal = diferencaKcalDoItem(n, nutrientesDoItem(principal.porCem, principal.quantidadeG));
              const dif = plano.mostrarCalorias && difKcal ? w(` (${difKcal})`) : '';
              return <Text key={i.id} style={s.sub} wrap={false}>ou {i.nome} — {quantidade(i)}{kcal}{dif}</Text>;
            })}
            {r.observacao && <Text style={s.obs}>{r.observacao}</Text>}
          </View>
        ))}
        {plano.orientacoes && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.refeicao}>Orientações</Text>
            <Text>{plano.orientacoes}</Text>
          </View>
        )}
        <View style={s.rodape} fixed>
          <Text>Fonte: {FONTE_TACO_TEXTO}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Helvetica padrão (WinAnsi), como o prontuário: todo texto passa por paraWinAnsi (emoji e afins viram "?"). */
export async function renderizarPlano(d: DadosPdfPlano): Promise<Buffer> {
  const plano: PlanoCompleto = {
    ...d.plano,
    titulo: w(d.plano.titulo),
    orientacoes: w(d.plano.orientacoes),
    refeicoes: d.plano.refeicoes.map((r) => ({
      ...r,
      nome: w(r.nome),
      observacao: w(r.observacao),
      itens: r.itens.map((i) => ({ ...i, nome: w(i.nome), medidaCaseiraTxt: i.medidaCaseiraTxt && w(i.medidaCaseiraTxt) })),
    })),
  };
  return renderToBuffer(<Plano d={{ ...d, plano, paciente: w(d.paciente), nutricionista: { nome: w(d.nutricionista.nome), crn: d.nutricionista.crn && w(d.nutricionista.crn) } }} />);
}
