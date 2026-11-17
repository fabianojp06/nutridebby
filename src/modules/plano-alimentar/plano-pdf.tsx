import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { FONTES, FONTES_DE_ALIMENTO, MSG_FONTES, type Fonte, type FontePublica } from '@/modules/alimentos/fontes';
import { formatarNutriente, formatarReferencia, MSG_NUTRIENTES, NUTRIENTES, type ChaveNutriente } from '@/modules/alimentos/nutrientes';
import { ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { paraWinAnsi } from '@/modules/pacientes/prontuario-pdf';
import { MSG_PLANO_DIAS } from '@/modules/portal/plano-regras';
import { diferencaKcalDoItem, gTexto, kcalTexto, nutrientesDoItem, quantidadeDoItem, totalDoDia, totalDosItens, totalMicros } from './calculo';
import { MSG_DIAS, MSG_PLANO } from './constantes';
import { perfisDeDia, rotuloDosDiasPorExtenso } from './dias';
import type { ListaLigada, PlanoCompleto, RefeicaoPlano } from './tipos';

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
  pagina: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  perfil: { marginTop: 16, fontSize: 13, fontFamily: 'Helvetica-Bold' },
  secao: { marginTop: 16, fontSize: 13, fontFamily: 'Helvetica-Bold' },
  refeicao: { marginTop: 10, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  grupo: { marginTop: 6, fontFamily: 'Helvetica-Bold' },
  item: { marginLeft: 8 },
  sub: { marginLeft: 22, color: '#444444' },
  obs: { marginLeft: 8, color: '#444444', fontStyle: 'italic' },
  rodape: { position: 'absolute', bottom: 20, left: 36, right: 84, fontSize: 8, color: '#666666' },
  // A4 tem 841,89 pt de altura: a linha do número fica onde ficava com `bottom: 20`. O número vai por `top`, fora do
  // rodapé: o @react-pdf 4.9 quebra ("unsupported number") com um `render` em nó absoluto por `bottom` num documento
  // de muitas páginas (PM-PA9: 50 refeições e 400 itens)
  paginaN: { position: 'absolute', top: 810, right: 36, width: 48, textAlign: 'right', fontSize: 8, color: '#666666' },
});

/** Helvetica padrão (WinAnsi): todo texto do PDF passa por aqui, inclusive o calculado (o "−" de "−11 kcal" vira "-"). */
const w = paraWinAnsi;
const porHorario = (rs: RefeicaoPlano[]) => [...rs].sort((a, b) => a.horario.localeCompare(b.horario));
const calculo = (r: RefeicaoPlano) => r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId }));
const NOME_DO_NUTRIENTE = new Map<string, string>(NUTRIENTES.map((n) => [n.chave, n.nome]));
/** " · 139 kcal" do item (ou " · —" sem kcal na fonte, RN-02). */
const kcalDoItem = (porCem: RefeicaoPlano['itens'][number]['porCem'], g: number) => {
  const n = nutrientesDoItem(porCem, g);
  return n.semValor.includes('kcal') ? ' · —' : ` · ${kcalTexto(n.kcal)} kcal`;
};

/**
 * RN-233: as tabelas públicas usadas no plano — itens congelados das refeições e itens das listas ligadas, com a fonte de
 * origem do "Meu alimento" duplicado —, na ordem do catálogo; `usda` liga o aviso da tradução dos nomes.
 */
function fontesDoPlano(plano: Pick<PlanoCompleto, 'refeicoes' | 'listas'>): { fontes: FontePublica[]; usda: boolean } {
  const usadas = new Set<Fonte>();
  const anotar = (i: { fonte: Fonte; fonteOrigem?: Fonte | null }) => {
    usadas.add(i.fonte);
    if (i.fonteOrigem) usadas.add(i.fonteOrigem);
  };
  for (const r of plano.refeicoes) r.itens.forEach(anotar);
  for (const l of plano.listas) for (const g of l.grupos) g.itens.forEach(anotar);
  const fontes = FONTES_DE_ALIMENTO.filter((f): f is FontePublica => f !== 'propria' && usadas.has(f));
  return { fontes, usda: usadas.has('usda') };
}

/** RN-239: "Ferro 12,4 mg (meta 18 mg)"; passou do máximo e itens sem o valor (RN-236) entram no parêntese. */
function textoDoNutriente(c: ChaveNutriente, t: { total: number; semValor: number }, ref: PlanoCompleto['referenciaCongelada']): string {
  const nome = NOME_DO_NUTRIENTE.get(c)!;
  const v = ref?.valores[c];
  const extras: string[] = [];
  if (typeof v?.meta === 'number') extras.push(`meta ${formatarReferencia(c, v.meta)}`);
  if (typeof v?.maximo === 'number' && t.total > v.maximo) extras.push(MSG_NUTRIENTES.acimaDoMaximo(formatarReferencia(c, v.maximo)));
  if (t.semValor > 0) extras.push(MSG_NUTRIENTES.semValorDe(t.semValor, nome));
  return `${nome} ${formatarNutriente(c, t.total)}${extras.length ? ` (${extras.join('; ')})` : ''}`;
}

