import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { CIRCUNFERENCIAS } from './antropometria-constantes';
import { formatarData } from './datas';
import type { DadosExportacao } from './exportacao-job';
import { DOBRAS } from './formulas';

// Helvetica padrão do PDF (WinAnsi): cobre os acentos do português; o resto passa por paraWinAnsi (abaixo)
const s = StyleSheet.create({
  // paddingBottom 48: o corpo termina em 841,89 − 48 = 793,89 pt, 14 pt acima do rodapé (que começa em 807,89)
  pagina: { padding: 36, paddingBottom: 48, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  secao: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  linha: { flexDirection: 'row', gap: 8 },
  rotulo: { fontFamily: 'Helvetica-Bold' },
  // SUS-99: o rodapé vai por `top`, não por `bottom`. Com o número da página (`render`) dentro de um nó absoluto por
  // `bottom`, o @react-pdf 4.9 desenhava o rodapé fora da página (y de milhares de pt) e, acima de ~10 páginas, quebrava
  // ("unsupported number"). Premissa: `size="A4"` (841,89 pt de altura) — mudou o tamanho da página, refaça a conta.
  // A linha do rodapé tem 14 pt (o `lineHeight: 1.4` da página vale sobre os 10 pt dela e é herdado assim pelo texto de
  // 8 pt): o `bottom: 20` de antes punha a linha em 841,89 − 20 − 14 = 807,89 pt.
  rodape: {
    position: 'absolute',
    top: 807.89,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#555555',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

const SEXO: Record<string, string> = { F: 'Feminino', M: 'Masculino' };
// Mesma formatação da tela (RNF-12): casas fixas onde a tela fixa; senão, as casas digitadas
const br = formatarData;
const num = (v: number | null, casas?: number) =>
  v === null ? '-' : formatarDecimal(v, casas ?? casasDecimais(v));
const PROTOCOLO: Record<string, string> = {
  jp3: 'JP 3 dobras',
  jp7: 'JP 7 dobras',
  nenhum: 'sem protocolo de dobras',
};
const PEDIDO: Record<string, string> = { exportacao: 'Exportação', exclusao: 'Exclusão' };
const SITUACAO: Record<string, string> = { aberto: 'aberto', concluido: 'concluído' };
// Na ordem da tela (o jsonb não guarda a ordem das chaves); chave fora da lista vai no fim, pelo id
const medidas = (
  m: Record<string, number>,
  lista: readonly { id: string; rotulo: string }[],
  unidade: string,
) =>
  [
    ...lista.filter((x) => x.id in m),
    ...Object.keys(m)
      .filter((k) => !lista.some((x) => x.id === k))
      .map((id) => ({ id, rotulo: id })),
  ]
    .map((x) => `${x.rotulo} ${num(m[x.id])} ${unidade}`)
    .join(' · ');

const ou = (v: string | null | undefined) => v || '-';
/** "Rua, número, complemento · bairro · cidade (UF) · CEP 00000-000", só com o que foi preenchido; nada → "-". */
function endereco(e: NonNullable<DadosExportacao['paciente']['cadastro']>['endereco'] | undefined): string {
  if (!e) return '-';
  const cidade = e.cidade && e.uf ? `${e.cidade} (${e.uf})` : e.cidade || e.uf;
  const partes = [[e.rua, e.numero, e.complemento].filter(Boolean).join(', '), e.bairro, cidade, e.cep ? `CEP ${e.cep}` : null].filter(Boolean);
  return partes.length ? partes.join(' · ') : '-';
}

/**
 * Plano 18 (§10, D7, RN-262, RN-266; Res. CFN 594/2017, art. 4º, § 1º, I): a identificação que a 594 pede, com o nome
 * civil primeiro e "Nome social: …" logo depois (como a impressão). Sem o CPF (só no dados.json, RN-262) e sem a
 * observação do cadastro (fica no dados.json).
 */
function Identificacao({ p }: { p: DadosExportacao['paciente'] }) {
  const c = p.cadastro;
  return (
    <View>
      <Text>{`Nome: ${p.nome}`}</Text>
      {c?.nomeSocial && <Text>{`Nome social: ${c.nomeSocial}`}</Text>}
      <Text>{`Nascimento: ${p.dataNascimento ? br(p.dataNascimento) : '-'} · Sexo: ${SEXO[p.sexo ?? ''] ?? '-'} · Identidade de gênero: ${ou(c?.identidadeDeGenero)}`}</Text>
      <Text>{`Estado civil: ${ou(c?.estadoCivil)} · Nacionalidade: ${ou(c?.nacionalidade)} · Naturalidade: ${ou(c?.naturalidade)}`}</Text>
      <Text>{`Escolaridade: ${ou(c?.escolaridade)} · Ocupação: ${ou(c?.ocupacao)}`}</Text>
      <Text>{`Endereço: ${endereco(c?.endereco)}`}</Text>
      <Text>{`E-mail: ${p.email} · Celular: ${ou(p.telefone)} · Telefone fixo: ${ou(c?.telefoneFixo)}`}</Text>
    </View>
  );
}

function Prontuario({ d, nutri }: { d: DadosExportacao; nutri: string }) {
  return (
    <Document title="Prontuário" author={nutri} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <Text style={s.titulo}>Prontuário nutricional</Text>
        <Text>{`${d.paciente.nome} · emitido em ${br(d.dataEmissao)} · ${nutri}`}</Text>

        <Text style={s.secao}>Identificação</Text>
        <Identificacao p={d.paciente} />

        <Text style={s.secao}>Anamneses</Text>
        {d.anamneses.length === 0 && <Text>Nenhuma.</Text>}
        {d.anamneses.map((a, i) => (
          <View key={i}>
            <Text style={s.rotulo} minPresenceAhead={28}>{`${br(a.data)} · ${a.modelo}`}</Text>
            {a.respostas.map((r, j) => (
              <Text key={j}>{`${r.pergunta}: ${r.resposta}`}</Text>
            ))}
          </View>
        ))}

        <Text style={s.secao}>Antropometria</Text>
        {d.antropometria.length === 0 && <Text>Nenhuma.</Text>}
        {d.antropometria.map((a, i) => (
          <View key={i}>
            <Text>{`${br(a.data)}: peso ${num(a.pesoKg, 2)} kg · altura ${num(a.alturaCm, 1)} cm · IMC ${num(a.imc, 2)} · % de gordura ${num(a.percGordura, 2)} (${PROTOCOLO[a.protocolo] ?? a.protocolo})`}</Text>
            {Object.keys(a.circunferencias).length > 0 && (
              <Text>{`Circunferências: ${medidas(a.circunferencias, CIRCUNFERENCIAS, 'cm')}`}</Text>
            )}
            {Object.keys(a.dobrasMm).length > 0 && (
              <Text>{`Dobras: ${medidas(a.dobrasMm, DOBRAS, 'mm')}`}</Text>
            )}
          </View>
        ))}

        <Text style={s.secao}>Gasto energético</Text>
        {d.gastoEnergetico.length === 0 && <Text>Nenhum.</Text>}
        {d.gastoEnergetico.map((g, i) => (
          <Text
            key={i}
          >{`${br(g.data)}: ${g.formula} · fator ${num(g.fatorAtividade, 2)} · TMB ${g.tmbKcal} kcal · GET ${g.getKcal} kcal`}</Text>
        ))}

        <Text style={s.secao}>Exames</Text>
        {d.exames.length === 0 && <Text>Nenhum.</Text>}
        {d.exames.map((e, i) => (
          <View key={i}>
            <Text
              style={s.rotulo}
              minPresenceAhead={28}
            >{`${br(e.data)} · ${e.titulo}${e.laudo ? ` (laudo: ${e.laudo})` : e.temLaudo ? ' (laudo guardado no sistema, fora desta exportação)' : ''}`}</Text>
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

        <Text style={s.secao}>Pedidos do titular (LGPD)</Text>
        {d.pedidosLgpd.length === 0 && <Text>Nenhum.</Text>}
        {d.pedidosLgpd.map((r, i) => (
          <Text
            key={i}
          >{`${PEDIDO[r.tipo] ?? r.tipo} · ${SITUACAO[r.status] ?? r.status} · prazo ${br(r.prazo)}`}</Text>
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
