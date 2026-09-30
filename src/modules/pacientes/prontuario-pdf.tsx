import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { DadosExportacao } from './exportacao-job';

// Helvetica padrão do PDF (WinAnsi): cobre os acentos do português; o resto passa por paraWinAnsi (abaixo)
const s = StyleSheet.create({
  pagina: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  secao: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  linha: { flexDirection: 'row', gap: 8 },
  rotulo: { fontFamily: 'Helvetica-Bold' },
  rodape: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#555555',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

const br = (iso: string) => iso.split('-').reverse().join('/');
const num = (v: number | null) => (v === null ? '-' : String(v).replace('.', ','));

function Prontuario({ d, nutri }: { d: DadosExportacao; nutri: string }) {
  return (
    <Document title="Prontuário" author={nutri} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <Text style={s.titulo}>Prontuário nutricional</Text>
        <Text>{`${d.paciente.nome} · emitido em ${br(d.dataEmissao)} · ${nutri}`}</Text>

        <Text style={s.secao}>Identificação</Text>
        <Text>{`Nascimento: ${d.paciente.dataNascimento ? br(d.paciente.dataNascimento) : '-'} · Sexo: ${d.paciente.sexo ?? '-'} · E-mail: ${d.paciente.email} · Telefone: ${d.paciente.telefone ?? '-'}`}</Text>

        <Text style={s.secao}>Anamneses</Text>
        {d.anamneses.length === 0 && <Text>Nenhuma.</Text>}
        {d.anamneses.map((a, i) => (
          <View key={i} wrap={false}>
            <Text style={s.rotulo}>{`${br(a.data)} · ${a.modelo}`}</Text>
            {a.respostas.map((r, j) => (
              <Text key={j}>{`${r.pergunta}: ${r.resposta}`}</Text>
            ))}
          </View>
        ))}

        <Text style={s.secao}>Antropometria</Text>
        {d.antropometria.length === 0 && <Text>Nenhuma.</Text>}
        {d.antropometria.map((a, i) => (
          <Text
            key={i}
          >{`${br(a.data)}: peso ${num(a.pesoKg)} kg · altura ${num(a.alturaCm)} cm · IMC ${num(a.imc)} · % de gordura ${num(a.percGordura)}`}</Text>
        ))}

        <Text style={s.secao}>Gasto energético</Text>
        {d.gastoEnergetico.length === 0 && <Text>Nenhum.</Text>}
        {d.gastoEnergetico.map((g, i) => (
          <Text
            key={i}
          >{`${br(g.data)}: ${g.formula} · fator ${num(g.fatorAtividade)} · TMB ${g.tmbKcal} kcal · GET ${g.getKcal} kcal`}</Text>
        ))}

        <Text style={s.secao}>Exames</Text>
        {d.exames.length === 0 && <Text>Nenhum.</Text>}
        {d.exames.map((e, i) => (
          <View key={i} wrap={false}>
            <Text
              style={s.rotulo}
            >{`${br(e.data)} · ${e.titulo}${e.temLaudo ? ' (laudo anexado no sistema)' : ''}`}</Text>
            {e.valores.map((v, j) => (
              <Text
                key={j}
              >{`${v.nome}: ${num(v.valor)}${v.unidade ? ` ${v.unidade}` : ''}${v.referencia ? ` (referência ${v.referencia})` : ''}`}</Text>
            ))}
          </View>
        ))}

        <Text style={s.secao}>Orientações dos atendimentos</Text>
        {d.atendimentos.length === 0 && <Text>Nenhuma.</Text>}
        {d.atendimentos.map((a, i) => (
          <Text key={i}>{`${br(a.data)}: ${a.orientacoes ?? '-'}`}</Text>
        ))}

        <View style={s.rodape} fixed>
          <Text>Dados exportados do NutriDebby (LGPD, art. 18)</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/**
 * A Helvetica padrão só tem o conjunto WinAnsi: "≥ 40" (referência de exame), "−", emoji e afins sairiam
 * como outro caractere, sem erro. Troca os comuns por equivalentes e o resto por "?".
 */
const EQUIVALENTES: Record<string, string> = { '≥': '>=', '≤': '<=', '−': '-', '→': '->' };
const FORA_DO_WINANSI = /[^\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/gu;
export function paraWinAnsi(t: string): string {
  return t.replace(/[≥≤−→]/g, (c) => EQUIVALENTES[c] ?? c).replace(FORA_DO_WINANSI, '?');
}

export async function renderizarProntuario(dados: DadosExportacao, nutri: string): Promise<Buffer> {
  const limpo = JSON.parse(JSON.stringify(dados), (_k, v: unknown) =>
    typeof v === 'string' ? paraWinAnsi(v) : v,
  ) as DadosExportacao;
  return renderToBuffer(<Prontuario d={limpo} nutri={paraWinAnsi(nutri)} />);
}