function Refeicao({ r, comKcal, livre }: { r: RefeicaoPlano; comKcal: boolean; livre: boolean }) {
  return (
    <View>
      {/* A refeição quebra entre páginas (uma maior que a página seria cortada); o título não fica sozinho no
          fim da página (minPresenceAhead) e cada linha de item fica inteira (wrap={false} só no item). */}
      <Text style={s.refeicao} minPresenceAhead={28}>
        {r.nome} · {r.horario}
        {comKcal ? w(`  (${kcalTexto(totalDosItens(calculo(r)).kcal)} kcal)`) : ''}
      </Text>
      {/* RN-243: no texto livre, o texto da nutricionista no lugar dos alimentos */}
      {livre && r.descricaoLivre && <Text style={s.item}>{r.descricaoLivre}</Text>}
      {!livre &&
        r.itens.map((i) => {
          const principal = r.itens.find((x) => x.id === i.substituiItemId);
          const kcal = comKcal ? w(kcalDoItem(i.porCem, i.quantidadeG)) : '';
          if (!principal) return <Text key={i.id} style={s.item} wrap={false}>• {i.nome} — {quantidadeDoItem(i)}{kcal}</Text>;
          const difKcal = diferencaKcalDoItem(nutrientesDoItem(i.porCem, i.quantidadeG), nutrientesDoItem(principal.porCem, principal.quantidadeG));
          const dif = comKcal && difKcal ? w(` (${difKcal})`) : '';
          return <Text key={i.id} style={s.sub} wrap={false}>ou {i.nome} — {quantidadeDoItem(i)}{kcal}{dif}</Text>;
        })}
      {r.observacao && <Text style={s.obs}>{r.observacao}</Text>}
    </View>
  );
}

function Listas({ listas, comKcal }: { listas: ListaLigada[]; comKcal: boolean }) {
  return (
    <View>
      <Text style={s.secao} minPresenceAhead={40}>{MSG_PLANO_DIAS.lista}</Text>
      {listas.map((l) => (
        <View key={l.id}>
          <Text style={s.refeicao} minPresenceAhead={28}>{l.nome}</Text>
          {l.orientacao && <Text style={s.obs}>{l.orientacao}</Text>}
          {l.grupos.map((g, k) => (
            <View key={k}>
              <Text style={s.grupo} minPresenceAhead={14}>{g.nome}</Text>
              {/* um Text por grupo, uma linha por item: 5 listas de 20 × 30 itens em ~2 s (um Text por item levava ~17 s,
                  PM-PA9); o texto quebra entre páginas só entre linhas */}
              <Text style={s.item}>{g.itens.map((i) => `• ${i.nome} — ${quantidadeDoItem(i)}${comKcal ? w(kcalDoItem(i.porCem, i.quantidadeG)) : ''}`).join('\n')}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Plano({ d }: { d: DadosPdfPlano }) {
  const { plano } = d;
  // RN-243: no texto livre não há cálculo — "Mostrar calorias" fica sem efeito (refeição, dia e lista), como no portal
  const livre = plano.modo === 'livre';
  const comKcal = plano.mostrarCalorias && !livre;
  // RN-239 (D12): nutrientes escolhidos e referência só com as duas caixas; RN-237: cópia de antes do Plano 19, sem micros
  const comMicros = comKcal && plano.mostrarMicrosPdf;
  const microsNaoRegistrados = comMicros && plano.refeicoes.some((r) => r.itens.some((i) => i.micros === null));
  const chaves = comMicros && !microsNaoRegistrados ? plano.nutrientesExibidos : [];
  const referencia = comMicros && !microsNaoRegistrados ? plano.referenciaCongelada : null;
  // RN-247 (g): um bloco por perfil de dia, cada um com as suas refeições e o total do dia (nunca a soma de todas)
  const perfis = perfisDeDia(porHorario(plano.refeicoes));
  const { fontes, usda } = fontesDoPlano(plano);
  const ligados = plano.conteudos.filter((c) => c.situacao === 'publicado' && c.contentId !== null);
  // o rodapé fixo cresce para cima com as fontes: a margem de baixo da página acompanha (uma linha ≈ 11,2 pt)
  const linhasDoRodape = Math.max(1, (fontes.length ? 1 + fontes.length : 0) + (fontes.includes('tbca') ? 1 : 0) + (usda ? 1 : 0));
  return (
    <Document title={plano.titulo} author={d.nutricionista.nome} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={[s.pagina, { paddingBottom: 36 + 12 * linhasDoRodape }]}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <View>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{d.nutricionista.nome}</Text>
            {d.nutricionista.crn && <Text>{d.nutricionista.crn}</Text>}
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> e não tem alt */}
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>{plano.titulo}</Text>
        {/* RN-117 / art. 37 (A-D13): o plano veio do rascunho da IA e foi revisado e publicado pela nutricionista */}
        {plano.iaOrigemEm && <Text style={{ fontStyle: 'italic', marginBottom: 4 }}>{w(MSG_PLANO.seloIa)}</Text>}
        <Text>Paciente: {d.paciente}</Text>
        <Text>Data: {d.data}</Text>
        {/* RN-244: a prescrição do texto livre (meta e distribuição), quando preenchida */}
        {livre && plano.metaKcal !== null && <Text>{w(`Meta: ${kcalTexto(plano.metaKcal)} kcal`)}</Text>}
        {livre && plano.macrosPrescritos && (
          <Text>{w(`Distribuição prescrita: Proteína ${plano.macrosPrescritos.proteina}% · Carboidrato ${plano.macrosPrescritos.carboidrato}% · Lipídio ${plano.macrosPrescritos.lipidio}%`)}</Text>
        )}
        {referencia && <Text>{w(`Referência: ${referencia.nome} — ${referencia.fonte}`)}</Text>}
        {microsNaoRegistrados && <Text>{w(MSG_NUTRIENTES.naoRegistrados)}</Text>}
        {perfis.map((p) => {
          const total = totalDoDia(p.refeicoes.map((r) => ({ itens: calculo(r) })));
          const micros = chaves.length ? totalMicros(p.refeicoes, chaves) : null;
          return (
            <View key={p.dias.join()}>
              {/* o cabeçalho do perfil fica inteiro e não fica sozinho no fim da página */}
              <View wrap={false} minPresenceAhead={40}>
                <Text style={s.perfil}>{w(rotuloDosDiasPorExtenso(p.dias))}</Text>
                <Text>{w(MSG_DIAS.refeicoesPorDia(p.refeicoes.length))}</Text>
                {comKcal && <Text>{w(`Total do dia: ${kcalTexto(total.kcal)} kcal`)}</Text>}
                {comKcal && <Text>{w(`Proteína: ${gTexto(total.proteinaG)} g · Carboidrato: ${gTexto(total.carboidratoG)} g · Lipídio: ${gTexto(total.lipidioG)} g · Fibra: ${gTexto(total.fibraG)} g`)}</Text>}
                {micros && <Text>{w(`Nutrientes: ${chaves.map((c) => textoDoNutriente(c, micros[c], referencia)).join(' · ')}`)}</Text>}
              </View>
              {p.refeicoes.map((r) => (
                <Refeicao key={r.id} r={r} comKcal={comKcal} livre={livre} />
              ))}
            </View>
          );
        })}
        {plano.orientacoes && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.refeicao}>Orientações</Text>
            <Text>{plano.orientacoes}</Text>
          </View>
        )}
        {/* RN-252: as cópias das listas ligadas, depois das refeições */}
        {plano.listas.length > 0 && <Listas listas={plano.listas} comKcal={comKcal} />}
        {/* RN-253: só os conteúdos ligados publicados (tipo e título), como a exportação do titular */}
        {ligados.length > 0 && (
          <View>
            <Text style={s.secao} minPresenceAhead={20}>{MSG_PLANO_DIAS.conteudos}</Text>
            {ligados.map((c) => (
              <Text key={c.id} style={s.item} wrap={false}>• {c.tipo ? `${ROTULO_TIPO_CONTEUDO[c.tipo]}: ` : ''}{c.titulo}</Text>
            ))}
          </View>
        )}
        {/* RN-233: só as fontes usadas, uma por linha, depois de "Fontes:" */}
        {fontes.length > 0 && (
          <View style={s.rodape} fixed>
            <Text>Fontes:</Text>
            {fontes.map((f) => (
              <Text key={f}>{w(FONTES[f].citacao)}</Text>
            ))}
            {usda && <Text>{w(MSG_FONTES.traduzidoNoPdf)}</Text>}
          </View>
        )}
        <Text style={s.paginaN} fixed render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
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
      descricaoLivre: r.descricaoLivre && w(r.descricaoLivre),
      itens: r.itens.map((i) => ({ ...i, nome: w(i.nome), medidaCaseiraTxt: i.medidaCaseiraTxt && w(i.medidaCaseiraTxt) })),
    })),
    listas: d.plano.listas.map((l) => ({
      ...l,
      nome: w(l.nome),
      orientacao: w(l.orientacao),
      grupos: l.grupos.map((g) => ({ ...g, nome: w(g.nome), itens: g.itens.map((i) => ({ ...i, nome: w(i.nome), medidaCaseiraTxt: i.medidaCaseiraTxt && w(i.medidaCaseiraTxt) })) })),
    })),
    conteudos: d.plano.conteudos.map((c) => ({ ...c, titulo: w(c.titulo) })),
  };
  return renderToBuffer(<Plano d={{ ...d, plano, paciente: w(d.paciente), nutricionista: { nome: w(d.nutricionista.nome), crn: d.nutricionista.crn && w(d.nutricionista.crn) } }} />);
}
